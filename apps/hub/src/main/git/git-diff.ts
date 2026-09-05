/**
 * 커밋별 diff 통계와 목적(카테고리) 분류를 담당하는 순수 규칙 함수 모음.
 * AI 의존성 없이 git 출력을 결정적으로 파싱/분류합니다.
 */
import type { CommitCategory, GitCommitDiffStats } from "./git-service";

/** 커밋 제목을 키워드 규칙으로 목적(카테고리) 분류합니다. 순수 결정적 함수입니다. */
export function classifyPurpose(subject: string): CommitCategory {
  const trimmed = subject.trim();
  if (!trimmed) return "기타";
  const norm = trimmed.toLowerCase();

  if (norm.startsWith("feat") || norm.startsWith("기능")) return "기능";
  if (norm.startsWith("perf") || norm.startsWith("optim") || norm.startsWith("성능")) return "성능";
  if (norm.startsWith("fix") || norm.startsWith("hotfix") || norm.startsWith("bug") || norm.startsWith("버그") || norm.startsWith("수정")) return "버그/수정";
  if (norm.startsWith("refactor") || norm.startsWith("리팩토링")) return "리팩토링";
  if (norm.startsWith("docs") || norm.startsWith("문서")) return "문서";
  return "기타";
}

interface ParsedNumstat {
  insertions: number;
  deletions: number;
}

/** git show --numstat -z 출력을 파싱해 추가/삭제 라인 수를 결정적으로 합산합니다. */
export function parseNumstat(raw: string): ParsedNumstat {
  let insertions = 0;
  let deletions = 0;
  const records = raw.split("\0");
  for (const record of records) {
    if (!record) continue;
    const fields = record.split("\t");
    if (fields.length < 3) continue;
    const add = fields[0]!;
    const del = fields[1]!;
    const addNum = add === "-" ? Number.NaN : Number.parseInt(add, 10);
    const delNum = del === "-" ? Number.NaN : Number.parseInt(del, 10);
    if (Number.isFinite(addNum)) insertions += addNum;
    if (Number.isFinite(delNum)) deletions += delNum;
  }
  return { insertions, deletions };
}

interface ParsedNameStatus {
  added: string[];
  deleted: string[];
  modified: string[];
}

/** git show --name-status -z 출력을 파싱해 추가/삭제/수정 파일 목록을 결정적으로 구성합니다.
 * -z 모드에서는 코드와 경로가 모두 NUL로 구분됩니다 (예: A\0a.txt\0, R100\0old\0new\0).
 */
export function parseNameStatus(raw: string): ParsedNameStatus {
  const added: string[] = [];
  const deleted: string[] = [];
  const modified: string[] = [];
  const tokens = raw.split("\0").filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const code = tokens[index]!.trim();
    if (!code) continue;
    if (code === "A") {
      const path = tokens[index + 1] ?? "";
      if (path) added.push(path);
      index += 1;
    } else if (code === "D") {
      const path = tokens[index + 1] ?? "";
      if (path) deleted.push(path);
      index += 1;
    } else if (code === "M" || code === "T") {
      const path = tokens[index + 1] ?? "";
      if (path) modified.push(path);
      index += 1;
    } else if (code.startsWith("R") || code.startsWith("C")) {
      const newPath = tokens[index + 2] ?? "";
      if (newPath) modified.push(newPath);
      index += 2;
    }
  }
  return { added, deleted, modified };
}

