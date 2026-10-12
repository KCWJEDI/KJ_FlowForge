import type {
  GitChangeSummary,
  GitCloneResult,
  GitConnectOrCloneResult,
  GitConnectResult,
  GitPullResult,
  GitStatusView,
} from "../../shared/ipc";
import type { GitService } from "../git/git-service";
import type { CredentialManager } from "./credential-manager";
import type { GitBranchState } from "./git-state";
import type { ProjectAccess } from "./project-access";

export interface GitWorkflowDeps {
  git: GitService;
  credentials: CredentialManager;
  access: ProjectAccess;
  branchState: GitBranchState;
  /** 상태 변경(커밋/푸시/폐기 등) 후 화면 새로고침을 알립니다. */
  onChanged: () => void;
}

/**
 * Git 작업(조회·브랜치 전환·스테이징·폐기·커밋·푸시·풀)을 담당합니다.
 *
 * 커밋/푸시 상관관계는 GitBranchState에 남기고, 브랜치 접근 정책은
 * ProjectAccess에 위임합니다. 이 클래스는 Git 명령 실행과 상태 전이를 조합합니다.
 */
export class GitWorkflow {
  public constructor(private readonly deps: GitWorkflowDeps) {}

  private resolve(repository?: string): string {
    return this.deps.access.resolveRepository(repository);
  }

  public async inspect(repository?: string): Promise<GitStatusView> {
    return this.deps.git.inspect(this.resolve(repository));
  }

  public async clone(args: { url: string; directory: string }): Promise<GitCloneResult> {
    this.deps.git.setSshKey(this.deps.credentials.sshKeyForUrl(args.url));
    const root = await this.deps.git.cloneRepository(args.url, args.directory);
    const identity = await this.deps.git.getRepositoryIdentity(root);
    return { path: root, url: identity.originUrl, identity: identity.key };
  }

  public async connect(args: { directory: string }): Promise<GitConnectResult> {
    const identity = await this.deps.git.getRepositoryIdentity(args.directory);
    return { path: identity.root, url: identity.originUrl, identity: identity.key };
  }

  public async connectOrClone(args: { url: string; directory: string }): Promise<GitConnectOrCloneResult> {
    this.deps.git.setSshKey(this.deps.credentials.sshKeyForUrl(args.url));
    const result = await this.deps.git.connectOrClone(args.url, args.directory);
    return { action: result.action, path: result.root, url: result.originUrl, identity: result.identity };
  }

  public async switchBranch(repository: string | undefined, branch: string): Promise<GitStatusView> {
    const target = this.resolve(repository);
    await this.deps.access.assertUserProjectAccess(target, branch);
    await this.deps.git.switchBranch(target, branch);
    this.deps.onChanged();
    return this.deps.git.inspect(target);
  }

  public async createBranch(repository: string | undefined, branch: string, startPoint?: string): Promise<GitStatusView> {
    const target = this.resolve(repository);
    await this.deps.access.assertUserProjectAccess(target, branch, true);
    await this.deps.git.createBranch(target, branch, startPoint);
    this.deps.onChanged();
    return this.deps.git.inspect(target);
  }

  public async stage(repository: string | undefined, paths: string[]): Promise<GitStatusView> {
    const target = this.resolve(repository);
    await this.deps.git.stage(target, paths);
    this.deps.onChanged();
    return this.deps.git.inspect(target);
  }

  /**
   * 작업 트리의 변경사항을 폐기합니다(브랜치 전환을 막는 변경사항 정리).
   *
   * 새로 만든 파일은 기본적으로 남기고(안전), includeUntracked가 true일 때만 함께 지웁니다.
   */
  public async discardChanges(repository: string | undefined, includeUntracked = false): Promise<GitStatusView> {
    const target = this.resolve(repository);
    await this.deps.git.discardChanges(target);
    if (includeUntracked) {
      const untracked = await this.deps.git.listUntrackedFiles(target);
      if (untracked.length > 0) await this.deps.git.cleanUntracked(target, untracked);
    }
    this.deps.onChanged();
    return this.deps.git.inspect(target);
  }

  /** 폐기 대상 미리보기: 추적 파일 변경 수와 새 파일 목록을 반환합니다. */
  public async discardPreview(repository: string | undefined): Promise<{ changedFiles: number; untrackedFiles: string[] }> {
    const target = this.resolve(repository);
    const status = await this.deps.git.inspect(target);
    const untracked = await this.deps.git.listUntrackedFiles(target);
    return { changedFiles: status.files.length, untrackedFiles: untracked };
  }

  public async commitWithSummary(repository?: string): Promise<GitChangeSummary> {
    const target = this.resolve(repository);
    const status = await this.deps.git.inspect(target);
    this.deps.branchState.currentBranch.set(target, status.branch);
    await this.deps.access.assertUserProjectAccess(target, status.branch);
    this.deps.access.assertPersonalBranch(target);
    const summary = await this.deps.git.commitWithSummary(target);
    this.deps.branchState.createdCommits.set(target, summary);
    this.deps.onChanged();
    return summary;
  }

  public async pushCreatedCommit(repository?: string): Promise<GitStatusView> {
    const target = this.resolve(repository);
    const status = await this.deps.git.inspect(target);
    this.deps.branchState.currentBranch.set(target, status.branch);
    await this.deps.access.assertUserProjectAccess(target, status.branch);
    this.deps.access.assertPersonalBranch(target);
    const created = this.deps.branchState.createdCommits.get(target);
    if (!created) throw new Error("먼저 '변경사항 요약 후 커밋'을 실행해야 푸시할 수 있습니다.");
    if (status.head !== created.newHead) {
      throw new Error("생성한 커밋 이후 HEAD가 변경되었습니다. 새로고침 후 다시 시도하세요.");
    }
    await this.deps.git.push(target);
    this.deps.branchState.createdCommits.delete(target);
    this.deps.onChanged();
    return this.deps.git.inspect(target);
  }

  public async pushBranch(repository: string | undefined, branch: string, remote = "origin"): Promise<GitStatusView> {
    const target = this.resolve(repository);
    await this.deps.access.assertUserProjectAccess(target, branch);
    this.deps.branchState.currentBranch.set(target, branch);
    await this.deps.git.switchBranch(target, branch);
    await this.deps.git.push(target, remote, branch);
    this.deps.onChanged();
    return this.deps.git.inspect(target);
  }

  /**
   * 선택한 브랜치로 원격(main 등)의 최신 커밋을 가져옵니다(Pull).
   *
   * 공용 브랜치도 '가져오기'는 허용합니다(커밋·푸시만 제한). 작업 트리가 깨끗해야 합니다.
   */
  public async pull(repository: string | undefined, branch: string, remote = "origin"): Promise<GitPullResult> {
    const target = this.resolve(repository);
    await this.deps.access.assertUserProjectAccess(target, branch);
    // 원격 인증(배포 키/토큰)을 저장소 URL 기준으로 설정합니다.
    this.deps.credentials.applyForRepository(target);
    const result = await this.deps.git.pull(target, branch, remote);
    this.deps.branchState.createdCommits.delete(target);
    this.deps.onChanged();
    const status = await this.deps.git.inspect(target);
    return {
      repository: status.repository,
      branch: status.branch,
      updated: result.oldHead !== result.newHead,
      oldHead: result.oldHead,
      newHead: result.newHead,
      commits: result.commits,
      status,
    };
  }
}

