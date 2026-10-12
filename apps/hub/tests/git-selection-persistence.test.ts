import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitSelectionStore, sanitizeSelectionState } from "../src/main/git-selection-store";
import { removeDirSafely } from "./helpers/cleanup";

describe("Git selection persistence across a restart", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await removeDirSafely(directory);
    directory = null;
  });

  function newFile(): string {
    directory = mkdtempSync(path.join(os.tmpdir(), "git-selection-"));
    return path.join(directory, "runtime", "git-selection.json");
  }

  it("keeps a per-project repository path after saving and reloading", async () => {
    const file = newFile();
    const store = new GitSelectionStore(file);
    await store.save(sanitizeSelectionState({
      ...({} as Record<string, unknown>),
      projectConnectPaths: { TestGitProject: "C:/Users/kcwje/Downloads/Test" },
      projectConnectMessages: { TestGitProject: "연결됨: C:/Users/kcwje/Downloads/Test" },
      selectedProject: "TestGitProject",
    }));

    // 앱 재시작을 모사: 같은 파일을 새 스토어로 다시 읽습니다.
    const reloaded = await new GitSelectionStore(file).load();
    expect(reloaded.projectConnectPaths["TestGitProject"]).toBe("C:/Users/kcwje/Downloads/Test");
    expect(reloaded.projectConnectMessages["TestGitProject"]).toBe("연결됨: C:/Users/kcwje/Downloads/Test");
  });

  it("keeps each card's own repository folder (localPath) after reload", async () => {
    const file = newFile();
    const store = new GitSelectionStore(file);
    await store.save(sanitizeSelectionState({
      ...({} as Record<string, unknown>),
      cardsByProject: {
        TestGitProject: [
          { id: "git-card-a", path: "W:/repo-a", localPath: "W:/repo-a", workBranches: ["Test1"], activeBranches: ["Test1"] },
          { id: "git-card-b", path: "W:/repo-b", localPath: "W:/repo-b", workBranches: [], activeBranches: [] },
        ],
      },
    }));

    const reloaded = await new GitSelectionStore(file).load();
    const cards = reloaded.cardsByProject["TestGitProject"] ?? [];
    expect(cards.map((card) => card.localPath)).toEqual(["W:/repo-a", "W:/repo-b"]);
  });

  it("recovers saved paths from the backup when the file is corrupted", async () => {
    const file = newFile();
    const store = new GitSelectionStore(file);
    // 정상 저장(이때 원본이 .bak 로 백업됩니다).
    await store.save(sanitizeSelectionState({
      ...({} as Record<string, unknown>),
      projectConnectPaths: { TestGitProject: "C:/Users/kcwje/Downloads/Test" },
    }));
    // 두 번째 저장으로 .bak 이 최신 상태를 담게 합니다.
    await store.save(sanitizeSelectionState({
      ...({} as Record<string, unknown>),
      projectConnectPaths: { TestGitProject: "C:/Users/kcwje/Downloads/Test" },
      selectedProject: "TestGitProject",
    }));
    // 예전 버그처럼 본 파일이 깨졌다고 가정합니다.
    writeFileSync(file, readFileSync(file, "utf8") + 'tMessage": ""\n}', "utf8");

    const reloaded = await new GitSelectionStore(file).load();
    expect(reloaded.projectConnectPaths["TestGitProject"]).toBe("C:/Users/kcwje/Downloads/Test");
  });

  it("keeps the file valid under concurrent saves", async () => {
    const file = newFile();
    const store = new GitSelectionStore(file);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.save(sanitizeSelectionState({
          ...({} as Record<string, unknown>),
          projectConnectPaths: { TestGitProject: `C:/Users/kcwje/Downloads/Test${index}` },
        })),
      ),
    );
    // 동시 저장 후에도 파일이 항상 유효한 JSON 이어야 합니다.
    expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
  });
});
