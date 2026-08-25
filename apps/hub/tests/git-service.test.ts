import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitService } from "../src/main/git/git-service";

const exec = promisify(execFile);

describe("GitService read-only daily capture", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
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
