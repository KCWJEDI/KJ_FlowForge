/**
 * 라이선스 저장소에 배포된 암호화 Git 자격증명을 이 PC 에 설치합니다.
 *
 * 관리자(CreateKey)가 팀원별 SSH 개인키를 그 사람의 라이선스 키로 암호화해
 * 라이선스 저장소(공개 가능)에 올립니다. 암호문이므로 저장소가 공개여도 평문은 노출되지 않습니다.
 *
 * 팀원은 라이선스 키만 있으면 되고, 앱이 시작할 때 자기 몫을 찾아 복호화해 로컬 키로 설치합니다.
 * 자격증명은 저장소 식별자(normalizeRepoIdentity)로 구분되므로, 비공개 config 저장소와
 * 각 프로젝트 저장소에 맞는 키를 골라 쓸 수 있습니다.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CredentialBundle, EncryptedCredentialEnvelope } from "../shared/ipc";
import { normalizeRepoIdentity } from "../shared/repo-identity";
import { decryptSecretEnvelope, isEncryptedSecretEnvelope } from "./secret-envelope";
import { hardenPrivateKeyPermissions } from "./git/private-key-permissions";

/** 저장소 식별자 -> 설치된 개인키 경로. */
export type InstalledCredentialMap = Record<string, string>;

/** 번들에서 특정 저장소(URL)에 해당하는 암호문을 찾습니다. 없으면 null. */
export function findBundleEnvelope(
  bundle: CredentialBundle | undefined,
  repoUrl: string,
): EncryptedCredentialEnvelope | null {
  if (!bundle) return null;
  const identity = normalizeRepoIdentity(repoUrl);
  if (!identity) return null;
  const candidate = bundle[identity];
  return isEncryptedSecretEnvelope(candidate) ? candidate : null;
}

/** 번들에 담긴 저장소 식별자 목록을 반환합니다. */
export function bundleRepoIdentities(bundle: CredentialBundle | undefined): string[] {
  if (!bundle) return [];
  return Object.keys(bundle).filter((key) => isEncryptedSecretEnvelope(bundle[key]));
}

/**
 * 번들의 모든 자격증명을 복호화해 개인키 파일로 설치하고, 식별자별 경로를 돌려줍니다.
 * 일부가 실패해도 나머지는 설치하며, 실패 사유는 warnings 에 담습니다.
 */
export async function installCredentialBundle(args: {
  directory: string;
  licenseKey: string;
  bundle: CredentialBundle;
}): Promise<{ installed: InstalledCredentialMap; warnings: string[] }> {
  const installed: InstalledCredentialMap = {};
  const warnings: string[] = [];
  await mkdir(args.directory, { recursive: true });

  for (const identity of bundleRepoIdentities(args.bundle)) {
    const envelope = args.bundle[identity]!;
    try {
      const contents = decryptSecretEnvelope(args.licenseKey, envelope);
      if (!contents.includes("PRIVATE KEY")) {
        throw new Error("복호화된 값이 SSH 개인키 형식이 아닙니다.");
      }
      const safeName = identity.replace(/[^A-Za-z0-9._-]+/g, "_") || "repo";
      const keyPath = path.join(args.directory, `flowforge_${safeName}`);
      await writeFile(keyPath, contents, { encoding: "utf8", mode: 0o600 });
      // Windows OpenSSH 는 개인키 권한이 열려 있으면 사용을 거부하므로 ACL 을 조입니다.
      await chmod(keyPath, 0o600).catch(() => undefined);
      await hardenPrivateKeyPermissions(keyPath);
      installed[identity] = keyPath;
    } catch (error) {
      warnings.push(identity + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return { installed, warnings };
}

