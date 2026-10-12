import { writeFile } from "node:fs/promises";
import type { IntegrationConnectionStatus, SettingsSaveResult, SettingsView } from "../../shared/ipc";
import type { HubConfig } from "../config";
import { ENV_DEFINITIONS, readEnvFile, writeEnvFile } from "../env-store";
import type { GitService } from "../git/git-service";
import type { DiscordAdapter } from "../integrations/discord-adapter";
import type { GeminiAdapter } from "../integrations/gemini-adapter";
import type { GitHubAdapter } from "../integrations/github-adapter";
import { ensureProjectsCacheDir, parseProjectsFile, serializeProjectsFile, upsertProjectsFromRepositories } from "../projects-store";
import type { Integrations } from "./integrations";
import { parseBoolean, parseRepositoriesForConfig } from "./repository-settings";
import type { ProjectRegistry } from "./project-access";
import type { RuntimeContext } from "./runtime-context";

export interface SettingsServiceDeps {
  config: HubConfig;
  git: GitService;
  github: GitHubAdapter;
  gemini: GeminiAdapter;
  discord: DiscordAdapter;
  dailyAutomation: { reconfigure(): void };
  integrations: Integrations;
  registry: ProjectRegistry;
  context: RuntimeContext;
  /** 설정 저장 후 화면 새로고침을 알립니다. */
  onChanged: () => void;
}

/**
 * .env 설정의 조회·저장과, 저장에 따른 런타임 재구성(통합·저장소·프로젝트 동기화)을 담당합니다.
 *
 * 일반 사용자는 관리자 전용 필드(자동화, 프로젝트 URL, Gemini 키 등)를 수정할 수 없습니다.
 */
export class SettingsService {
  private lastRepositoriesWarning: string | null = null;

  public constructor(private readonly deps: SettingsServiceDeps) {}

  /** 현재 .env 값을 화면용 설정 뷰로 반환합니다(비밀 값은 마스킹). */
  public async getSettings(): Promise<SettingsView> {
    const { config, context } = this.deps;
    const values = await readEnvFile(config.envFile);
    return {
      envFile: config.envFile,
      fields: ENV_DEFINITIONS.filter((definition) => context.role === "admin" || !definition.adminOnly).map((definition) => {
        const value = values.get(definition.key) ?? "";
        return {
          ...definition,
          value: definition.kind === "secret" ? "" : value,
          configured: Boolean(value),
        };
      }),
    };
  }

  /** 설정 값을 저장하고, 저장소·통합을 새 값으로 재구성합니다. */
  public async saveSettings(input: Record<string, string>): Promise<SettingsSaveResult> {
    const { config, git, github, gemini, discord, dailyAutomation, integrations, context } = this.deps;
    this.lastRepositoriesWarning = null;
    const entries: Record<string, string> = { ...input };
    // Git 저장소 탭에서 명시적으로 전체 삭제했는지 여부 (그 외 경로는 빈 목록으로 저장소를 덮어쓰지 않는다).
    const explicitRepositoryClear = entries.HUB_GIT_REPOSITORIES_CLEAR === "1";
    delete entries.HUB_GIT_REPOSITORIES_CLEAR;
    // 일반 사용자는 관리자 전용 설정을 변경할 수 없습니다.
    if (context.role !== "admin") {
      delete entries.HUB_DAILY_AUTOMATION_ENABLED;
      delete entries.HUB_DAILY_AUTOMATION_PROJECTS;
      delete entries.HUB_PROJECTS_URL;
      for (const definition of ENV_DEFINITIONS) {
        if (definition.adminOnly) delete entries[definition.key];
      }
    }
    const current = await readEnvFile(config.envFile);
    const updates: Record<string, string> = {};
    for (const definition of ENV_DEFINITIONS) {
      if (!(definition.key in entries)) continue;
      const value = entries[definition.key]!.trim();
      if (definition.kind === "secret" && !value) continue;
      updates[definition.key] = value;
    }
    if ("HUB_GIT_REPOSITORIES" in updates) {
      await this.validateRepositories(updates, explicitRepositoryClear, current.get("HUB_GIT_REPOSITORIES"));
    }
    const next = await writeEnvFile(config.envFile, updates);
    const restartKeys = ["HUB_HTTP_PORT", "HUB_TCP_PORT", "HUB_COMMAND_TIMEOUT_MS", "HUB_MAX_FRAME_BYTES", "HUB_API_TOKEN"];
    const restartRequired = restartKeys.some((key) => (current.get(key) ?? "") !== (next.get(key) ?? ""));

    config.repositories = parseRepositoriesForConfig(next.get("HUB_GIT_REPOSITORIES"));
    // 관리자가 Git 저장소 탭에서 저장소를 등록·저장하면 Config 저장소의 projects.json에도 병합·푸시합니다.
    if (context.role === "admin" && config.configRepo && github.enabled) {
      try {
        await this.syncProjectsToConfig(config.repositories);
      } catch (error) {
        this.appendWarning("Config projects.json 동기화 실패: " + (error instanceof Error ? error.message : String(error)));
      }
    }
    config.dailyAutomation = {
      enabled: context.role === "admin" && parseBoolean(next.get("HUB_DAILY_AUTOMATION_ENABLED")),
      projects: context.role === "admin"
        ? [...new Set((next.get("HUB_DAILY_AUTOMATION_PROJECTS") ?? "").split(",").map((value) => value.trim()).filter(Boolean))]
        : [],
    };
    config.discord = {
      token: next.get("DISCORD_BOT_TOKEN") || undefined,
      channelId: next.get("DISCORD_CHANNEL_ID") || undefined,
    };
    config.notion = {
      enabled: config.repositories.some(
        (repo) => Boolean(repo.notionToken?.trim()) && Boolean((repo.notionDatabaseId ?? "").trim()),
      ),
    };
    config.github = {
      token: next.get("GITHUB_TOKEN") || undefined,
      ...(config.github?.owner && config.github?.repo
        ? { owner: config.github.owner, repo: config.github.repo }
        : {}),
    };
    config.gemini = {
      apiKey: next.get("GEMINI_API_KEY") || undefined,
      model: (next.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite").trim() || "gemini-3.5-flash-lite",
    };
    github.configure(config.github);
    git.setToken(config.github.token);
    config.sshKeyPath = (next.get("GIT_SSH_KEY_PATH") ?? "").trim();
    git.setSshKey(config.sshKeyPath);
    gemini.configure(config.gemini);
    dailyAutomation.reconfigure();

    let discordConfigureError: Error | null = null;
    try {
      await discord.configure(config.discord);
    } catch (error) {
      discordConfigureError = error instanceof Error ? error : new Error(String(error));
    }
    this.deps.onChanged();

    const statuses = await integrations.testIntegrations();
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

  /** HUB_GIT_REPOSITORIES JSON을 검증·정규화해 updates에 반영합니다. */
  private async validateRepositories(
    updates: Record<string, string>,
    explicitRepositoryClear: boolean,
    currentRaw: string | undefined,
  ): Promise<void> {
    const raw = updates.HUB_GIT_REPOSITORIES ?? "";
    if (!raw.trim()) {
      if (explicitRepositoryClear) {
        updates.HUB_GIT_REPOSITORIES = "";
      } else {
        delete updates.HUB_GIT_REPOSITORIES;
        if (currentRaw?.trim()) {
          this.appendWarning("저장소 목록은 Git 저장소 탭에서만 삭제할 수 있습니다. 기존 저장소를 유지합니다.");
        }
      }
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Array<Partial<{
        label: string; username: string; defaultBranch: string; path: string;
        url: string; branches: string[]; discordMinCommits: number; discordBranches: string[];
        project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
      }>>;
      const validated: Array<{
        label: string; username: string; defaultBranch: string; path: string; url: string;
        branches: string[]; discordMinCommits: number; discordBranches: string[];
        project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
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
          repoPath = await this.deps.git.validateRepository(rawPath);
        } catch (validationError) {
          this.appendWarning("저장소 검증 지연: " + (validationError instanceof Error ? validationError.message : String(validationError)));
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
              ? normalizeNotionDatabaseId(item.notionDatabaseId)
              : "",
          notionToken: typeof item?.notionToken === "string" ? item.notionToken.trim() : "",
          discordChannelId: typeof item?.discordChannelId === "string" ? item.discordChannelId.trim() : "",
        });
      }
      if (validated.length === 0 && !explicitRepositoryClear) {
        // 빈 배열("[]")은 여러 저장 경로(자동저장·Notion·Discord)에서 기존 목록을
        // 의도치 않게 덮어쓰는 원인이 되므로, 명시적 삭제가 아닌 경우 기존 저장소를 유지합니다.
        if (currentRaw?.trim()) delete updates.HUB_GIT_REPOSITORIES;
        else updates.HUB_GIT_REPOSITORIES = "[]";
      } else {
        updates.HUB_GIT_REPOSITORIES = JSON.stringify(validated);
      }
    } catch (error) {
      delete updates.HUB_GIT_REPOSITORIES;
      this.appendWarning(
        "저장소 목록 JSON이 손상되어 변경사항을 건너뛰고 이전 값을 유지했습니다: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** 로컬 저장소 목록을 Config 저장소의 projects.json에 병합한 뒤 GitHub로 푸시합니다. */
  private async syncProjectsToConfig(
    repositories: Array<{
      project?: string; label: string; username?: string; defaultBranch?: string; path: string; url: string;
      branches: string[]; discordMinCommits?: number; discordBranches?: string[];
      notionDatabaseId?: string; discordChannelId?: string;
    }>,
  ): Promise<void> {
    const existingText = await this.deps.github.readFile("projects.json", "main");
    const current = existingText ? parseProjectsFile(existingText) : this.deps.registry.get();
    if (!existingText && current.length === 0) {
      throw new Error("중앙 projects.json 을 읽지 못해 동기화를 건너뛰었습니다. 기존 정의를 보존합니다.");
    }
    const merged = upsertProjectsFromRepositories(current, repositories);
    this.deps.registry.set(merged);
    await this.deps.github.writeFile(
      "projects.json",
      serializeProjectsFile(merged),
      "main",
      "chore: sync repositories into projects.json",
    );
    await this.refreshProjectsCache();
  }

  /** 로컬 프로젝트 캐시 파일을 갱신합니다(최선 노력). */
  private async refreshProjectsCache(): Promise<void> {
    const { registry } = this.deps;
    try {
      if (!registry.getCacheFile()) {
        registry.setCacheFile(await ensureProjectsCacheDir(this.deps.config.dataDirectory));
      }
      await writeFile(
        registry.getCacheFile(),
        JSON.stringify({ fetchedAt: new Date().toISOString(), projects: registry.get() }, null, 2),
        { encoding: "utf8", mode: 0o600 },
      );
    } catch {
      /* cache write is best-effort */
    }
  }

  private appendWarning(message: string): void {
    this.lastRepositoriesWarning = (this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : "") + message;
  }

  /** 시작 시 자격증명 설치 등 외부에서 생긴 경고를 설정 메시지에 합칩니다. */
  public addWarning(message: string): void {
    this.appendWarning(message);
  }
}

/** Notion 데이터베이스 URL/ID 표기를 표준 UUID 형식으로 정규화합니다. */
export function normalizeNotionDatabaseId(value: string): string {
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

