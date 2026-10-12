import type { IntegrationConnectionStatus, RepositoryConnectionCheck } from "../../shared/ipc";
import type { HubConfig } from "../config";
import type { DiscordAdapter } from "../integrations/discord-adapter";
import type { GeminiAdapter } from "../integrations/gemini-adapter";
import type { GitHubAdapter } from "../integrations/github-adapter";
import { NotionAdapter } from "../integrations/notion-adapter";

export interface IntegrationsDeps {
  discord: DiscordAdapter;
  notion: NotionAdapter;
  github: GitHubAdapter;
  gemini: GeminiAdapter;
  getRepositories(): HubConfig["repositories"];
}

/**
 * Discord / Notion / GitHub 연결 테스트와 상태 조회를 담당합니다.
 *
 * 설정 저장 흐름이 저장 후 통합 상태를 새로고침할 때도 이 모듈을 사용합니다.
 */
export class Integrations {
  public constructor(private readonly deps: IntegrationsDeps) {}

  /** 설정 탭 'Notion 저장소'에서 특정 데이터베이스 ID의 연결을 테스트합니다. */
  public async testNotionDatabase(args: { repository?: string; databaseId: string; token?: string }): Promise<{ ok: boolean; message: string }> {
    const databaseId = (args.databaseId ?? "").trim();
    if (!databaseId) return { ok: false, message: "데이터베이스 ID를 먼저 입력하세요." };
    // 화면에 방금 입력한 토큰이 전달되면 그 값을 우선해 검증한다. 값이 없으면
    // 저장된(in-memory) 저장소 토큰으로 검증한다.
    const explicitToken = (args.token ?? "").trim();
    const repository = this.deps.getRepositories().find((r) => r.path === args.repository || r.label === args.repository);
    const token = explicitToken || repository?.notionToken?.trim();
    if (!token) return { ok: false, message: "Notion integration token이 저장소에 설정되지 않았습니다." };
    try {
      const adapter = NotionAdapter.forToken(token);
      const message = await adapter.testConnection(databaseId);
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
      const message = await this.deps.discord.testChannel(channelId);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 저장소별 Notion DB · Discord 채널 연결 상태를 배치로 확인합니다. */
  public async checkRepositoryConnections(): Promise<RepositoryConnectionCheck[]> {
    const checks: RepositoryConnectionCheck[] = [];
    const seen = new Map<string, Set<"notion" | "discord">>();
    for (const repository of this.deps.getRepositories()) {
      const repoPath = repository.path.trim();
      const bucket = seen.get(repoPath) ?? new Set<"notion" | "discord">();
      seen.set(repoPath, bucket);

      const notionId = (repository.notionDatabaseId ?? "").trim();
      const notionToken = (repository.notionToken ?? "").trim();
      if (notionId && notionToken && !bucket.has("notion")) {
        bucket.add("notion");
        try {
          const adapter = NotionAdapter.forToken(notionToken);
          const message = await adapter.testConnection(notionId);
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
          const message = await this.deps.discord.testChannel(channelId);
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

  /** Discord / Notion / GitHub 통합 연결 상태를 반환합니다. */
  public async testIntegrations(): Promise<IntegrationConnectionStatus[]> {
    const notionRepo = this.deps.getRepositories().find((r) => r.notionToken?.trim() && r.notionDatabaseId?.trim());
    return Promise.all([
      this.testIntegration("discord", this.deps.discord.enabled, () => this.deps.discord.testConnection()),
      this.testIntegration("notion", Boolean(notionRepo), async () => {
        if (!notionRepo?.notionToken?.trim() || !notionRepo.notionDatabaseId?.trim()) {
          throw new Error("Notion integration token 또는 database ID가 설정된 저장소가 없습니다.");
        }
        const adapter = NotionAdapter.forToken(notionRepo.notionToken);
        return adapter.testConnection(notionRepo.notionDatabaseId);
      }),
      this.testIntegration("github", this.deps.github.enabled, () => this.deps.github.testConnection()),
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
}

