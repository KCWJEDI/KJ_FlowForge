export type LicenseRole = "admin" | "user";

export interface PublicConfig {
  httpPort: number;
  tcpPort: number;
  commandTimeoutMs: number;
  repositories: GitRepositorySetting[];
  secretFile: string;
  integrations: {
    discord: boolean;
    notion: boolean;
    github: boolean;
    gemini: boolean;
  };
}

export interface GitStatusView {
  repository: string;
  branch: string;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: Array<{ path: string; indexStatus: string; workTreeStatus: string }>;
  conflicts: string[];
  clean: boolean;
}

export interface GitCardSelection {
  id: string;
  path: string;
  workBranches: string[];
  activeBranches: string[];
  /** 이 카드(패널)에서 "저장소 폴더 선택"으로 직접 지정한 로컬 Git 폴더. */
  localPath?: string;
}

export interface GitSelectionState {
  workBranchesByProject: Record<string, string[]>;
  activeBranchesByProject: Record<string, string[]>;
  cardsByProject: Record<string, GitCardSelection[]>;
  selectedProject: string;
  connectedPaths: string[];
  projectConnectPaths: Record<string, string>;
  projectConnectMessages: Record<string, string>;
  projectConnectPath: string;
  projectConnectMessage: string;
}

export interface DailyAutomationBranchResult {
  repositoryLabel?: string;
  branch: string;
  status: "succeeded" | "failed";
  phase: "captured" | "analyzed" | "reported" | "failed";
  attempts: number;
  fromHead?: string;
  toHead?: string;
  reportPageId?: string;
  reported: boolean;
  commitCount: number;
  message: string;
}

export interface DailyAutomationRunView {
  id: string;
  startedAt: string;
  completedAt?: string;
  trigger: "scheduled" | "catch-up" | "manual";
  scheduledSlot?: string;
  status: "running" | "succeeded" | "partial" | "failed";
  branches: DailyAutomationBranchResult[];
  error?: string;
}

export interface ManualDailyReportBranchResult {
  repositoryLabel: string;
  branch: string;
  status: "succeeded" | "failed";
  commitCount: number;
  message: string;
  notionPageId?: string;
  reported?: boolean;
}

export interface ManualDailyReportInput {
  /** 보고 날짜(YYYY-MM-DD) */
  date: string;
  /** 비교 시작 임계(포함), 예: 전날 08시 ISO 문자열 */
  sinceIso: string;
  /** 비교 종료 임계(미포함), 예: 당일 08시 ISO 문자열 */
  untilIso: string;
  /** 처리할 저장소 경로 목록 */
  repositories: string[];
  /** 처리할 작업 브랜치 목록 */
  branches: string[];
}

export interface ManualDailyReportResult {
  date: string;
  branches: ManualDailyReportBranchResult[];
  discordError?: string;
}

export interface DailyAutomationView {
  enabled: boolean;
  selectedProjects: string[];
  repositories: Array<{
    label: string;
    username?: string;
    defaultBranch?: string;
    path: string | null;
    url: string;
    repositoryError: string | null;
    selectedBranches: string[];
    availableBranches: string[];
    discordMinCommits: number;
    discordBranches: string[];
  }>;
  nextRunAt: string | null;
  lastRun: DailyAutomationRunView | null;
  running: boolean;
}

export interface NotionRepositoryView {
  path: string;
  project: string;
  label: string;
  username: string;
  databaseId: string;
  testState: "untested" | "testing" | "connected" | "error";
  testMessage: string;
}

export interface RepositoryConnectionCheck {
  /** 저장소 경로 (저장소별 Notion DB / Discord 채널 용) */
  repository: string;
  integration: "notion" | "discord";
  /** 대상 식별자 (Notion DB ID 또는 Discord 채널 ID) */
  targetId: string;
  state: "untested" | "testing" | "connected" | "error";
  message: string;
}

export interface GitChangeSummary {
  oldHead: string | null;
  newHead: string;
  message: string;
  changedFiles: number;
  insertions: number;
  deletions: number;
}

export interface GitPullResult {
  repository: string;
  branch: string;
  /** 원격에서 새 커밋을 가져와 HEAD가 전진했으면 true. */
  updated: boolean;
  oldHead: string | null;
  newHead: string | null;
  /** 이번에 가져온 커밋 수. */
  commits: number;
  status: GitStatusView;
}

export interface GitRepositorySetting {
  project?: string;
  label: string;
  username?: string;
  defaultBranch?: string;
  path: string;
  url: string;
  branches: string[];
  discordMinCommits?: number;
  discordBranches?: string[];
  notionDatabaseId?: string;
  discordChannelId?: string;
  notionToken?: string;
}

export interface ProjectDefinition {
  id: string;
  name: string;
  url: string;
  allowedBranches?: string[];
  /** 유저(keyId)별 허용 브랜치. 해당 유저는 여기 지정된 브랜치만 사용 가능. */
  userBranches?: Record<string, string[]>;
  notionDatabaseId?: string;
  discordChannelId?: string;
  gitOwner?: string;
  gitRepo?: string;
}

/** 관리자가 라이선스 키로 암호화해 배포하는 Git 자격증명 봉투입니다. */
export interface EncryptedCredentialEnvelope {
  v: number;
  alg: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
  mac: string;
}

/**
 * 저장소 식별자(normalizeRepoIdentity 결과)별로 암호화된 자격증명 묶음입니다.
 *
 * 라이선스 저장소에 저장되어, 팀원이 라이선스 키만으로 자기 SSH 키를 받아
 * 비공개 config/프로젝트 저장소에 접근할 수 있게 합니다(닭-달걀 해소).
 * 암호문이므로 라이선스 저장소가 공개여도 개인키 평문은 노출되지 않습니다.
 */
export type CredentialBundle = Record<string, EncryptedCredentialEnvelope>;
export interface ProjectView {
  id: string;
  name: string;
  url: string;
  allowedBranches: string[];
  branchRestricted: boolean;
  repository: GitRepositorySetting | null;
  selectableBranches: string[];
}

export interface GitCloneResult {
  path: string;
  url: string;
  identity: string;
}

export interface GitConnectResult {
  path: string;
  url: string;
  identity: string;
}

export interface GitConnectOrCloneResult {
  action: "clone" | "connect";
  path: string;
  url: string;
  identity: string;
}

export interface SettingFieldView {
  key: string;
  label: string;
  group: string;
  kind: "text" | "secret" | "number" | "path";
  hint?: string;
  /** 관리자(admin) 전용 필드인지 여부. 일반 사용자에게는 이 필드가 노출되지 않습니다. */
  adminOnly?: boolean;
  value: string;
  configured: boolean;
}

export interface SettingsView {
  envFile: string;
  fields: SettingFieldView[];
}

export interface IntegrationConnectionStatus {
  integration: "discord" | "notion" | "github";
  state: "connected" | "disconnected" | "error" | "not-configured";
  message: string;
  checkedAt: string;
}

export interface SettingsSaveResult {
  settings: SettingsView;
  statuses: IntegrationConnectionStatus[];
  restartRequired: boolean;
  message: string;
}

export interface LicenseStatus {
  activated: boolean;
  keyId?: string;
  owner?: string;
  expiresAt?: string;
  role?: LicenseRole;
  reason?: "missing" | "grace-offline" | "invalid" | "blocked" | undefined;
}

export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  message: string;
  /** 오류 원문(진단용). renderer에는 상세 영역에만 표시합니다. */
  detail?: string;
  progress?: UpdateProgress;
  checkedAt?: string;
  manualDownloadUrl: string;
}

export interface DashboardState {
  startedAt: string;
  config: PublicConfig;
  role: LicenseRole;
  recentEvents: Array<{ name: string; timestamp: string; summary: string }>;
  dailyAutomation: DailyAutomationView;
}

export interface HubApi {
  getState(): Promise<DashboardState>;
  inspectGit(repository?: string): Promise<GitStatusView>;
  listGitBranches(repository?: string): Promise<string[]>;
  /** 연결된 폴더의 변경 감시를 시작합니다(자동 새로고침용). */
  watchRepository(directory: string): Promise<boolean>;
  /** 연결된 폴더의 변경 감시를 중단합니다. */
  unwatchRepository(directory: string): Promise<boolean>;
  switchGitBranch(args: { repository?: string; branch: string }): Promise<GitStatusView>;
  gitCreateBranch(args: { repository?: string; branch: string; startPoint?: string }): Promise<GitStatusView>;
  gitStage(args: { repository?: string; paths: string[] }): Promise<GitStatusView>;
  /** 폐기 대상 미리보기: 바뀐 파일 수와 새로 만든 파일 목록. */
  gitDiscardPreview(repository?: string): Promise<{ changedFiles: number; untrackedFiles: string[] }>;
  /** 변경사항을 폐기합니다(includeUntracked 시 새 파일도 삭제). */
  gitDiscard(args: { repository?: string; includeUntracked?: boolean }): Promise<GitStatusView>;
  gitCommit(args: { repository?: string }): Promise<GitChangeSummary>;
  gitPush(args: { repository?: string }): Promise<GitStatusView>;
  gitPushBranch(args: { repository?: string; branch: string; remote?: string }): Promise<GitStatusView>;
  /** 선택한 브랜치로 원격(main 등)의 최신 커밋을 가져옵니다(Pull). */
  gitPull(args: { repository?: string; branch: string; remote?: string }): Promise<GitPullResult>;
  getProjects(): Promise<ProjectView[]>;
  cloneGitRepository(args: { url: string; directory: string }): Promise<GitCloneResult>;
  connectGitRepository(args: { directory: string }): Promise<GitConnectResult>;
  connectOrCloneGitRepository(args: { url: string; directory: string }): Promise<GitConnectOrCloneResult>;
  getDailyAutomation(): Promise<DailyAutomationView>;
  runDailyAutomation(): Promise<DailyAutomationRunView>;
  reportManualDailyReport(args: ManualDailyReportInput): Promise<ManualDailyReportResult>;
  chooseGitRepository(): Promise<string | null>;
  listGitRemoteBranches(url: string): Promise<string[]>;
  getSettings(): Promise<SettingsView>;
  saveSettings(values: Record<string, string>): Promise<SettingsSaveResult>;
  getGitSelection(): Promise<GitSelectionState>;
  saveGitSelection(state: GitSelectionState): Promise<GitSelectionState>;
  testIntegrations(): Promise<IntegrationConnectionStatus[]>;
  testNotionDatabase(args: { repository?: string; databaseId: string; token?: string }): Promise<{ ok: boolean; message: string }>;
  testDiscordChannel(args: { repository?: string; channelId: string }): Promise<{ ok: boolean; message: string }>;
  /** 앱 시작/설정 변경 시 저장소별 Notion DB·Discord 채널 연결 상태를 배치로 확인합니다. */
  checkRepositoryConnections(): Promise<RepositoryConnectionCheck[]>;
  getLicenseStatus(): Promise<LicenseStatus>;
  activateLicense(key: string): Promise<LicenseStatus>;
  replaceLicense(key: string): Promise<LicenseStatus>;
  /** 현재 앱 버전과 자동 업데이트 상태를 가져옵니다. */
  getUpdateStatus(): Promise<UpdateStatus>;
  /** 자동 업데이트를 지금 확인합니다. */
  checkForUpdates(): Promise<UpdateStatus>;
  /** 내려받은 업데이트를 설치하고 앱을 다시 시작합니다. */
  installUpdate(): Promise<boolean>;
  /** 업데이트 상태 변경 구독(확인/다운로드/완료/오류). */
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  onStateChanged(listener: (state: DashboardState) => void): () => void;
  /** 연결된 폴더가 변경되면 호출됩니다. */
  onRepositoryChanged(listener: (repository: string) => void): () => void;
}
