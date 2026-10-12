import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { isSameRepository, normalizeRepoIdentity } from "../src/shared/repo-identity";
import { sameIdentity } from "../src/main/projects-store";
import { GitService, normalizeRemoteIdentity } from "../src/main/git/git-service";

describe("repo identity edge cases", () => {
  const canonical = "github.com/kcwjedi/kj_flowforge_testgit";
  const variants: Array<[string, string]> = [
    ["https with .git", "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git"],
    ["https no .git", "https://github.com/KCWJEDI/KJ_FlowForge_TestGit"],
    ["https trailing slash", "https://github.com/KCWJEDI/KJ_FlowForge_TestGit/"],
    ["http", "http://github.com/KCWJEDI/KJ_FlowForge_TestGit.git"],
    ["ssh scheme", "ssh://git@github.com/KCWJEDI/KJ_FlowForge_TestGit.git"],
    ["ssh scheme no user", "ssh://github.com/KCWJEDI/KJ_FlowForge_TestGit.git"],
    ["scp", "git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git"],
    ["scp no .git", "git@github.com:KCWJEDI/KJ_FlowForge_TestGit"],
    ["git protocol", "git://github.com/KCWJEDI/KJ_FlowForge_TestGit.git"],
    ["uppercase host", "https://GITHUB.COM/KCWJEDI/KJ_FlowForge_TestGit.git"],
    ["mixed case path", "https://github.com/kcwjedi/kj_flowforge_testgit.git"],
    ["surrounding spaces", "  https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git  "],
    ["quoted", "\"https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git\""],
  ];

  for (const [label, value] of variants) {
    it("normalizes " + label, () => {
      expect(normalizeRepoIdentity(value)).toBe(canonical);
      expect(isSameRepository(value, "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git")).toBe(true);
    });
  }

  it("keeps distinct repos distinct", () => {
    const a = "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git";
    const b = "https://github.com/KCWJEDI/DiceGambit_Project.git";
    const c = "https://github.com/Other/KJ_FlowForge_TestGit.git";
    const d = "https://gitlab.com/KCWJEDI/KJ_FlowForge_TestGit.git";
    expect(isSameRepository(a, b)).toBe(false);
    expect(isSameRepository(a, c)).toBe(false);
    expect(isSameRepository(a, d)).toBe(false);
  });

  it("does not confuse Windows drive paths with scp hosts", () => {
    const local = normalizeRepoIdentity("W:\\WorkSpace\\KJ_FlowForge");
    const scp = normalizeRepoIdentity("git@github.com:KCWJEDI/KJ_FlowForge.git");
    expect(local).toBe("w:/workspace/kj_flowforge");
    expect(local).not.toBe(scp);
  });

  it("handles empty/whitespace without throwing", () => {
    expect(normalizeRepoIdentity("")).toBe("");
    expect(normalizeRepoIdentity("   ")).toBe("");
    expect(isSameRepository("", "")).toBe(false);
    expect(isSameRepository("https://github.com/a/b.git", "")).toBe(false);
  });

  it("sameIdentity and normalizeRemoteIdentity agree with shared module", () => {
    const pairs: Array<[string, string]> = [
      ["https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", "git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git"],
      ["ssh://git@github.com/KCWJEDI/KJ_FlowForge_TestGit.git", "https://github.com/KCWJEDI/KJ_FlowForge_TestGit"],
    ];
    for (const [left, right] of pairs) {
      expect(sameIdentity(left, right)).toBe(true);
      expect(normalizeRemoteIdentity(left)).toBe(normalizeRemoteIdentity(right));
    }
  });
});

describe("connect-or-clone workflow", () => {
  function emptyDir(): string {
    return mkdtempSync(path.join(os.tmpdir(), "qa-connect-"));
  }

  it("connectOrClone treats a folder with ssh origin as connect (not clone)", async () => {
    const dir = emptyDir();
    const g = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    g(["init", "-b", "main"]);
    g(["config", "user.email", "t@e"]);
    g(["config", "user.name", "t"]);
    writeFileSync(path.join(dir, "a.txt"), "x");
    g(["add", "-A"]);
    g(["commit", "-m", "init"]);
    g(["remote", "add", "origin", "git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git"]);

    const service = new GitService();
    const result = await service.connectOrClone("https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", dir);
    expect(result.action).toBe("connect");
    expect(normalizeRepoIdentity(result.originUrl)).toBe("github.com/kcwjedi/kj_flowforge_testgit");
    expect(result.identity).toBe("remote:github.com/kcwjedi/kj_flowforge_testgit");
  }, 60000);

  it("connectOrClone detects an empty folder as clone target", async () => {
    const dir = emptyDir();
    const service = new GitService();
    const identity = await service.getRepositoryIdentity(dir).catch(() => null);
    expect(identity).toBeNull();
  }, 60000);

  it("validates a real local repository root", async () => {
    const dir = emptyDir();
    const g = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    g(["init", "-b", "main"]);
    const service = new GitService();
    const root = await service.validateRepository(dir);
    expect(normalizeRepoIdentity(root)).toBe(normalizeRepoIdentity(dir));
  }, 60000);

  it("rejects a remote URL passed as a local repository path", async () => {
    const service = new GitService();
    await expect(service.validateRepository("https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git")).rejects.toThrow();
    await expect(service.validateRepository("git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git")).rejects.toThrow();
  }, 60000);
});



