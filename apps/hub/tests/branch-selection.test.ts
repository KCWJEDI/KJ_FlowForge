import { describe, expect, it } from "vitest";
import { filterBranchesByAllowed } from "../src/shared/branch-selection";

describe("브랜치 권한 회수 시 작업 브랜치 정리", () => {
  it("권한이 회수된 브랜치(Test2)를 제거합니다", () => {
    // 이전에 Test1, Test2를 쓰다가 라이선스가 Test1만 허용하도록 변경된 상황
    const result = filterBranchesByAllowed({
      saved: ["Test1", "Test2"],
      allowed: ["Test1"],
      isAdmin: false,
    });
    console.log("Test1,Test2 + 허용[Test1] -> " + JSON.stringify(result));
    expect(result).toEqual(["Test1"]);
  });

  it("권한이 그대로면 기존 선택을 유지합니다", () => {
    const result = filterBranchesByAllowed({
      saved: ["Test1", "Test2"],
      allowed: ["Test1", "Test2", "master"],
      isAdmin: false,
    });
    expect(result).toEqual(["Test1", "Test2"]);
  });

  it("모든 권한이 회수되면 빈 목록이 됩니다", () => {
    const result = filterBranchesByAllowed({ saved: ["Test2"], allowed: ["Test1"], isAdmin: false });
    expect(result).toEqual([]);
  });

  it("배정 정보가 없으면 사용자의 선택을 지우지 않습니다", () => {
    // 아직 프로젝트 정보를 받지 못한 순간에 체크가 사라지면 혼란스러우므로 보존합니다.
    const result = filterBranchesByAllowed({ saved: ["Test2"], allowed: [], isAdmin: false });
    expect(result).toEqual(["Test2"]);
  });

  it("관리자는 제한 없이 그대로 유지합니다", () => {
    const result = filterBranchesByAllowed({ saved: ["any", "branch"], allowed: ["Test1"], isAdmin: true });
    expect(result).toEqual(["any", "branch"]);
  });

  it("중복과 빈 값을 정리합니다", () => {
    const result = filterBranchesByAllowed({ saved: ["Test1", "Test1", " ", ""], allowed: ["Test1"], isAdmin: false });
    expect(result).toEqual(["Test1"]);
  });
});

