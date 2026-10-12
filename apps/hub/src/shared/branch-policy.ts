/**
 * 공용(보호) 브랜치 정의입니다.
 *
 * main/master/develop 계열은 팀 공용 브랜치로 취급해, 일반 사용자의 커밋·푸시를 막습니다.
 * 이 정책은 메인(hub-runtime)과 화면(renderer)이 같은 기준을 쓰도록 여기서 한 번만 정의합니다.
 * (양쪽에 따로 두면 기준이 어긋나 화면과 실제 동작이 달라집니다.)
 */
import type { LicenseRole } from "./ipc";

export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set([
  "main",
  "master",
  "develop",
  "development",
]);

/** 브랜치 이름이 공용 브랜치인지 판정합니다(대소문자 무시). */
export function isProtectedBranch(branch: string | undefined, defaultBranch?: string): boolean {
  const name = (branch ?? "").trim().toLowerCase();
  if (!name) return false;
  if (PROTECTED_BRANCHES.has(name)) return true;
  const fallback = (defaultBranch ?? "").trim().toLowerCase();
  return Boolean(fallback) && name === fallback;
}

/**
 * 이 브랜치에서 일반 사용자가 커밋·푸시할 수 있는지 판정합니다.
 * 관리자는 제한이 없습니다.
 */
export function canCommitOnBranch(args: {
  branch: string | undefined;
  role: LicenseRole;
  defaultBranch?: string;
}): boolean {
  if (args.role === "admin") return true;
  return !isProtectedBranch(args.branch, args.defaultBranch);
}

