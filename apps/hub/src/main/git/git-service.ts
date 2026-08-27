import { execFile } from "node:child_process";
import { access, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitStatusView } from "../../shared/ipc";

const execFileAsync = promisify(execFile);

export interface GitCommitSummary {
  hash: string;
  author: string;
  timestamp: string;
  subject: string;
  body: string;
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
      this.git(root, ["push", "--set-upstream", remote, currentBranch]).then(() => undefined),
    );
  }

  public async listBranches(repository: string): Promise<string[]> {
    const root = await this.root(repository);
    const output = await this.git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  public async listRemoteBranches(url: string): Promise<string[]> {
    const remote = url.trim();
    if (!remote) throw new Error("GitHub 저장소 URL을 입력하세요.");
    if (!isRemoteRepositoryUrl(remote)) throw new Error("올바른 GitHub 저장소 URL을 입력하세요.");
    const output = await this.git(process.cwd(), ["ls-remote", "--heads", remote]);
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
      await this.git(worktreePath, ["push", "--set-upstream", "origin", `${newHead}:refs/heads/${branch}`]);
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
      throw new Error(detail.stderr?.trim() || detail.message || `git ${args[0]} failed`);
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

export function normalizeRemoteIdentity(value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/");
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
  if (scp && !/^[A-Za-z]:\//.test(trimmed) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")}`;
  }
  try {
    const url = new URL(trimmed);
    const authority = `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`;
    return `${authority}/${url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")}`;
  } catch {
    return trimmed.replace(/\.git$/i, "");
  }
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
