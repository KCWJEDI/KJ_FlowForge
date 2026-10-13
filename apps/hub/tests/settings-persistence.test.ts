import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { HubRuntime } from "../src/main/hub-runtime";
import { loadConfig, type HubConfig } from "../src/main/config";
import { ensureEnvFile } from "../src/main/env-store";
import { normalizeRepoIdentity } from "../src/shared/repo-identity";

function configFor(dir: string): HubConfig {
  return {
    host: "127.0.0.1",
    httpPort: 43100,
    tcpPort: 43101,
    commandTimeoutMs: 30000,
    maxFrameBytes: 8388608,
    apiToken: "token",
    repositories: [],
    projectsUrl: "",
    configRepo: null,
    envFile: path.join(dir, ".env"),
    dataDirectory: path.join(dir, "runtime"),
    secretFile: path.join(dir, "runtime", "unity-session.json"),
    sessionSecret: "secret",
    selectionFile: path.join(dir, "runtime", "git-selection.json"),
    dailyAutomation: { enabled: false },
    discord: {},
    notion: { enabled: false },
    github: {},
    gemini: { model: "gemini-3.5-flash-lite" },
    sshKeyPath: "",
    kanbanDatabaseId: "",
    kanbanGroupProperty: "상태",
  };
}

function initRepo(dir: string, origin: string): string {
  mkdirSync(dir, { recursive: true });
  const g = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g(["init", "-b", "main"]);
  g(["config", "user.email", "test@example.com"]);
  g(["config", "user.name", "test"]);
  writeFileSync(path.join(dir, "a.txt"), "hello");
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
  g(["remote", "add", "origin", origin]);
  return dir;
}

describe("repository settings survive an app restart", () => {
  it("keeps a repository saved with a Windows backslash path", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "restart-exists-"));
    mkdirSync(path.join(dir, "runtime"), { recursive: true });
    await ensureEnvFile(path.join(dir, ".env"));
    const repo = initRepo(path.join(dir, "TestGithub"), "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git");
    const pickedPath = repo.replace(/\//g, "\\");

    const runtime = new HubRuntime(configFor(dir), "admin", "Admin");
    await runtime.start();
    await runtime.saveSettings({
      HUB_GIT_REPOSITORIES: JSON.stringify([{ label: "저장소", username: "KCWJEDI", path: pickedPath, url: "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", branches: [] }]),
    });

    const reloaded = await loadConfig(path.join(dir, "runtime"), path.join(dir, ".env"));
    expect(reloaded.repositories).toHaveLength(1);
    // 유효한 저장소는 git 이 정규화한 루트 경로로 저장됩니다. 중요한 것은 재시작 후에도
    // 같은 폴더를 가리키며 살아남는 것입니다(백슬래시 경로가 손상되어 사라지지 않음).
    expect(normalizeRepoIdentity(reloaded.repositories[0]?.path ?? "")).toBe(normalizeRepoIdentity(repo));
  }, 90000);

  it("keeps a not-yet-cloned folder path (git validation failure does not drop it)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "restart-missing-"));
    mkdirSync(path.join(dir, "runtime"), { recursive: true });
    await ensureEnvFile(path.join(dir, ".env"));
    const missing = "C:\\WorkSpace\\NotYetCloned";

    const runtime = new HubRuntime(configFor(dir), "admin", "Admin");
    await runtime.start();
    const saved = await runtime.saveSettings({
      HUB_GIT_REPOSITORIES: JSON.stringify([{ label: "저장소", username: "KCWJEDI", path: missing, url: "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", branches: [] }]),
    });
    expect(saved.message).toContain("검증 지연");

    const reloaded = await loadConfig(path.join(dir, "runtime"), path.join(dir, ".env"));
    expect(reloaded.repositories.map((item) => item.path)).toEqual([missing]);
  }, 90000);

  it("does not wipe the saved repository list on an unrelated settings save", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "restart-unrelated-"));
    mkdirSync(path.join(dir, "runtime"), { recursive: true });
    await ensureEnvFile(path.join(dir, ".env"));
    const repo = initRepo(path.join(dir, "TestGithub"), "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git");

    const runtime = new HubRuntime(configFor(dir), "admin", "Admin");
    await runtime.start();
    await runtime.saveSettings({
      HUB_GIT_REPOSITORIES: JSON.stringify([{ label: "저장소", username: "KCWJEDI", path: repo, url: "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", branches: [] }]),
    });
    // Git 탭이 아닌 다른 설정 저장(예: Discord 알림 조건)이 저장소를 지우면 안 됩니다.
    await runtime.saveSettings({ HUB_DAILY_AUTOMATION_ENABLED: "false" });

    const reloaded = await loadConfig(path.join(dir, "runtime"), path.join(dir, ".env"));
    expect(reloaded.repositories).toHaveLength(1);
  }, 90000);
});
