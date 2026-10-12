/**
 * HUB_GIT_REPOSITORIES(JSON) 문자열을 저장소 설정 배열로 파싱합니다.
 *
 * 손상된 JSON은 예외를 던지지 않고 빈 배열을 돌려주어, 설정 저장 흐름이
 * 통째로 실패하지 않게 합니다.
 */
export function parseRepositoriesForConfig(raw?: string): Array<{
  label: string; username: string; defaultBranch: string; path: string; url: string;
  branches: string[]; discordMinCommits: number; discordBranches: string[];
  project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
}> {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<{
      label: string; username: string; defaultBranch: string; path: string; url: string;
      branches: string[]; discordMinCommits: number; discordBranches: string[];
      project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
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
        notionToken: typeof item.notionToken === "string" ? item.notionToken.trim() : "",
        discordChannelId: typeof item.discordChannelId === "string" ? item.discordChannelId.trim() : "",
      }));
  } catch {
    return [];
  }
}

/** env 값("1"/"true"/"yes"/"on")을 불리언으로 해석합니다. */
export function parseBoolean(value?: string): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

