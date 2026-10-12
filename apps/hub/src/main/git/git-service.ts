import { execFile } from "node:child_process";
import { access, mkdir, open, readFile, readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitStatusView } from "../../shared/ipc";
import { normalizeRepoIdentity } from "../../shared/repo-identity";
import { classifyPurpose, parseNumstat, parseNameStatus } from "./git-diff";

const execFileAsync = promisify(execFile);

export interface GitCommitSummary {
  hash: string;
  author: string;
  timestamp: string;
  subject: string;
  body: string;
  /** 커밋 목적 분류: 기능 | 성능 | 버그/수정 | 리팩토링 | 문서 | 기타 */
  category?: CommitCategory;
  /** 커밋별 변경 파일/라인 통계 */
  diff?: GitCommitDiffStats;
  /** diff가 계산되었는지 여부 */
  hasDiff?: boolean;
}

export type CommitCategory = "기능" | "성능" | "버그/수정" | "리팩토링" | "문서" | "기타";

export interface GitCommitDiffStats {
  addedFiles: string[];
  deletedFiles: string[];
  modifiedFiles: string[];
  insertions: number;
  deletions: number;
}

export interface GitBranchWorktree {
  branch: string;
  path: string;
}

export interface GitBranchSyncResult {
  repository: string;
  branch: string;
  worktree: string | null;
  committed: boolean;
  commitHash: string | null;
  changedFiles: number;
  oldHead: string | null;
  newHead: string | null;
  commits: GitCommitSummary[];
}

export interface GitBranchCaptureResult {
  repository: string;
  branch: string;
  previousHead: string | null;
  currentHead: string;
  commits: GitCommitSummary[];
}

export interface GitTimeCaptureInput {
  repository: string;
  branch: string;
  /** 비교 시작 임계(포함). 예: 전날 08:00 ISO 문자열 */
  sinceIso: string;
  /** 비교 종료 임계(미포함). 예: 당일 08:00 ISO 문자열 */
  untilIso: string;
}

export interface GitChangeSummary {
  oldHead: string | null;
  newHead: string;
  message: string;
  changedFiles: number;
  insertions: number;
  deletions: number;
}

export interface GitRepositoryIdentity {
 root: string;
  commonDirectory: string;
  originUrl: string;
  key: string;
  legacyKey: string;
}

const repositoryQueues = new Map<string, Promise<void>>();

export class GitService {
  /** 비공개 저장소 clone/fetch/push/ls-remote 에 사용할 GitHub 토큰. 생성 후 주입 가능합니다. */
  private token = "";
  /** 배포 키(SSH) 개인키 경로. 설정 시 https 대신 ssh 로 접속합니다. */
  private sshKeyPath = "";

  public setToken(token: string | undefined): void {
    this.token = (token ?? "").trim();
  }

  public get hasToken(): boolean {
    return this.token.length > 0;
  }

  /**
   * 네트워크 Git 명령에 붙일 인증 인자입니다.
   *
   * 비공개 저장소는 익명 접근이 불가능하므로(Repository not found / could not read Username),
   * GitHub 토큰을 Basic 인증 헤더로 전달해야 clone/fetch/push/ls-remote 가 성공합니다.
   * 자격증명 관리자(credential helper)가 설정된 PC에서는 우연히 성공하지만, 새 PC에서는
   * 실패하므로 토큰을 명시적으로 넘겨 컴퓨터 간 동작을 일치시킵니다.
   */
  private authArgs(): string[] {
    return githubAuthArgs(this.token);
  }

  /** 배포 키(SSH 개인키) 경로. HTTPS 토큰이 없어도 저장소에 접근할 수 있게 합니다. */
  public setSshKey(keyPath: string | undefined): void {
    this.sshKeyPath = (keyPath ?? "").trim();
  }

  public get hasSshKey(): boolean {
    return this.sshKeyPath.length > 0;
  }

  /** 네트워크 명령에 공통으로 붙는 인증/전송 설정입니다(HTTPS 토큰 + SSH 키). */
  private networkArgs(): string[] {
    return [...this.authArgs(), ...sshCommandArgs(this.sshKeyPath)];
  }

  /** SSH 키가 지정되면 https 원격을 ssh 표기로 바꿔 배포 키로 접속합니다. */
  private remoteUrl(url: string): string {
    const trimmed = (url ?? "").trim();
    // SSH 키가 있으면 https 원격도 ssh 표기로 바꿔 그 키로 접속합니다.
    // 단, github.com 이 아닌 원격(공유 폴더, 로컬 경로)은 그대로 둡니다.
    return this.sshKeyPath ? toSshUrl(trimmed) : trimmed;
  }

  public async validateRepository(repository: string): Promise<string> {
    if (isRemoteRepositoryUrl(repository)) {
      throw new Error("GitHub URL이 아니라 PC에 클론된 로컬 Git 저장소 폴더를 선택하세요.");
    }
    try {
      return await this.root(repository);
    } catch {
      throw new Error(`로컬 Git 저장소를 찾을 수 없습니다: ${repository}`);
    }
  }

  /** 지정된 빈 폴더에 원격 Git 저장소를 클론하고, 클론된 루트 경로를 반환합니다. */
  public async cloneRepository(url: string, directory: string): Promise<string> {
    const remote = url.trim();
    if (!remote) throw new Error("올바른 Git 저장소 URL을 입력하세요.");
    const target = path.resolve(directory);
    if (!target.trim()) throw new Error("복제할 빈 폴더를 선택하세요.");
    let targetEmpty = false;
    try {
      const entries = await readdir(target);
      targetEmpty = entries.length === 0;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") targetEmpty = true;
      else if (code !== "NOTEMPTY") throw error;
    }
    if (!targetEmpty) throw new Error("대상 폴더가 비어있지 않아 클론할 수 없습니다. 비어있는 새 폴더를 선택하세요.");
    await mkdir(target, { recursive: true });
    await this.git(process.cwd(), [...this.networkArgs(), "clone", this.remoteUrl(remote), target]);
    const root = (await this.git(target, ["rev-parse", "--show-toplevel"])).trim();
    return root || target;
  }

  /** 대상 폴더의 상태를 자동 판별해 빈 폴더면 clone, 이미 git 저장소면 연결(connect)합니다. */

  /**
   * 지정 폴더에 원격 저장소를 보장합니다(없으면 클론, 있으면 fetch 후 갱신).
   * config 저장소를 읽기 전용으로 캐시할 때 사용합니다.
   */
  public async ensureRepositoryAt(url: string, directory: string, branch = "main"): Promise<string> {
    const target = path.resolve(directory);
    let hasGit = false;
    try {
      await access(path.join(target, ".git"));
      hasGit = true;
    } catch { hasGit = false; }

    if (!hasGit) {
      await mkdir(path.dirname(target), { recursive: true });
      try {
        const entries = await readdir(target);
        // 폴더가 비어 있지 않으면 그대로 클론할 수 없으므로 내용을 정리합니다.
        if (entries.length > 0) await rm(target, { recursive: true, force: true });
      } catch { /* 폴더가 없으면 그대로 진행 */ }
      await this.cloneRepository(url, target);
      return (await this.git(target, ["rev-parse", "--show-toplevel"])).trim() || target;
    }

    // 기존 캐시는 원격 최신 내용으로 맞춥니다(실패해도 기존 캐시로 계속).
    try {
      await this.withRepositoryLock(target, async () => {
        await this.git(target, [...this.networkArgs(), "fetch", "--depth", "1", "origin", branch]);
        await this.git(target, ["checkout", "--force", "FETCH_HEAD"]);
      });
    } catch { /* 네트워크 실패 시 기존 캐시 사용 */ }
    return target;
  }

  public async connectOrClone(url: string, directory: string): Promise<{ action: "clone" | "connect"; root: string; originUrl: string; identity: string }> {
    const target = path.resolve(directory);
    let hasGitDir = false;
    try {
      await access(path.join(target, ".git"));
      hasGitDir = true;
    } catch {
      hasGitDir = false;
    }
    let root: string;
    if (hasGitDir) {
      const identity = await this.getRepositoryIdentity(target);
      return { action: "connect", root: identity.root, originUrl: identity.originUrl, identity: identity.key };
    }
    root = await this.cloneRepository(url, target);
    const identity = await this.getRepositoryIdentity(root);
    return { action: "clone", root, originUrl: identity.originUrl, identity: identity.key };
  }

  public async inspect(repository: string): Promise<GitStatusView> {
    const root = await this.root(repository);
    const [branch, head, upstream, status, aheadBehind] = await Promise.all([
      this.git(root, ["branch", "--show-current"]),
      this.git(root, ["rev-parse", "--verify", "HEAD"], true),
      this.git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], true),
      this.git(root, ["status", "--porcelain=v1", "-z"]),
      this.git(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], true),
    ]);
    const files = parsePorcelain(status);
    const [ahead = 0, behind = 0] = aheadBehind
      ? aheadBehind.trim().split(/\s+/).map((value) => Number.parseInt(value, 10))
      : [];
    return {
      repository: root,
      branch: branch.trim() || "(detached)",
      head: head.trim() || null,
      upstream: upstream.trim() || null,
      ahead,
      behind,
      files,
      conflicts: files.filter((file) => isConflict(file.indexStatus, file.workTreeStatus)).map((file) => file.path),
      clean: files.length === 0,
    };
  }

  public async createBranch(repository: string, branch: string, startPoint = "HEAD"): Promise<void> {
    validateRef(branch);
    const root = await this.root(repository);
    await this.withRepositoryLock(root, () => this.git(root, ["switch", "-c", branch, startPoint]).then(() => undefined));
  }

  public async switchBranch(repository: string, branch: string): Promise<void> {
    validateRef(branch);
    const root = await this.root(repository);
    await this.withRepositoryLock(root, () => this.git(root, ["switch", branch]).then(() => undefined));
  }

  public async stage(repository: string, paths: string[]): Promise<void> {
    if (paths.length === 0) throw new Error("At least one path is required to stage files");
    const root = await this.root(repository);
    await this.withRepositoryLock(root, () => this.git(root, ["add", "--", ...paths]).then(() => undefined));
  }

  /**
   * 추적 중인 파일의 변경사항을 폐기합니다(작업 트리를 HEAD 상태로 되돌림).
   *
   * 안전을 위해 새로 만든(추적되지 않는) 파일은 삭제하지 않습니다.
   * 새 파일까지 지우려면 cleanUntracked 를 함께 호출해야 합니다.
   */
  public async discardChanges(repository: string): Promise<void> {
    const root = await this.root(repository);
    await this.withRepositoryLock(root, async () => {
      // 추적 중인 파일의 수정/삭제를 되돌립니다.
      await this.git(root, ["checkout", "--", "."]);
      // 스테이징된 변경도 함께 해제합니다(예: git add 후 폐기).
      await this.git(root, ["reset", "--mixed", "HEAD"]);
      // reset 이후 다시 한 번 작업 트리를 맞춥니다.
      await this.git(root, ["checkout", "--", "."]);
    });
  }

  /** 저장소의 미추적(새로 만든) 파일 목록을 반환합니다. */
  public async listUntrackedFiles(repository: string): Promise<string[]> {
    const root = await this.root(repository);
    const output = await this.git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    return parsePorcelain(output)
      .filter((file) => file.indexStatus === "?" && file.workTreeStatus === "?")
      .map((file) => file.path);
  }

  /**
   * 미추적 파일을 삭제합니다.
   *
   * 사용자가 폐기를 확인했을 때만 호출합니다(새로 만든 작업물이 사라지므로 주의).
   * 전달받은 경로만 정확히 지우고, 추적 중인 파일은 건드리지 않습니다.
   */
  public async cleanUntracked(repository: string, paths: string[]): Promise<void> {
    const targets = paths.filter((item) => typeof item === "string" && item.trim().length > 0);
    if (targets.length === 0) return;
    const root = await this.root(repository);
    await this.withRepositoryLock(root, async () => {
      // -f 필수, -d 는 새 폴더까지 정리하되 전달받은 경로로 한정합니다.
      await this.git(root, ["clean", "-f", "-d", "--", ...targets]);
    });
  }

  public async commit(repository: string, message: string): Promise<string> {
    if (!message.trim()) throw new Error("Commit message is required");
    const root = await this.root(repository);
    return this.withRepositoryLock(root, async () => {
      await this.git(root, ["commit", "-m", message]);
      return (await this.git(root, ["rev-parse", "HEAD"])).trim();
    });
  }

  public async commitWithSummary(repository: string): Promise<GitChangeSummary> {
    const root = await this.root(repository);
    return this.withRepositoryLock(root, async () => {
      await this.assertSafeToCommit(root);
      const oldHead = (await this.git(root, ["rev-parse", "--verify", "HEAD"], true)).trim() || null;
      const status = await this.git(root, ["status", "--porcelain=v1", "-z"]);
      const files = parsePorcelain(status);
      if (files.length === 0) throw new Error("변경사항이 없어 커밋할 수 없습니다.");
     await this.git(root, ["add", "-A"]);
     const message = buildCommitMessage(files);
      await this.git(root, ["commit", "-m", message]);
      const newHead = (await this.git(root, ["rev-parse", "HEAD"])).trim();
      const shortStat = (await this.git(root, ["diff", "--cached", "--shortstat"])).trim();
      const { insertions, deletions } = parseShortStat(shortStat);
      return {
        oldHead,
        newHead,
        message,
        changedFiles: files.length,
        insertions,
        deletions,
      };
    });
  }

  public async push(repository: string, remote = "origin", branch?: string): Promise<void> {
   const root = await this.root(repository);
    const currentBranch = branch ?? (await this.git(root, ["branch", "--show-current"])).trim();
    validateRef(currentBranch);
    validateRef(remote);
    await this.withRepositoryLock(root, () =>
      this.git(root, [...this.networkArgs(), "push", "--set-upstream", remote, currentBranch]).then(() => undefined),
    );
  }

  /**
   * 원격의 최신 커밋을 현재 브랜치로 가져옵니다(다른 팀원이 병합한 내용 반영).
   *
   * 작업 트리가 깨끗하지 않거나 병합이 진행 중이면 시작하지 않습니다(자동 정지).
   * 이미 로컬 작업이 있는 브랜치를 강제로 덮어쓰지 않고, 커밋되지 않은 변경이 있으면
   * 사용자가 먼저 커밋/스태시하도록 안내합니다. 이력이 갈라졌으면(diverged) 머지가
   * 멈출 수 있으므로 fast-forward 를 기본으로 합니다.
   */
  public async pull(
    repository: string,
    branch: string,
    remote = "origin",
  ): Promise<{ oldHead: string | null; newHead: string | null; commits: number }> {
    validateRef(branch);
    validateRef(remote);
    const root = await this.root(repository);
    return this.withRepositoryLock(root, async () => {
      const currentBranch = (await this.git(root, ["branch", "--show-current"])).trim();
      if (currentBranch !== branch) {
        throw new Error(`브랜치 '${branch}' 가 현재 체크아웃되어 있지 않습니다. 먼저 해당 브랜치로 전환하세요.`);
      }
      await this.assertSafeToCommit(root);
      const oldHead = (await this.git(root, ["rev-parse", "--verify", "HEAD"], true)).trim() || null;
      // 먼저 원격을 갱신합니다. 그렇지 않으면 오래된 원격 추적 참조를 병합할 수 있습니다.
      await this.git(root, [...this.networkArgs(), "fetch", remote, branch]);
      // --ff-only: 로컬 작업을 임의로 머지하지 않습니다. 갈라진 이력은 명확한 오류로 알립니다.
      await this.git(root, ["merge", "--ff-only", "FETCH_HEAD"]);
      const newHead = (await this.git(root, ["rev-parse", "--verify", "HEAD"], true)).trim() || null;
      let commits = 0;
      if (oldHead && newHead && oldHead !== newHead) {
        commits = Number.parseInt((await this.git(root, ["rev-list", "--count", `${oldHead}..${newHead}`], true)).trim(), 10) || 0;
      }
      return { oldHead, newHead, commits };
    });
  }

  public async listBranches(repository: string): Promise<string[]> {
    const root = await this.root(repository);
    const output = await this.git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  public async listRemoteBranches(url: string): Promise<string[]> {
    const remote = url.trim();
    if (!remote) throw new Error("GitHub 저장소 URL을 입력하세요.");

    const output = await this.git(process.cwd(), [...this.networkArgs(), "ls-remote", "--heads", this.remoteUrl(remote)]);
    return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/)[1] ?? "").filter((ref) => ref.startsWith("refs/heads/")).map((ref) => ref.slice("refs/heads/".length)))];
  }

  public async listWorktrees(repository: string): Promise<GitBranchWorktree[]> {
    const root = await this.root(repository);
    const output = await this.git(root, ["worktree", "list", "--porcelain", "-z"]);
    return [...parseWorktrees(output).entries()].map(([branch, path]) => ({ branch, path }));
  }

  public async getBranchHead(repository: string, branch: string): Promise<string | null> {
    validateRef(branch);
    const root = await this.root(repository);
    return (await this.git(root, ["rev-parse", "--verify", `refs/heads/${branch}`], true)).trim() || null;
  }

  public async captureBranchCommits(
    repository: string,
    branch: string,
    previousHead: string | null,
  ): Promise<GitBranchCaptureResult> {
    const root = await this.root(repository);
    const currentHead = await this.getBranchHead(root, branch);
    if (!currentHead) throw new Error(`Branch '${branch}' has no local commit`);
    const commits = previousHead
      ? await this.listCommitsBetween(root, previousHead, currentHead)
      : [];
    for (const commit of commits) {
      if (!commit.hasDiff) {
        commit.diff = await this.readCommitDiff(root, commit.hash);
        commit.hasDiff = true;
      }
      commit.category = commit.category ?? classifyPurpose(commit.subject);
    }
    return {
      repository: root,
      branch,
      previousHead,
      currentHead,
      commits,
    };
  }

  /** 특정 시간 범위(이전 08시 ~ 당일 08시)의 커밋만 수집합니다. */
  public async captureBranchCommitsInTimeRange(
    input: GitTimeCaptureInput,
  ): Promise<GitBranchCaptureResult> {
    const root = await this.root(input.repository);
    const currentHead = await this.getBranchHead(root, input.branch);
    if (!currentHead) throw new Error("Branch '" + input.branch + "' has no local commit");
    const commits = await this.readCommitsInTimeRange(root, input.branch, input.sinceIso, input.untilIso);
    for (const commit of commits) {
      if (!commit.hasDiff) {
        commit.diff = await this.readCommitDiff(root, commit.hash);
        commit.hasDiff = true;
      }
      commit.category = commit.category ?? classifyPurpose(commit.subject);
    }
    return {
      repository: root,
      branch: input.branch,
      previousHead: null,
      currentHead,
      commits,
    };
  }

 public async getRepositoryIdentity(repository: string): Promise<GitRepositoryIdentity> {
    const root = await this.root(repository);
    const commonDirectory = await this.commonDirectory(root);
    const originUrl = (await this.git(root, ["remote", "get-url", "origin"], true)).trim();
    if (!originUrl) throw new Error("Git remote 'origin' is not configured");
    return {
      root,
      commonDirectory,
      originUrl,
      key: `remote:${normalizeRemoteIdentity(originUrl)}`,
      legacyKey: `${normalizeIdentityPath(commonDirectory)}|${originUrl}`,
    };
  }

  public async listCommitsBetween(
    repository: string,
    oldHead: string | null,
    newHead: string,
  ): Promise<GitCommitSummary[]> {
    validateRef(newHead);
    if (oldHead) validateRef(oldHead);
    const root = await this.root(repository);
    await this.requireCommit(root, newHead);
    if (oldHead) {
      await this.requireCommit(root, oldHead);
      try {
        await this.git(root, ["merge-base", "--is-ancestor", oldHead, newHead]);
      } catch {
        throw new Error(`Git history changed: ${oldHead.slice(0, 8)} is not an ancestor of ${newHead.slice(0, 8)}`);
      }
    }
    const revision = oldHead ? `${oldHead}..${newHead}` : newHead;
    const args = oldHead ? [revision] : ["-1", revision];
    return this.readCommits(root, args);
  }

  public async syncBranch(repository: string, branch: string, commitMessage: string): Promise<GitBranchSyncResult> {
    validateRef(branch);
    const root = await this.root(repository);
    return this.withRepositoryLock(root, async () => {
      const worktrees = parseWorktrees(await this.git(root, ["worktree", "list", "--porcelain", "-z"]));
      const worktreePath = worktrees.get(branch) ?? null;
      if (!worktreePath) {
        throw new Error(`Branch '${branch}' has no checked-out worktree; automatic commit was skipped`);
      }
      const currentBranch = (await this.git(worktreePath, ["branch", "--show-current"])).trim();
      if (currentBranch !== branch) throw new Error(`Worktree '${worktreePath}' is not checked out on '${branch}'`);
      await this.assertSafeToCommit(worktreePath);

      const oldHead = (await this.git(worktreePath, ["rev-parse", "HEAD"], true)).trim() || null;
      await this.git(worktreePath, ["add", "-A"]);
      const status = await this.git(worktreePath, ["status", "--porcelain=v1", "-z"]);
      const changedFiles = parsePorcelain(status).length;
      let committed = false;
      if (changedFiles > 0) {
        if (!commitMessage.trim()) throw new Error("Commit message is required when changes exist");
        await this.git(worktreePath, ["commit", "-m", commitMessage]);
        committed = true;
      }
      const newHead = (await this.git(worktreePath, ["rev-parse", "HEAD"])).trim();
      await this.git(worktreePath, [...this.networkArgs(), "push", "--set-upstream", "origin", `${newHead}:refs/heads/${branch}`]);
      const commits = oldHead && newHead ? await this.listCommitsBetween(root, oldHead, newHead) : [];
      return {
        repository: root,
        branch,
        worktree: worktreePath,
        committed,
        commitHash: committed ? newHead : null,
        changedFiles,
        oldHead,
        newHead,
        commits,
      };
    });
  }

  private async root(repository: string): Promise<string> {
    const resolved = path.resolve(repository);
    return (await this.git(resolved, ["rev-parse", "--show-toplevel"])).trim();
  }

  private async commonDirectory(root: string): Promise<string> {
    const value = (await this.git(root, ["rev-parse", "--git-common-dir"])).trim();
    return path.resolve(root, value);
  }

  /** 특정 커밋의 변경 파일/라인 통계를 부모 기준으로 수집합니다. */
  private async readCommitDiff(root: string, hash: string): Promise<GitCommitDiffStats> {
    const numstat = await this.git(root, ["show", "--format=", "--numstat", "-z", hash], true);
    const nameStatus = await this.git(root, ["show", "--format=", "--name-status", "-z", hash], true);
    const parsed = parseNumstat(numstat);
    const statuses = parseNameStatus(nameStatus);
    return {
      addedFiles: statuses.added,
      deletedFiles: statuses.deleted,
      modifiedFiles: statuses.modified,
      insertions: parsed.insertions,
      deletions: parsed.deletions,
    };
  }

  private async assertSafeToCommit(worktree: string): Promise<void> {
    const conflicts = (await this.git(worktree, ["diff", "--name-only", "--diff-filter=U"])).trim();
    if (conflicts) throw new Error(`Merge conflicts must be resolved before automation: ${conflicts.replace(/\r?\n/g, ", ")}`);
    const gitDirectory = path.resolve(worktree, (await this.git(worktree, ["rev-parse", "--git-dir"])).trim());
    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
      try {
        await access(path.join(gitDirectory, marker));
        throw new Error(`Git ${marker.toLowerCase().replaceAll("_", " ")} is in progress; automation stopped`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async requireCommit(root: string, revision: string): Promise<void> {
    try {
      await this.git(root, ["cat-file", "-e", `${revision}^{commit}`]);
    } catch {
      throw new Error(`Git commit '${revision}' is not available in this repository`);
    }
  }

  private async withRepositoryLock<T>(root: string, action: () => Promise<T>): Promise<T> {
    const commonDirectory = await this.commonDirectory(root);
    const previous = repositoryQueues.get(commonDirectory) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => { releaseQueue = resolve; });
    const queued = previous.then(() => current);
    repositoryQueues.set(commonDirectory, queued);
    await previous;
    const lockFile = path.join(commonDirectory, "kj-flowforge.lock");
    let lockHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      lockHandle = await acquireFileLock(lockFile);
      return await action();
    } finally {
      await lockHandle?.close().catch(() => undefined);
      if (lockHandle) await unlink(lockFile).catch(() => undefined);
      releaseQueue();
      if (repositoryQueues.get(commonDirectory) === queued) repositoryQueues.delete(commonDirectory);
    }
  }

 private async readCommits(root: string, revisions: string[]): Promise<GitCommitSummary[]> {
   const format = "%H%x01%an%x01%aI%x01%s%x01%b%x02";
   const raw = await this.git(root, ["log", `--format=${format}`, ...revisions], true);
   const commits: GitCommitSummary[] = [];
   for (const record of raw.split("\u0002")) {
     const parts = record.replace(/^\r?\n/, "").split("\u0001");
     if (parts.length < 4) continue;
     commits.push({
       hash: parts[0]!.trim(),
       author: parts[1]!,
       timestamp: parts[2]!,
       subject: parts[3]!,
       body: parts.slice(4).join("\u0001").trim(),
     });
   }
   return commits;
 }

  /** 브랜치의 특정 시간 구간(이전 08시 ~ 당일 08시)에 커밋된 변경사항을 수집합니다. */
  private async readCommitsInTimeRange(
    root: string,
    branch: string,
    sinceIso: string,
    untilIso: string,
  ): Promise<GitCommitSummary[]> {
    validateRef(branch);
    const format = "%H%x01%an%x01%aI%x01%s%x01%b%x02";
    const args = [
      "log",
      `--format=${format}`,
      `--since=${sinceIso}`,
      `--until=${untilIso}`,
      branch,
    ];
    const raw = await this.git(root, args, true);
    const commits: GitCommitSummary[] = [];
    for (const record of raw.split("\u0002")) {
      const parts = record.replace(/^\r?\n/, "").split("\u0001");
      if (parts.length < 4) continue;
      commits.push({
        hash: parts[0]!.trim(),
        author: parts[1]!,
        timestamp: parts[2]!,
        subject: parts[3]!,
        body: parts.slice(4).join("\u0001").trim(),
      });
    }
    return commits;
  }
  private async git(cwd: string, args: string[], allowFailure = false): Promise<string> {
    try {
      const result = await execFileAsync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      });
      return result.stdout;
    } catch (error) {
      if (allowFailure) return "";
      const detail = error as { stderr?: string; message?: string };
      throw new Error(friendlyGitError(detail.stderr?.trim() || detail.message || `git ${args[0]} failed`));
    }
  }
}

async function acquireFileLock(lockFile: string): Promise<Awaited<ReturnType<typeof open>>> {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      await handle.sync();
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isStaleLock(lockFile)) {
        await unlink(lockFile).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for another KJ FlowForge Git operation");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function isStaleLock(lockFile: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(lockFile, "utf8")) as { pid?: number; createdAt?: string };
    if (value.createdAt && Date.now() - Date.parse(value.createdAt) > 10 * 60_000) return true;
    if (!value.pid) return true;
    try {
      process.kill(value.pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

function normalizeIdentityPath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

/**
 * GitHub 토큰을 git 명령 인자로 변환합니다(순수 함수).
 * Authorization 헤더는 github.com 호스트에만 적용되므로 다른 호스트로 토큰이 새지 않습니다.
 */
export function githubAuthArgs(token: string): string[] {
  const trimmed = (token ?? "").trim();
  if (!trimmed) return [];
  const basic = Buffer.from(`x-access-token:${trimmed}`, "utf8").toString("base64");
  return ["-c", `http.https://github.com/.extraHeader=Authorization: Basic ${basic}`];
}

/**
 * SSH 개인키(배포 키)를 사용하도록 git 에 전달할 인자입니다(순수 함수).
 *
 * 지정된 키만 사용하도록 IdentitiesOnly 를 켜서, PC 에 다른 키가 있어도 섞이지 않게 합니다.
 * 대화형 프롬프트를 막아 무인 실행(앱)에서 멈추지 않도록 합니다.
 */
export function sshCommandArgs(keyPath: string): string[] {
  const trimmed = (keyPath ?? "").trim();
  if (!trimmed) return [];
  const normalized = trimmed.replace(/\\/g, "/");
  const command = `ssh -i "${normalized}" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;
  return ["-c", `core.sshCommand=${command}`];
}

/**
 * https 원격 URL 을 ssh 표기로 변환합니다(순수 함수).
 * 이미 ssh/scp 표기이거나 github.com 이 아니면 원본을 그대로 돌려줍니다.
 */
export function toSshUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return trimmed;
  if (/^(?:git@|ssh:\/\/)/i.test(trimmed)) return trimmed;
  const match = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (!match) return trimmed;
  return `git@github.com:${match[1]}/${match[2]}.git`;
}

/**
 * git 실패 메시지를 사용자가 이해할 수 있게 다듬습니다.
 *
 * 비공개 저장소를 인증 없이 접근하면 GitHub 는 저장소가 없는 것처럼 "Repository not found" 를
 * 돌려줍니다. 이는 오해를 부르므로 인증/권한 안내로 바꿔줍니다.
 */
export function friendlyGitError(stderr: string): string {
  const text = (stderr ?? "").trim();
  if (!text) return text;
  const authIssue = /repository not found|could not read username|authentication failed|could not read password|terminal prompts disabled|invalid username or password|403 forbidden|support for password authentication/i.test(text);
  if (authIssue) {
    return (
      "원격 저장소에 접근할 수 없습니다. 비공개 저장소는 인증이 필요합니다.\n" +
      "설정 → Git 접속 에서 GitHub 토큰(repo 권한)을 등록한 뒤 다시 시도하세요.\n\n" +
      "원본 오류: " + text
    );
  }
  return text;
}

export function normalizeRemoteIdentity(value: string): string {
  // 원격 URL 정규화는 shared/repo-identity 의 단일 구현만 사용합니다.
  return normalizeRepoIdentity(value);
}

function parsePorcelain(output: string): GitStatusView["files"] {
  const records = output.split("\0").filter(Boolean);
  const files: GitStatusView["files"] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const indexStatus = record[0] ?? " ";
    const workTreeStatus = record[1] ?? " ";
    let filePath = record.slice(3);
    if (indexStatus === "R" || indexStatus === "C") {
      const destination = records[index + 1];
      if (destination) {
        filePath = destination;
        index += 1;
      }
    }
    files.push({ path: filePath, indexStatus, workTreeStatus });
  }
  return files;
}

function parseWorktrees(output: string): Map<string, string> {
  const result = new Map<string, string>();
  let branch: string | null = null;
  let worktreePath: string | null = null;

  const finishRecord = (): void => {
    if (branch && worktreePath) result.set(branch, worktreePath);
    branch = null;
    worktreePath = null;
  };

  for (const token of output.split("\0")) {
    if (!token) {
      if (worktreePath) finishRecord();
      continue;
    }
    for (const field of token.split(/\r?\n/).filter(Boolean)) {
      if (field.startsWith("worktree ")) {
        if (worktreePath) finishRecord();
        worktreePath = field.slice("worktree ".length);
      } else if (field.startsWith("branch ")) {
        branch = field.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }
  }
  if (worktreePath) finishRecord();
  return result;
}

function isConflict(indexStatus: string, workTreeStatus: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${indexStatus}${workTreeStatus}`);
}

function validateRef(value: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes("..") || value.startsWith("-") || value.endsWith("/")) {
    throw new Error(`Invalid git reference '${value}'`);
  }
}

function buildCommitMessage(files: GitStatusView["files"]): string {
  const date = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\. /g, "-").replace(".", "");
  const categories = categorizeFiles(files.map((file) => file.path));
  const lines: string[] = [`${date} : ${categories.join(", ")}`, ""];
  if (categories.length > 0) {
    lines.push("요약:");
    for (const category of categories) lines.push(`- ${category}`);
    lines.push("");
  }
  lines.push("자동 커밋 by KJ FlowForge");
  return lines.join("\n");
}

function categorizeFiles(paths: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const filePath of paths) {
    const segments = filePath.replace(/\\/g, "/").split("/");
    const top = segments.length > 1 ? (segments[0] ?? "기타") : "기타";
    const list = groups.get(top) ?? [];
    list.push(filePath);
    groups.set(top, list);
  }
  return [...groups.entries()].map(([folder, list]) => `${folder} 폴터에서 ${list.length}개 파일 변경`);
}

function parseShortStat(value: string): { insertions: number; deletions: number } {
  const insertions = /(\d+) insertion/.exec(value);
  const deletions = /(\d+) deletion/.exec(value);
  return {
    insertions: insertions?.[1] ? Number.parseInt(insertions[1], 10) : 0,
    deletions: deletions?.[1] ? Number.parseInt(deletions[1], 10) : 0,
  };
}

function isRemoteRepositoryUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  return /^(?:https?|ssh|git):\/\//i.test(trimmed) || /^(?:[^@/]+@)?[^:/]+:.+/.test(trimmed);
}
