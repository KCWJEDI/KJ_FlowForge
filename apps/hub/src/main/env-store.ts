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
  { key: "GITHUB_TOKEN", label: "Personal access token", group: "GitHub", kind: "secret", hint: "Needs repo scope; add workflow scope for workflow dispatch" },
  { key: "GIT_SSH_KEY_PATH", label: "SSH 배포 키 파일 경로", group: "GitHub", kind: "path", hint: "GitHub 계정 없이 저장소에 접속할 때 사용할 SSH 개인키 파일 경로입니다(예: C:\\keys\\flowforge_deploy). 비워두면 위 토큰을 사용합니다." },
  { key: "GEMINI_API_KEY", label: "Gemini API Key", group: "AI 요약", kind: "secret", adminOnly: true, hint: "Google AI Studio API key. 관리자만 설정할 수 있습니다. 일일 작업 보고를 Gemini로 요약합니다." },
  { key: "GEMINI_MODEL", label: "Gemini 모델", group: "AI 요약", kind: "text", adminOnly: true, hint: "요약에 사용할 Gemini 모델명 (기본: gemini-3.5-flash-lite)" },
  { key: "HUB_KANBAN_DATABASE_ID", label: "칸반보드 Notion 데이터베이스 ID", group: "칸반보드", kind: "text", hint: "칸반보드로 사용할 Notion 데이터베이스 ID입니다. 이 데이터베이스에 통합(KJ_FlowForge)이 연결되어 있어야 합니다." },
  { key: "HUB_KANBAN_GROUP_PROPERTY", label: "칸반 열 속성 이름", group: "칸반보드", kind: "text", hint: "칸반 열로 사용할 Notion 속성 이름입니다(기본: 상태). status 또는 select 속성이어야 합니다." },
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
      value = decodeDoubleQuotedValue(value);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      // 작은따옴표는 dotenv 규칙상 원시 값(raw)으로 취급한다.
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

/**
 * 큰따옴표로 감싼 값을 JSON 문자열 규칙으로 복원합니다.
 *
 * 저장 시에는 반드시 JSON.stringify 로 기록하지만, 과거 버전은 따옴표만 이스케이프하고
 * 백슬래시를 그대로 기록했습니다(C:\\WorkSpace 처럼). 그런 파일을 만나면 JSON 파싱이
 * 실패해 저장소 목록(HUB_GIT_REPOSITORIES)이 통째로 비어버리므로, JSON 형태일 때만
 * 백슬래시를 복원하는 최선 노력(best-effort) 복구를 수행합니다.
 */
function decodeDoubleQuotedValue(raw: string): string {
  try {
    return JSON.parse(raw) as string;
  } catch {
    const inner = raw.slice(1, -1);
    // 일반 문자열(예: Windows 경로)은 그대로 두어 기존 동작을 유지합니다.
    if (!/^[[{]/.test(inner.trim())) return inner;
    // JSON 값이면 이스케이프되지 않은 백슬래시를 복원해 살립니다.
    const sentinel = "\u0000";
    const quoted = inner.replace(/\\"/g, sentinel);
    const escaped = quoted.replace(/\\/g, "\\\\");
    const candidate = escaped.split(sentinel).join('"');
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return inner;
    }
  }
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
  // JSON 규칙으로 정확히 이스케이프합니다. 백슬래시를 이스케이프하지 않으면
  // Windows 경로가 담긴 저장소 JSON이 저장→재시작 왕복에서 손상되어
  // 저장소 목록이 통째로 사라집니다(다른 컴퓨터에서 저장소가 안 보이던 원인).
  if (/[\s#"']/.test(value)) return JSON.stringify(value);
  return value;
}
