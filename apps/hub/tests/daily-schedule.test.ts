import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DailyAutomation,
  DailyAutomationStateStore,
  localDateKey,
  nextLocalRunAt,
  shouldCatchUpToday,
  filterDiscordBranches,
} from "../src/main/automation/daily-schedule";
import type { HubConfig } from "../src/main/config";
import type { GitService } from "../src/main/git/git-service";
import { NotionAdapter } from "../src/main/integrations/notion-adapter";
import { removeDirSafely } from "./helpers/cleanup";

describe("daily automation schedule", () => {
  it("filters Discord branches and applies the repository commit threshold", () => {
    const branches = [
      { repositoryLabel: "기본", branch: "main", author: "KJ", occurredAt: "", content: "", commits: [{ hash: "1", author: "KJ", occurredAt: "", subject: "a", body: "" }, { hash: "2", author: "KJ", occurredAt: "", subject: "b", body: "" }, { hash: "3", author: "KJ", occurredAt: "", subject: "c", body: "" }] },
      { repositoryLabel: "기본", branch: "develop", author: "KJ", occurredAt: "", content: "", commits: [] },
    ];
    expect(filterDiscordBranches(branches, [{ label: "기본", path: "repo", url: "", branches: ["main", "develop"], discordMinCommits: 3, discordBranches: ["main"] }])).toEqual([branches[0]]);
    expect(filterDiscordBranches(branches, [{ label: "기본", path: "repo", url: "", branches: ["main", "develop"], discordMinCommits: 4, discordBranches: ["main"] }])).toEqual([]);
  });

  it("uses the local calendar date", () => {
    expect(localDateKey(new Date(2026, 7, 12, 7, 59, 59))).toBe("2026-08-12");
  });

  it("returns today at 08:00 before the scheduled time", () => {
    const next = nextLocalRunAt(new Date(2026, 7, 12, 7, 30));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(7);
    expect(next.getDate()).toBe(12);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
  });

  it("returns tomorrow at 08:00 at or after the scheduled time", () => {
    const next = nextLocalRunAt(new Date(2026, 7, 12, 8, 0));
    expect(next.getDate()).toBe(13);
    expect(next.getHours()).toBe(8);
  });

  it("catches up once after 08:00 when no run is recorded for today", () => {
    const now = new Date(2026, 7, 12, 12, 0);
    expect(shouldCatchUpToday(undefined, now)).toBe(true);
    expect(shouldCatchUpToday("2026-08-11", now)).toBe(true);
    expect(shouldCatchUpToday("2026-08-12", now)).toBe(false);
  });

  it("does not catch up before 08:00", () => {
    expect(shouldCatchUpToday(undefined, new Date(2026, 7, 12, 7, 59))).toBe(false);
  });
});

describe("daily automation state store", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await removeDirSafely(directory);
    directory = null;
  });

  it("returns an empty state when the file does not exist", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hub-daily-state-"));
    const store = new DailyAutomationStateStore(directory);
    await expect(store.read()).resolves.toEqual({ version: 1, reportedHeads: {}, pendingBaselines: {} });
  });

  it("persists the reported heads and last scheduled date", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hub-daily-state-"));
    const store = new DailyAutomationStateStore(directory);
    await store.write({
      version: 1,
      lastScheduledDate: "2026-08-12",
      reportedHeads: { main: "abc123" },
      pendingBaselines: {},
    });
    await expect(store.read()).resolves.toEqual({
      lastScheduledDate: "2026-08-12",
      version: 1,
      reportedHeads: { main: "abc123" },
      pendingBaselines: {},
      lastRun: undefined,
    });
    expect(await readFile(path.join(directory, "daily-automation.json"), "utf8")).toContain('"main": "abc123"');
  });
});

describe("daily automation reporting", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await removeDirSafely(directory);
    vi.restoreAllMocks();
    directory = null;
  });

  it("creates a date-only baseline report on the first run", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hub-daily-run-"));
    const createDailyWorkReport = vi.fn().mockResolvedValue("page-1");
    vi.spyOn(NotionAdapter, "forToken").mockReturnValue(
      { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
    );
    const automation = new DailyAutomation({
      config: testConfig(directory),
      git: fakeGitService([]),
      notion: { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
      onChanged: () => undefined,
    });
    await automation.start();

    const run = await automation.run("manual");

    expect(run.status).toBe("succeeded");
    expect(createDailyWorkReport).toHaveBeenCalledWith(expect.objectContaining({
      date: localDateKey(),
      branches: [expect.objectContaining({ branch: "main", commits: [] })],
    }));
    const state = await new DailyAutomationStateStore(directory).read();
    expect(Object.values(state.reportedHeads)).toEqual(["head-2"]);
    expect(state.pendingBaselines).toEqual({});
    await automation.stop();
  });

  it("keeps a pending baseline when Notion reporting fails", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hub-daily-run-"));
    const createDailyWorkReport = vi.fn().mockRejectedValue(new Error("Notion unavailable"));
    vi.spyOn(NotionAdapter, "forToken").mockReturnValue(
      { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
    );
    const automation = new DailyAutomation({
      config: testConfig(directory),
      git: fakeGitService([]),
      notion: {
        enabled: true,
        createDailyWorkReport,
      } as unknown as NotionAdapter,
      onChanged: () => undefined,
    });
    await automation.start();

    const run = await automation.run("manual");

    expect(run.status).toBe("failed");
    const state = await new DailyAutomationStateStore(directory).read();
    expect(state.reportedHeads).toEqual({});
    expect(Object.values(state.pendingBaselines)).toEqual(["head-2"]);
    await automation.stop();
  });

  it("does not call Notion when any selected branch capture fails", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hub-daily-run-"));
    const config = testConfig(directory);
    config.repositories[0]!.branches = ["main", "develop"];
    const createDailyWorkReport = vi.fn().mockResolvedValue("page-1");
    const captureBranchCommits = vi.fn().mockImplementation(
      (repository: string, branch: string, previousHead: string | null) => {
        if (branch === "develop") return Promise.reject(new Error("develop capture failed"));
        return Promise.resolve({ repository, branch, previousHead, currentHead: "main-head", commits: [] });
      },
    );
    const automation = new DailyAutomation({
      config,
      git: fakeGitService([], {
        branches: ["main", "develop"],
        captureBranchCommits,
      }),
      notion: { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
      onChanged: () => undefined,
    });
    await automation.start();

    const run = await automation.run("manual");

    expect(run.status).toBe("partial");
    expect(createDailyWorkReport).not.toHaveBeenCalled();
    const state = await new DailyAutomationStateStore(directory).read();
    expect(state.reportedHeads).toEqual({});
    expect(Object.values(state.pendingBaselines)).toEqual(["head-2", "head-2"]);
    await automation.stop();
  });

  it("reports only commits after the stored head and advances all heads after Notion succeeds", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hub-daily-run-"));
    const config = testConfig(directory);
    config.repositories[0]!.branches = ["main", "develop"];
    const identityKey = "remote:github.com/example/repository";
    const mainKey = `${identityKey}|origin|main`;
    const developKey = `${identityKey}|origin|develop`;
    await new DailyAutomationStateStore(directory).write({
      version: 1,
      reportedHeads: { [mainKey]: "main-old", [developKey]: "develop-old" },
      pendingBaselines: {},
    });
    const commit = {
      hash: "a".repeat(40),
      author: "KJ",
      timestamp: "2026-08-13T08:00:00+09:00",
      subject: "새 기능",
      body: "일일작업 테스트",
    };
    const captureBranchCommits = vi.fn().mockImplementation(
      (repository: string, branch: string, previousHead: string | null) => Promise.resolve({
        repository,
        branch,
        previousHead,
        currentHead: `${branch}-new`,
        commits: branch === "main" ? [commit] : [],
      }),
    );
    const createDailyWorkReport = vi.fn().mockResolvedValue("page-1");
    vi.spyOn(NotionAdapter, "forToken").mockReturnValue(
      { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
    );
    const automation = new DailyAutomation({
      config,
      git: fakeGitService([], {
        branches: ["main", "develop"],
        captureBranchCommits,
      }),
      notion: { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
      onChanged: () => undefined,
    });
    await automation.start();

    const run = await automation.run("manual");

    expect(run.status).toBe("succeeded");
    expect(captureBranchCommits).toHaveBeenCalledWith(config.repositories[0]!.path, "main", "main-old");
    expect(captureBranchCommits).toHaveBeenCalledWith(config.repositories[0]!.path, "develop", "develop-old");
    expect(createDailyWorkReport).toHaveBeenCalledWith(expect.objectContaining({
      branches: [
        expect.objectContaining({ branch: "main", commits: [expect.objectContaining({ hash: commit.hash })] }),
        expect.objectContaining({ branch: "develop", commits: [] }),
      ],
    }));
    const state = await new DailyAutomationStateStore(directory).read();
    expect(state.reportedHeads).toEqual({
      [mainKey]: "main-new",
      [developKey]: "develop-new",
    });
    expect(state.pendingBaselines).toEqual({});
    await automation.stop();
  });

  it("carries over legacy remote: state keys when the normalization rules change", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hub-daily-run-"));
    const config = testConfig(directory);
    // 과거 정규화 규칙으로 저장된 키(대문자 경로). 원격 정규화가 소문자로 통일된 뒤에도
    // 이 이력을 이어받아 같은 브랜치가 다시 baseline 으로 잡히지 않아야 합니다.
    const legacyKey = "remote:github.com/EXAMPLE/repository|origin|main";
    await new DailyAutomationStateStore(directory).write({
      version: 1,
      reportedHeads: { [legacyKey]: "main-old" },
      pendingBaselines: {},
    });
    const captureBranchCommits = vi.fn().mockImplementation(
      (repository: string, branch: string, previousHead: string | null) => Promise.resolve({
        repository,
        branch,
        previousHead,
        currentHead: "main-new",
        commits: [],
      }),
    );
    const createDailyWorkReport = vi.fn().mockResolvedValue("page-1");
    vi.spyOn(NotionAdapter, "forToken").mockReturnValue(
      { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
    );
    const automation = new DailyAutomation({
      config,
      git: fakeGitService([], { branches: ["main"], captureBranchCommits }),
      notion: { enabled: true, createDailyWorkReport } as unknown as NotionAdapter,
      onChanged: () => undefined,
    });
    await automation.start();

    const run = await automation.run("manual");

    expect(run.status).toBe("succeeded");
    // 기존 이력을 이어받아 과거 head 를 기준으로 비교해야 합니다(새 baseline 으로 리셋되지 않음).
    expect(captureBranchCommits).toHaveBeenCalledWith(config.repositories[0]!.path, "main", "main-old");
    const state = await new DailyAutomationStateStore(directory).read();
    expect(state.reportedHeads["remote:github.com/example/repository|origin|main"]).toBe("main-new");
    expect(state.reportedHeads[legacyKey]).toBeUndefined();
    await automation.stop();
  });

});


function testConfig(dataDirectory: string): HubConfig {
  return {
    host: "127.0.0.1",
    httpPort: 43100,
    tcpPort: 43101,
    commandTimeoutMs: 30_000,
    maxFrameBytes: 8 * 1024 * 1024,
    apiToken: "test",
    repositories: [{
      label: "기본",
      username: "",
      defaultBranch: "",
      path: "C:\\fake-repository",
      url: "",
      branches: ["main"],
      discordMinCommits: 0,
      discordBranches: [],
      project: "",
      notionDatabaseId: "test-db",
      notionToken: "test-token",
      discordChannelId: "",
    }],
    envFile: path.join(dataDirectory, ".env"),
    dataDirectory,
    projectsUrl: "",
    configRepo: null,
    secretFile: path.join(dataDirectory, "unity-session.json"),
    sessionSecret: "test",
    dailyAutomation: { enabled: false },
    discord: {},
    notion: { enabled: false },
    github: {},
    gemini: { apiKey: "", model: "gemini-3.5-flash-lite" },
    sshKeyPath: "",
  };
}

function fakeGitService(commits: Array<{
  hash: string;
  author: string;
  timestamp: string;
  subject: string;
  body: string;
}>, overrides?: {
  branches?: string[];
  captureBranchCommits?: ReturnType<typeof vi.fn>;
}): GitService {
  return {
    validateRepository: vi.fn().mockImplementation((repository: string) => Promise.resolve(repository)),
    listBranches: vi.fn().mockResolvedValue(overrides?.branches ?? ["main"]),
    getBranchHead: vi.fn().mockResolvedValue("head-2"),
    getRepositoryIdentity: vi.fn().mockResolvedValue({
      root: "C:\\fake-repository",
      commonDirectory: "C:\\fake-repository\\.git",
      originUrl: "https://github.com/example/repository.git",
      key: "remote:github.com/example/repository",
      legacyKey: "c:/fake-repository/.git|https://github.com/example/repository.git",
    }),
    captureBranchCommits: overrides?.captureBranchCommits ?? vi.fn().mockImplementation(
      (repository: string, branch: string, previousHead: string | null) =>
        Promise.resolve({ repository, branch, previousHead, currentHead: "head-2", commits }),
    ),
  } as unknown as GitService;
}
