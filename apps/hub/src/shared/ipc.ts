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

export interface GitChangeSummary {
  oldHead: string | null;
  newHead: string;
  message: string;
  changedFiles: number;
  insertions: number;
  deletions: number;
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
}

export interface SettingFieldView {
  key: string;
  label: string;
  group: string;
  kind: "text" | "secret" | "number" | "path";
  hint?: string;
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
  switchGitBranch(args: { repository?: string; branch: string }): Promise<GitStatusView>;
  gitCreateBranch(args: { repository?: string; branch: string; startPoint?: string }): Promise<GitStatusView>;
  gitStage(args: { repository?: string; paths: string[] }): Promise<GitStatusView>;
  gitCommit(args: { repository?: string }): Promise<GitChangeSummary>;
  gitPush(args: { repository?: string }): Promise<GitStatusView>;
  gitPushBranch(args: { repository?: string; branch: string; remote?: string }): Promise<GitStatusView>;
  getDailyAutomation(): Promise<DailyAutomationView>;
  runDailyAutomation(): Promise<DailyAutomationRunView>;
  reportManualDailyReport(args: ManualDailyReportInput): Promise<ManualDailyReportResult>;
  chooseGitRepository(): Promise<string | null>;
  listGitRemoteBranches(url: string): Promise<string[]>;
  getSettings(): Promise<SettingsView>;
  saveSettings(values: Record<string, string>): Promise<SettingsSaveResult>;
  testIntegrations(): Promise<IntegrationConnectionStatus[]>;
  testNotionDatabase(args: { repository?: string; databaseId: string }): Promise<{ ok: boolean; message: string }>;
  testDiscordChannel(args: { repository?: string; channelId: string }): Promise<{ ok: boolean; message: string }>;
  getLicenseStatus(): Promise<LicenseStatus>;
  activateLicense(key: string): Promise<LicenseStatus>;
  replaceLicense(key: string): Promise<LicenseStatus>;
  onStateChanged(listener: (state: DashboardState) => void): () => void;
}
