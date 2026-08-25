# Local Unity Workflow Hub

로컬 Electron 앱에서 Unity Editor, Discord, Notion, GitHub 작업을 연결하는
자동화 허브입니다. 현재 범위는 `Unity_수집항목_리스트.txt`의 ★★ 및 ★★★
기능 전체이며 ★ 기능은 제외합니다.

## 구성

- `apps/hub`: Electron + TypeScript 데스크톱 앱
- `apps/unity-plugin`: Unity Editor 전용 TCP 클라이언트 패키지
- `ARCHITECTURE.md`: 포트, TCP 프레임, 책임 경계 및 기능 계약

허브는 `127.0.0.1`에만 바인딩합니다. Unity와의 TCP 통신은 4바이트
big-endian 길이 접두사가 붙은 UTF-8 JSON 메시지를 사용합니다.

## 개발 순서

1. `apps/hub/.env.example`을 참고해 필요한 서비스 토큰을 설정합니다.
2. `apps/hub`에서 의존성을 설치하고 Electron 앱을 실행합니다.
3. `apps/unity-plugin`을 Unity 프로젝트의 `Packages` 아래에 추가합니다.
4. Unity 메뉴에서 Hub 창을 열어 로컬 허브에 연결합니다.

세부 명령은 각 앱 디렉터리의 README를 참고하세요.

## 보안

Discord, Notion, GitHub 자격 증명은 Electron 메인 프로세스에서만 읽습니다.
Unity 플러그인과 Electron renderer에는 외부 서비스 토큰을 전달하지 않습니다.
`.env` 파일은 Git에서 제외됩니다.
