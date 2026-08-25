# Local Unity Workflow Hub

## Scope

이 저장소는 Unity Editor, Discord, Notion, GitHub를 연결하는 로컬 Electron
데스크톱 애플리케이션입니다. `Unity_수집항목_리스트.txt`에 `★★` 또는 `★★★`
표시된 수집 및 명령 기능만 구현 범위이며, `★` 항목은 첫 구현에서 의도적으로
제외합니다.

## Runtime topology

```text
Electron main process
  - local HTTP API/UI bridge: 127.0.0.1:43100
  - Unity TCP server:         127.0.0.1:43101
  - Discord Gateway client
  - Notion REST client
  - GitHub REST/GraphQL client and local git runner

Unity Editor package
  - TCP client -> 127.0.0.1:43101
  - main-thread editor command dispatcher
  - event collectors and snapshots
```

허브는 루프백 주소에만 바인딩합니다. 클라우드 배포와 외부 LAN 접근은 이
프로젝트의 범위에 포함되지 않습니다.

## TCP protocol

각 메시지는 4바이트 부호 없는 big-endian 페이로드 길이 접두사가 붙은
UTF-8 JSON입니다. JSON 봉투 형식은 다음과 같습니다.

```json
{
  "type": "event|command|response|hello|error",
  "requestId": "uuid",
  "name": "status.snapshot",
  "payload": {},
  "timestamp": "ISO-8601"
}
```

수신 측은 부분 읽기를 버퍼링하고 한 번의 읽기에서 여러 프레임을 처리해야
합니다. UnityEditor API를 호출하는 명령은 대기열에 넣고 Unity 메인 스레드에서
실행합니다. 허브는 `requestId`를 상관 관계 키로 사용하며, Unity가 중단됐다고
가정하지 않고 요청을 타임아웃 처리해야 합니다.

## In-scope Unity collection

- 연결/프로젝트: 프로젝트 경로, Unity 버전, 에디터 상태, 현재 씬, 열린 씬,
  Unity PID, 타깃 플랫폼.
- 빌드: 시작, 진행률, 완료/실패, 전체 로그, 경고/오류 수, 출력 경로, 소요
  시간, 타깃 플랫폼.
- 에디터/플레이: 플레이 모드 전환, 플레이 모드 Console 로그, 씬 로드/언로드,
  플레이 세션 시간.
- 에셋: 임포트 이벤트, 임포트 진행률, 변경된 파일, 새로 추가된 에셋.
- Console: 모든 로그, 오류 및 경고 필터, 스택 트레이스, 타임스탬프,
  `[Hub]` 사용자 지정 채널 처리.
- 컴파일: 시작/완료, 컴파일러 오류, 소요 시간.
- Git 관찰: 변경 파일 목록, 현재 브랜치, 커밋되지 않은 변경 상태, 충돌
  알림. 08:00 일일작업 자동화는 선택 브랜치의 커밋 이력만 읽으며 Git 파일,
  인덱스, 브랜치와 원격 저장소를 변경하지 않습니다.
- 런타임 지표: FPS, 프레임 시간, 메모리 사용량, 씬 로드 시간.
- 작업 메타데이터: 활성 파일, 마지막 저장 시간, 저장되지 않은 변경 상태.

## In-scope hub commands

씬 로드, 플레이 모드 진입/종료, 빌드 실행, 에셋 강제 새로고침, 스크립트
컴파일 요청, 활성 씬 저장, 새 스냅샷 수집을 지원합니다.

## Workflow rules

워크플로는 명시적이며 요청 ID별로 영속화되고 단계 기반으로 동작합니다. 한
단계가 타입화된 결과를 반환해야 다음 단계가 시작됩니다. 외부 부수 효과는
가능한 한 멱등성이어야 합니다. 자격 증명은 Electron 메인 프로세스에만
있으며 Unity 플러그인이나 renderer로 전송되지 않습니다.

## Security and safety

첫 버전은 로컬 전용이지만 Unity hello 핸드셰이크를 위해 실행마다 무작위
세션 시크릿을 사용합니다. Discord, Notion, GitHub 토큰은 허브의
환경/설정 저장소에서 읽습니다. Renderer IPC는 원시 Node 또는 파일시스템
접근 대신 좁은 명령만 노출해야 합니다.
