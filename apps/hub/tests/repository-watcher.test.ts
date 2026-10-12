import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { RepositoryWatcher } from "../src/main/git/repository-watcher";

describe("RepositoryWatcher (자동 새로고침)", () => {
  it("감지된 변경을 디바운스해 한 번만 알립니다", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "watch-"));
    mkdirSync(path.join(dir, "Assets"), { recursive: true });
    writeFileSync(path.join(dir, "Assets", "a.txt"), "one");

    const seen: string[] = [];
    const watcher = new RepositoryWatcher({ onChange: (repo) => seen.push(repo), debounceMs: 150 });
    watcher.watch(dir);

    // 짧은 시간에 여러 번 수정 -> 디바운스로 1회 알림
    writeFileSync(path.join(dir, "Assets", "a.txt"), "two");
    writeFileSync(path.join(dir, "Assets", "b.txt"), "new");
    await new Promise((r) => setTimeout(r, 900));

    console.log("notifications: " + seen.length + " -> " + JSON.stringify(seen));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((item) => item === dir)).toBe(true);
    watcher.closeAll();
  }, 60000);

  it(".git 내부 변경은 무시합니다", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "watchgit-"));
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    const seen: string[] = [];
    const watcher = new RepositoryWatcher({ onChange: (repo) => seen.push(repo), debounceMs: 100 });
    watcher.watch(dir);
    writeFileSync(path.join(dir, ".git", "index"), "x");
    await new Promise((r) => setTimeout(r, 700));
    console.log(".git 변경 알림 수: " + seen.length);
    expect(seen.length).toBe(0);
    watcher.closeAll();
  }, 60000);

  it("sync 로 감시 목록을 정리합니다", () => {
    const dirs = [0, 1, 2].map((i) => {
      const d = mkdtempSync(path.join(os.tmpdir(), "sync-" + i + "-"));
      return d;
    });
    const watcher = new RepositoryWatcher({ onChange: () => undefined });
    watcher.sync(dirs);
    watcher.sync([dirs[0]!]);
    console.log("sync 후 감시 수: " + (watcher as unknown as { watches: Map<string, unknown> }).watches.size);
    expect((watcher as unknown as { watches: Map<string, unknown> }).watches.size).toBe(1);
    watcher.closeAll();
    expect((watcher as unknown as { watches: Map<string, unknown> }).watches.size).toBe(0);
  });
});

