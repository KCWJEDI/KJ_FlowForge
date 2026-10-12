import type { GitChangeSummary } from "../git/git-service";

/**
 * 커밋/푸시 상관관계와 현재 브랜치 캐시를 공유하는 상태 저장소입니다.
 *
 * GitWorkflow(생성·조회)와 ProjectAccessGuard(개인 브랜치 정책 판정)가 같은 상태를
 * 봐야 하므로 HubRuntime이 만들어 양쪽에 주입합니다.
 */
export class GitBranchState {
  /** 저장소 경로 -> 방금 생성한 커밋 요약(푸시 전 HEAD 검증용). */
  public readonly createdCommits = new Map<string, GitChangeSummary>();
  /** 저장소 경로 -> 현재 브랜치(개인 브랜치 정책 판정용). */
  public readonly currentBranch = new Map<string, string>();
}

