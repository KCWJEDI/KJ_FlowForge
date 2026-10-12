/**
 * 저장소 원격 URL 동일성 판정의 단일 기준(single source of truth).
 *
 * 같은 저장소를 나타내는 URL 표기는 여러 형태가 존재합니다.
 *   https://github.com/owner/repo.git
 *   http://github.com/owner/repo
 *   ssh://git@github.com/owner/repo.git
 *   git://github.com/owner/repo.git
 *   git@github.com:owner/repo.git      (SCP 형식)
 *   owner/repo                          (짧은 표기)
 *
 * 이전에는 이 정규화가 projects-store / git-service / renderer / keygen 에
 * 서로 다르게 구현되어 있었고, SCP 형식(git@host:path)을 처리하지 못하는
 * 구현이 있어 https 원격을 쓰는 중앙 projects.json 과 ssh 원격을 쓰는 로컬
 * 클론이 서로 다른 저장소로 판정되었습니다. 그 결과 한 컴퓨터에서는 보이던
 * 저장소/프로젝트/브랜치가 다른 컴퓨터에서 사라지는 문제가 발생했습니다.
 *
 * 이 모듈은 Node 전용 API를 쓰지 않으므로 main 과 renderer 어디서나 사용합니다.
 */

/** 판정용으로 비교 가능한 형태로 원격 URL을 정규화합니다. */
export function normalizeRepoIdentity(value: string): string {
  let trimmed = (value ?? "").trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  // URL 표기 주변의 공백/따옴표 제거
  trimmed = trimmed.replace(/^["']|["']$/g, "");

  // SCP 형식: [user@]host:path  (단, Windows 드라이브 문자와 스킴은 제외)
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
  if (scp && !/^[A-Za-z]:\//.test(trimmed) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return scp[1]!.toLowerCase() + "/" + trimTail(scp[2]!).toLowerCase();
  }

  // 스킴 형식: scheme://[user@]host[:port]/path
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/i.exec(trimmed);
  if (scheme) {
    let rest = scheme[1]!;
    const at = rest.lastIndexOf("@");
    if (at >= 0) rest = rest.slice(at + 1);
    const slash = rest.indexOf("/");
    if (slash < 0) return rest.toLowerCase().replace(/\/$/, "");
    const host = rest.slice(0, slash).toLowerCase();
    return host + "/" + trimTail(rest.slice(slash + 1)).toLowerCase();
  }

  // 그 외(로컬 경로 또는 짧은 표기): 소문자 비교
  return trimTail(trimmed.toLowerCase());
}

function trimTail(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
}

/** 두 원격 URL이 같은 저장소를 가리키는지 판정합니다. */
export function isSameRepository(a: string, b: string): boolean {
  const left = normalizeRepoIdentity(a);
  const right = normalizeRepoIdentity(b);
  return Boolean(left && right) && left === right;
}
