/**
 * SSH 개인키 파일의 권한을 소유자 전용으로 조입니다.
 *
 * Windows OpenSSH 는 개인키에 다른 사용자가 접근할 수 있으면 키 사용을 거부합니다
 * ("Bad permissions / UNPROTECTED PRIVATE KEY FILE"). Node 의 chmod 는 Windows 에서
 * ACL 을 바꾸지 못하므로 icacls 로 상속을 끊고 소유자에게만 권한을 부여해야 합니다.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function hardenPrivateKeyPermissions(keyPath: string): Promise<void> {
  if (process.platform !== "win32") return;
  const user = process.env["USERNAME"] ?? "";
  if (!user) return;
  try {
    // 상속 권한 제거 후 소유자에게만 전체 권한 부여
    await execFileAsync("icacls", [keyPath, "/inheritance:r", "/grant:r", `${user}:F`], { windowsHide: true });
  } catch {
    // 권한 조정 실패는 치명적이지 않습니다. 호출 측에서 키 사용을 시도해 판단합니다.
  }
}

