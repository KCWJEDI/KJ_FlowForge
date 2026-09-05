import { EventEmitter } from "node:events";
import path from "node:path";
import type {
  DailyAutomationRunView,
  DailyAutomationView,
  DashboardState,
  GitCloneResult,
  GitConnectResult,
  GitConnectOrCloneResult,
  GitStatusView,
  IntegrationConnectionStatus,
  LicenseRole,
  ManualDailyReportInput,
  ManualDailyReportResult,
  ProjectDefinition,
  ProjectView,
  RepositoryConnectionCheck,
  SettingsSaveResult,
  SettingsView,
} from "../shared/ipc";
import type { HubConfig } from "./config";
import { toPublicConfig } from "./config";
import { ENV_DEFINITIONS, readEnvFile, writeEnvFile } from "./env-store";
import { DailyAutomation } from "./automation/daily-schedule";
import { GitService, type GitChangeSummary } from "./git/git-service";
import { GitSelectionStore, type GitSelectionState } from "./git-selection-store";
import { DiscordAdapter } from "./integrations/discord-adapter";
import { GeminiAdapter } from "./integrations/gemini-adapter";
import { GitHubAdapter } from "./integrations/github-adapter";
import { NotionAdapter } from "./integrations/notion-adapter";
import {
  allowedBranchesOf,
  buildProjectViews,
  ensureProjectsCacheDir,
  hasUserBranchAssignment,
  loadProjects,
  parseProjectsFile,
  sameIdentity,
  serializeProjectsFile,
  upsertProjectsFromRepositories,
  userBranchesOf,
} from "./projects-store";

const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "development"]);

export class HubRuntime extends EventEmitter {
  private readonly startedAt = new Date().toISOString();
  private readonly createdCommits = new Map<string, GitChangeSummary>();
  private readonly currentBranchCache = new Map<string, string>();
  private lastRepositoriesWarning: string | null = null;
  private projects: ProjectDefinition[] = [];
  private projectsCacheFile = "";
  private gitSelectionState: GitSelectionState = {
    workBranchesByProject: {},
    activeBranchesByProject: {},
    cardsByProject: {},
    selectedProject: "",
    connectedPaths: [],
    projectConnectPaths: {},
    projectConnectMessages: {},
    projectConnectPath: "",
    projectConnectMessage: "",
  };
  private readonly gitSelectionStore: GitSelectionStore;
  public readonly git = new GitService();
  public readonly discord: DiscordAdapter;
  public readonly notion: NotionAdapter;
  public readonly github: GitHubAdapter;
  public readonly gemini: GeminiAdapter;
  public readonly dailyAutomation: DailyAutomation;

  public constructor(
    public readonly config: HubConfig,
    public role: LicenseRole = "user",
    public readonly keyId: string = "",
  ) {
    super();
    this.gitSelectionStore = new GitSelectionStore(config.selectionFile ?? path.join(config.dataDirectory, "git-selection.json"));
    this.discord = new DiscordAdapter(config.discord);
    this.notion = new NotionAdapter(config.notion);
    this.github = new GitHubAdapter(config.github);
    this.gemini = new GeminiAdapter(config.gemini);
    this.dailyAutomation = new DailyAutomation({
      config,
      git: this.git,
      notion: this.notion,
      discord: this.discord,
      gemini: this.gemini,
      allBranches: this.role === "admin",
      onChanged: () => this.emitState(),
    });
  }

  public async start(): Promise<void> {
    this.gitSelectionState = await this.gitSelectionStore.load();
    this.projectsCacheFile = await ensureProjectsCacheDir(this.config.dataDirectory);
    const loaded = await loadProjects(this.config.projectsUrl, this.projectsCacheFile, async () => {
      if (this.github.enabled && this.config.github.owner && this.config.github.repo) {
        const raw = await this.github.readFile('projects.json', 'main');
        if (raw === null) throw new Error('projects.json not found in config repo');
        return raw;
      }
      throw new Error('GitHub token not configured; falling back to raw fetch/cache');
    });
    this.projects = loaded.projects;
    if (this.discord.enabled) await this.discord.start();
    // 매일 오전 08:00 자동 일일작업 등록은 관리자 라이선스 전용 기능입니다.
    if (this.role === "admin") {
      await this.dailyAutomation.start();
    } else {
      await this.dailyAutomation.stop();
    }
  }

  public async stop(): Promise<void> {
    await this.dailyAutomation.stop();
    await Promise.allSettled([this.discord.stop()]);
  }

  public setRole(role: LicenseRole): void {
    if (this.role === role) return;
    this.role = role;
    if (role === "admin") void this.dailyAutomation.start();
    else void this.dailyAutomation.stop();
    this.emitState();
  }

  public getState(): DashboardState {
    return {
      startedAt: this.startedAt,
      config: toPublicConfig(this.config),
      role: this.role,
      recentEvents: [],
      dailyAutomation: this.dailyAutomation.getView(),
    };
  }

  public getDailyAutomation(): DailyAutomationView {
    return this.dailyAutomation.getView();
  }

  public runDailyAutomation(): Promise<DailyAutomationRunView> {
    if (this.role !== "admin") {
      throw new Error("관리자 라이선스가 필요합니다. 자동 일일작업 등록은 관리자만 사용할 수 있습니다.");
    }
    return this.dailyAutomation.run("manual");
  }

  public reportManualDailyReport(input: ManualDailyReportInput): Promise<ManualDailyReportResult> {
    return this.dailyAutomation.reportManualCommits(input);
  }

  public async inspectGit(repository?: string): Promise<GitStatusView> {
    return this.git.inspect(this.resolveRepository(repository));
  }

  public async listGitBranches(repository?: string): Promise<string[]> {
    const target = this.resolveRepository(repository);
    const branches = await this.git.listBranches(target);
    let repo = this.config.repositories.find((item) => item.path === target || item.label === target);
    let project = repo ? this.projects.find((item) => item.id === repo.project) : undefined;
    if (!repo || !project) {
      try {
        const identity = await this.git.getRepositoryIdentity(target);
        project = this.projects.find((item) => sameIdentity(item.url, identity.originUrl)) ?? undefined;
      } catch {}
    }
    const restricted = this.role === "admin" ? allowedBranchesOf(project) : userBranchesOf(project, this.keyId);
    if (this.role !== "admin" && !hasUserBranchAssignment(project, this.keyId)) return [];
    if (restricted.length === 0) return branches;
    return branches.filter((branch) => restricted.includes(branch));
  }

  /** Config/KJ_FlowForge_Config의 projects.json에 정의된 프로젝트 목록(일반 유저 화면용)을 반환합니다. */
  public async getProjects(): Promise<ProjectView[]> {
    this.projectsCacheFile = this.projectsCacheFile || (await ensureProjectsCacheDir(this.config.dataDirectory));
    const loaded = await loadProjects(this.config.projectsUrl, this.projectsCacheFile, async () => {
      if (this.github.enabled && this.config.github.owner && this.config.github.repo) {
        const raw = await this.github.readFile('projects.json', 'main');
        if (raw === null) throw new Error('projects.json not found in config repo');
        return raw;
      }
      throw new Error('GitHub token not configured; falling back to raw fetch/cache');
    });
    // 빈 결과도 반영해야 Config에서 프로젝트/라이선스별 브랜치 배정이
    // 삭제된 경우 이전 상태가 화면에 남지 않습니다.
    this.projects = loaded.projects;
    const views = await buildProjectViews(this.projects, this.config.repositories, (url) => this.git.listRemoteBranches(url));
    if (this.role !== "admin") {
      return views.filter((view) => {
        const project = this.projects.find((item) => item.id === view.id);
        const restricted = userBranchesOf(project, this.keyId);
        if (!hasUserBranchAssignment(project, this.keyId)) return false;
        view.selectableBranches = view.selectableBranches.filter((branch) => restricted.includes(branch));
        view.branchRestricted = true;
        view.allowedBranches = restricted;
        return true;
      });
    }
    return views;
  }

  /** 일반 유저가 선택한 프로젝트를 로컬 빈 폴더에 클론합니다. */
  public async cloneGitRepository(args: { url: string; directory: string }): Promise<GitCloneResult> {
    const root = await this.git.cloneRepository(args.url, args.directory);
    const identity = await this.git.getRepositoryIdentity(root);
    return { path: root, url: identity.originUrl, identity: identity.key };
  }

  /** 일반 유저가 .git 폴더를 지정해 기존 로컬 저장소를 프로젝트에 연결합니다. */
  public async connectGitRepository(args: { directory: string }): Promise<GitConnectResult> {
    const identity = await this.git.getRepositoryIdentity(args.directory);
    return { path: identity.root, url: identity.originUrl, identity: identity.key };
  }

  /** 빈 폴더면 clone, 기존 git 저장소면 연결을 자동 판별해 수행합니다. */
  public async connectOrCloneGitRepository(args: { url: string; directory: string }): Promise<GitConnectOrCloneResult> {
    const result = await this.git.connectOrClone(args.url, args.directory);
    return { action: result.action, path: result.root, url: result.originUrl, identity: result.identity };
  }

  public async switchGitBranch(repository: string | undefined, branch: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.assertUserProjectAccess(target, branch);
    await this.git.switchBranch(target, branch);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitCreateBranch(repository: string | undefined, branch: string, startPoint?: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.assertUserProjectAccess(target, branch, true);
    await this.git.createBranch(target, branch, startPoint);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitStage(repository: string | undefined, paths: string[]): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.git.stage(target, paths);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitCommitWithSummary(repository?: string): Promise<GitChangeSummary> {
    const target = this.resolveRepository(repository);
    const status = await this.git.inspect(target);
    this.currentBranchCache.set(target, status.branch);
    await this.assertUserProjectAccess(target, status.branch);
    this.assertPersonalBranch(target);
    const summary = await this.git.commitWithSummary(target);
    this.createdCommits.set(target, summary);
    this.emitState();
    return summary;
  }

  public async gitPushCreatedCommit(repository?: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    const status = await this.git.inspect(target);
    this.currentBranchCache.set(target, status.branch);
    await this.assertUserProjectAccess(target, status.branch);
    this.assertPersonalBranch(target);
    const created = this.createdCommits.get(target);
    if (!created) throw new Error("먼저 '변경사항 요약 후 커밋'을 실행해야 푸시할 수 있습니다.");
    if (status.head !== created.newHead) {
      throw new Error("생성한 커밋 이후 HEAD가 변경되었습니다. 새로고침 후 다시 시도하세요.");
    }
    await this.git.push(target);
    this.createdCommits.delete(target);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitPushBranch(repository: string | undefined, branch: string, remote = "origin"): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.assertUserProjectAccess(target, branch);
    if (this.currentBranchCache.get(target) !== branch) {
      this.currentBranchCache.set(target, branch);
    }
    await this.git.switchBranch(target, branch);
    await this.git.push(target, remote, branch);
    this.emitState();
    return this.git.inspect(target);
  }

  private assertPersonalBranch(target: string): void {
    if (this.role === "admin") return;
    const repository = this.config.repositories.find((item) => item.path === target);
    const defaultBranch = (repository?.defaultBranch ?? "").trim().toLowerCase();
    const current = this.currentBranchCache.get(target) ?? "";
    const branch = current.toLowerCase();
    if ((defaultBranch && branch === defaultBranch) || PROTECTED_BRANCHES.has(branch)) {
      throw new Error(
        "일반 사용자는 개인 작업 브랜치에서만 커밋/푸시할 수 있습니다. 현재 브랜치('" +
          (current || "알 수 없음") +
          "')에서는 관리자 라이선스가 필요합니다.",
      );
    }
  }

  private async assertUserProjectAccess(target: string, branch: string, allowNewBranch = false): Promise<void> {
    if (this.role === "admin") return;
    const repository = this.config.repositories.find((item) => item.path === target);
    let project = repository ? this.projects.find((item) => item.id === repository.project) : undefined;
    if (!project) {
      try {
        const identity = await this.git.getRepositoryIdentity(target);
        project = this.projects.find((item) => sameIdentity(item.url, identity.originUrl));
      } catch {}
    }
    if (!hasUserBranchAssignment(project, this.keyId)) {
      throw new Error("이 라이선스에 허용된 프로젝트 또는 브랜치가 없습니다.");
    }
    if (!allowNewBranch && !userBranchesOf(project, this.keyId).includes(branch)) {
      throw new Error("이 라이선스에 허용되지 않은 브랜치입니다.");
    }
  }

  private resolveRepository(repository?: string): string {
    if (repository) {
      const byPath = this.config.repositories.find((item) => item.path === repository);
      const byLabel = this.config.repositories.find((item) => item.label === repository);
      const target = byPath?.path ?? byLabel?.path ?? repository;
      if (target.trim()) return target.trim();
    }
    const first = this.config.repositories.find((item) => item.path.trim().length > 0);
    if (!first) throw new Error("설정된 Git 저장소가 없습니다. 설정 탭에서 저장소를 추가하세요.");
    return first.path;
  }

  public async getSettings(): Promise<SettingsView> {
    const values = await readEnvFile(this.config.envFile);
    return {
      envFile: this.config.envFile,
      fields: ENV_DEFINITIONS.filter((definition) => this.role === "admin" || !definition.adminOnly).map((definition) => {
        const value = values.get(definition.key) ?? "";
        return {
          ...definition,
          value: definition.kind === "secret" ? "" : value,
          configured: Boolean(value),
        };
      }),
    };
  }

  /** 작업 브랜치 체크박스 선택 상태를 반환합니다(앱 재시작 후에도 유지). */
  public async getGitSelection(): Promise<GitSelectionState> {
    this.gitSelectionState = await this.gitSelectionStore.load();
    return this.gitSelectionState;
  }

  /** 작업 브랜치 체크박스 선택 상태를 저장합니다. */
  public async saveGitSelection(state: GitSelectionState): Promise<GitSelectionState> {
    this.gitSelectionState = await this.gitSelectionStore.save(state);
    return this.gitSelectionState;
  }

  /** 설정 탭 'Notion 저장소'에서 특정 데이터베이스 ID의 연결을 테스트합니다. */
  public async testNotionDatabase(args: { repository?: string; databaseId: string }): Promise<{ ok: boolean; message: string }> {
    const databaseId = (args.databaseId ?? "").trim();
    if (!databaseId) return { ok: false, message: "데이터베이스 ID를 먼저 입력하세요." };
    try {
      const message = await this.notion.testConnection(databaseId);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 설정 탭 'Discord 채널'에서 특정 채널 ID의 연결을 테스트합니다. */
  public async testDiscordChannel(args: { repository?: string; channelId: string }): Promise<{ ok: boolean; message: string }> {
    const channelId = (args.channelId ?? "").trim();
    if (!channelId) return { ok: false, message: "채널 ID를 먼저 입력하세요." };
    try {
      const message = await this.discord.testChannel(channelId);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 저장소별 Notion DB · Discord 채널 연결 상태를 배치로 확인해 상단 상태 점에 즉시 반영합니다. */
  public async checkRepositoryConnections(): Promise<RepositoryConnectionCheck[]> {
    const checks: RepositoryConnectionCheck[] = [];
    const seen = new Map<string, Set<"notion" | "discord">>();
    for (const repository of this.config.repositories) {
      const repoPath = repository.path.trim();
      const bucket = seen.get(repoPath) ?? new Set<"notion" | "discord">();
      seen.set(repoPath, bucket);

      const notionId = (repository.notionDatabaseId ?? "").trim();
      if (notionId && !bucket.has("notion")) {
        bucket.add("notion");
        try {
          const message = await this.notion.testConnection(notionId);
          checks.push({ repository: repoPath, integration: "notion", targetId: notionId, state: "connected", message });
        } catch (error) {
          checks.push({
            repository: repoPath,
            integration: "notion",
            targetId: notionId,
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const channelId = (repository.discordChannelId ?? "").trim();
      if (channelId && !bucket.has("discord")) {
        bucket.add("discord");
        try {
          const message = await this.discord.testChannel(channelId);
          checks.push({ repository: repoPath, integration: "discord", targetId: channelId, state: "connected", message });
        } catch (error) {
          checks.push({
            repository: repoPath,
            integration: "discord",
            targetId: channelId,
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return checks;
  }

  private async normalizeNotionDatabaseId(value: string): Promise<string> {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const withoutQuery = trimmed.split("?")[0] ?? trimmed;
    const match = /([0-9a-fA-F]{32})/.exec(withoutQuery.replace(/-/g, ""));
    if (match?.[1]) {
      const hex = match[1].toLowerCase();
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return trimmed;
  }

  public async saveSettings(input: Record<string, string>): Promise<SettingsSaveResult> {
    this.lastRepositoriesWarning = null;
    const entries: Record<string, string> = { ...input };
    // Git 저장소 탭에서 명시적으로 전체 삭제했는지 여부 (그 외 경로는 빈 목록으로 저장소를 덮어쓰지 않는다).
    const explicitRepositoryClear = entries.HUB_GIT_REPOSITORIES_CLEAR === "1";
    delete entries.HUB_GIT_REPOSITORIES_CLEAR;
    // 일반 사용자는 08:00 자동화 설정을 변경할 수 없습니다.
    if (this.role !== "admin") {
      delete entries.HUB_DAILY_AUTOMATION_ENABLED;
      delete entries.HUB_DAILY_AUTOMATION_PROJECTS;
      // 중앙 프로젝트 정의 주소는 관리자만 변경할 수 있습니다.
      delete entries.HUB_PROJECTS_URL;
      // 관리자 전용 필드(Gemini API 키 등)는 일반 사용자가 변경할 수 없습니다.
      for (const definition of ENV_DEFINITIONS) {
        if (definition.adminOnly) delete entries[definition.key];
      }
    }
    const current = await readEnvFile(this.config.envFile);
    const updates: Record<string, string> = {};
    for (const definition of ENV_DEFINITIONS) {
      if (!(definition.key in entries)) continue;
      const value = entries[definition.key]!.trim();
      if (definition.kind === "secret" && !value) continue;
      updates[definition.key] = value;
    }
    if ("HUB_GIT_REPOSITORIES" in updates) {
      const raw = updates.HUB_GIT_REPOSITORIES ?? "";
      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw) as Array<Partial<{
            label: string; username: string; defaultBranch: string; path: string;
            url: string; branches: string[]; discordMinCommits: number; discordBranches: string[];
            project: string; notionDatabaseId: string; discordChannelId: string;
          }>>;
          const validated: Array<{
            label: string; username: string; defaultBranch: string; path: string; url: string;
            branches: string[]; discordMinCommits: number; discordBranches: string[];
            project: string; notionDatabaseId: string; discordChannelId: string;
          }> = [];
          for (const item of parsed) {
            const project = typeof item?.project === "string" ? item.project.trim() : "";
            const label = typeof item?.label === "string" && item.label.trim() ? item.label.trim() : "저장소";
            const username = typeof item?.username === "string" ? item.username.trim() : "";
            const defaultBranch = typeof item?.defaultBranch === "string" ? item.defaultBranch.trim() : "";
            const rawPath = typeof item?.path === "string" ? item.path.trim() : "";
            const url = typeof item?.url === "string" && item.url.trim() ? item.url.trim() : "";
            if (!rawPath) continue;
            let repoPath = rawPath;
            try {
              repoPath = await this.git.validateRepository(rawPath);
            } catch (validationError) {
              const message = validationError instanceof Error ? validationError.message : String(validationError);
              this.lastRepositoriesWarning =
                (this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : "") +
                "저장소 검증 지연: " + message;
            }
            validated.push({
              project,
              label,
              username,
              defaultBranch,
              path: repoPath,
              url,
              branches: Array.isArray(item?.branches) ? item.branches.filter((b): b is string => typeof b === "string") : [],
              discordMinCommits:
                typeof item?.discordMinCommits === "number" && Number.isInteger(item.discordMinCommits) && item.discordMinCommits >= 0
                  ? item.discordMinCommits
                  : 0,
              discordBranches: Array.isArray(item?.discordBranches)
                ? item.discordBranches.filter((b): b is string => typeof b === "string")
                : [],
              notionDatabaseId:
                typeof item?.notionDatabaseId === "string"
                  ? (await this.normalizeNotionDatabaseId(item.notionDatabaseId))
                  : "",
              discordChannelId: typeof item?.discordChannelId === "string" ? item.discordChannelId.trim() : "",
            });
          }
          if (validated.length === 0 && !explicitRepositoryClear) {
            // 빈 배열("[]")은 여러 저장 경로(자동저장·Notion·Discord)에서 기존 목록을
            // 의도치 않게 덮어쓰는 원인이 되므로, 명시적 삭제가 아닌 경우 기존 저장소를 유지합니다.
            const existing = current.get("HUB_GIT_REPOSITORIES")?.trim();
            if (existing) {
              delete updates.HUB_GIT_REPOSITORIES;
            } else {
              updates.HUB_GIT_REPOSITORIES = "[]";
            }
          } else {
            updates.HUB_GIT_REPOSITORIES = JSON.stringify(validated);
          }
        } catch (error) {
          // 손상된 저장소 JSON은 다른 설정 저장을 막지 않도록 이전 값을 유지합니다.
          delete updates.HUB_GIT_REPOSITORIES;
          this.lastRepositoriesWarning =
            "저장소 목록 JSON이 손상되어 변경사항을 건너뛰고 이전 값을 유지했습니다: " +
            (error instanceof Error ? error.message : String(error));
        }
      } else {
        if (explicitRepositoryClear) {
          updates.HUB_GIT_REPOSITORIES = "";
        } else {
          // 저장소 목록을 비우지 않고 기존 값을 유지합니다 (정책: Git 탭에서만 삭제 가능).
          delete updates.HUB_GIT_REPOSITORIES;
          const currentRepos = current.get("HUB_GIT_REPOSITORIES")?.trim();
          if (currentRepos) {
            this.lastRepositoriesWarning =
              "저장소 목록은 Git 저장소 탭에서만 삭제할 수 있습니다. 기존 저장소를 유지합니다.";
          }
        }
      }
    }
    const next = await writeEnvFile(this.config.envFile, updates);
    const restartKeys = ["HUB_HTTP_PORT", "HUB_TCP_PORT", "HUB_COMMAND_TIMEOUT_MS", "HUB_MAX_FRAME_BYTES", "HUB_API_TOKEN"];
    const restartRequired = restartKeys.some((key) => (current.get(key) ?? "") !== (next.get(key) ?? ""));

    this.config.repositories = parseRepositoriesForConfig(next.get("HUB_GIT_REPOSITORIES"));
    // 관리자가 Git 저장소 탭에서 저장소를 등록·저장하면 Config 저장소의 projects.json에도 병합·푸시합니다.
    // 일반 사용자는 저장소를 관리할 수 없으므로 동기화하지 않습니다.
    if (this.role === "admin" && this.config.configRepo && this.github.enabled) {
      try {
        await this.syncProjectsToConfig(this.config.repositories);
      } catch (error) {
        this.lastRepositoriesWarning =
          (this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : "") +
          "Config projects.json 동기화 실패: " + (error instanceof Error ? error.message : String(error));
      }
    }
    this.config.dailyAutomation = {
      enabled: this.role === "admin" && parseBoolean(next.get("HUB_DAILY_AUTOMATION_ENABLED")),
      projects: this.role === "admin"
        ? [...new Set((next.get("HUB_DAILY_AUTOMATION_PROJECTS") ?? "").split(",").map((value) => value.trim()).filter(Boolean))]
        : [],
    };
    this.config.discord = {
      token: next.get("DISCORD_BOT_TOKEN") || undefined,
      channelId: next.get("DISCORD_CHANNEL_ID") || undefined,
    };
    this.config.notion = {
      token: next.get("NOTION_TOKEN") || undefined,
      databaseId: next.get("NOTION_DATABASE_ID") || undefined,
    };
    // 관리자가 Git 저장소 탭에서 저장소를 저장하면 Config projects.json에 push하기 위해
    // owner/repo를 유지합니다. owner/repo는 최초 loadConfig 시 HUB_CONFIG_REPO(또는
    // HUB_PROJECTS_URL)에서 유도되어 이.config.github에 담깁니다.
    this.config.github = {
      token: next.get("GITHUB_TOKEN") || undefined,
      ...(this.config.github?.owner && this.config.github?.repo
        ? { owner: this.config.github.owner, repo: this.config.github.repo }
        : {}),
    };

    this.config.gemini = {
      apiKey: next.get("GEMINI_API_KEY") || undefined,
      model: (next.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite").trim() || "gemini-3.5-flash-lite",
    };
    this.notion.configure(this.config.notion);
    this.github.configure(this.config.github);
    this.gemini.configure(this.config.gemini);
    this.dailyAutomation.reconfigure();
    let discordConfigureError: Error | null = null;
    try {
      await this.discord.configure(this.config.discord);
    } catch (error) {
      discordConfigureError = error instanceof Error ? error : new Error(String(error));
    }
    this.emitState();

    const statuses = await this.testIntegrations();
    if (discordConfigureError) {
      const index = statuses.findIndex((status) => status.integration === "discord");
      const status: IntegrationConnectionStatus = {
        integration: "discord",
        state: "error",
        message: discordConfigureError.message,
        checkedAt: new Date().toISOString(),
      };
      if (index >= 0) statuses[index] = status;
      else statuses.push(status);
    }
    return {
      settings: await this.getSettings(),
      statuses,
      restartRequired,
      message: this.lastRepositoriesWarning
        ? this.lastRepositoriesWarning
        : restartRequired
          ? "설정이 저장되었습니다. 포트·타임아웃·프레임 크기·API 토큰 변경은 앱 재시작이 필요합니다."
          : "설정이 저장되었고 통합 연결이 새로고침되었습니다.",
    };
  }

  public async testIntegrations(): Promise<IntegrationConnectionStatus[]> {
    return Promise.all([
      this.testIntegration("discord", this.discord.enabled, () => this.discord.testConnection()),
      this.testIntegration("notion", this.notion.enabled, () => this.notion.testConnection()),
      this.testIntegration("github", this.github.enabled, () => this.github.testConnection()),
    ]);
  }

  private async testIntegration(
    integration: IntegrationConnectionStatus["integration"],
    enabled: boolean,
    test: () => Promise<string>,
  ): Promise<IntegrationConnectionStatus> {
    const checkedAt = new Date().toISOString();
    if (!enabled) return { integration, state: "not-configured", message: "토큰이 설정되지 않았습니다.", checkedAt };
    try {
      return { integration, state: "connected", message: await test(), checkedAt };
    } catch (error) {
      return {
        integration,
        state: "error",
        message: error instanceof Error ? error.message : String(error),
        checkedAt,
      };
    }
  }

  private emitState(): void {
    this.emit("stateChanged", this.getState());
  }

  /** 로컬 저장소 목록을 Config 저장소의 projects.json에 병합한 뒤 GitHub로 푸시합니다. */
  private async syncProjectsToConfig(
    repositories: Array<{
      project?: string; label: string; username?: string; defaultBranch?: string; path: string; url: string;
      branches: string[]; discordMinCommits?: number; discordBranches?: string[];
      notionDatabaseId?: string; discordChannelId?: string;
    }>,
  ): Promise<void> {
    const existingText = await this.github.readFile("projects.json", "main");
    const current = existingText ? parseProjectsFile(existingText) : this.projects;
    const merged = upsertProjectsFromRepositories(current, repositories);
    this.projects = merged;
    await this.github.writeFile(
      "projects.json",
      serializeProjectsFile(merged),
      "main",
      "chore: sync repositories into projects.json",
    );
    await this.refreshProjectsCache();
  }

  private async refreshProjectsCache(): Promise<void> {
    try {
      this.projectsCacheFile = this.projectsCacheFile || (await ensureProjectsCacheDir(this.config.dataDirectory));
      const { writeFile } = await import("node:fs/promises");
      await writeFile(this.projectsCacheFile, JSON.stringify({ fetchedAt: new Date().toISOString(), projects: this.projects }, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch {
      /* cache write is best-effort */
    }
  }
}

function parseBoolean(value?: string): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

function parseRepositoriesForConfig(raw?: string): Array<{
  label: string; username: string; defaultBranch: string; path: string; url: string;
  branches: string[]; discordMinCommits: number; discordBranches: string[];
  project: string; notionDatabaseId: string; discordChannelId: string;
}> {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<{
      label: string; username: string; defaultBranch: string; path: string; url: string;
      branches: string[]; discordMinCommits: number; discordBranches: string[];
      project: string; notionDatabaseId: string; discordChannelId: string;
    }>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is typeof item & { path: string } =>
        Boolean(item && typeof item === "object" && typeof item.path === "string" && item.path.trim()))
      .map((item) => ({
        label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : "저장소",
        username: typeof item.username === "string" ? item.username.trim() : "",
        defaultBranch: typeof item.defaultBranch === "string" ? item.defaultBranch.trim() : "",
        path: item.path.trim(),
        url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : "",
        branches: Array.isArray(item.branches) ? item.branches.filter((b): b is string => typeof b === "string") : [],
        discordMinCommits:
          typeof item.discordMinCommits === "number" && Number.isInteger(item.discordMinCommits) && item.discordMinCommits >= 0
            ? item.discordMinCommits
            : 0,
        discordBranches: Array.isArray(item.discordBranches)
          ? item.discordBranches.filter((b): b is string => typeof b === "string")
          : [],
        project: typeof item.project === "string" ? item.project.trim() : "",
        notionDatabaseId: typeof item.notionDatabaseId === "string" ? item.notionDatabaseId.trim() : "",
        discordChannelId: typeof item.discordChannelId === "string" ? item.discordChannelId.trim() : "",
      }));
  } catch {
    return [];
  }
}
