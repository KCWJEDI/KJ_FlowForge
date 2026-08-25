import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import type {
  DailyAutomationRunView,
  DailyAutomationView,
  DashboardState,
  GitStatusView,
  IntegrationConnectionStatus,
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

export class HubRuntime extends EventEmitter {
  private readonly startedAt = new Date().toISOString();
  private readonly createdCommits = new Map<string, GitChangeSummary>();
  private lastRepositoriesWarning: string | null = null;
  public readonly git = new GitService();
  public readonly discord: DiscordAdapter;
  public readonly notion: NotionAdapter;
 public readonly github: GitHubAdapter;
 public readonly dailyAutomation: DailyAutomation;

  public constructor(public readonly config: HubConfig) {
    super();
    this.discord = new DiscordAdapter(config.discord);
    this.notion = new NotionAdapter(config.notion);
    this.github = new GitHubAdapter(config.github);
    this.dailyAutomation = new DailyAutomation({
      config,
      git: this.git,
      notion: this.notion,
      discord: this.discord,
      onChanged: () => this.emitState(),
    });
  }

 public async start(): Promise<void> {
    if (this.discord.enabled) await this.discord.start();
    await this.dailyAutomation.start();
  }

  public async stop(): Promise<void> {
    await this.dailyAutomation.stop();
    await Promise.allSettled([this.discord.stop()]);
  }

  public getState(): DashboardState {
    return {
      startedAt: this.startedAt,
      config: toPublicConfig(this.config),
      recentEvents: [],
      dailyAutomation: this.dailyAutomation.getView(),
    };
  }

  public getDailyAutomation(): DailyAutomationView {
    return this.dailyAutomation.getView();
  }

  public runDailyAutomation(): Promise<DailyAutomationRunView> {
    return this.dailyAutomation.run("manual");
  }

  public previewDailyReport(): Promise<DailyAutomationRunView> {
    return this.dailyAutomation.preview();
  }

  public publishPendingDailyReport(): Promise<DailyAutomationRunView> {
    const run: DailyAutomationRunView = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      trigger: "manual",
      status: "running",
      branches: [],
    };
    return this.dailyAutomation.publishPendingReport(run).then(() => {
      run.status = "succeeded";
      run.completedAt = new Date().toISOString();
      this.emitState();
      return run;
    }).catch((error) => {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
      this.emitState();
      throw error;
    });
  }

  public async sendPendingReportToDiscord(): Promise<DailyAutomationRunView> {
    const run: DailyAutomationRunView = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      trigger: "manual",
      status: "running",
      branches: [],
    };
    try {
      await this.dailyAutomation.sendPendingToDiscord();
      run.status = "succeeded";
      run.completedAt = new Date().toISOString();
      this.emitState();
      return run;
    } catch (error) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
      this.emitState();
      throw error;
    }
  }

  public async discardPendingDailyReport(): Promise<void> {
    await this.dailyAutomation.discardPendingReport();
    this.emitState();
  }

  public async inspectGit(repository?: string): Promise<GitStatusView> {
    return this.git.inspect(this.resolveRepository(repository));
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
    const summary = await this.git.commitWithSummary(target);
    this.createdCommits.set(target, summary);
    this.emitState();
    return summary;
  }

  public async gitPushCreatedCommit(repository?: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    const created = this.createdCommits.get(target);
    if (!created) throw new Error("먼저 변경사항을 커밋해야 푸시할 수 있습니다.");
    const currentHead = (await this.git.inspect(target)).head;
    if (currentHead !== created.newHead) {
      throw new Error("마지막으로 생성한 커밋 이후 HEAD가 변경되어 푸시할 수 없습니다.");
    }
    await this.git.push(target);
    this.createdCommits.delete(target);
    this.emitState();
    return this.git.inspect(target);
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

  public async saveSettings(input: Record<string, string>): Promise<SettingsSaveResult> {
    this.lastRepositoriesWarning = null;
    const current = await readEnvFile(this.config.envFile);
    const updates: Record<string, string> = {};
    for (const definition of ENV_DEFINITIONS) {
      if (!(definition.key in input)) continue;
      const value = input[definition.key]!.trim();
      if (definition.kind === "secret" && !value) continue;
      updates[definition.key] = value;
    }
    if ("HUB_GIT_REPOSITORIES" in updates) {
      const raw = updates.HUB_GIT_REPOSITORIES ?? "";
      if (raw.trim()) {
        try {
           const parsed = JSON.parse(raw) as { label?: string; username?: string; defaultBranch?: string; path?: string; url?: string; branches?: string[]; discordMinCommits?: number; discordBranches?: string[] }[];
           const validated: { label: string; username: string; defaultBranch: string; path: string; url: string; branches: string[]; discordMinCommits: number; discordBranches: string[] }[] = [];
          for (const item of parsed) {
            const label = typeof item?.label === "string" && item.label.trim() ? item.label.trim() : "저장소";
            const username = typeof item?.username === "string" ? item.username.trim() : "";
            const defaultBranch = typeof item?.defaultBranch === "string" ? item.defaultBranch.trim() : "";
            const rawPath = typeof item?.path === "string" ? item.path.trim() : "";
            const url = typeof item?.url === "string" && item.url.trim() ? item.url.trim() : "";
            if (!rawPath) continue;
            let path = rawPath;
            try {
              path = await this.git.validateRepository(rawPath);
            } catch (validationError) {
              const message = validationError instanceof Error ? validationError.message : String(validationError);
              this.lastRepositoriesWarning = `${this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : ""}저장소 검증 지연: ${message}`;
            }
            validated.push({
              label,
              username,
              defaultBranch,
              path,
              url,
               branches: Array.isArray(item?.branches) ? item.branches.filter((b): b is string => typeof b === "string") : [],
               discordMinCommits: typeof item?.discordMinCommits === "number" && Number.isInteger(item.discordMinCommits) && item.discordMinCommits >= 0 ? item.discordMinCommits : 0,
               discordBranches: Array.isArray(item?.discordBranches) ? item.discordBranches.filter((b): b is string => typeof b === "string") : [],
            });
          }
          updates.HUB_GIT_REPOSITORIES = JSON.stringify(validated);
        } catch (error) {
          // Malformed repository JSON must not block saving other settings. Keep previous value.
          delete updates.HUB_GIT_REPOSITORIES;
          this.lastRepositoriesWarning = `저장소 목록 JSON이 손상되어 변경을 건너뛰고 이전 값을 유지했습니다: ${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        updates.HUB_GIT_REPOSITORIES = "";
      }
    }
    const next = await writeEnvFile(this.config.envFile, updates);
    const restartKeys = ["HUB_HTTP_PORT", "HUB_TCP_PORT", "HUB_COMMAND_TIMEOUT_MS", "HUB_MAX_FRAME_BYTES", "HUB_API_TOKEN"];
    const restartRequired = restartKeys.some((key) => (current.get(key) ?? "") !== (next.get(key) ?? ""));

    this.config.repositories = parseRepositoriesForConfig(next.get("HUB_GIT_REPOSITORIES"));
    this.config.dailyAutomation = {
      enabled: parseBoolean(next.get("HUB_DAILY_AUTOMATION_ENABLED")),
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
          ? "Settings saved. Port, timeout, frame size, or API token changes require an app restart."
          : "Settings saved and integrations refreshed.",
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
    if (!enabled) return { integration, state: "not-configured", message: "Token is not configured", checkedAt };
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

function parseRepositoriesForConfig(raw?: string): { label: string; username: string; defaultBranch: string; path: string; url: string; branches: string[]; discordMinCommits: number; discordBranches: string[] }[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as { label?: string; username?: string; defaultBranch?: string; path?: string; url?: string; branches?: string[]; discordMinCommits?: number; discordBranches?: string[] }[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { label: string; username: string; defaultBranch: string; path: string; url: string; branches: string[]; discordMinCommits?: number; discordBranches?: string[] } =>
        Boolean(item && typeof item === "object" && typeof item.path === "string" && item.path.trim()))
      .map((item) => ({
        label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : "저장소",
        username: typeof item.username === "string" ? item.username.trim() : "",
        defaultBranch: typeof item.defaultBranch === "string" ? item.defaultBranch.trim() : "",
        path: item.path.trim(),
        url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : "",
        branches: Array.isArray(item.branches) ? item.branches.filter((b): b is string => typeof b === "string") : [],
        discordMinCommits: typeof item.discordMinCommits === "number" && Number.isInteger(item.discordMinCommits) && item.discordMinCommits >= 0 ? item.discordMinCommits : 0,
        discordBranches: Array.isArray(item.discordBranches) ? item.discordBranches.filter((b): b is string => typeof b === "string") : [],
      }));
  } catch {
    return [];
  }
}
