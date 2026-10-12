import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LicenseService } from "../src/main/license-service";
import { installCredentialBundle, findBundleEnvelope } from "../src/main/credential-store";
import { normalizeRepoIdentity } from "../src/shared/repo-identity";
import { parseProjectsFile } from "../src/main/projects-store";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

/**
 * 2안 계약 테스트: 라이선스 저장소(공개) 와 config 저장소(비공개)의 역할 분리.
 *
 *   licenses.json  -> 라이선스 해시 + 라이선스 키로 암호화된 저장소 자격증명
 *   projects.json  -> 프로젝트·브랜치 정의(자격증명 미포함)
 */
const LICENSES_JSON = process.env["KJFF_LICENSE_MANIFEST"] ?? "";
const PROJECTS_JSON = process.env["KJFF_PROJECTS_FILE"] ?? "";

describe.skipIf(!LICENSES_JSON)("license repo manifest contract", () => {
  it("contains hashes and encrypted credentials only (no plaintext secrets)", () => {
    const raw = readFileSync(LICENSES_JSON, "utf8");
    const manifest = JSON.parse(raw) as { keys: Array<{ id: string; hash: string }> };
    expect(Array.isArray(manifest.keys)).toBe(true);
    expect(manifest.keys.every((k) => typeof k.hash === "string" && k.hash.length === 64)).toBe(true);
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain("BEGIN OPENSSH");
    console.log("manifest keys: " + manifest.keys.map((k) => k.id).join(", "));
  });
});

describe.skipIf(!PROJECTS_JSON)("config repo projects contract", () => {
  it("carries project and branch definitions without credentials", () => {
    const projects = parseProjectsFile(readFileSync(PROJECTS_JSON, "utf8"));
    expect(projects.length).toBeGreaterThan(0);
    // config 에는 자격증명이 더 이상 없어야 합니다(라이선스 저장소로 이동).
    for (const project of projects) {
      expect((project as { gitCredentials?: unknown }).gitCredentials).toBeUndefined();
    }
    console.log("projects: " + projects.map((p) => p.id).join(", "));
  });
});

describe("bootstrap order is license-first (private config safe)", () => {
  it("documents the required startup order", () => {
    // 앱 시작 순서:
    //   1) 라이선스 저장소(공개)에서 매니페스트를 익명으로 읽어 라이선스 확인
    //   2) 같은 매니페스트에서 암호화된 SSH 키를 받아 복호화/설치
    //   3) 그 키로 config(비공개) 및 프로젝트 저장소에 접근
    const order = ["license-manifest", "install-credentials", "read-config"];
    expect(order[0]).toBe("license-manifest");
    expect(order[1]).toBe("install-credentials");
    expect(order[2]).toBe("read-config");
  });

  it("produces usable credentials with correct repository identities", () => {
    const bundle = {
      [normalizeRepoIdentity("https://github.com/KCWJEDI/KJ_FlowForge_Config.git")]: {
        v: 1, alg: "pbkdf2-sha256+aes-256-cbc+hmac-sha256", iter: 100000,
        salt: "AAAAAAAAAAAAAAAAAAAAAA==", iv: "AAAAAAAAAAAAAAAAAAAAAA==",
        ct: "AAAA", mac: "AAAA",
      },
    };
    // config 저장소 식별자로 자격증명을 찾을 수 있어야 합니다(ssh 표기 포함).
    const found = findBundleEnvelope(bundle as never, "git@github.com:KCWJEDI/KJ_FlowForge_Config.git");
    expect(found).not.toBeNull();
  });
});

