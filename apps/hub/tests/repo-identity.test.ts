import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { HubRuntime } from "../src/main/hub-runtime";
import type { HubConfig } from "../src/main/config";
import { isSameRepository, normalizeRepoIdentity } from "../src/shared/repo-identity";
import { sameIdentity } from "../src/main/projects-store";
import { normalizeRemoteIdentity } from "../src/main/git/git-service";

const HTTPS = "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git";
const SSH = "git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git";

function makeRepo(origin: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "repo-identity-repo-"));
  const g = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g(["init", "-b", "main"]);
  g(["config", "user.email", "test@example.com"]);
  g(["config", "user.name", "test"]);
  writeFileSync(path.join(dir, "a.txt"), "hello");
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
  g(["branch", "Test1"]);
  g(["remote", "add", "origin", origin]);
  return dir;
}

function freshConfig(dir: string): HubConfig {
  return {
    host: "127.0.0.1",
    httpPort: 43100,
    tcpPort: 43101,
    commandTimeoutMs: 30000,
    maxFrameBytes: 8388608,
    apiToken: "token",
    repositories: [],
    projectsUrl: "https://raw.githubusercontent.com/KCWJEDI/KJ_FlowForge_Config/main/projects.json",
    configRepo: "KCWJEDI/KJ_FlowForge_Config",
    envFile: path.join(dir, ".env"),
    dataDirectory: dir,
    secretFile: path.join(dir, "unity-session.json"),
    sessionSecret: "secret",
    selectionFile: path.join(dir, "git-selection.json"),
    dailyAutomation: { enabled: false },
    discord: {},
    notion: { enabled: false },
    github: {},
    gemini: { model: "gemini-3.5-flash-lite" },
    sshKeyPath: "",
  };
}

describe("repo identity normalization (cross-machine visibility)", () => {
  it("treats equivalent https/ssh/scp/기타 표기를 같은 저장소로 판정한다", () => {
    const forms = [
      "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git",
      "https://github.com/KCWJEDI/KJ_FlowForge_TestGit",
      "http://github.com/kcwjedi/kj_flowforge_testgit.git",
      "ssh://git@github.com/KCWJEDI/KJ_FlowForge_TestGit.git",
      "git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git",
      "git@github.com:kcwjedi/kj_flowforge_testgit",
    ];
    for (const form of forms) {
      // GitHub 는 owner/repo 대소문자를 구분하지 않으므로 소문자로 통일합니다.
      expect(normalizeRepoIdentity(form)).toBe("github.com/kcwjedi/kj_flowforge_testgit");
    }
    expect(isSameRepository(HTTPS, SSH)).toBe(true);
    expect(sameIdentity(HTTPS, SSH)).toBe(true);
    expect(normalizeRemoteIdentity(HTTPS)).toBe(normalizeRemoteIdentity(SSH));
  });

  it("distinguishes different repositories", () => {
    expect(isSameRepository(HTTPS, "https://github.com/KCWJEDI/Other.git")).toBe(false);
    expect(isSameRepository(HTTPS, "")).toBe(false);
  });

  it("keeps Windows drive paths distinct from scp hosts", () => {
    expect(normalizeRepoIdentity("W:/WorkSpace/TestGithub")).toBe("w:/workspace/testgithub");
  });
});

describe("fresh machine project/branch visibility", () => {
  it("normal user with no license credential sees no projects (config is private)", async () => {
    // config 저장소가 비공개로 전환되었으므로, 라이선스 자격증명 없이는 프로젝트를 읽을 수 없습니다.
    // 이 테스트는 그 차단이 실제로 동작하는지 확인합니다.
    const work = mkdtempSync(path.join(os.tmpdir(), "repo-identity-work-"));
    const runtime = new HubRuntime(freshConfig(work), "user", "User1");
    await runtime.start();
    const projects = await runtime.getProjects();
    console.log("credential 없이 조회된 프로젝트 수: " + projects.length);
    expect(projects).toHaveLength(0);
  }, 90000);

  it("ssh-origin local clone is still recognized as the same repository", async () => {
    // 저장소 식별(ssh vs https)은 자격증명과 무관하게 동작해야 합니다.
    const work = mkdtempSync(path.join(os.tmpdir(), "repo-identity-work-"));
    const repo = makeRepo(SSH);
    const runtime = new HubRuntime(freshConfig(work), "user", "User1");
    await runtime.start();
    const identity = await runtime.git.getRepositoryIdentity(repo);
    expect(identity.key).toBe("remote:github.com/kcwjedi/kj_flowforge_testgit");
  }, 90000);

  it("unknown license key sees no projects (no accidental exposure)", async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), "repo-identity-work-"));
    const runtime = new HubRuntime(freshConfig(work), "user", "Nobody");
    await runtime.start();
    await expect(runtime.getProjects()).resolves.toHaveLength(0);
  }, 90000);
});
