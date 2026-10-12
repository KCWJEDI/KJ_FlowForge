import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { decryptSecretEnvelope, isEncryptedSecretEnvelope, SECRET_ENVELOPE_ALG } from "../src/main/secret-envelope";
import {
  bundleRepoIdentities,
  findBundleEnvelope,
  installCredentialBundle,
} from "../src/main/credential-store";
import { normalizeRepoIdentity } from "../src/shared/repo-identity";

/** 테스트용 암호문 봉투 생성 (관리자 C# 과 동일한 형식). */
function encryptFor(licenseKey: string, plaintext: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const km = crypto.pbkdf2Sync(licenseKey, salt, 100000, 64, "sha256");
  const cipher = crypto.createCipheriv("aes-256-cbc", km.subarray(0, 32), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const mac = crypto.createHmac("sha256", km.subarray(32, 64)).update(Buffer.concat([salt, iv, ct])).digest();
  return {
    v: 1,
    alg: SECRET_ENVELOPE_ALG,
    iter: 100000,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    mac: mac.toString("base64"),
  };
}

const LICENSE_KEY = "KJFF-AAAAAA-BBBBBB-CCCCCC-DDDDDD-EEEEEE-FFFFFF";
const REPO_URL = "https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git";

function makePrivateKey(): { privateKey: string; publicKey: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cred-src-"));
  const file = path.join(dir, "id");
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", "test", "-f", file], { stdio: "pipe" });
  return { privateKey: readFileSync(file, "utf8"), publicKey: readFileSync(file + ".pub", "utf8").trim() };
}

describe("license-key encrypted credential bundle", () => {
  it("round-trips a real SSH private key and never exposes it in the blob", () => {
    const { privateKey } = makePrivateKey();
    const envelope = encryptFor(LICENSE_KEY, privateKey);
    expect(JSON.stringify(envelope)).not.toContain("PRIVATE KEY");
    expect(decryptSecretEnvelope(LICENSE_KEY, envelope)).toBe(privateKey);
  });

  it("rejects a wrong license key and tampered ciphertext", () => {
    const { privateKey } = makePrivateKey();
    const envelope = encryptFor(LICENSE_KEY, privateKey);
    expect(() => decryptSecretEnvelope("KJFF-000000-000000-000000-000000-000000-000000", envelope)).toThrow();
    const tampered = { ...envelope, ct: Buffer.from("hacked").toString("base64") };
    expect(() => decryptSecretEnvelope(LICENSE_KEY, tampered)).toThrow();
  });

  it("validates envelope shape", () => {
    expect(isEncryptedSecretEnvelope(encryptFor(LICENSE_KEY, "x"))).toBe(true);
    expect(isEncryptedSecretEnvelope(null)).toBe(false);
    expect(isEncryptedSecretEnvelope({ salt: "a" })).toBe(false);
  });
});

describe("credential bundle lookup by repository identity", () => {
  it("finds a credential by any equivalent URL form", () => {
    const envelope = encryptFor(LICENSE_KEY, "dummy");
    const identity = normalizeRepoIdentity(REPO_URL);
    const bundle = { [identity]: envelope };

    expect(findBundleEnvelope(bundle, REPO_URL)).toEqual(envelope);
    // ssh 표기, .git 생략 표기도 같은 저장소로 찾아야 함
    expect(findBundleEnvelope(bundle, "git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git")).toEqual(envelope);
    expect(findBundleEnvelope(bundle, "https://github.com/KCWJEDI/KJ_FlowForge_TestGit")).toEqual(envelope);
    expect(findBundleEnvelope(bundle, "https://github.com/Other/Repo.git")).toBeNull();
    expect(bundleRepoIdentities(bundle)).toEqual([identity]);
  });

  it("validates envelope shape", () => {
    expect(isEncryptedSecretEnvelope(encryptFor(LICENSE_KEY, "x"))).toBe(true);
    expect(isEncryptedSecretEnvelope(null)).toBe(false);
    expect(isEncryptedSecretEnvelope({ salt: "a" })).toBe(false);
  });
});

describe("credential bundle installation", () => {
  it("installs usable private keys with owner-only permissions and reports failures", async () => {
    const { privateKey, publicKey } = makePrivateKey();
    const identity = normalizeRepoIdentity(REPO_URL);
    const otherIdentity = "github.com/kcwjedi/other";
    const dir = mkdtempSync(path.join(os.tmpdir(), "cred-bundle-"));

    const bundle = {
      [identity]: encryptFor(LICENSE_KEY, privateKey),
      // 라이선스 키가 달라 복호화에 실패하는 항목(경고로 보고되어야 함)
      [otherIdentity]: encryptFor("KJFF-WRONG-KEY-000000-000000-000000-000000", privateKey),
    };

    const result = await installCredentialBundle({ directory: dir, licenseKey: LICENSE_KEY, bundle });
    expect(Object.keys(result.installed)).toEqual([identity]);
    expect(result.warnings).toHaveLength(1);

    const keyPath = result.installed[identity]!;
    expect(existsSync(keyPath)).toBe(true);
    // Windows ACL 까지 조여야 OpenSSH 가 키를 받아들인다(수동 처리 없음).
    const derived = execFileSync("ssh-keygen", ["-y", "-f", keyPath], { encoding: "utf8" }).trim();
    expect(publicKey.startsWith(derived)).toBe(true);
  }, 60000);

  it("refuses non-SSH payloads", async () => {
    const identity = normalizeRepoIdentity(REPO_URL);
    const dir = mkdtempSync(path.join(os.tmpdir(), "cred-bad-"));
    const bundle = { [identity]: encryptFor(LICENSE_KEY, "not a key") };
    const result = await installCredentialBundle({ directory: dir, licenseKey: LICENSE_KEY, bundle });
    expect(Object.keys(result.installed)).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  }, 60000);
});

