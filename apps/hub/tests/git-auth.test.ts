import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { GitService, githubAuthArgs, friendlyGitError } from "../src/main/git/git-service";

const TOKEN = process.env["KJFF_TEST_GITHUB_TOKEN"] ?? "";
const PRIVATE_REPO = "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git";

describe("git auth args (pure)", () => {
  it("emits no auth argument without a token", () => {
    expect(githubAuthArgs("")).toEqual([]);
    expect(githubAuthArgs("   ")).toEqual([]);
  });

  it("scopes the Basic header to github.com and never leaks the raw token", () => {
    const args = githubAuthArgs("ghp_exampletoken");
    expect(args[0]).toBe("-c");
    expect(args[1]).toContain("http.https://github.com/.extraHeader=Authorization: Basic ");
    expect(args[1]).not.toContain("ghp_exampletoken");
    const decoded = Buffer.from(args[1]!.split("Basic ")[1]!, "base64").toString("utf8");
    expect(decoded).toBe("x-access-token:ghp_exampletoken");
  });
});

describe("friendly git error messages", () => {
  it("explains private-repository access failures", () => {
    const message = friendlyGitError("remote: Repository not found.\nfatal: repository 'x' not found");
    expect(message).toContain("비공개 저장소");
    expect(message).toContain("토큰");
  });

  it("leaves unrelated errors untouched", () => {
    expect(friendlyGitError("fatal: destination path already exists")).toBe("fatal: destination path already exists");
  });
});

describe.skipIf(!TOKEN)("private repository clone with a token (fresh-PC scenario)", () => {
  it("clones and lists remote branches when the credential helper is disabled", async () => {
    // 자격증명 관리자 캐시가 없는 새 PC를 흉내내기 위해 credential.helper 를 비웁니다.
    const isolated = new GitService();
    isolated.setToken(TOKEN);
    const dir = mkdtempSync(path.join(os.tmpdir(), "priv-token-"));
    const root = await isolated.cloneRepository(PRIVATE_REPO, path.join(dir, "repo"));
    expect(root.length).toBeGreaterThan(0);
    const branches = await isolated.listRemoteBranches(PRIVATE_REPO);
    expect(branches).toContain("Test1");
  }, 120000);

  it("git without auth still fails so the token is what unlocks access", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "priv-anon-"));
    let failed = false;
    try {
      execFileSync("git", ["-c", "credential.helper=", "-c", "core.askPass=", "ls-remote", "--heads", PRIVATE_REPO], {
        stdio: "pipe",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    void dir;
  }, 120000);
});

