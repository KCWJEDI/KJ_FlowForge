import { describe, expect, it } from "vitest";
import { parseProjectsFile, serializeProjectsFile, upsertProjectsFromRepositories, type RepoLike } from "../src/main/projects-store";

const CENTRAL = JSON.stringify({
  version: 1,
  projects: [
    { id: "TestGithub", name: "TestGitProject", url: "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", userBranches: { User1: ["Test1"], YS: ["Test1", "Test2"] } },
    { id: "CK_2_2_TermProject", name: "CK_2_2_TermProject", url: "https://github.com/KCWJEDI/CK_2_2_TermProject.git", userBranches: { User1: ["Develop"] } },
  ],
});

describe("central projects.json preservation", () => {
  it("merging local repositories keeps existing projects and their per-key branches", () => {
    const current = parseProjectsFile(CENTRAL);
    const merged = upsertProjectsFromRepositories(current, [
      { project: "DiceGambit", label: "프로그래머", username: "KCWJEDI", path: "C:/local/dice", url: "https://github.com/KCWJEDI/DiceGambit_Project.git", branches: ["main"] } satisfies RepoLike,
    ]);
    expect(merged.map((project) => project.id)).toEqual(["TestGithub", "CK_2_2_TermProject", "DiceGambit"]);
    const testGithub = merged.find((project) => project.id === "TestGithub");
    expect(testGithub?.name).toBe("TestGitProject");
    expect(testGithub?.userBranches).toEqual({ User1: ["Test1"], YS: ["Test1", "Test2"] });
  });

  it("re-merging an already-known repository does not drop unrelated projects", () => {
    const current = parseProjectsFile(CENTRAL);
    const merged = upsertProjectsFromRepositories(current, [
      { project: "TestGitProject", label: "저장소", username: "KCWJEDI", path: "C:/local/test", url: "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", branches: ["Test1"] } satisfies RepoLike,
    ]);
    const ids = merged.map((project) => project.id);
    expect(ids).toContain("TestGithub");
    expect(ids).toContain("CK_2_2_TermProject");
    // 다른 라이선스 키(YS)의 브랜치 배정도 보존되어야 합니다.
    expect(merged.find((project) => project.id === "TestGithub")?.userBranches?.YS).toEqual(["Test1", "Test2"]);
  });

  it("serialized central file stays parseable after merge", () => {
    const merged = upsertProjectsFromRepositories(parseProjectsFile(CENTRAL), [
      { project: "DiceGambit", label: "프로그래머", username: "KCWJEDI", path: "C:/local/dice", url: "git@github.com:KCWJEDI/DiceGambit_Project.git", branches: [] } satisfies RepoLike,
    ]);
    const reparsed = parseProjectsFile(serializeProjectsFile(merged));
    expect(reparsed.map((project) => project.id)).toContain("TestGithub");
  });
});

