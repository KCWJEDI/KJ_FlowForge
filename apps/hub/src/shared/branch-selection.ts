/**
 * 라이선스 배정에 따라 사용자의 브랜치 선택을 정리하는 순수 규칙입니다.
 *
 * 렌더러의 저장된 상태(작업 브랜치·활성 브랜치)를 실제 배정과 대조해,
 * 권한이 회수된 브랜치를 제거합니다. 렌더러와 테스트가 같은 규칙을 쓰도록 분리했습니다.
 */

/**
 * 저장된 브랜치 목록에서 권한이 있는 브랜치만 남깁니다.
 *
 * - 관리자는 제한이 없으므로 그대로 둡니다.
 * - 배정 정보가 비어 있으면(아직 로드 전 등) 사용자의 선택을 함부로 지우지 않습니다.
 * - 배정이 있으면 그 목록에 없는 브랜치는 제거합니다(예: Test2 회수 시 체크 해제).
 */
export function filterBranchesByAllowed(args: {
  saved: string[];
  allowed: string[];
  isAdmin: boolean;
}): string[] {
  const saved = Array.isArray(args.saved) ? args.saved.filter((b) => typeof b === "string" && b.trim().length > 0) : [];
  if (args.isAdmin) return [...new Set(saved)];
  const allowed = Array.isArray(args.allowed) ? args.allowed.filter((b) => typeof b === "string" && b.trim().length > 0) : [];
  if (allowed.length === 0) return [...new Set(saved)];
  return [...new Set(saved.filter((branch) => allowed.includes(branch)))];
}

