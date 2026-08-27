import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  DailyAutomationRunView,
  DailyAutomationView,
  ManualDailyReportBranchResult,
  ManualDailyReportInput,
  ManualDailyReportResult,
} from "../../shared/ipc";
import type { HubConfig } from "../config";
import { GitService, normalizeRemoteIdentity, type GitCommitSummary, type GitRepositoryIdentity } from "../git/git-service";
import { NotionAdapter, type DailyWorkReportBranch } from "../integrations/notion-adapter";
import { DiscordAdapter } from "../integrations/discord-adapter";

export interface DailyAutomationStateFile {
  version: 1;
  lastScheduledDate?: string;
  reportedHeads: Record<string, string>;
  pendingBaselines: Record<string, string>;
  lastRun?: DailyAutomationRunView;
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextLocalRunAt(now = new Date(), hour = 8): Date {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function shouldCatchUpToday(lastScheduledDate: string | undefined, now = new Date(), hour = 8): boolean {
  const scheduled = new Date(now);
  scheduled.setHours(hour, 0, 0, 0);
  return now.getTime() >= scheduled.getTime() && lastScheduledDate !== localDateKey(now);
}

export class DailyAutomationStateStore {
  private readonly file: string;

  public constructor(dataDirectory: string) {
    this.file = path.join(dataDirectory, "daily-automation.json");
  }

  public async read(): Promise<DailyAutomationStateFile> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<DailyAutomationStateFile>;
      if (raw.version !== undefined && raw.version !== 1) throw new Error("Unsupported daily automation state version");
      return {
        version: 1,
        lastScheduledDate: typeof raw.lastScheduledDate === "string" ? raw.lastScheduledDate : undefined,
        reportedHeads: raw.reportedHeads && typeof raw.reportedHeads === "object" ? raw.reportedHeads : {},
        pendingBaselines: raw.pendingBaselines && typeof raw.pendingBaselines === "object" ? raw.pendingBaselines : {},
        lastRun: isDailyAutomationRun(raw.lastRun) ? raw.lastRun : undefined,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { version: 1, reportedHeads: {}, pendingBaselines: {} };
      if (error instanceof SyntaxError) {
        throw new Error(`Daily automation state is corrupt: ${this.file}`);
      }
      throw error;
    }
  }

  public async write(state: DailyAutomationStateFile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.file);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

interface DailyAutomationOptions {
  config: HubConfig;
  git: GitService;
  notion: NotionAdapter;
  discord?: DiscordAdapter;
  /** 관리자 실행 시 저장소의 모든 로컬 브랜치를 분석합니다. */
  allBranches?: boolean;
  onChanged: () => void;
}

export class DailyAutomation {
  private readonly store: DailyAutomationStateStore;
  private state: DailyAutomationStateFile = { version: 1, reportedHeads: {}, pendingBaselines: {} };
  private timer: NodeJS.Timeout | null = null;
  private activeRun: Promise<DailyAutomationRunView> | null = null;
  private stopped = true;
  private repositoryViews: DailyAutomationView["repositories"] = [];
  private pendingScheduledRun = false;

  public constructor(private readonly options: DailyAutomationOptions) {
    this.store = new DailyAutomationStateStore(options.config.dataDirectory);
  }

  public async start(): Promise<void> {
    this.stopped = false;
    this.state = await this.store.read();
    await this.refreshBranches();
    this.scheduleNext();
    if (this.options.config.dailyAutomation.enabled && shouldCatchUpToday(this.state.lastScheduledDate)) {
      void this.run("catch-up");
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.activeRun?.catch(() => undefined);
  }

  public reconfigure(): void {
    if (!this.stopped) this.scheduleNext();
    void this.refreshBranches();
    this.options.onChanged();
  }

  public getView(): DailyAutomationView {
    return {
      enabled: this.options.config.dailyAutomation.enabled,
      selectedProjects: [...(this.options.config.dailyAutomation.projects ?? [])],
      repositories: this.repositoryViews,
      nextRunAt: this.options.config.dailyAutomation.enabled && !this.stopped
        ? nextLocalRunAt().toISOString()
        : null,
      lastRun: this.state.lastRun ?? null,
      running: this.activeRun !== null,
    };
  }

  public run(trigger: DailyAutomationRunView["trigger"] = "manual"): Promise<DailyAutomationRunView> {
    if (this.activeRun) {
      if (trigger === "manual") return Promise.reject(new Error("Daily automation is already running"));
      this.pendingScheduledRun = true;
      return this.activeRun;
    }
    this.activeRun = this.execute(trigger).finally(() => {
      this.activeRun = null;
      this.options.onChanged();
      if (this.pendingScheduledRun && !this.stopped) {
        this.pendingScheduledRun = false;
        void this.run("scheduled");
      }
    });
    this.options.onChanged();
    return this.activeRun;
  }

  /** 이전 08시~당일 08시 커밋을 선택된 브랜치별로 수집해 각각 Notion에 등록하고 Discord로 1건 알림합니다. */
  public async reportManualCommits(input: ManualDailyReportInput): Promise<ManualDailyReportResult> {
    const result: ManualDailyReportResult = { date: input.date, branches: [] };
    const repositorySettings = this.options.config.repositories.filter((item) =>
      input.repositories.includes(item.path),
    );
    if (repositorySettings.length === 0) throw new Error("선택된 저장소가 설정에 없습니다.");
    if (!this.options.notion.enabled) throw new Error("Notion integration is not configured");

    const workBranches = new Map<string, DailyWorkReportBranch>();
    for (const repositorySetting of repositorySettings) {
      await this.options.git.validateRepository(repositorySetting.path);
      for (const branch of input.branches) {
        const node: ManualDailyReportBranchResult = {
          repositoryLabel: repositorySetting.label,
          branch,
          status: "succeeded",
          commitCount: 0,
          message: "",
        };
        try {
          const capture = await this.options.git.captureBranchCommitsInTimeRange({
            repository: repositorySetting.path,
            branch,
            sinceIso: input.sinceIso,
            untilIso: input.untilIso,
          });
          node.commitCount = capture.commits.length;
          const workBranch = buildDailyWorkBranch({
            repositoryLabel: repositorySetting.label,
            stateKey: `manual|${repositorySetting.path}|${branch}`,
            notionDatabaseId: repositorySetting.notionDatabaseId,
            project: repositorySetting.project,
            repository: repositorySetting.path,
            branch,
            previousHead: null,
            currentHead: capture.currentHead,
            commits: capture.commits,
          });
          workBranches.set(repositorySetting.label + "|" + branch, workBranch);
          const pageId = await this.options.notion.createDailyWorkReport({
            date: input.date,
            reportKey: `manual|${input.date}|${repositorySetting.path}|${branch}`,
            repositoryDatabaseId: repositorySetting.notionDatabaseId,
            branches: [workBranch],
          });
          node.notionPageId = pageId;
          node.reported = true;
          node.message = capture.commits.length > 0
            ? `커밋 ${capture.commits.length}개 요약을 Notion에 등록했습니다.`
            : "해당 시간대에 새 커밋이 없습니다. 날짜만 표시됩니다.";
        } catch (error) {
          node.status = "failed";
          node.message = error instanceof Error ? error.message : String(error);
        }
        result.branches.push(node);
      }
    }

    if (this.options.discord?.enabled) {
      try {
        const discBranches = Array.from(workBranches.values());
        const filtered = filterDiscordBranches(discBranches, this.options.config.repositories);
        if (filtered.length > 0) {
          await this.options.discord.sendMessage(
            buildManualDiscordSummary(input.date, filtered, result.branches),
          );
        }
      } catch (error) {
        result.discordError = error instanceof Error ? error.message : String(error);
      }
    }
    return result;
  }

  private async execute(trigger: DailyAutomationRunView["trigger"]): Promise<DailyAutomationRunView> {
    const run: DailyAutomationRunView = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      trigger,
      scheduledSlot: trigger === "manual" ? undefined : scheduledSlotIso(),
      status: "running",
      branches: [],
    };
    this.state.lastRun = run;
    await this.store.write(this.state);
    this.options.onChanged();

    try {
      const selectedProjects = this.options.config.dailyAutomation.projects;
      const repositories = selectedProjects === undefined
        ? this.options.config.repositories
        : this.options.config.repositories.filter((repository) => selectedProjects.includes(projectName(repository.project)));
      if (repositories.length === 0) throw new Error("모니터링할 Git 저장소가 설정되지 않았습니다.");
      if (!this.options.notion.enabled) throw new Error("Notion integration is not configured");

      await this.refreshBranches();
      const captures: CapturedBranch[] = [];
      let anySelected = false;
      for (const repositorySetting of repositories) {
        const repository = repositorySetting.path;
        const selectedBranches = repositorySetting.branches.filter(Boolean);
        // 관리자 자동화는 저장소의 모든 로컬 브랜치를 분석합니다.
        const branches = this.options.allBranches === true
          ? [...new Set([...selectedBranches, ...(await this.options.git.listBranches(repository))])]
          : selectedBranches;
        await this.options.git.validateRepository(repository);
        if (branches.length > 0) anySelected = true;
        const identity = await this.options.git.getRepositoryIdentity(repository);
        let hasNewBaseline = false;
        const initialHeads = new Map<string, string>();
        const branchesNeedingBaseline = branches.filter((branch) => {
          const stateKey = `${identity.key}|origin|${branch}`;
          this.migrateLegacyBranchState(identity, branch, stateKey);
          return !this.state.reportedHeads[stateKey] && !this.state.pendingBaselines[stateKey];
        });
        if (branchesNeedingBaseline.length > 0) {
          for (const branch of branchesNeedingBaseline) {
            const head = await this.options.git.getBranchHead(repository, branch);
            if (!head) throw new Error(`브랜치 '${branch}'에 로컬 커밋이 없습니다.`);
            initialHeads.set(branch, head);
          }
          for (const [branch, head] of initialHeads) {
            this.state.pendingBaselines[`${identity.key}|origin|${branch}`] = head;
          }
          hasNewBaseline = true;
          await this.store.write(this.state);
        }

        for (const branch of branches) {
          const stateKey = `${identity.key}|origin|${branch}`;
          const reportedHead = this.state.reportedHeads[stateKey] ?? null;
          const pendingBaseline = this.state.pendingBaselines[stateKey] ?? null;
          const previousHead = reportedHead ?? pendingBaseline;
          let attempts = 0;
          try {
            const capture = await withRetries(async () => {
              attempts += 1;
              return this.options.git.captureBranchCommits(repository, branch, previousHead);
            });
            captures.push({
              repositoryLabel: repositorySetting.label,
              stateKey,
              notionDatabaseId: repositorySetting.notionDatabaseId ?? "",
              project: repositorySetting.project ?? "",
              ...capture,
            });
            run.branches.push({
              repositoryLabel: repositorySetting.label,
              branch,
              status: "succeeded",
              phase: capture.commits.length > 0 ? "analyzed" : "captured",
              attempts,
              fromHead: previousHead ?? undefined,
              toHead: capture.currentHead,
              reported: false,
              commitCount: capture.commits.length,
              message: capture.commits.length > 0
                ? `새 커밋 ${capture.commits.length}개를 분석했습니다.`
                : previousHead
                  ? "마지막 보고 이후 새 커밋이 없습니다."
                  : "첫 실행 기준 HEAD를 설정했습니다.",
            });
          } catch (error) {
            run.branches.push({
              repositoryLabel: repositorySetting.label,
              branch,
              status: "failed",
              phase: "failed",
              attempts,
              fromHead: previousHead ?? undefined,
              reported: false,
              commitCount: 0,
              message: errorMessage(error),
            });
          }
          this.state.lastRun = run;
          await this.store.write(this.state);
          this.options.onChanged();
        }
        if (hasNewBaseline) await this.store.write(this.state);
      }
      if (!anySelected) throw new Error("선택된 브랜치가 없습니다.");
      const failed = run.branches.filter((branch) => branch.status === "failed").length;
      if (failed > 0) {
        run.status = failed === run.branches.length ? "failed" : "partial";
      } else {
        const date = localDateKey();
        const allKeys = captures.map((capture) => capture.stateKey).sort();
        const reportKey = `${allKeys.join("|")}|daily|${date}`;
        await this.publishReport(run, date, reportKey, captures);
        run.status = "succeeded";
      }
    } catch (error) {
      run.status = "failed";
      run.error = errorMessage(error);
    }

    return this.finishRun(run, trigger);
  }

  private async publishReport(
    run: DailyAutomationRunView,
    date: string,
    reportKey: string,
    captures: CapturedBranch[],
  ): Promise<void> {
    // Notion 등록이 실패하면 HEAD를 갱신하지 않습니다. 같은 날짜/리포트 키로
    // 다음 실행이 페이지를 찾아 이어서 완성하거나 새로 생성합니다.
    // 저장소별 Notion 데이터베이스가 지정되어 있으면 데이터베이스 단위로 묶어 등록합니다.
    const groups = new Map<string, CapturedBranch[]>();
    for (const capture of captures) {
      const key = (capture.notionDatabaseId ?? "").trim() || "__default__";
      const list = groups.get(key) ?? [];
      list.push(capture);
      groups.set(key, list);
    }
    let reportPageId: string | undefined;
    for (const [databaseKey, groupCaptures] of groups) {
      const branches = groupCaptures.map(buildDailyWorkBranch);
      const databaseId = databaseKey === "__default__" ? undefined : databaseKey;
      const groupReportKey = databaseId ? `${reportKey}|${databaseId}` : reportKey;
      const pageId = await this.options.notion.createDailyWorkReport({
        date,
        reportKey: groupReportKey,
        repositoryDatabaseId: databaseId,
        branches,
      });
      reportPageId = pageId;
    }
    if (this.options.discord?.enabled) {
      try {
        const discordBranches = filterDiscordBranches(captures.map(buildDailyWorkBranch), this.options.config.repositories);
        if (discordBranches.length > 0) {
          await this.options.discord.sendMessage(buildDiscordDailySummary(date, discordBranches, reportPageId));
        }
      } catch (discordError) {
        run.error = `Discord 전송 실패: ${errorMessage(discordError)}`;
      }
    }
    for (const capture of captures) {
      this.state.reportedHeads[capture.stateKey] = capture.currentHead;
      delete this.state.pendingBaselines[capture.stateKey];
    }
    run.branches = captures.map((capture) => ({
      repositoryLabel: capture.repositoryLabel,
      branch: capture.branch,
      status: "succeeded" as const,
      phase: "reported" as const,
      attempts: 1,
      toHead: capture.currentHead,
      reportPageId,
      reported: true,
      commitCount: capture.commits.length,
      message: capture.commits.length > 0
        ? `새 커밋 ${capture.commits.length}개를 Notion 일일작업에 등록했습니다.`
        : "새 커밋이 없어 날짜만 Notion 일일작업에 기록했습니다.",
    }));
    await this.store.write(this.state);
  }

  private async finishRun(
    run: DailyAutomationRunView,
    trigger: DailyAutomationRunView["trigger"],
  ): Promise<DailyAutomationRunView> {
    run.completedAt = new Date().toISOString();
    if (trigger !== "manual" && run.status === "succeeded") this.state.lastScheduledDate = localDateKey();
    this.state.lastRun = run;
    await this.store.write(this.state);
    this.scheduleNext();
    return run;
  }

  private migrateLegacyBranchState(identity: GitRepositoryIdentity, branch: string, stateKey: string): void {
    if (this.state.reportedHeads[stateKey] || this.state.pendingBaselines[stateKey]) return;
    const legacyKey = `${identity.legacyKey}|origin|${branch}`;
    const candidate = this.findEquivalentLegacyStateKey(identity.originUrl, branch, legacyKey);
    if (!candidate || candidate === stateKey) return;
    if (this.state.reportedHeads[candidate]) {
      this.state.reportedHeads[stateKey] = this.state.reportedHeads[candidate]!;
      delete this.state.reportedHeads[candidate];
    }
    if (this.state.pendingBaselines[candidate]) {
      this.state.pendingBaselines[stateKey] = this.state.pendingBaselines[candidate]!;
      delete this.state.pendingBaselines[candidate];
    }
  }

  private findEquivalentLegacyStateKey(originUrl: string, branch: string, exact: string): string | null {
    const keys = [...Object.keys(this.state.reportedHeads), ...Object.keys(this.state.pendingBaselines)];
    if (keys.includes(exact)) return exact;
    const suffix = `|origin|${branch}`;
    const expectedRemote = normalizeRemoteIdentity(originUrl);
    return keys.find((key) => {
      if (!key.endsWith(suffix) || key.startsWith("remote:")) return false;
      const identity = key.slice(0, -suffix.length);
      const separator = identity.indexOf("|");
      if (separator < 0) return false;
      return normalizeRemoteIdentity(identity.slice(separator + 1)) === expectedRemote;
    }) ?? null;
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || !this.options.config.dailyAutomation.enabled) return;
    const delay = Math.max(1, nextLocalRunAt().getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run("scheduled");
    }, delay);
  }

  private async refreshBranches(): Promise<void> {
    const selectedProjects = this.options.config.dailyAutomation.projects;
    const repositories = selectedProjects === undefined
      ? this.options.config.repositories
      : this.options.config.repositories.filter((repository) => selectedProjects.includes(projectName(repository.project)));
    const views: DailyAutomationView["repositories"] = [];
    for (const repositorySetting of repositories) {
      let repoPath = repositorySetting.path ?? null;
      let repositoryError: string | null = null;
      let availableBranches: string[] = [];
      try {
        const validated = await this.options.git.validateRepository(repositorySetting.path);
        repoPath = validated;
        availableBranches = await this.options.git.listBranches(validated);
        repositoryError = availableBranches.length === 0 ? "선택한 로컬 Git 저장소에 브랜치가 없습니다." : null;
      } catch (error) {
        availableBranches = [];
        repositoryError = errorMessage(error);
      }
      views.push({
        label: repositorySetting.label,
        username: repositorySetting.username ?? "",
        defaultBranch: repositorySetting.defaultBranch ?? "",
        path: repoPath,
        url: repositorySetting.url ?? "",
        repositoryError,
        selectedBranches: [...repositorySetting.branches],
        availableBranches,
        discordMinCommits: repositorySetting.discordMinCommits ?? 0,
        discordBranches: [...(repositorySetting.discordBranches ?? [])],
      });
    }
    this.repositoryViews = views;
    this.options.onChanged();
  }
}

function projectName(value?: string): string {
  return value?.trim() || "미지정 프로젝트";
}

interface CapturedBranch {
  repositoryLabel: string;
  stateKey: string;
  notionDatabaseId?: string;
  project?: string;
  repository: string;
  branch: string;
  previousHead: string | null;
  currentHead: string;
  commits: GitCommitSummary[];
}

function buildDailyWorkBranch(capture: CapturedBranch): Parameters<NotionAdapter["createDailyWorkReport"]>[0]["branches"][number] {
  const { repositoryLabel, project, branch, commits } = capture;
  const authors = [...new Set(commits.map((commit) => commit.author).filter(Boolean))];
  const latest = commits.length > 0
    ? commits.reduce((current, commit) =>
      Date.parse(commit.timestamp) > Date.parse(current.timestamp) ? commit : current,
    commits[0]!)
    : null;
  const content = commits.map((commit) => {
    const details = commit.body.trim() ? `\n${commit.body.trim()}` : "";
    return `[${commit.hash.slice(0, 8)}] ${commit.subject}${details}`;
  }).join("\n\n");
  return {
    repositoryLabel,
    branchLabel: project && repositoryLabel ? `${project} : ${repositoryLabel}` : repositoryLabel,
    branch,
    author: authors.join(", ") || "Unknown",
    occurredAt: latest?.timestamp ?? "",
    content,
    commits: commits.map((commit) => ({
      hash: commit.hash,
      author: commit.author,
      occurredAt: commit.timestamp,
      subject: commit.subject,
      body: commit.body,
    })),
  };
}

function isDailyAutomationRun(value: unknown): value is DailyAutomationRunView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DailyAutomationRunView>;
  return typeof candidate.id === "string" && typeof candidate.startedAt === "string" && Array.isArray(candidate.branches);
}

function buildDiscordDailySummary(
  date: string,
  branches: DailyWorkReportBranch[],
  reportPageId?: string,
): string {
  const lines: string[] = [];
  lines.push(`📋 일일작업 보고 · ${date}`);
  if (branches.length === 0) {
    lines.push("보고할 브랜치가 없습니다.");
  }
  let totalCommits = 0;
  for (const branch of branches) {
    totalCommits += branch.commits.length;
    const heading = branch.branchLabel || branch.repositoryLabel
      ? `[${branch.branchLabel ? branch.branchLabel : `분야: ${branch.repositoryLabel}`}] 브랜치 ${branch.branch}`
      : `브랜치 ${branch.branch}`;
    lines.push("", `**${heading}**`, `담당: ${branch.author || "Unknown"}`);
    if (branch.commits.length === 0) {
      lines.push("새 커밋 없음");
      continue;
    }
    lines.push(`커밋 ${branch.commits.length}개`);
    for (const commit of branch.commits.slice(0, 10)) {
      lines.push(`- [${commit.hash.slice(0, 8)}] ${commit.subject}`);
    }
    if (branch.commits.length > 10) {
      lines.push(`…외 ${branch.commits.length - 10}개 커밋`);
    }
  }
  lines.push("", `총 커밋: ${totalCommits}개`);
  if (reportPageId) {
    lines.push(`Notion 페이지: ${reportPageId.replace(/-/g, "")}`);
  }
  return lines.join("\n");
}

function buildManualDiscordSummary(
  date: string,
  branches: DailyWorkReportBranch[],
  nodes: ManualDailyReportBranchResult[],
): string {
  const lines: string[] = [];
  lines.push(`일일작업 요약 등록 · ${date}`);
  if (branches.length === 0) {
    lines.push("등록할 브랜치가 없습니다.");
  }
  let totalCommits = 0;
  for (const branch of branches) {
    totalCommits += branch.commits.length;
    const heading = branch.branchLabel || branch.repositoryLabel
      ? `[${branch.branchLabel ? branch.branchLabel : `분야: ${branch.repositoryLabel}`}] 브랜치 ${branch.branch}`
      : `브랜치 ${branch.branch}`;
    lines.push("", `**${heading}**`, `담당: ${branch.author || "Unknown"}`);
    if (branch.commits.length === 0) {
      lines.push("새 커밋 없음 - 날짜만 등록");
    } else {
      lines.push(`커밋 ${branch.commits.length}개 요약 등록 완료`);
      for (const commit of branch.commits.slice(0, 8)) {
        lines.push(`- [${commit.hash.slice(0, 8)}] ${commit.subject}`);
      }
      if (branch.commits.length > 8) {
        lines.push(`…외 ${branch.commits.length - 8}개 커밋`);
      }
    }
    const node = nodes.find((item) => item.branch === branch.branch && item.repositoryLabel === branch.repositoryLabel);
    if (node?.notionPageId) {
      lines.push(`Notion: ${node.notionPageId.replace(/-/g, "")}`);
    }
  }
  lines.push("", `총 커밋: ${totalCommits}개 · 등록 브랜치 ${branches.length}개`);
  return lines.join("\n");
}

export function filterDiscordBranches(
  branches: DailyWorkReportBranch[],
  repositories: HubConfig["repositories"],
): DailyWorkReportBranch[] {
  const grouped = new Map<string, DailyWorkReportBranch[]>();
  for (const branch of branches) {
    const repository = repositories.find((item) => item.label === branch.repositoryLabel);
    if (repository?.discordBranches?.length && !repository.discordBranches.includes(branch.branch)) continue;
    const key = branch.repositoryLabel || "";
    const list = grouped.get(key) ?? [];
    list.push(branch);
    grouped.set(key, list);
  }
  const result: DailyWorkReportBranch[] = [];
  for (const [label, items] of grouped) {
    const repository = repositories.find((item) => item.label === label);
    const minimum = repository?.discordMinCommits ?? 0;
    if (items.reduce((total, item) => total + item.commits.length, 0) >= minimum) result.push(...items);
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scheduledSlotIso(now = new Date()): string {
  const slot = new Date(now);
  slot.setHours(8, 0, 0, 0);
  return slot.toISOString();
}

async function withRetries<T>(action: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150)));
    }
  }
  throw lastError;
}

function isTransient(error: unknown): boolean {
  const candidate = error as { status?: number; code?: string; message?: string };
  if (candidate.status === 429 || (candidate.status !== undefined && candidate.status >= 500)) return true;
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(candidate.code ?? "")) return true;
  return /timed? out|connection reset|temporarily unavailable|remote end hung up/i.test(candidate.message ?? "");
}
