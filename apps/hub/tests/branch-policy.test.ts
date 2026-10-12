import { describe, expect, it } from "vitest";
import { canCommitOnBranch, isProtectedBranch, PROTECTED_BRANCHES } from "../src/shared/branch-policy";

describe("공용(보호) 브랜치 정책 (1번)", () => {
  it("메인 계열 브랜치는 보호로 판정합니다", () => {
    for (const branch of ["main", "master", "develop", "development"]) {
      expect(isProtectedBranch(branch)).toBe(true);
    }
    console.log("보호 브랜치: " + [...PROTECTED_BRANCHES].join(", "));
  });

  it("개인 작업 브랜치는 보호 대상이 아닙니다", () => {
    for (const branch of ["Test1", "Test2", "feature/login"]) {
      expect(isProtectedBranch(branch)).toBe(false);
    }
  });

  it("대소문자를 구분하지 않습니다", () => {
    expect(isProtectedBranch("MASTER")).toBe(true);
    expect(isProtectedBranch("Main")).toBe(true);
  });

  it("저장소의 기본 브랜치도 보호합니다", () => {
    expect(isProtectedBranch("release", "release")).toBe(true);
    expect(isProtectedBranch("Test1", "release")).toBe(false);
  });

  it("일반 사용자는 공용 브랜치에서 커밋할 수 없고, 관리자는 가능합니다", () => {
    expect(canCommitOnBranch({ branch: "master", role: "user" })).toBe(false);
    expect(canCommitOnBranch({ branch: "Test1", role: "user" })).toBe(true);
    expect(canCommitOnBranch({ branch: "master", role: "admin" })).toBe(true);
    console.log("일반 사용자 master 커밋 불가, admin 은 가능");
  });
});

