import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitService } from "../src/main/git/git-service";
import { removeDirSafely } from "./helpers/cleanup";

const exec = promisify(execFile);

describe("GitService read-only daily capture", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await removeDirSafely(directory);
    directory = null;
  });

  it("uses the current head as a baseline without reporting existing history", async () => {
    const repository = await createRepository();
    const branch = (await git(repository, ["branch", "--show-current"])).trim();
    const head = (await git(repository, ["rev-parse", "HEAD"])).trim();

    const result = await new GitService().captureBranchCommits(repository, branch, null);

    expect(result.currentHead).toBe(head);
    expect(result.previousHead).toBeNull();
    expect(result.commits).toEqual([]);
  });

  it("rejects a GitHub URL where a local repository path is required", async () => {
    await expect(new GitService().validateRepository("https://github.com/KCWJEDI/TestGithubProject.git"))
      .rejects.toThrow("로컬 Git 저장소 폴더");
  });

  it("accepts and resolves a local Git repository folder", async () => {
    const repository = await createRepository();
    const validated = await new GitService().validateRepository(repository);
    expect(validated.replace(/\\/g, "/")).toBe(repository.replace(/\\/g, "/"));
  });

  it("does not mistake a Windows drive path for an SCP-style remote URL", async () => {
    await expect(new GitService().validateRepository("W:\\WorkSpace\\MissingRepository"))
      .rejects.toThrow("로컬 Git 저장소를 찾을 수 없습니다");
  });

  it("returns only commits added after the reported head and leaves dirty files untouched", async () => {
    const repository = await createRepository();
    const branch = (await git(repository, ["branch", "--show-current"])).trim();
    const previousHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    await writeFile(path.join(repository, "feature.txt"), "committed\n", "utf8");
    await git(repository, ["add", "feature.txt"]);
    await git(repository, ["commit", "-m", "add feature"]);
    await writeFile(path.join(repository, "README.md"), "initial\nuncommitted\n", "utf8");
    const statusBefore = await git(repository, ["status", "--porcelain=v1"]);

    const result = await new GitService().captureBranchCommits(repository, branch, previousHead);

    expect(result.commits.map((commit) => commit.subject)).toEqual(["add feature"]);
    expect(await git(repository, ["status", "--porcelain=v1"])).toBe(statusBefore);
    expect(await readFile(path.join(repository, "README.md"), "utf8")).toBe("initial\nuncommitted\n");
  });

  it("captures a local branch that has no checked-out worktree", async () => {
    const repository = await createRepository();
    const head = (await git(repository, ["rev-parse", "HEAD"])).trim();
    await git(repository, ["branch", "not-checked-out"]);

    const result = await new GitService().captureBranchCommits(repository, "not-checked-out", null);

    expect(result.currentHead).toBe(head);
    expect(result.commits).toEqual([]);
  });

  it("rejects a rewritten or diverged history", async () => {
    const repository = await createRepository();
    const base = (await git(repository, ["rev-parse", "HEAD"])).trim();
    await writeFile(path.join(repository, "main.txt"), "main\n", "utf8");
    await git(repository, ["add", "main.txt"]);
    await git(repository, ["commit", "-m", "main commit"]);
    const mainHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    await git(repository, ["switch", "-c", "diverged", base]);
    await writeFile(path.join(repository, "diverged.txt"), "diverged\n", "utf8");
    await git(repository, ["add", "diverged.txt"]);
    await git(repository, ["commit", "-m", "diverged commit"]);

    await expect(new GitService().captureBranchCommits(repository, "diverged", mainHead))
      .rejects.toThrow("Git history changed");
  });

  async function createRepository(): Promise<string> {
    directory = await mkdtemp(path.join(tmpdir(), "hub-git-service-"));
    const repository = path.join(directory, "repository");
    await git(directory, ["init", repository]);
    await git(repository, ["config", "user.name", "FlowForge Test"]);
    await git(repository, ["config", "user.email", "flowforge@example.com"]);
    await writeFile(path.join(repository, "README.md"), "initial\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "initial"]);
    return repository;
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return result.stdout;
}


describe("GitService cloneRepository", () => {
  let directory: string | null = null;
  afterEach(async () => {
    if (directory) await removeDirSafely(directory);
    directory = null;
  });

  async function initRepo(): Promise<string> {
    directory = await mkdtemp(path.join(tmpdir(), "hub-git-clone-"));
    const repository = path.join(directory, "source");
    await git(directory, ["init", repository]);
    await git(repository, ["config", "user.name", "FlowForge Test"]);
    await git(repository, ["config", "user.email", "flowforge@example.com"]);
    await writeFile(path.join(repository, "README.md"), "initial\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "initial"]);
    await git(repository, ["branch", "dev"]);
    return repository;
  }

  it("clones a remote repository into an empty directory", async () => {
    const source = await initRepo();
    const service = new GitService();
    const target = path.join(directory!, "clone-target");
    await mkdir(target, { recursive: true });
    const root = await service.cloneRepository(source, target);
    expect(await readFile(path.join(root, "README.md"), "utf8")).toContain("initial");
    const branches = await service.listRemoteBranches(source);
    expect(branches).toContain("dev");
  });

  it("rejects cloning into a non-empty directory", async () => {
    const source = await initRepo();
    const target = path.join(directory!, "occupied");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "file.txt"),"x");
    await expect(new GitService().cloneRepository(source, target)).rejects.toThrow("비어있지 않아");
  });

  it("rejects a local path that is not a remote-style URL", async () => {
    await expect(new GitService().cloneRepository("", path.join(directory ?? tmpdir(), "x"))).rejects.toThrow("올바른 Git 저장소 URL");
  });
});

describe("GitService pull", () => {
  let directory: string | null = null;
  afterEach(async () => {
    if (directory) await removeDirSafely(directory);
    directory = null;
  });

  /** 원격(bare) + 클론을 준비하고 브랜치/경로들을 돌려줍니다. */
  async function setUpRemote(): Promise<{ origin: string; clone: string; branch: string }> {
    directory = await mkdtemp(path.join(tmpdir(), "hub-git-pull-"));
    const source = path.join(directory, "source");
    await git(directory, ["init", source]);
    await git(source, ["config", "user.name", "FlowForge Test"]);
    await git(source, ["config", "user.email", "flowforge@example.com"]);
    await writeFile(path.join(source, "README.md"), "initial\n", "utf8");
    await git(source, ["add", "README.md"]);
    await git(source, ["commit", "-m", "initial"]);
    const branch = (await git(source, ["branch", "--show-current"])).trim();
    const origin = path.join(directory, "origin.git");
    await git(directory, ["init", "--bare", origin]);
    await git(source, ["remote", "add", "origin", origin]);
    await git(source, ["push", "origin", branch]);
    const clone = path.join(directory, "clone");
    await git(directory, ["clone", origin, clone]);
    await git(clone, ["config", "user.name", "FlowForge Test"]);
    await git(clone, ["config", "user.email", "flowforge@example.com"]);
    return { origin, clone, branch };
  }

  it("fast-forwards the current branch to the latest remote commit", async () => {
    const { clone, branch } = await setUpRemote();
    const remote = path.join(directory!, "source");
    await writeFile(path.join(remote, "feature.txt"), "merged by teammate\n", "utf8");
    await git(remote, ["add", "feature.txt"]);
    await git(remote, ["commit", "-m", "teammate merge"]);
    await git(remote, ["push", "origin", branch]);

    const result = await new GitService().pull(clone, branch);

    expect(result.oldHead).not.toBe(result.newHead);
    expect(result.commits).toBe(1);
    expect(await readFile(path.join(clone, "feature.txt"), "utf8")).toContain("merged by teammate");
  });

  it("reports no change when already up to date", async () => {
    const { clone, branch } = await setUpRemote();
    const result = await new GitService().pull(clone, branch);
    expect(result.oldHead).toBe(result.newHead);
    expect(result.commits).toBe(0);
  });

  it("refuses to run when the requested branch is not checked out", async () => {
    const { clone } = await setUpRemote();
    await git(clone, ["branch", "other"]);
    await expect(new GitService().pull(clone, "other")).rejects.toThrow("체크아웃되어 있지 않습니다");
  });

  it("refuses to merge diverged history without an explicit merge", async () => {
    const { clone, branch } = await setUpRemote();
    // 로컬에만 있는 커밋을 만들어 이력을 갈라지게 합니다.
    await writeFile(path.join(clone, "local.txt"), "local only\n", "utf8");
    await git(clone, ["add", "local.txt"]);
    await git(clone, ["commit", "-m", "local work"]);
    // 원격에도 별도 커밋을 추가합니다.
    const remote = path.join(directory!, "source");
    await writeFile(path.join(remote, "remote.txt"), "remote only\n", "utf8");
    await git(remote, ["add", "remote.txt"]);
    await git(remote, ["commit", "-m", "remote work"]);
    await git(remote, ["push", "origin", branch]);

    await expect(new GitService().pull(clone, branch)).rejects.toThrow(/fast-forward/i);
  });
});
