# KJ FlowForge

Unity Editor, Discord, Notion, GitHub 워크플로를 연결하는 로컬 Electron
데스크톱 앱입니다. 루프백 주소에만 바인딩합니다. `Unity_수집항목_리스트.txt`의
`★★` 및 `★★★` 수집/명령 범위를 구현하며 `★` 항목은 제외합니다.

## Layout

```text
src/
  main/        Electron 메인 프로세스: TCP 서버, HTTP API, 연동, git
  preload/     contextBridge 브리지 (좁고 타입화된 IPC 표면)
  renderer/    대시보드 UI (프레임워크 없는 TypeScript)
  shared/      프로세스 간 공유되는 프로토콜 + IPC 타입
tests/         프로토콜, 프레임 코덱, 워크플로 엔진용 Vitest 스위트
scripts/       esbuild 빌드 스크립트
```

- 메인 → Unity: `127.0.0.1:43101` TCP, 4바이트 big-endian 길이 접두사 + UTF-8 JSON.
- 메인 → 로컬 UI 브리지: `127.0.0.1:43100` HTTP (`/health`, `/api/...`).

## Prerequisites

- Node.js >= 18.18 (Node 20 권장)
- git 제어를 위해 `PATH`에 Git 필요
- `apps/unity-plugin`을 사용하는 Unity 프로젝트 (선택 사항)

## Setup

```bash
npm install
cp .env.example .env   # 선택 사항; 없어도 Unity + 로컬 Git용 허브는 동작합니다
```

허브는 실행마다 세션 시크릿을 생성해 시작 시
`<userData>/runtime/unity-session.json`에 기록합니다. Unity 플러그인은 같은
경로 규칙으로 이 파일을 읽고 `unity.hello` 핸드셰이크에 사용합니다.

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # esbuild -> dist/ (main, preload, renderer)
npm start           # build + launch Electron
npm run dev         # build in watch mode
npm run package:win  # NSIS 설치본 + latest.yml 생성 (release/)
npm run release:prepare  # 버전업 + 서명(설정 시) + 빌드 + 업데이트 저장소 업로드
```

## 자동 업데이트

설치 버전(NSIS)은 시작 시 공개 릴리스 저장소
`KCWJEDI/KJ_FlowForge_Releases`의 `latest.yml`을 읽어 새 버전을 확인하고,
있으면 자동으로 내려받습니다. 내려받은 뒤에는 설정 → **업데이트** 탭에서
**지금 설치하고 재시작**을 누르면 설치 후 앱이 다시 시작됩니다. 새 버전이
있으면 좌측 하단 표시기에 현재 버전과 새 버전이 함께 표시됩니다.

동작 환경과 한계:

- 설치 버전(`KJ-FlowForge-Setup-x.y.z-x64.exe`)에서만 동작합니다. 휴대용(portable)
  실행에서는 자동 업데이트가 지원되지 않으므로 설정 → 업데이트 탭에 안내가 표시됩니다.
- 개발 실행(`npm start`)에서는 업데이트를 확인하지 않습니다.
- 서명하지 않은 빌드도 버전 확인과 다운로드는 되지만, 서명이 없으면 Windows
  SmartScreen 경고가 표시될 수 있습니다.

새 버전 배포 순서:

1. `GH_TOKEN`(또는 `GITHUB_TOKEN`)에 `KJ_FlowForge_Releases` 쓰기 권한을 준비합니다.
2. `npm run release:prepare`를 실행합니다. 패치 버전을 올리고, 서명 설정이 있으면
   서명한 뒤, NSIS 설치본과 `latest.yml`을 릴리스로 업로드합니다.
3. 실행 중인 앱이 다음 확인 주기(시작 후 8초, 이후 6시간마다)에 새 버전을 감지합니다.

## 코드 서명

`package.json`의 `build.win`은 `signAndEditExecutable`이 켜져 있어, 인증서가
설정되면 설치본과 내부 실행 파일에 Authenticode 서명을 적용합니다. 인증서가
없으면 서명을 건너뛰고 빌드는 계속 진행합니다.

인증서는 다음 중 하나로 지정합니다.

- 환경변수: `WIN_CSC_LINK`(또는 `CSC_LINK`)에 `.pfx`/`.p12` 경로,
  `WIN_CSC_KEY_PASSWORD`에 암호.
- 로컬 파일: `config/signing.json`에
  `{ "certificateFile": "C:\\\\keys\\\\flowforge.pfx", "certificatePassword": "..." }`.
  `config/`는 `.gitignore`에 포함되어 커밋되지 않습니다.

인증서 파일과 암호는 절대 저장소에 커밋하지 마세요.

## Environment

`.env.example`을 참고하세요. 모든 외부 연동(Discord, Notion, GitHub)은
선택 사항입니다. 토큰은 Electron 메인 프로세스에서만 읽으며 Unity 플러그인
이나 renderer로 전송되지 않습니다.

| 변수                       | 설명                                  |
| -------------------------- | ------------------------------------ |
| `HUB_HTTP_PORT`            | 로컬 UI/API 브리지 포트 (43100)      |
| `HUB_TCP_PORT`             | Unity TCP 포트 (43101)               |
| `HUB_COMMAND_TIMEOUT_MS`   | 명령별 타임아웃 (30000)              |
| `HUB_MAX_FRAME_BYTES`      | 최대 TCP 프레임 크기 (8 MiB)         |
| `HUB_API_TOKEN`            | 로컬 HTTP API Bearer 토큰            |
| `HUB_GIT_REPOSITORY`       | git 제어에 사용할 기본 저장소         |
| `HUB_DAILY_AUTOMATION_ENABLED` | 매일 08:00 Git/Notion 작업 활성화 |
| `HUB_GIT_BRANCHES`         | 일일 작업에 선택한 브랜치 (쉼표 구분) |
| `DISCORD_BOT_TOKEN`        | Discord 봇 토큰                      |
| `DISCORD_CHANNEL_ID`       | 메시지 전송 기본 Discord 채널        |
| `NOTION_TOKEN`             | Notion 연동 토큰                     |
| `NOTION_DATABASE_ID`       | 작업용 Notion 데이터베이스           |
| `GITHUB_TOKEN`             | GitHub 토큰                          |

## Dashboard

renderer 대시보드(context-isolated, 샌드박스, 좁은 preload IPC)는 다음을
제공합니다:

- **Connections** — 연결된 Unity 에디터 목록과 대상 클라이언트 선택.
- **Unity Commands** — 씬 로드/저장, 플레이 모드 진입/종료, 빌드 실행, 에셋
  새로고침, 스크립트 재컴파일, 스냅샷 수집.
- **Git** — 상태, 충돌, ahead/behind 확인; 브랜치 생성, 전체 스테이징, 커밋,
  push. Git 변경 작업은 허브 프로세스가 소유합니다.
- **08:00 Git 변경 분석 / Notion 일일작업** — 선택한 브랜치의 기존 커밋을
  읽어 마지막 보고 이후의 브랜치, 담당자, 시간, 변경 내용을 날짜별
  `일일작업` 페이지에 등록합니다. 자동 커밋, Push, 체크아웃과 파일 변경은
  수행하지 않습니다. 일일 예약을 활성화하기 전에 **지금 실행**으로 설정을
  검증하세요.
- **Workflows** — 정의 목록, JSON 입력으로 실행, 실행 기록 조회. 실행 결과는
  요청 ID별로 `<userData>/runtime/workflow-runs/`에 영속화됩니다.
- **Integrations & events** — 활성화 상태 표시와 실시간 이벤트 피드.

일일 자동화는 KJ FlowForge가 열려 있는 동안 실행됩니다. 앱이 08:00 이후에
시작되고 해당 로컬 날짜에 성공한 실행 기록이 없으면 catch-up 실행을
수행합니다. 선택한 브랜치는 로컬 브랜치로 존재해야 하지만 체크아웃된 Git
worktree는 필요하지 않습니다. 첫 성공 실행은 현재 HEAD를 기준으로 설정하고
과거 전체 이력을 소급 등록하지 않습니다.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- preload는 좁고 타입화된 메서드가 있는 `window.hub`만 노출합니다.
- TCP는 루프백 클라이언트만 허용하며 실행별 세션 시크릿을 요구합니다.
- 자격 증명은 renderer나 Unity로 프로세스 경계를 넘지 않습니다.

## Testing

```bash
npm test
```

스위트는 프로토콜 봉투 검증, 길이 접두사 프레임 코덱(부분 읽기, 다중 프레임
읽기, 손상된 프레임), 워크플로 엔진(단계 연결, 실행 ID 기준 멱등성, 영속화,
실패 처리)을 다룹니다.
