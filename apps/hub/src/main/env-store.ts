import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EnvKind = "text" | "secret" | "number" | "path";

export interface EnvDefinition {
  key: string;
  label: string;
  group: string;
  kind: EnvKind;
  hint?: string;
  /** 관리자(admin 라이선스)만 설정할 수 있는 필드. 일반 사용자에게는 노출/편집이 차단됩니다. */
  adminOnly?: boolean;
}

export const ENV_DEFINITIONS: EnvDefinition[] = [
  { key: "HUB_HTTP_PORT", label: "HTTP API port", group: "Hub", kind: "number", hint: "Local dashboard/API port (restart required)" },
  { key: "HUB_TCP_PORT", label: "Unity TCP port", group: "Hub", kind: "number", hint: "Unity editor TCP port (restart required)" },
  { key: "HUB_COMMAND_TIMEOUT_MS", label: "Command timeout (ms)", group: "Hub", kind: "number", hint: "Per-command timeout (restart required)" },
  { key: "HUB_MAX_FRAME_BYTES", label: "Max frame size (bytes)", group: "Hub", kind: "number", hint: "Max TCP frame size (restart required)" },
  { key: "HUB_API_TOKEN", label: "API token", group: "Hub", kind: "secret", hint: "Bearer token for the local HTTP API" },
  { key: "HUB_GIT_REPOSITORIES", label: "분야별 Git 저장소 목록", group: "Hub", kind: "text", hint: "설정 탭에서 추가한 저장소 JSON입니다. Discord 조건은 discordMinCommits와 discordBranches로 저장됩니다." },
  { key: "HUB_PROJECTS_URL", label: "프로젝트 정의 URL", group: "Hub", kind: "text", hint: "KJ_FlowForge_Config 저장소의 projects.json raw URL입니다. 일반 사용자는 여기 등록된 프로젝트만 사용할 수 있습니다." },
  { key: "HUB_CONFIG_REPO", label: "Config 저장소 (owner/repo)", group: "Hub", kind: "text", adminOnly: true, hint: "프로젝트 정의를 push할 KJ_FlowForge_Config 저장소입니다. 관리자만 수정할 수 있습니다." },
  { key: "HUB_DAILY_AUTOMATION_ENABLED", label: "08:00 Git/Notion 자동화", group: "Automation", kind: "text", hint: "true로 설정하면 매일 오전 08:00에 선택 브랜치의 새 커밋을 읽고 Notion 일일작업을 등록합니다." },
  { key: "HUB_DAILY_AUTOMATION_PROJECTS", label: "08:00 자동화 대상 프로젝트", group: "Automation", kind: "text", hint: "자동화 탭에서 선택한 프로젝트 목록(쉼표 구분)입니다. 자동화 탭에서 관리됩니다." },
  { key: "DISCORD_BOT_TOKEN", label: "Bot token", group: "Discord", kind: "secret", hint: "Discord Developer Portal → Bot → Reset Token" },
  { key: "DISCORD_CHANNEL_ID", label: "Channel ID", group: "Discord", kind: "text", hint: "Copy from a channel with Developer Mode enabled" },
  { key: "NOTION_TOKEN", label: "Integration token", group: "Notion", kind: "secret", hint: "Notion → Settings → Connections → integrations" },
  { key: "GITHUB_TOKEN", label: "Personal access token", group: "GitHub", kind: "secret", hint: "Needs repo scope; add workflow scope for workflow dispatch" },
  { key: "GEMINI_API_KEY", label: "Gemini API Key", group: "AI 요약", kind: "secret", adminOnly: true, hint: "Google AI Studio API key. 관리자만 설정할 수 있습니다. 일일 작업 보고를 Gemini로 요약합니다." },
  { key: "GEMINI_MODEL", label: "Gemini 모델", group: "AI 요약", kind: "text", adminOnly: true, hint: "요약에 사용할 Gemini 모델명 (기본: gemini-3.5-flash-lite)" },
];

export const ENV_KEYS = ENV_DEFINITIONS.map((definition) => definition.key);

export function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      // 큰따옴표로 감싼 값은 JSON 문자열 규칙으로 이스케이프(\", \\ 등)를 복원해야
      // 저장→읽기→재저장 주기를 반복해도 값이 변질되지 않는다. JSON 저장소 값이 계속
      // 백슬래시를 쌓아 손상되는 문제를 막는다.
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      // 작은따옴표는 dotenv 규칙상 원시 값(raw)으로 취급한다.
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

export function buildEnvTemplate(values?: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  let lastGroup = "";
  for (const definition of ENV_DEFINITIONS) {
    if (definition.group !== lastGroup) {
      if (lines.length > 0) lines.push("");
      lines.push(`# ----- ${definition.group} -----`);
      lastGroup = definition.group;
    }
    if (definition.hint) lines.push(`# ${definition.hint}`);
    const value = values?.get(definition.key) ?? "";
    lines.push(`${definition.key}=${quoteValue(value)}`);
  }
  const managedKeys = new Set(ENV_KEYS);
  const customEntries = [...(values?.entries() ?? [])].filter(([key]) => !managedKeys.has(key));
  if (customEntries.length > 0) {
    lines.push("", "# ----- Custom -----");
    for (const [key, value] of customEntries) lines.push(`${key}=${quoteValue(value)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function ensureEnvFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(filePath, buildEnvTemplate(), { encoding: "utf8", mode: 0o600 });
  }
}

export async function readEnvFile(filePath: string): Promise<Map<string, string>> {
  return parseEnvFile(await readFile(filePath, "utf8"));
}

export async function writeEnvFile(filePath: string, updates: Readonly<Record<string, string | undefined>>): Promise<Map<string, string>> {
  await ensureEnvFile(filePath);
  const values = await readEnvFile(filePath);
  for (const [key, value] of Object.entries(updates)) {
    values.set(key, value ?? "");
  }
  await writeFile(filePath, buildEnvTemplate(values), { encoding: "utf8", mode: 0o600 });
  return values;
}

export function applyEnvToProcess(values: ReadonlyMap<string, string>): void {
  for (const key of ENV_KEYS) {
    const value = values.get(key);
    if (value) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

function quoteValue(value: string): string {
  if (/[\s#"']/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}
