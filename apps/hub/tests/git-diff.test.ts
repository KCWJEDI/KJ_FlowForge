import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { classifyPurpose, parseNameStatus, parseNumstat } from "../src/main/git/git-diff";
import { GitService } from "../src/main/git/git-service";

const exec = promisify(execFile);

describe("classifyPurpose", () => {
  it("maps conventional-commit prefixes to categories", () => {
    expect(classifyPurpose("feat: add login")).toBe("기능");
    expect(classifyPurpose("Feat(scope): x")).toBe("기능");
    expect(classifyPurpose("perf: faster render")).toBe("성능");
    expect(classifyPurpose("fix: crash on boot")).toBe("버그/수정");
    expect(classifyPurpose("hotfix: patch")).toBe("버그/수정");
    expect(classifyPurpose("refactor: cleanup")).toBe("리팩토링");
    expect(classifyPurpose("docs: update readme")).toBe("문서");
  });
  it("maps Korean keyword prefixes to categories", () => {
    expect(classifyPurpose("기능: 로그인 추가")).toBe("기능");
    expect(classifyPurpose("성능 개선")).toBe("성능");
    expect(classifyPurpose("버그 수정")).toBe("버그/수정");
    expect(classifyPurpose("수정: tls")).toBe("버그/수정");
    expect(classifyPurpose("리팩토링: 정리")).toBe("리팩토링");
    expect(classifyPurpose("문서 갱신")).toBe("문서");
  });
  it("defaults unknown or empty subjects to 기타", () => {
    expect(classifyPurpose("random change")).toBe("기타");
    expect(classifyPurpose("   ")).toBe("기타");
    expect(classifyPurpose("WIP: something")).toBe("기타");
  });
});

describe("parseNumstat", () => {
  it("sums insertions and deletions across records", () => {
    const raw = ["3\t1\tfoo.ts", "0\t2\tbar.ts", "", ""].join("\0");
    expect(parseNumstat(raw)).toEqual({ insertions: 3, deletions: 3 });
  });
  it("ignores binary records and missing fields", () => {
    const raw = ["-\t-\timage.png", "2\t0\tapp.js", ""].join("\0");
    expect(parseNumstat(raw)).toEqual({ insertions: 2, deletions: 0 });
  });
});

describe("parseNameStatus", () => {
  it("groups added, deleted, and modified files", () => {
    const raw = ["A", "new.txt", "D", "old.txt", "M", "changed.txt", "T", "type.txt", ""].join("\0");
    expect(parseNameStatus(raw)).toEqual({
      added: ["new.txt"],
      deleted: ["old.txt"],
      modified: ["changed.txt", "type.txt"],
    });
  });
  it("maps renames to the destination path as modified", () => {
    const raw = ["R100", "old.txt", "renamed.txt", "C50", "a.txt", "b.txt", "R90", "x.txt", "y.txt", ""].join("\0");
    expect(parseNameStatus(raw)).toEqual({
      added: [],
      deleted: [],
      modified: ["renamed.txt", "b.txt", "y.txt"],
    });
  });
});

describe("GitService commit diff capture", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("populates per-commit diff stats and category without changing files", async () => {
    const repository = await createRepository();
    const branch = (await git(repository, ["branch", "--show-current"])).trim();
    const previousHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    await writeFile(path.join(repository, "feature.txt"), "line1\nline2\n", "utf8");
    await git(repository, ["add", "feature.txt"]);
    await git(repository, ["commit", "-m", "feat: add feature"]);
    await writeFile(path.join(repository, "feature.txt"), "line1\nline2\nline3\n", "utf8");
    await git(repository, ["add", "feature.txt"]);
    await git(repository, ["commit", "-m", "fix: extend feature"]);

    const statusBefore = await git(repository, ["status", "--porcelain=v1"]);
    const result = await new GitService().captureBranchCommits(repository, branch, previousHead);

    expect(result.commits).toHaveLength(2);
    expect(result.commits.map((commit) => commit.category)).toEqual(["버그/수정", "기능"]);
    expect(result.commits.map((commit) => commit.diff?.insertions)).toEqual([1, 2]);
    expect(result.commits.map((commit) => commit.diff?.deletions)).toEqual([0, 0]);
    expect(result.commits.map((commit) => commit.diff?.addedFiles)).toEqual([[], ["feature.txt"]]);
    expect(result.commits.map((commit) => commit.diff?.modifiedFiles?.[0])).toEqual(["feature.txt", undefined]);
    expect(result.commits.every((commit) => commit.hasDiff === true)).toBe(true);
    expect(await git(repository, ["status", "--porcelain=v1"])).toBe(statusBefore);
  });

  async function createRepository(): Promise<string> {
    directory = await mkdtemp(path.join(tmpdir(), "hub-git-diff-"));
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

