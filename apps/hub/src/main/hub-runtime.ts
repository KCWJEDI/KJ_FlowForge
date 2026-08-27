import { EventEmitter } from "node:events";
import type {
  DailyAutomationRunView,
  DailyAutomationView,
  DashboardState,
  GitStatusView,
  IntegrationConnectionStatus,
  LicenseRole,
  ManualDailyReportInput,
  ManualDailyReportResult,
  SettingsSaveResult,
  SettingsView,
} from "../shared/ipc";
import type { HubConfig } from "./config";
import { toPublicConfig } from "./config";
import { ENV_DEFINITIONS, readEnvFile, writeEnvFile } from "./env-store";
import { DailyAutomation } from "./automation/daily-schedule";
import { GitService, type GitChangeSummary } from "./git/git-service";
import { DiscordAdapter } from "./integrations/discord-adapter";
import { GitHubAdapter } from "./integrations/github-adapter";
import { NotionAdapter } from "./integrations/notion-adapter";

const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "development"]);

export class HubRuntime extends EventEmitter {
  private readonly startedAt = new Date().toISOString();
  private readonly createdCommits = new Map<string, GitChangeSummary>();
  private readonly currentBranchCache = new Map<string, string>();
  private lastRepositoriesWarning: string | null = null;
  public readonly git = new GitService();
  public readonly discord: DiscordAdapter;
  public readonly notion: NotionAdapter;
  public readonly github: GitHubAdapter;
  public readonly dailyAutomation: DailyAutomation;

  public constructor(public readonly config: HubConfig, public readonly role: LicenseRole = "user") {
    super();
    this.discord = new DiscordAdapter(config.discord);
    this.notion = new NotionAdapter(config.notion);
    this.github = new GitHubAdapter(config.github);
    this.dailyAutomation = new DailyAutomation({
      config,
      git: this.git,
      notion: this.notion,
      discord: this.discord,
      allBranches: this.role === "admin",
      onChanged: () => this.emitState(),
    });
  }

  public async start(): Promise<void> {
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
    return this.git.listBranches(this.resolveRepository(repository));
  }

  public async switchGitBranch(repository: string | undefined, branch: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.git.switchBranch(target, branch);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitCreateBranch(repository: string | undefined, branch: string, startPoint?: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
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
      fields: ENV_DEFINITIONS.map((definition) => {
        const value = values.get(definition.key) ?? "";
        return {
          ...definition,
          value: definition.kind === "secret" ? "" : value,
          configured: Boolean(value),
        };
      }),
    };
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
          updates.HUB_GIT_REPOSITORIES = JSON.stringify(validated);
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
    this.config.github = {
      token: next.get("GITHUB_TOKEN") || undefined,
    };

    this.notion.configure(this.config.notion);
    this.github.configure(this.config.github);
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
