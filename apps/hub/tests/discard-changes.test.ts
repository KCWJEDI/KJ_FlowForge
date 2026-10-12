import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { GitService } from "../src/main/git/git-service";

/** 테스트용 저장소를 만들어 커밋 1개와 브랜치를 준비합니다. */
function initRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "discard-qa-"));
  const g = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g(["init", "-b", "Test1"]);
  g(["config", "user.email", "t@e"]);
  g(["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "tracked.txt"), "original");
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
  g(["branch", "Test2"]);
  return dir;
}

describe("변경사항 폐기 (2번)", () => {
  it("추적 파일의 수정 내용을 되돌려 브랜치 전환이 가능해집니다", async () => {
    const dir = initRepo();
    const svc = new GitService();

    // 추적 파일을 수정 -> 변경사항 발생
    writeFileSync(path.join(dir, "tracked.txt"), "modified");
    const before = await svc.inspect(dir);
    console.log("폐기 전 변경 파일: " + before.files.length + " (" + before.files.map((f) => f.path).join(",") + ")");
    expect(before.clean).toBe(false);

    // 변경사항이 있으면 브랜치 전환이 막히는지 확인
    let switchBlocked = false;
    try { await svc.switchBranch(dir, "Test2"); } catch { switchBlocked = true; }
    console.log("변경사항 있을 때 브랜치 전환 차단: " + switchBlocked);

    // 폐기
    await svc.discardChanges(dir);
    const after = await svc.inspect(dir);
    console.log("폐기 후 변경 파일: " + after.files.length + " / 내용: " + readFileSync(path.join(dir, "tracked.txt"), "utf8"));
    expect(after.clean).toBe(true);
    expect(readFileSync(path.join(dir, "tracked.txt"), "utf8")).toBe("original");

    // 이제 브랜치 전환이 되어야 함
    await svc.switchBranch(dir, "Test2");
    const onTest2 = await svc.inspect(dir);
    console.log("전환된 브랜치: " + onTest2.branch);
    expect(onTest2.branch).toBe("Test2");
  }, 90000);

  it("새로 만든 파일은 기본 폐기에서 남습니다(A안)", async () => {
    const dir = initRepo();
    const svc = new GitService();
    writeFileSync(path.join(dir, "tracked.txt"), "modified");
    writeFileSync(path.join(dir, "brand-new.txt"), "my work");

    await svc.discardChanges(dir);
    console.log("새 파일 남아있음: " + existsSync(path.join(dir, "brand-new.txt")));
    expect(existsSync(path.join(dir, "brand-new.txt"))).toBe(true);
    expect(readFileSync(path.join(dir, "tracked.txt"), "utf8")).toBe("original");
  }, 90000);

  it("includeUntracked 로 새 파일까지 지울 수 있습니다", async () => {
    const dir = initRepo();
    const svc = new GitService();
    writeFileSync(path.join(dir, "brand-new.txt"), "my work");

    const untracked = await svc.listUntrackedFiles(dir);
    console.log("미추적 파일: " + JSON.stringify(untracked));
    expect(untracked).toContain("brand-new.txt");

    await svc.cleanUntracked(dir, untracked);
    expect(existsSync(path.join(dir, "brand-new.txt"))).toBe(false);
    console.log("cleanUntracked 후 삭제됨: true");
  }, 90000);

  it("스테이징된 변경도 폐기됩니다", async () => {
    const dir = initRepo();
    const svc = new GitService();
    writeFileSync(path.join(dir, "tracked.txt"), "staged-change");
    await svc.stage(dir, ["tracked.txt"]);
    const staged = await svc.inspect(dir);
    console.log("스테이징 상태: index=" + staged.files[0]?.indexStatus);

    await svc.discardChanges(dir);
    const after = await svc.inspect(dir);
    console.log("폐기 후 clean: " + after.clean + " / 내용: " + readFileSync(path.join(dir, "tracked.txt"), "utf8"));
    expect(after.clean).toBe(true);
    expect(readFileSync(path.join(dir, "tracked.txt"), "utf8")).toBe("original");
  }, 90000);
});

