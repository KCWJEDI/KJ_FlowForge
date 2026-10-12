import { describe, expect, it } from "vitest";
import { assignmentFingerprint, assignmentsChanged } from "../src/shared/assignment-fingerprint";
import type { ProjectView } from "../src/shared/ipc";

function view(id: string, name: string, branches: string[]): ProjectView {
  return { id, name, url: "https://example.test/" + id + ".git", allowedBranches: branches, branchRestricted: true, repository: null, selectableBranches: branches };
}

describe("브랜치 배정 변경 감지 (3번 자동 새로고침)", () => {
  it("브랜치가 추가되면 변경으로 판정합니다", () => {
    const before = [view("p1", "Alpha", ["Test1"])];
    const after = [view("p1", "Alpha", ["Test1", "Test2"])];
    console.log("추가 감지: " + assignmentsChanged(before, after));
    expect(assignmentsChanged(before, after)).toBe(true);
  });

  it("브랜치가 회수되면 변경으로 판정합니다", () => {
    const before = [view("p1", "Alpha", ["Test1", "Test2"])];
    const after = [view("p1", "Alpha", ["Test1"])];
    expect(assignmentsChanged(before, after)).toBe(true);
  });

  it("변화가 없으면 갱신하지 않습니다(화면 흔들림 방지)", () => {
    const before = [view("p1", "Alpha", ["Test1", "Test2"])];
    const after = [view("p1", "Alpha", ["Test2", "Test1"])]; // 순서만 다름
    console.log("변화 없음: " + !assignmentsChanged(before, after));
    expect(assignmentsChanged(before, after)).toBe(false);
  });

  it("프로젝트가 추가/삭제되면 변경으로 판정합니다", () => {
    const one = [view("p1", "Alpha", ["Test1"])];
    const two = [view("p1", "Alpha", ["Test1"]), view("p2", "Beta", ["main"])];
    expect(assignmentsChanged(one, two)).toBe(true);
    expect(assignmentsChanged(two, one)).toBe(true);
  });

  it("프로젝트 이름이 바뀌면 변경으로 판정합니다", () => {
    const before = [view("p1", "Alpha", ["Test1"])];
    const after = [view("p1", "Renamed", ["Test1"])];
    expect(assignmentsChanged(before, after)).toBe(true);
  });

  it("지문은 순서에 독립적입니다", () => {
    const a = [view("p1", "A", ["x"]), view("p2", "B", ["y"])];
    const b = [view("p2", "B", ["y"]), view("p1", "A", ["x"])];
    expect(assignmentFingerprint(a)).toBe(assignmentFingerprint(b));
  });
});

