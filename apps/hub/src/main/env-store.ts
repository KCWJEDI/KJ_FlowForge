import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EnvKind = "text" | "secret" | "number" | "path";

export interface EnvDefinition {
  key: string;
  label: string;
  group: string;
  kind: EnvKind;
  hint?: string;
}

export const ENV_DEFINITIONS: EnvDefinition[] = [
  { key: "HUB_HTTP_PORT", label: "HTTP API port", group: "Hub", kind: "number", hint: "Local dashboard/API port (restart required)" },
  { key: "HUB_TCP_PORT", label: "Unity TCP port", group: "Hub", kind: "number", hint: "Unity editor TCP port (restart required)" },
  { key: "HUB_COMMAND_TIMEOUT_MS", label: "Command timeout (ms)", group: "Hub", kind: "number", hint: "Per-command timeout (restart required)" },
  { key: "HUB_MAX_FRAME_BYTES", label: "Max frame size (bytes)", group: "Hub", kind: "number", hint: "Max TCP frame size (restart required)" },
  { key: "HUB_API_TOKEN", label: "API token", group: "Hub", kind: "secret", hint: "Bearer token for the local HTTP API" },
  { key: "HUB_GIT_REPOSITORIES", label: "분야별 Git 저장소 목록", group: "Hub", kind: "text", hint: "설정 탭에서 추가한 저장소 JSON입니다. Discord 조건은 discordMinCommits와 discordBranches로 저장됩니다." },
  { key: "HUB_DAILY_AUTOMATION_ENABLED", label: "08:00 Git/Notion 자동화", group: "Automation", kind: "text", hint: "true로 설정하면 매일 오전 08:00에 선택 브랜치의 새 커밋을 읽고 Notion 일일작업을 등록합니다." },
  { key: "DISCORD_BOT_TOKEN", label: "Bot token", group: "Discord", kind: "secret", hint: "Discord Developer Portal → Bot → Reset Token" },
  { key: "DISCORD_CHANNEL_ID", label: "Channel ID", group: "Discord", kind: "text", hint: "Copy from a channel with Developer Mode enabled" },
  { key: "NOTION_TOKEN", label: "Integration token", group: "Notion", kind: "secret", hint: "Notion → Settings → Connections → integrations" },
  { key: "NOTION_DATABASE_ID", label: "Database ID (구버전 호환)", group: "Notion", kind: "text", hint: "더 이상 사용하지 않습니다. Notion 데이터베이스는 설정 탭의 'Notion 저장소'에서 저장소별로 지정하세요." },
  { key: "GITHUB_TOKEN", label: "Personal access token", group: "GitHub", kind: "secret", hint: "Needs repo scope; add workflow scope for workflow dispatch" },
];

export const ENV_KEYS = ENV_DEFINITIONS.map((definition) => definition.key);

export function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
