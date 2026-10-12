import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GitRepositorySetting, LicenseRole, PublicConfig } from "../shared/ipc";
import { applyEnvToProcess, readEnvFile } from "./env-store";

export const DEFAULT_PROJECTS_URL =
  "https://raw.githubusercontent.com/KCWJEDI/KJ_FlowForge_Config/main/projects.json";

const envSchema = z.object({
  HUB_HTTP_PORT: z.coerce.number().int().min(1024).max(65535).default(43100),
  HUB_TCP_PORT: z.coerce.number().int().min(1024).max(65535).default(43101),
  HUB_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  HUB_MAX_FRAME_BYTES: z.coerce.number().int().min(1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024),
  HUB_API_TOKEN: z.string().optional(),
  HUB_GIT_REPOSITORIES: z.string().optional(),
  HUB_GIT_REPOSITORY: z.string().optional(),
  HUB_PROJECTS_URL: z.string().optional(),
  HUB_CONFIG_REPO: z.string().optional(),
  HUB_DAILY_AUTOMATION_ENABLED: z.string().optional(),
  HUB_DAILY_AUTOMATION_PROJECTS: z.string().optional(),
  HUB_GIT_BRANCHES: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CHANNEL_ID: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GIT_SSH_KEY_PATH: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
});

export interface HubConfig {
  host: "127.0.0.1";
  httpPort: number;
  tcpPort: number;
  commandTimeoutMs: number;
  maxFrameBytes: number;
  apiToken: string;
  repositories: GitRepositorySetting[];
  projectsUrl: string;
  /** 프로젝트 정의를 push할 Config 저장소 (owner/repo), HUB_CONFIG_REPO 또는 projectsUrl에서 유도 */
  configRepo: string | null;
  envFile: string;
  dataDirectory: string;
  secretFile: string;
  sessionSecret: string;
  selectionFile?: string;
  dailyAutomation: {
    enabled: boolean;
    projects?: string[];
  };
  discord: { token?: string; channelId?: string };
  notion: { enabled: boolean };
  github: { token?: string; owner?: string; repo?: string };
  /** GitHub 계정 없이 저장소에 접속할 SSH 배포 키 경로(HTTPS 토큰보다 우선). */
  sshKeyPath: string;
  gemini: { apiKey?: string; model: string };
}

export async function loadConfig(dataDirectory: string, envFile: string): Promise<HubConfig> {
  applyEnvToProcess(await readEnvFile(envFile));
  const env = envSchema.parse(process.env);
  await mkdir(dataDirectory, { recursive: true });
  const sessionSecret = randomBytes(32).toString("hex");
  const secretFile = path.join(dataDirectory, "unity-session.json");
  await writeFile(
    secretFile,
    `${JSON.stringify({ host: "127.0.0.1", port: env.HUB_TCP_PORT, sessionSecret }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const selectionFile = path.join(dataDirectory, "git-selection.json");

  const projectsUrl = (env.HUB_PROJECTS_URL ?? "").trim() || DEFAULT_PROJECTS_URL;
  const configRepoValue = resolveConfigRepo((env.HUB_CONFIG_REPO ?? "").trim(), projectsUrl);
  const githubParts = configRepoValue ? configRepoValue.split("/") : [];

  return {
    host: "127.0.0.1",
    httpPort: env.HUB_HTTP_PORT,
    tcpPort: env.HUB_TCP_PORT,
    commandTimeoutMs: env.HUB_COMMAND_TIMEOUT_MS,
    maxFrameBytes: env.HUB_MAX_FRAME_BYTES,
    apiToken: env.HUB_API_TOKEN || randomBytes(24).toString("base64url"),
    repositories: parseRepositories(env.HUB_GIT_REPOSITORIES, env.HUB_GIT_REPOSITORY, env.HUB_GIT_BRANCHES),
    projectsUrl,
    configRepo: configRepoValue,
    envFile,
    dataDirectory,
    secretFile,
    sessionSecret,
    selectionFile,
    dailyAutomation: {
      enabled: /^(1|true|yes|on)$/i.test(env.HUB_DAILY_AUTOMATION_ENABLED ?? ""),
      projects: parseBranchList(env.HUB_DAILY_AUTOMATION_PROJECTS),
    },
    discord: { token: env.DISCORD_BOT_TOKEN, channelId: env.DISCORD_CHANNEL_ID },
    notion: { enabled: false },
    github: {
      token: env.GITHUB_TOKEN,
      ...(githubParts.length === 2 && githubParts[0] && githubParts[1]
        ? { owner: githubParts[0], repo: githubParts[1] }
        : {}),
    },
    sshKeyPath: (env.GIT_SSH_KEY_PATH ?? "").trim(),
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      model: (env.GEMINI_MODEL ?? "gemini-3.5-flash-lite").trim() || "gemini-3.5-flash-lite",
    },
  };
}

function resolveConfigRepo(configRepo: string, projectsUrl: string): string | null {
  if (configRepo) return configRepo.trim();
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)/i.exec(projectsUrl);
  if (m?.[1] && m?.[2]) return m[1] + "/" + m[2];
  return null;
}

function parseBranchList(value?: string): string[] {
  return [...new Set((value ?? "").split(",").map((branch) => branch.trim()).filter(Boolean))];
}

function parseRepositories(
  repositoriesRaw: string | undefined,
  legacyRepository: string | undefined,
  legacyBranches: string | undefined,
): GitRepositorySetting[] {
  if (repositoriesRaw && repositoriesRaw.trim()) {
    try {
      const parsed = JSON.parse(repositoriesRaw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is { project?: unknown; label?: unknown; username?: unknown; defaultBranch?: unknown; path?: unknown; url?: unknown; branches?: unknown; discordMinCommits?: unknown; discordBranches?: unknown; notionDatabaseId?: unknown; notionToken?: unknown; discordChannelId?: unknown } =>
           Boolean(item) && typeof item === "object")
         .map((item) => ({
           project: typeof item.project === "string" && item.project.trim() ? item.project.trim() : "",
           label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : "저장소",
           username: typeof item.username === "string" ? item.username.trim() : "",
           defaultBranch: typeof item.defaultBranch === "string" ? item.defaultBranch.trim() : "",
           path: typeof item.path === "string" && item.path.trim() ? item.path.trim() : "",
            url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : "",
            branches: Array.isArray(item.branches) ? item.branches.filter((branch): branch is string => typeof branch === "string") : [],
           discordMinCommits: parseMinCommits(item.discordMinCommits),
           discordBranches: parseBranchArray(item.discordBranches),
           notionDatabaseId: typeof item.notionDatabaseId === "string" ? item.notionDatabaseId.trim() : "",
           notionToken: typeof item.notionToken === "string" ? item.notionToken.trim() : "",
           discordChannelId: typeof item.discordChannelId === "string" ? item.discordChannelId.trim() : "",
         }))
         .filter((item) => item.path.length > 0);
      }
    } catch {
      // Fall through to legacy handling if the JSON value is invalid.
    }
  }
  const legacy = legacyRepository?.trim();
  if (legacy) {
    return [{ project: "", label: "기본", username: "", defaultBranch: "", path: legacy, url: "", branches: parseBranchList(legacyBranches), notionDatabaseId: "", notionToken: "" }];
  }
  return [];
}

function parseBranchArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((branch): branch is string => typeof branch === "string" && Boolean(branch.trim())).map((branch) => branch.trim()))] : [];
}

function parseMinCommits(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function toPublicConfig(config: HubConfig, role: LicenseRole = "admin"): PublicConfig {
  return {
    httpPort: config.httpPort,
    tcpPort: config.tcpPort,
    commandTimeoutMs: config.commandTimeoutMs,
    // 일반 유저에게는 관리자의 로컬 저장소 목록을 노출하지 않습니다.
    repositories: role === "admin" ? config.repositories : [],
    secretFile: role === "admin" ? config.secretFile : "",
    integrations: {
      discord: Boolean(config.discord.token),
      notion: config.repositories.some((repo) => Boolean(repo.notionToken?.trim())),
      github: Boolean(config.github.token),
      gemini: Boolean(config.gemini.apiKey),
    },
  };
}
