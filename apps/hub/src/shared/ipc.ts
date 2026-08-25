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

export interface PendingDailyReportView {
  date: string;
  reportKey: string;
  branches: DailyAutomationBranchResult[];
}

export interface DailyAutomationView {
  enabled: boolean;
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
  pendingReport: PendingDailyReportView | null;
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
  label: string;
  username?: string;
  defaultBranch?: string;
  path: string;
  url: string;
  branches: string[];
  discordMinCommits?: number;
  discordBranches?: string[];
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
  reason?: "missing" | "grace-offline" | "invalid" | "blocked" | undefined;
}

export interface DashboardState {
  startedAt: string;
  config: PublicConfig;
  recentEvents: Array<{ name: string; timestamp: string; summary: string }>;
  dailyAutomation: DailyAutomationView;
}

export interface HubApi {
  getState(): Promise<DashboardState>;
  inspectGit(repository?: string): Promise<GitStatusView>;
  gitCreateBranch(args: { repository?: string; branch: string; startPoint?: string }): Promise<GitStatusView>;
  gitStage(args: { repository?: string; paths: string[] }): Promise<GitStatusView>;
  gitCommit(args: { repository?: string }): Promise<GitChangeSummary>;
  gitPush(args: { repository?: string }): Promise<GitStatusView>;
  getDailyAutomation(): Promise<DailyAutomationView>;
  runDailyAutomation(): Promise<DailyAutomationRunView>;
  chooseGitRepository(): Promise<string | null>;
  listGitRemoteBranches(url: string): Promise<string[]>;
  previewDailyReport(): Promise<DailyAutomationRunView>;
  publishPendingDailyReport(): Promise<DailyAutomationRunView>;
  discardPendingDailyReport(): Promise<void>;
  sendPendingReportToDiscord(): Promise<DailyAutomationRunView>;
  getSettings(): Promise<SettingsView>;
  saveSettings(values: Record<string, string>): Promise<SettingsSaveResult>;
  testIntegrations(): Promise<IntegrationConnectionStatus[]>;
  getLicenseStatus(): Promise<LicenseStatus>;
  activateLicense(key: string): Promise<LicenseStatus>;
  onStateChanged(listener: (state: DashboardState) => void): () => void;
}
