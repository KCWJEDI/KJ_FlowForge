/**
 * 라이선스 키로 암호화된 Git 자격증명(SSH 개인키) 봉투를 해제합니다.
 *
 * 관리자(CreateKey, .NET Framework 4.8)가 팀원별 SSH 개인키를 그 사람의 라이선스 키로
 * 암호화해 config 저장소에 올립니다. 이 모듈은 그 암호문을 앱에서 복호화합니다.
 *
 * 암호 형식은 .NET Framework 4.8 과 Node 양쪽이 지원하는 조합으로 고정했습니다.
 *   - 키 유도: PBKDF2-HMAC-SHA256, 100000회, 64바이트(앞 32 = 암호화 키, 뒤 32 = MAC 키)
 *   - 암호화:  AES-256-CBC + PKCS7
 *   - 무결성:  HMAC-SHA256(salt || iv || ciphertext)
 *
 * scrypt 와 AES-GCM 은 .NET Framework 에 없으므로 사용하지 않습니다.
 */
import { createDecipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";

export interface EncryptedSecretEnvelope {
  v: number;
  alg: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
  mac: string;
}

export const SECRET_ENVELOPE_ALG = "pbkdf2-sha256+aes-256-cbc+hmac-sha256";

export function isEncryptedSecretEnvelope(value: unknown): value is EncryptedSecretEnvelope {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.salt === "string" &&
    typeof raw.iv === "string" &&
    typeof raw.ct === "string" &&
    typeof raw.mac === "string" &&
    typeof raw.iter === "number" &&
    (raw.alg === undefined || raw.alg === SECRET_ENVELOPE_ALG)
  );
}

/** 암호문 봉투를 라이선스 키로 복호화합니다. 키가 틀리거나 변조되면 예외를 던집니다. */
export function decryptSecretEnvelope(licenseKey: string, envelope: EncryptedSecretEnvelope): string {
  const key = (licenseKey ?? "").trim();
  if (!key) throw new Error("라이선스 키가 없어 Git 자격증명을 해제할 수 없습니다.");
  if (envelope.alg !== undefined && envelope.alg !== SECRET_ENVELOPE_ALG) {
    throw new Error("지원하지 않는 자격증명 암호 형식입니다: " + String(envelope.alg));
  }
  const iterations = Number.isInteger(envelope.iter) && envelope.iter > 0 ? envelope.iter : 100000;
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const ciphertext = Buffer.from(envelope.ct, "base64");
  const mac = Buffer.from(envelope.mac, "base64");

  const material = pbkdf2Sync(key.normalize("NFKC"), salt, iterations, 64, "sha256");
  const encKey = material.subarray(0, 32);
  const macKey = material.subarray(32, 64);

  const expected = createHmac("sha256", macKey).update(Buffer.concat([salt, iv, ciphertext])).digest();
  if (expected.length !== mac.length || !timingSafeEqual(expected, mac)) {
    throw new Error("Git 자격증명 복호화에 실패했습니다. 라이선스 키가 올바른지 확인하세요.");
  }

  const decipher = createDecipheriv("aes-256-cbc", encKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

