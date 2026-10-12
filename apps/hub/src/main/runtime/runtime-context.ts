import type { LicenseRole } from "../../shared/ipc";

/**
 * 모듈들이 공유하는 런타임 컨텍스트입니다.
 *
 * role은 실행 중 setRole로 바뀔 수 있으므로 값이 아니라 객체로 공유합니다.
 * (모듈이 생성 시점의 role을 복사해 두면 라이선스 변경이 반영되지 않습니다.)
 */
export interface RuntimeContext {
  role: LicenseRole;
  keyId: string;
}

