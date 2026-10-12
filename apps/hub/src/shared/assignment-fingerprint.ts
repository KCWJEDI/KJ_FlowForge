/**
 * 브랜치 배정(라이선스별 허용 브랜치)의 변경을 감지하기 위한 지문 계산입니다.
 *
 * 관리자가 CreateKey에서 브랜치 권한을 바꾸면 중앙 projects.json 이 바뀝니다.
 * 앱은 주기적으로 이 값을 다시 읽어, 지문이 달라졌을 때만 화면을 갱신합니다.
 * (매번 다시 그리면 사용자가 보던 체크 상태가 흔들리므로 변경 시에만 반영합니다.)
 */
import type { ProjectView } from "./ipc";

/**
 * 프로젝트 목록에서 비교용 지문을 만듭니다.
 * 프로젝트 id·이름과 허용 브랜치 목록을 정렬해 포함하므로,
 * 브랜치 추가/회수·프로젝트 추가/삭제/이름 변경을 모두 감지합니다.
 */
export function assignmentFingerprint(projects: readonly ProjectView[]): string {
  return projects
    .map((project) => {
      const branches = Array.isArray(project.selectableBranches) ? project.selectableBranches : [];
      const allowed = Array.isArray(project.allowedBranches) ? project.allowedBranches : [];
      const merged = [...new Set([...branches, ...allowed])].sort();
      return [project.id, project.name, merged.join("|")].join(":");
    })
    .sort()
    .join(";");
}

/** 두 프로젝트 목록의 배정이 실질적으로 달라졌는지 판정합니다. */
export function assignmentsChanged(
  previous: readonly ProjectView[],
  next: readonly ProjectView[],
): boolean {
  return assignmentFingerprint(previous) !== assignmentFingerprint(next);
}

