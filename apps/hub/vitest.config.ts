import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Git 저장소를 만들고 실제 git 프로세스를 실행하는 테스트가 많아,
    // 병렬 실행 시 기본 5초를 넘기는 경우가 있습니다.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

