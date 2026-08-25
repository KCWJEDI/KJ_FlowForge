#!/usr/bin/env node
// 라이선스 키 발급 도구 (개발자 전용)
// 사용법: node issue-license.mjs <키ID> <사용자이름> [만료일 YYYY-MM-DD]
// 실행 결과로 라이선스 키와 해시가 출력됩니다.
import { createHash, randomBytes } from "node:crypto";

const [, , id, owner, expiresAt] = process.argv;
if (!id || !owner) {
  console.error("사용법: node issue-license.mjs <키ID> <사용자이름> [만료일 YYYY-MM-DD]");
  process.exit(1);
}

const key = "KJFF-" + randomBytes(18).toString("hex").replace(/(.{6})/g, "$1-").slice(0, 29).toUpperCase();
const hash = createHash("sha256").update(key).digest("hex");

console.log("=== 발급 완료 ===");
console.log("라이선스 키 : " + key);
console.log("(팀원에게 이 키만 전달하세요)");
console.log("");
console.log("=== licenses.json에 추가할 항목 ===");
console.log(JSON.stringify({ id, hash, owner, ...(expiresAt ? { expiresAt } : {}) }, null, 2));
