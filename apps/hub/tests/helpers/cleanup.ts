/**
 * 테스트용 임시 폴더 정리 헬퍼입니다.
 *
 * Windows 에서는 git 프로세스나 파일 감시가 아직 핸들을 놓지 않아,
 * rm 이 EBUSY/EPERM 으로 실패하는 경우가 있습니다.
 * 짧게 재시도해 간헐적 실패(flaky)를 막습니다.
 */
import { rm } from "node:fs/promises";

export async function removeDirSafely(directory: string | null | undefined): Promise<void> {
  if (!directory) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows 파일 잠김은 곧 풀리므로 잠시 기다렸다 다시 시도합니다.
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  // 마지막 시도까지 실패하면 조용히 넘깁니다(테스트 결과에 영향 없도록).
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

