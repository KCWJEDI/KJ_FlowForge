import type {
  DailyAutomationView,
  DashboardState,
  GitRepositorySetting,
  ProjectView,
  GitStatusView,
  IntegrationConnectionStatus,
  RepositoryConnectionCheck,
  SettingsSaveResult,
  SettingsView,
  SettingFieldView,
  UpdateStatus,
  KanbanBoard,
} from "../shared/ipc";
import { isSameRepository } from "../shared/repo-identity";
import { filterBranchesByAllowed } from "../shared/branch-selection";
import { isProtectedBranch } from "../shared/branch-policy";
import { assignmentsChanged } from "../shared/assignment-fingerprint";

export interface HubSettingsApi {
  getSettings(): Promise<SettingsView>;
  saveSettings(values: Record<string, string>): Promise<SettingsSaveResult>;
  testIntegrations(): Promise<IntegrationConnectionStatus[]>;
}

function required<T>(element: HTMLElement | null, label: string): T {
  if (!element) throw new Error(`Missing DOM element '${label}'`);
  return element as T;
}

const $ = {
  headerMeta: required<HTMLElement>(document.getElementById("header-meta"), "header-meta"),
  pageTitle: required<HTMLElement>(document.getElementById("page-title"), "page-title"),
  integrationDots: required<HTMLElement>(document.getElementById("integration-dots"), "integration-dots"),
  integrationStatuses: document.createElement("div"),
  refreshState: required<HTMLButtonElement>(document.getElementById("refresh-state"), "refresh-state"),
  themeToggle: required<HTMLButtonElement>(document.getElementById("theme-toggle"), "theme-toggle"),
  gitRefresh: required<HTMLButtonElement>(document.getElementById("git-refresh"), "git-refresh"),
  gitCurrentBranch: required<HTMLElement>(document.getElementById("git-current-branch"), "git-current-branch"),
  gitRepositoryPath: required<HTMLElement>(document.getElementById("git-repository-path"), "git-repository-path"),
  gitBranches: required<HTMLElement>(document.getElementById("git-branches"), "git-branches"),
  gitSummary: required<HTMLElement>(document.getElementById("git-summary"), "git-summary"),
  gitConflicts: required<HTMLElement>(document.getElementById("git-conflicts"), "git-conflicts"),
  gitFiles: required<HTMLTableElement>(document.getElementById("git-files"), "git-files"),
  gitCommit: required<HTMLButtonElement>(document.getElementById("git-commit"), "git-commit"),
  gitPush: required<HTMLButtonElement>(document.getElementById("git-push"), "git-push"),
  gitPull: required<HTMLButtonElement>(document.getElementById("git-pull"), "git-pull"),
  gitDiscard: required<HTMLButtonElement>(document.getElementById("git-discard"), "git-discard"),
  gitDailyReport: required<HTMLButtonElement>(document.getElementById("git-daily-report"), "git-daily-report"),
  gitError: required<HTMLElement>(document.getElementById("git-error"), "git-error"),
  statusBar: required<HTMLElement>(document.getElementById("status-bar-text"), "status-bar-text"),
  automationSection: required<HTMLElement>(document.getElementById("automation-section"), "automation-section"),
  mainTabDashboard: required<HTMLButtonElement>(document.getElementById("tab-dashboard"), "tab-dashboard"),
  mainTabAutomation: required<HTMLButtonElement>(document.getElementById("tab-automation"), "tab-automation"),
  mainTabSettings: required<HTMLButtonElement>(document.getElementById("tab-settings"), "tab-settings"),
  mainTabKanban: required<HTMLButtonElement>(document.getElementById("tab-kanban"), "tab-kanban"),
  panelDashboard: required<HTMLElement>(document.getElementById("panel-dashboard"), "panel-dashboard"),
  panelAutomation: required<HTMLElement>(document.getElementById("panel-automation"), "panel-automation"),
  panelKanban: required<HTMLElement>(document.getElementById("panel-kanban"), "panel-kanban"),
  panelSettings: required<HTMLElement>(document.getElementById("panel-settings"), "panel-settings"),
  kanbanBoardTitle: required<HTMLElement>(document.getElementById("kanban-board-title"), "kanban-board-title"),
  kanbanBoardMeta: required<HTMLElement>(document.getElementById("kanban-board-meta"), "kanban-board-meta"),
  kanbanBoard: required<HTMLElement>(document.getElementById("kanban-board"), "kanban-board"),
  kanbanNewTitle: required<HTMLInputElement>(document.getElementById("kanban-new-title"), "kanban-new-title"),
  kanbanAdd: required<HTMLButtonElement>(document.getElementById("kanban-add"), "kanban-add"),
  kanbanRefresh: required<HTMLButtonElement>(document.getElementById("kanban-refresh"), "kanban-refresh"),
  kanbanMessage: required<HTMLElement>(document.getElementById("kanban-message"), "kanban-message"),
  kanbanDbUrl: required<HTMLInputElement>(document.getElementById("kanban-db-url"), "kanban-db-url"),
  kanbanDbApply: required<HTMLButtonElement>(document.getElementById("kanban-db-apply"), "kanban-db-apply"),
  dashboardProject: required<HTMLSelectElement>(document.getElementById("dashboard-project"), "dashboard-project"),
  dashboardProjectRenameInput: required<HTMLInputElement>(document.getElementById("dashboard-project-rename-input"), "dashboard-project-rename-input"),
  dashboardProjectRename: required<HTMLButtonElement>(document.getElementById("dashboard-project-rename"), "dashboard-project-rename"),
  dashboardAddCard: required<HTMLButtonElement>(document.getElementById("dashboard-add-card"), "dashboard-add-card"),
  gitConnect: required<HTMLElement>(document.getElementById("git-connect"), "git-connect"),
  gitConnectChoose: required<HTMLButtonElement>(document.getElementById("git-connect-choose"), "git-connect-choose"),
  gitConnectMessage: required<HTMLElement>(document.getElementById("git-connect-message"), "git-connect-message"),
  settingsTabEnv: required<HTMLButtonElement>(document.getElementById("settings-tab-env"), "settings-tab-env"),
  settingsTabGit: required<HTMLButtonElement>(document.getElementById("settings-tab-git"), "settings-tab-git"),
  settingsTabNotion: required<HTMLButtonElement>(document.getElementById("settings-tab-notion"), "settings-tab-notion"),
  settingsTabLicense: required<HTMLButtonElement>(document.getElementById("settings-tab-license"), "settings-tab-license"),
  settingsTabGitAccess: required<HTMLButtonElement>(document.getElementById("settings-tab-gitaccess"), "settings-tab-gitaccess"),
  settingsPaneGitAccess: required<HTMLElement>(document.getElementById("settings-pane-gitaccess"), "settings-pane-gitaccess"),
  settingsGitAccessGroup: required<HTMLElement>(document.getElementById("settings-gitaccess-group"), "settings-gitaccess-group"),
  settingsGitAccessSave: required<HTMLButtonElement>(document.getElementById("settings-gitaccess-save"), "settings-gitaccess-save"),
  settingsGitAccessMessage: required<HTMLElement>(document.getElementById("settings-gitaccess-message"), "settings-gitaccess-message"),
  settingsPaneEnv: required<HTMLElement>(document.getElementById("settings-pane-env"), "settings-pane-env"),
  settingsPaneGit: required<HTMLElement>(document.getElementById("settings-pane-git"), "settings-pane-git"),
  settingsPaneNotion: required<HTMLElement>(document.getElementById("settings-pane-notion"), "settings-pane-notion"),
  settingsPaneLicense: required<HTMLElement>(document.getElementById("settings-pane-license"), "settings-pane-license"),
  settingsTabApikey: required<HTMLButtonElement>(document.getElementById("settings-tab-apikey"), "settings-tab-apikey"),
  settingsPaneApikey: required<HTMLElement>(document.getElementById("settings-pane-apikey"), "settings-pane-apikey"),
  settingsApikeyGroup: required<HTMLElement>(document.getElementById("settings-apikey-group"), "settings-apikey-group"),
  settingsApikeySave: required<HTMLButtonElement>(document.getElementById("settings-apikey-save"), "settings-apikey-save"),
  settingsApikeyMessage: required<HTMLElement>(document.getElementById("settings-apikey-message"), "settings-apikey-message"),
  settingsLicenseKey: required<HTMLInputElement>(document.getElementById("settings-license-key"), "settings-license-key"),
  settingsLicenseChange: required<HTMLButtonElement>(document.getElementById("settings-license-change"), "settings-license-change"),
  settingsLicenseMessage: required<HTMLElement>(document.getElementById("settings-license-message"), "settings-license-message"),
  settingsTabUpdate: required<HTMLButtonElement>(document.getElementById("settings-tab-update"), "settings-tab-update"),
  settingsPaneUpdate: required<HTMLElement>(document.getElementById("settings-pane-update"), "settings-pane-update"),
  updateIndicator: required<HTMLButtonElement>(document.getElementById("update-indicator"), "update-indicator"),
  updateIndicatorText: required<HTMLElement>(document.getElementById("update-indicator-text"), "update-indicator-text"),
  updateCurrentVersion: required<HTMLElement>(document.getElementById("update-current-version"), "update-current-version"),
  updatePhasePill: required<HTMLElement>(document.getElementById("update-phase-pill"), "update-phase-pill"),
  updateLatest: required<HTMLElement>(document.getElementById("update-latest"), "update-latest"),
  updateProgressWrap: required<HTMLElement>(document.getElementById("update-progress-wrap"), "update-progress-wrap"),
  updateProgressBar: required<HTMLElement>(document.getElementById("update-progress-bar"), "update-progress-bar"),
  updateProgressText: required<HTMLElement>(document.getElementById("update-progress-text"), "update-progress-text"),
  updateNotesWrap: required<HTMLElement>(document.getElementById("update-notes-wrap"), "update-notes-wrap"),
  updateNotes: required<HTMLElement>(document.getElementById("update-notes"), "update-notes"),
  updateCheck: required<HTMLButtonElement>(document.getElementById("update-check"), "update-check"),
  updateInstall: required<HTMLButtonElement>(document.getElementById("update-install"), "update-install"),
  updateManual: required<HTMLButtonElement>(document.getElementById("update-manual"), "update-manual"),
  updateMessage: required<HTMLElement>(document.getElementById("update-message"), "update-message"),
  updateDetail: required<HTMLElement>(document.getElementById("update-detail"), "update-detail"),
  settingsApiMissing: required<HTMLElement>(document.getElementById("settings-api-missing"), "settings-api-missing"),
  settingsForm: required<HTMLFormElement>(document.getElementById("settings-form"), "settings-form"),
  settingsGroups: required<HTMLElement>(document.getElementById("settings-groups"), "settings-groups"),
  settingsAutoSave: required<HTMLInputElement>(document.getElementById("settings-auto-save"), "settings-auto-save"),
  settingsSave: required<HTMLButtonElement>(document.getElementById("settings-save"), "settings-save"),
  settingsTest: required<HTMLButtonElement>(document.getElementById("settings-test"), "settings-test"),
  settingsRestart: required<HTMLElement>(document.getElementById("settings-restart"), "settings-restart"),
  settingsMessage: required<HTMLElement>(document.getElementById("settings-message"), "settings-message"),
  settingsRepositories: required<HTMLElement>(document.getElementById("settings-repositories"), "settings-repositories"),
  settingsRepositoryAdd: required<HTMLButtonElement>(document.getElementById("settings-repository-add"), "settings-repository-add"),
  settingsRepositoriesSave: required<HTMLButtonElement>(document.getElementById("settings-repositories-save"), "settings-repositories-save"),
  settingsRepositoriesMessage: required<HTMLElement>(document.getElementById("settings-repositories-message"), "settings-repositories-message"),
  settingsNotionRepositories: required<HTMLElement>(document.getElementById("settings-notion-repositories"), "settings-notion-repositories"),
  settingsNotionSave: required<HTMLButtonElement>(document.getElementById("settings-notion-save"), "settings-notion-save"),
  settingsNotionMessage: required<HTMLElement>(document.getElementById("settings-notion-message"), "settings-notion-message"),
  settingsTabDiscord: required<HTMLButtonElement>(document.getElementById("settings-tab-discord"), "settings-tab-discord"),
  settingsPaneDiscord: required<HTMLElement>(document.getElementById("settings-pane-discord"), "settings-pane-discord"),
  settingsDiscordRepositories: required<HTMLElement>(document.getElementById("settings-discord-repositories"), "settings-discord-repositories"),
  settingsDiscordSave: required<HTMLButtonElement>(document.getElementById("settings-discord-save"), "settings-discord-save"),
  settingsDiscordMessage: required<HTMLElement>(document.getElementById("settings-discord-message"), "settings-discord-message"),
  automationState: required<HTMLElement>(document.getElementById("automation-state"), "automation-state"),
  automationEnabled: required<HTMLInputElement>(document.getElementById("automation-enabled"), "automation-enabled"),
  automationProjects: required<HTMLElement>(document.getElementById("automation-projects"), "automation-projects"),
  automationSave: required<HTMLButtonElement>(document.getElementById("automation-save"), "automation-save"),
  automationRun: required<HTMLButtonElement>(document.getElementById("automation-run"), "automation-run"),
  automationNext: required<HTMLElement>(document.getElementById("automation-next"), "automation-next"),
  automationLastRun: required<HTMLElement>(document.getElementById("automation-last-run"), "automation-last-run"),
  automationMessageText: required<HTMLElement>(document.getElementById("automation-message-text"), "automation-message-text"),
}; 

/** 현재 네온이 켜져 있는 Git 커밋/푸시 카드 (포커스가 어디에도 없으면 마지막 포커싱된 카드 유지). */
let neonFocusedCard: HTMLElement | null = null;

function trackCardFocus(card: HTMLElement): void {
  const engage = (): void => {
    if (neonFocusedCard && neonFocusedCard !== card) neonFocusedCard.classList.remove("neon");
    neonFocusedCard = card;
    card.classList.add("neon");
  };
  card.addEventListener("focusin", engage);
  // 카드 내부 어디를 클릭/누르더라도 포커스가 잡히게 한다.
  card.addEventListener("mousedown", engage);
  card.addEventListener("pointerdown", engage);
}

const state: {
  dashboard: DashboardState | null;
  git: GitStatusView | null;
  gitBusy: boolean;
  /** 메인 카드가 현재 사용하는 저장소 폴더 경로(표시 + 작업 대상). */
  gitRepositoryPath: string;
  gitBranches: string[];
  gitWorkBranches: string[];
  gitWorkBranchesProject: string;
  gitWorkBranchesByProject: Record<string, string[]>;
  gitActiveBranches: string[];
  gitActiveBranchesByProject: Record<string, string[]>;
  gitCardsByProject: Record<string, Array<{ id: string; path: string; localPath?: string; workBranches: string[]; activeBranches: string[] }>>;
  lastSelectedProject: string;
  projects: ProjectView[];
  connectedPaths: string[];
  projectConnectPaths: Record<string, string>;
  projectConnectMessages: Record<string, string>;
  projectConnectPath: string;
  projectConnectMessage: string;
  settings: SettingsView | null;
  settingsStatuses: IntegrationConnectionStatus[];
  settingsBusy: boolean;
  settingsDrafts: Record<string, string>;
  autoSaveTimer: number | undefined;
  automationBusy: boolean;
  licenseOwner: string;
  repositoryDrafts: GitRepositorySetting[];
  repositoryCollapsed: Record<number, boolean>;
  notionRepositories: GitRepositorySetting[];
  notionCollapsed: Record<number, boolean>;
  notionTestStates: Record<number, { state: "untested" | "testing" | "connected" | "error"; message: string }>;
  discordRepositories: GitRepositorySetting[];
  discordCollapsed: Record<number, boolean>;
  discordTestStates: Record<number, { state: "untested" | "testing" | "connected" | "error"; message: string }>;
  update: UpdateStatus | null;
  kanban: KanbanBoard | null;
  kanbanBusy: boolean;
} = {
  dashboard: null,
  git: null,
  gitBusy: false,
  gitRepositoryPath: "",
  gitBranches: [],
  gitWorkBranches: [],
  gitWorkBranchesProject: "",
  gitWorkBranchesByProject: {},
  gitActiveBranches: [],
  gitActiveBranchesByProject: {},
  gitCardsByProject: {},
  lastSelectedProject: "",
  projects: [],
  connectedPaths: [],
  projectConnectPaths: {},
  projectConnectMessages: {},
  projectConnectPath: "",
  projectConnectMessage: "",
  settings: null,
  settingsStatuses: [],
  settingsBusy: false,
  settingsDrafts: {},
  autoSaveTimer: undefined,
  automationBusy: false,
  licenseOwner: "",
  repositoryDrafts: [],
  repositoryCollapsed: {},
  notionRepositories: [],
  notionCollapsed: {},
  notionTestStates: {},
  discordRepositories: [],
  discordCollapsed: {},
  discordTestStates: {},
  update: null,
  kanban: null,
  kanbanBusy: false,
};

function setStatus(message: string): void {
  $.statusBar.textContent = message;
}

function applyTheme(theme: "dark" | "light"): void {
  document.body.classList.toggle("theme-light", theme === "light");
  $.themeToggle.textContent = theme === "dark" ? "라이트 모드" : "다크 모드";
  $.themeToggle.setAttribute("aria-label", theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환");
  localStorage.setItem("kj-flowforge-theme", theme);
}

function initializeTheme(): void {
  applyTheme(localStorage.getItem("kj-flowforge-theme") === "light" ? "light" : "dark");
}


function integrationDotMeta(
  key: IntegrationConnectionStatus["integration"],
): { className: string; title: string } {
  const label = INTEGRATION_LABELS[key];
  const status = state.settingsStatuses.find((entry) => entry.integration === key);
  if (status) {
    const stateLabel = INTEGRATION_STATE_LABELS[status.state] ?? status.state;
    const detail = status.message ? ` — ${status.message}` : "";
    const checked = status.checkedAt ? ` (${formatTime(status.checkedAt)})` : "";
    const title = `${label}: ${stateLabel}${detail}${checked}`;
    switch (status.state) {
      case "connected":
        return { className: "on", title };
      case "error":
        return { className: "error", title };
      case "disconnected":
        return { className: "warn", title };
      case "not-configured":
        return { className: "off", title };
    }
  }
  return { className: "off", title: `${label}: 확인 전 — 연결 상태 탭에서 테스트를 실행하세요.` };
}

function notionDotMeta(): { className: string; title: string } {
  const repos = state.notionRepositories;
  if (repos.length === 0) return { className: "off", title: "Notion: 등록된 저장소 없음" };
  const tests = state.notionTestStates;
  let connected = 0;
  let error = 0;
  let testing = 0;
  for (let index = 0; index < repos.length; index += 1) {
    const test = tests[index];
    const hasDbId = Boolean(repos[index]?.notionDatabaseId?.trim());
    if (!hasDbId || !test || test.state === "untested") continue;
    if (test.state === "connected") connected += 1;
    else if (test.state === "error") error += 1;
    else if (test.state === "testing") testing += 1;
  }
  if (testing > 0) return { className: "off", title: "Notion: 연결 테스트 진행 중…" };
  if (connected === 0 && error === 0) return { className: "off", title: "Notion: 확인 전 — 저장소별 DB 연결 테스트를 실행하세요." };
  if (error === 0) return { className: "on", title: "Notion: 모든 저장소 연결 성공 (" + connected + "개)" };
  if (connected > 0) return { className: "warn", title: "Notion: 일부 연결 실패 (성공 " + connected + "개 / 실패 " + error + "개)" };
  return { className: "error", title: "Notion: 모든 저장소 연결 실패 (" + error + "개)" };
}

function discordDotMeta(): { className: string; title: string } {
  const repos = state.discordRepositories;
  if (repos.length === 0) return { className: "off", title: "Discord: 등록된 저장소 없음" };
  const tests = state.discordTestStates;
  let connected = 0;
  let error = 0;
  let testing = 0;
  for (let index = 0; index < repos.length; index += 1) {
    const test = tests[index];
    const hasChannelId = Boolean(repos[index]?.discordChannelId?.trim());
    if (!hasChannelId || !test || test.state === "untested") continue;
    if (test.state === "connected") connected += 1;
    else if (test.state === "error") error += 1;
    else if (test.state === "testing") testing += 1;
  }
  if (testing > 0) return { className: "off", title: "Discord: 연결 테스트 진행 중…" };
  if (connected === 0 && error === 0) return { className: "off", title: "Discord: 확인 전 — 저장소별 채널 연결 테스트를 실행하세요." };
  if (error === 0) return { className: "on", title: "Discord: 모든 저장소 연결 성공 (" + connected + "개)" };
  if (connected > 0) return { className: "warn", title: "Discord: 일부 연결 실패 (성공 " + connected + "개 / 실패 " + error + "개)" };
  return { className: "error", title: "Discord: 모든 저장소 연결 실패 (" + error + "개)" };
}

function renderHeader(dashboard: DashboardState): void {
  // 좌측 브랜드 옆에 현재 연결된 라이선스 사용자를 작게 표시합니다.
  $.headerMeta.textContent = state.licenseOwner?.trim()
    ? ` · ${state.licenseOwner.trim()}`
    : "";
  // 관리자(admin)는 Discord/Notion/GitHub 모두 표시하고, 일반 사용자는 GitHub 연결 상태만 표시합니다.
  const isHeaderAdmin = dashboard.role === "admin";
  const integrations = [
    ...(isHeaderAdmin
      ? [
          { key: "discord" as const, label: "Discord", on: dashboard.config.integrations.discord },
          { key: "notion" as const, label: "Notion", on: dashboard.config.integrations.notion },
        ]
      : []),
    { key: "github" as const, label: "GitHub", on: dashboard.config.integrations.github },
  ];
  $.integrationDots.innerHTML = "";
  for (const integration of integrations) {
    const meta = integration.key === "notion" ? notionDotMeta() : integration.key === "discord" ? discordDotMeta() : integrationDotMeta(integration.key);
    const dot = document.createElement("span");
    dot.className = `dot ${meta.className}`;
    dot.textContent = integration.label;
    dot.title = meta.title;
    $.integrationDots.appendChild(dot);
  }
}

function renderGitRepositoryOptions(): void {
  const project = $.dashboardProject.value;
  // 프로젝트가 선택되지 않은 동안에는 이전 프로젝트의 Git 작업 대상을
  // 다시 표시하지 않습니다. 선택값이 없으면 Git 카드도 빈 상태로 유지합니다.
  if (!project) {
    state.gitRepositoryPath = "";
    $.gitRepositoryPath.textContent = repositoryPathLabel("", "");
    state.git = null;
    state.gitBranches = [];
    state.gitWorkBranches = [];
    state.gitActiveBranches = [];
    mainGitPendingPush = false;
    renderMainCardConnectMessage();
    if (mainGitController) void mainGitController.refresh();
    return;
  }
  // 이 카드(패널)의 저장소: 이 카드에서 직접 고른 폴더가 있으면 그 폴더, 없으면 설정 저장소.
  const localPath = state.projectConnectPaths[project] ?? "";
  const repoPath = resolveRepositoryPath(project, localPath);
  state.gitRepositoryPath = repoPath;
  $.gitRepositoryPath.textContent = repositoryPathLabel(project, repoPath);
  $.gitRepositoryPath.className = repoPath ? "git-repository-path" : "git-repository-path error-text";
  renderMainCardConnectMessage();
  if (!repoPath) {
    state.git = null;
    // 일반 사용자는 로컬 폴더를 연결하기 전에도 라이선스로 배정된 브랜치를
    // 볼 수 있어야 합니다. 그렇지 않으면 새 PC(연결 폴더 없음)에서 브랜치가
    // 통째로 사라져 보입니다.
    const isNormalUser = (state.dashboard?.role ?? "user") !== "admin";
    state.gitBranches = isNormalUser ? projectSelectableBranches() : [];
    state.gitWorkBranches = [];
    state.gitActiveBranches = [];
    mainGitPendingPush = false;
    if (mainGitController) void mainGitController.refresh();
    return;
  }
  if (!state.gitBusy) {
    if (mainGitController) void mainGitController.refresh();
  }
}

/** 메인 카드의 저장소 폴더 연결 안내 문구를 갱신합니다. */
function renderMainCardConnectMessage(): void {
  const project = $.dashboardProject.value || "";
  const stored = project ? (state.projectConnectMessages[project] ?? "") : "";
  if (stored) {
    $.gitConnectMessage.textContent = stored;
    $.gitConnectMessage.className = "muted";
  } else {
    $.gitConnectMessage.textContent = "경로가 지정되지 않았습니다.";
    $.gitConnectMessage.className = "error-text";
  }
}

function selectedRepository(): string | undefined {
  const value = (state.gitRepositoryPath ?? "").trim();
  return value || undefined;
}

function repositorySettingForPath(path: string): GitRepositorySetting | undefined {
  return (state.dashboard?.config.repositories ?? []).find((item) => item.path === path);
}

function persistGitSelectionState(): void {
  // 로드 전(빈 상태)에는 저장하지 않습니다. 그렇게 저장하면 디스크에 남아 있던
  // 저장소 경로/카드가 지워져 재시작 후 설정이 사라집니다.
  if (!gitSelectionLoaded) return;
  const payload = {
    workBranchesByProject: state.gitWorkBranchesByProject,
    activeBranchesByProject: state.gitActiveBranchesByProject,
    cardsByProject: state.gitCardsByProject,
    selectedProject: $.dashboardProject.value || "",
    connectedPaths: state.connectedPaths,
    projectConnectPaths: state.projectConnectPaths,
    projectConnectMessages: state.projectConnectMessages,
    projectConnectPath: state.projectConnectPath,
    projectConnectMessage: state.projectConnectMessage,
  };
  // 메인 프로세스가 userData 디렉터리에 JSON 파일로 영구 저장하므로 앱을 재실행해도 유지됩니다.
  void window.hub.saveGitSelection(payload).catch(() => { /* 저장 실패는 조용히 무시 */ });
}

async function loadGitSelectionState(): Promise<void> {
  const parsed = await window.hub.getGitSelection().catch(() => null);
  if (parsed) {
    state.gitWorkBranchesByProject = parsed.workBranchesByProject ?? {};
    state.gitActiveBranchesByProject = parsed.activeBranchesByProject ?? {};
    state.gitCardsByProject = parsed.cardsByProject ?? {};
    state.lastSelectedProject = parsed.selectedProject ?? "";
    if (Array.isArray(parsed.connectedPaths)) state.connectedPaths = parsed.connectedPaths;
    state.projectConnectPaths = parsed.projectConnectPaths ?? {};
    state.projectConnectMessages = parsed.projectConnectMessages ?? {};
    state.projectConnectPath = parsed.projectConnectPath ?? "";
    state.projectConnectMessage = parsed.projectConnectMessage ?? "";
  }
  // 로드가 끝난 뒤에만 저장을 허용합니다. 로드 전 빈 상태로 저장되면
  // 저장해 둔 저장소 경로를 통째로 지워버립니다.
  gitSelectionLoaded = true;
}

function persistGitWorkBranches(): void {
  const project = $.dashboardProject.value || "";
  state.gitWorkBranchesByProject[project] = state.gitWorkBranches.slice();
  persistGitSelectionState();
}

function persistGitActiveBranches(): void {
  const project = $.dashboardProject.value || "";
  state.gitActiveBranchesByProject[project] = state.gitActiveBranches.slice();
  persistGitSelectionState();
}

function currentlySelectedProject(): string {
  return $.dashboardProject.value || "";
}

/**
 * 일반 사용자의 브랜치 목록을 현재 라이선스 배정에 맞게 정리합니다.
 *
 * 관리자가 브랜치 권한을 회수하면(예: Test2 제거) 이전에 저장해 둔 작업 브랜치에 그 이름이
 * 남아 있을 수 있습니다. 그대로 복원하면 권한이 없는 브랜치가 체크된 채로 보이므로,
 * 배정된 브랜치만 남기고 제거합니다. 권한이 그대로면 기존 선택이 유지됩니다.
 */
function filterBranchesByLicense(branches: string[]): string[] {
  return filterBranchesByAllowed({
    saved: branches,
    allowed: projectSelectableBranches(),
    isAdmin: (state.dashboard?.role ?? "user") === "admin",
  });
}

function restoreProjectWorkBranches(): void {
  const project = currentlySelectedProject();
  const saved = state.gitWorkBranchesByProject[project];
  if (saved && saved.length > 0) {
    const filtered = filterBranchesByLicense(saved);
    state.gitWorkBranches = filtered;
    // 회수된 브랜치가 있었다면 저장 상태도 갱신해 다음 실행에 남지 않게 합니다.
    if (filtered.length !== saved.length) {
      state.gitWorkBranchesByProject[project] = filtered;
      persistGitSelectionState();
    }
  } else {
    // 저장된 작업 브랜치가 없으면 빈 상태로 초기화해 이전 프로젝트의 브랜치가 남지 않게 한다.
    state.gitWorkBranches = [];
  }
}

function restoreProjectActiveBranches(): void {
  const project = currentlySelectedProject();
  const saved = state.gitActiveBranchesByProject[project];
  if (saved && saved.length > 0) {
    const filtered = filterBranchesByLicense(saved);
    state.gitActiveBranches = filtered;
    if (filtered.length !== saved.length) {
      state.gitActiveBranchesByProject[project] = filtered;
      persistGitSelectionState();
    }
  } else {
    // 저장된 활성 브랜치가 없으면 빈 상태로 시작해 전체 선택이 자동으로 켜지지 않게 한다.
    state.gitActiveBranches = [];
  }
}

interface GitCardAccess {
  repoPath(): string;
  readGit(): GitStatusView | null;
  writeGit(git: GitStatusView | null): void;
  branchNames(): string[];
  writeBranchNames(branches: string[]): void;
  readWork(): string[];
  writeWork(branches: string[]): void;
  readActive(): string[];
  writeActive(active: string[]): void;
  readBusy(): boolean;
  writeBusy(busy: boolean): void;
  readClean(): boolean;
  writeClean(clean: boolean): void;
  readPendingPush(): boolean;
  writePendingPush(pending: boolean): void;
}

interface GitCardDom {
  /** 현재 사용할 저장소 경로를 돌려줍니다(드롭다운 없이 단일 경로). */
  repoPath: () => string;
  refreshBtn?: HTMLButtonElement;
  branchesEl: HTMLElement;
  summary: HTMLElement;
  conflicts: HTMLElement;
  table: HTMLTableElement;
  filesToggle?: HTMLButtonElement;
  filesHidden?: HTMLElement;
  commitBtn: HTMLButtonElement;
  pushBtn: HTMLButtonElement;
  /** 원격 변경 가져오기(Pull) 버튼. */
  pullBtn?: HTMLButtonElement;
  /** 변경사항 폐기 버튼(메인 카드 전용). */
  discardBtn?: HTMLButtonElement;
  reportBtn?: HTMLButtonElement;
  errorEl: HTMLElement;
  /** 메인 카드에만 있는 '현재 브랜치' 표시 요소(추가 카드에는 없음). */
  currentBranchEl?: HTMLElement;
}

interface GitCardController {
  /** options.silent: 폴더 변경 감시 등 배경 자동 새로고침. 버튼 깜빡임을 막습니다. */
  refresh(options?: { silent?: boolean }): Promise<void>;
}

let mainGitController: GitCardController | null = null;

/** 대시보드에 추가된 Git 카드들의 컨트롤러입니다(카드 요소 -> 컨트롤러).
 *  배경 자동 새로고침 때 버튼을 클릭하지 않고 조용히 갱신하기 위해 사용합니다. */
const extraCardControllers = new WeakMap<HTMLElement, GitCardController>();

/** 현재 자동 새로고침(폴더 변경 감시) 중인 저장소 경로입니다. */
let watchedRepository = "";

/** 연결된 폴더의 변경 감시를 시작해, 파일이 바뀌면 화면을 자동 갱신합니다. */
async function watchConnectedFolder(repository: string): Promise<void> {
  const target = (repository ?? "").trim();
  if (watchedRepository === target) return;
  const previous = watchedRepository;
  watchedRepository = target;
  try {
    if (previous) await window.hub.unwatchRepository(previous);
    if (target) await window.hub.watchRepository(target);
  } catch {
    // 감시 실패는 치명적이지 않습니다(수동 새로고침 사용 가능).
  }
}

let mainGitPendingPush = false;

/** 저장된 Git 선택 상태를 디스크에서 읽어왔는지 여부. 로드 전 저장을 막는 데 씁니다. */
let gitSelectionLoaded = false;

function gitErrorSummary(cause: unknown, fromBranch?: string, toBranch?: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const fromOf = fromBranch ? "'" + fromBranch + "'" : '현재 브랜치';
  const toOf = toBranch ? "'" + toBranch + "'" : '다른 브랜치';
  if (/overwritten by checkout|would be overwritten/i.test(message)) {
    return fromOf + '에서 ' + toOf + '(으)로 전환하지 못했습니다. 현재 브랜치의 미저장 변경사항을 커밋하거나 스태시한 뒤 다시 시도하세요.';
  }
  if (/cannot switch branch/i.test(message)) {
    return '브랜치 ' + toOf + ' 전환 시도 중 병합(merge)이 진행 중이라 바꿀 수 없습니다. 병합을 완료하거나 중단한 뒤 다시 시도하세요.';
  }
  return message;
}

async function pushActiveBranches(repository: string, active: string[]): Promise<void> {
  if (active.length === 0) throw new Error('활성 브랜치를 하나 이상 선택하세요.');
  const errors: string[] = [];
  for (const branch of active) {
    try {
      await window.hub.gitPushBranch({ repository, branch });
    } catch (cause: unknown) {
      errors.push(branch + ': ' + (cause instanceof Error ? cause.message : String(cause)));
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

function previousEightIso() {
  const now = new Date();
  const until = new Date(now);
  until.setHours(8, 0, 0, 0);
  const since = new Date(until);
  since.setDate(since.getDate() - 1);
  const month = String(until.getMonth() + 1).padStart(2, '0');
  const day = String(until.getDate()).padStart(2, '0');
  return {
    date: until.getFullYear() + '-' + month + '-' + day,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
  };
}

function mountGitCard(dom: GitCardDom, access: GitCardAccess): GitCardController {
  const branchesEl = dom.branchesEl;
  const summary = dom.summary;
  const conflicts = dom.conflicts;
  const table = dom.table;
  const filesToggle = dom.filesToggle;
  const filesHidden = dom.filesHidden;
  const commitBtn = dom.commitBtn;
  const pushBtn = dom.pushBtn;
  const pullBtn = dom.pullBtn;
  const reportBtn = dom.reportBtn;
  const errorEl = dom.errorEl;
  const discardBtn = dom.discardBtn;

  // 일일 요약 등록 버튼은 관리자(admin) 라이선스에서만 노출합니다. 일반(user) 라이선스에서는 숨깁니다.
  const isAdminRole = state.dashboard?.role === "admin";
  if (reportBtn) reportBtn.hidden = !isAdminRole;

  const applyButtonState = (): void => {
    if (access.readBusy()) {
      commitBtn.disabled = true;
      pushBtn.disabled = true;
      if (discardBtn) discardBtn.disabled = true;
      if (reportBtn) reportBtn.disabled = true;
      return;
    }
    const hasRepo = Boolean(access.repoPath());
    const hasChanges = access.readGit() !== null && !access.readClean();
    const active = access.readActive().filter((branch) => branch.trim().length > 0);
    const pendingUpstream = access.readGit() ? access.readGit()!.ahead > 0 : false;
    const isAdminUser = (state.dashboard?.role ?? "user") === "admin";
    // 공용 브랜치(main/master 등)에서는 일반 사용자가 커밋·푸시할 수 없습니다.
    // 버튼을 누른 뒤에야 알게 되면 혼란스러우므로, 눌리지 않게 미리 막고 이유를 보여줍니다.
    const targetBranch = active[0];
    const commitBlocked = !isAdminUser && isProtectedBranch(targetBranch);
    commitBtn.disabled = !hasRepo || !hasChanges || active.length !== 1 || commitBlocked;
    pushBtn.disabled = active.length !== 1 || !pendingUpstream || commitBlocked;
    // Pull 은 작업 트리가 깨끗할 때만 허용합니다(미커밋 변경 위로 덮어쓰지 않도록).
    if (pullBtn) {
      const dirty = hasRepo && access.readGit() !== null && !access.readClean();
      pullBtn.disabled = !hasRepo || active.length !== 1 || dirty;
      pullBtn.title = dirty
        ? "커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 폐기한 뒤 Pull 하세요."
        : "원격(main 등)의 최신 커밋을 현재 브랜치로 가져옵니다";
    }
    // 폐기는 바뀐 내용이 있을 때만 의미가 있습니다.
    if (discardBtn) discardBtn.disabled = !hasRepo || !hasChanges;
    // 왜 비활성인지 화면에 알려줍니다.
    if (commitBlocked && targetBranch) {
      errorEl.textContent =
        "공용 브랜치 '" + targetBranch + "' 에서는 일반 사용자가 커밋/푸시할 수 없습니다. " +
        "개인 작업 브랜치를 선택하세요.";
    } else if (errorEl.dataset["protectedNotice"] === "1") {
      errorEl.textContent = "";
      delete errorEl.dataset["protectedNotice"];
    }
    if (commitBlocked && targetBranch) errorEl.dataset["protectedNotice"] = "1";
    if (reportBtn) reportBtn.disabled = !hasRepo || active.length === 0;
  };

  const setBusy = (value: boolean): void => {
    access.writeBusy(value);
    commitBtn.disabled = value;
    pushBtn.disabled = value;
    if (pullBtn) pullBtn.disabled = value;
    if (discardBtn) discardBtn.disabled = value;
    if (reportBtn) reportBtn.disabled = value;
    if (dom.refreshBtn) dom.refreshBtn.disabled = value;
    if (!value) applyButtonState();
  };


  // 변경된 파일 목록 접기/펼치기 상태 (기본: 펼침).
  // 기본은 접힘: 5개만 보여주고 나머지는 '감추기' 기능으로 숨깁니다.
  let filesCollapsed = true;
  const COLLAPSE_LIMIT = 5;

  const renderFiles = (files: { path: string; indexStatus: string; workTreeStatus: string }[]): void => {
    const body = table.tBodies[0];
    if (!body) return;
    body.innerHTML = '';
    const hasMany = files.length > COLLAPSE_LIMIT;
    if (filesToggle) filesToggle.hidden = !hasMany;
    const visible = hasMany && filesCollapsed ? files.slice(0, COLLAPSE_LIMIT) : files;
    for (const file of visible) {
      const row = document.createElement('tr');
      const path = document.createElement('td');
      path.textContent = file.path;
      const index = document.createElement('td');
      index.textContent = file.indexStatus;
      const workTree = document.createElement('td');
      workTree.textContent = file.workTreeStatus;
      row.append(path, index, workTree);
      body.appendChild(row);
    }
    if (filesToggle) filesToggle.textContent = hasMany && filesCollapsed ? '▸' : '▾';
    if (filesHidden) {
      if (hasMany && filesCollapsed) {
        filesHidden.hidden = false;
        filesHidden.textContent = files.length - COLLAPSE_LIMIT + '개 파일이 접혀 있습니다';
      } else {
        filesHidden.hidden = true;
      }
    }
  };

  if (filesToggle) {
    filesToggle.addEventListener('click', () => {
      filesCollapsed = !filesCollapsed;
      const git = access.readGit();
      renderFiles(git ? git.files : []);
    });
  }

  const renderGitView = (git: GitStatusView | null): void => {
    if (git) {
      const parts = [
        '브랜치 ' + git.branch,
        git.upstream ? 'upstream ' + git.upstream : 'upstream 없음',
        git.ahead > 0 ? git.ahead + ' ahead' : null,
        git.behind > 0 ? git.behind + ' behind' : null,
        git.clean ? '변경 없음' : git.files.length + '개 파일 변경',
      ].filter(Boolean);
      summary.textContent = parts.join(' · ');
    } else {
      summary.textContent = 'Git 상태를 불러올 수 없습니다';
    }
    // 현재 연결된 브랜치를 상단에 굵은 흰색으로 표시합니다(메인 카드 전용).
    if (dom.currentBranchEl) {
      dom.currentBranchEl.textContent = git && git.branch ? git.branch : '';
    }
    const hasConflicts = Boolean(git && git.conflicts.length > 0);
    conflicts.hidden = !hasConflicts;
    conflicts.textContent = hasConflicts && git ? '병합 충돌: ' + git.conflicts.join(', ') : '';
    const files = git ? git.files : [];
    renderFiles(files);
    access.writeClean(git ? git.clean : true);
  };

  const syncActiveBranch = async (): Promise<void> => {
    const active = access.readActive().filter((branch) => branch.trim().length > 0);
    if (active.length === 0) return;
    const target = active[0]!;
    const git = access.readGit();
    // Local git folder is not connected/valid yet.
    if (!git) {
      errorEl.textContent = '로컬 Git 폴더가 아직 연결되지 않았습니다. 프로젝트의 로컬 폴더를 먼저 연결하세요.';
      return;
    }
    const currentBranch = git ? git.branch : '';
    if (currentBranch === target) {
      errorEl.textContent = '';
      return;
    }
    setBusy(true);
    try {
      access.writeGit(await window.hub.switchGitBranch({ repository: access.repoPath(), branch: target }));
      errorEl.textContent = '';
      await refresh();
    } catch (cause) {
      errorEl.textContent = gitErrorSummary(cause, currentBranch, target);
    } finally {
      setBusy(false);
    }
  };

  const renderBranches = (): void => {
    buildWorkBranchPicker({
      container: branchesEl,
      names: access.branchNames(),
      current: access.readGit() ? access.readGit()!.branch : '',
      selected: access.readWork(),
      active: access.readActive(),
      onSwitch: () => syncActiveBranch(),
      onChange: (list) => {
        access.writeWork(list.slice());
        applyButtonState();
        void syncActiveBranch();
      },
      onOpenRefresh: async () => {
        try {
          await window.hub.getProjects();
          const fresh = await window.hub.listGitBranches(access.repoPath());
          if (fresh && fresh.length > 0) return fresh;
        } catch { /* fall through to config fallback */ }
        const fallback = projectSelectableBranches();
        return fallback.length > 0 ? fallback : access.branchNames();
      },
      onActiveChange: (active) => {
        access.writeActive(active.slice());
        applyButtonState();
        void syncActiveBranch();
      },
    });
  };

  // 배경(자동) 새로고침이 겹치지 않도록 진행 중이면 표시만 하고 끝냅니다.
  let refreshInFlight = false;
  const refresh = async (options?: { silent?: boolean }): Promise<void> => {
    const silent = options?.silent === true;
    // 폴더 감시가 촘촘히 이벤트를 보내도 UI 버튼이 계속 깜빡이지 않도록,
    // 이미 새로고침 중이면 다시 시작하지 않고 조용히 무시합니다.
    if (silent && refreshInFlight) return;
    refreshInFlight = true;
    // 배경 새로고침은 버튼 비활성/깜빡임을 만들지 않습니다.
    if (!silent) errorEl.textContent = '';
    const repo = access.repoPath();
    if (!repo) {
      summary.textContent = '저장소를 선택하세요.';
      access.writeGit(null);
      access.writeBranchNames([]);
      renderGitView(null);
      renderBranches();
      applyButtonState();
      refreshInFlight = false;
      return;
    }
    if (!silent) setBusy(true);
    try {
      // inspectGit may fail when the local folder is not connected/cloned yet.
      // Branch names (license allowed) must still be shown in that case.
      // 연결된 폴더가 바뀌면 자동 새로고침되도록 감시를 갱신합니다.
      void watchConnectedFolder(repo);
      // 관리자가 라이선스에 브랜치를 추가/회수했을 수 있으므로,
      // 새로고침할 때 프로젝트 배정 정보도 함께 최신으로 받아옵니다.
      // (이 값이 예전 상태로 남아 있으면 새 브랜치가 권한 밖으로 걸러져 안 보입니다.)
      // 배경(폴더 변경) 새로고침은 파일 내용만 바뀌므로 네트워크 조회를 건너뜁니다.
      if (!silent) await refreshProjectAssignments();
      const [gitResult, namesResult] = await Promise.allSettled([
        window.hub.inspectGit(repo),
        window.hub.listGitBranches(repo),
      ]);
      const git = gitResult.status === 'fulfilled' ? gitResult.value : null;
      let names = namesResult.status === 'fulfilled' ? namesResult.value : [];
      if (names.length === 0) {
        const fallback = projectSelectableBranches();
        if (fallback.length > 0) names = fallback;
      }
      access.writeGit(git);
      access.writeBranchNames(names);
      renderGitView(git);
      renderBranches();
      if (!git && names.length > 0) {
        summary.textContent = "로컬 Git 폴더가 아직 연결되지 않아 상태를 볼 수 없습니다. 프로젝트의 로컬 폴더를 먼저 연결하세요.";
      }
    } catch (cause) {
      summary.textContent = 'Git 사용 불가';
      access.writeGit(null);
      access.writeBranchNames([]);
      renderGitView(null);
      renderBranches();
      errorEl.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!silent) setBusy(false);
      refreshInFlight = false;
    }
  };

  const runCommit = async (): Promise<void> => {
    errorEl.textContent = '';
    const repo = access.repoPath();
    if (!repo) { errorEl.textContent = '저장소를 선택하세요.'; return; }
    const active = access.readActive().filter((branch) => branch.trim().length > 0);
    if (active.length !== 1) {
      errorEl.textContent = active.length === 0 ? '활성 브랜치를 1개 선택하세요.' : '커밋은 활성 브랜치가 정확히 1개일 때만 가능합니다. 다른 브랜치를 비활성화하세요.';
      return;
    }
    setBusy(true);
    setStatus('변경사항을 요약해 커밋하는 중…');
    try {
      const git = access.readGit();
      if (git && git.branch !== active[0]) {
        try {
          access.writeGit(await window.hub.switchGitBranch({ repository: repo, branch: active[0]! }));
        } catch (switchCause) {
          errorEl.textContent = gitErrorSummary(switchCause, git.branch, active[0]!);
          setStatus('커밋 실패');
          return;
        }
      }
      const summaryResult = await window.hub.gitCommit({ repository: repo });
      access.writePendingPush(true);
      setStatus('커밋 완료(푸시 대기): ' + summaryResult.newHead.slice(0, 8) + ' — 푸시 버튼을 눌러야 원격에 반영됩니다');
      await refresh();
    } catch (cause) {
      errorEl.textContent = gitErrorSummary(cause);
      setStatus('커밋 실패');
    } finally {
      setBusy(false);
    }
  };

  const runPush = async (): Promise<void> => {


    errorEl.textContent = '';
    const repo = access.repoPath();
    if (!repo) { errorEl.textContent = '저장소를 선택하세요.'; return; }
    const active = access.readActive().filter((branch) => branch.trim().length > 0);
    if (active.length === 0) { errorEl.textContent = '활성 브랜치를 하나 이상 선택하세요.'; return; }
    setBusy(true);
    setStatus('푸시하는 중…');
    try {
      await pushActiveBranches(repo, active);
      access.writePendingPush(false);
      setStatus('푸시 완료 (' + active.join(', ') + ')');
      await refresh();
    } catch (cause) {
      errorEl.textContent = gitErrorSummary(cause);
      setStatus('푸시 실패');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 원격(main 등)의 최신 커밋을 현재 활성 브랜치로 가져옵니다.
   *
   * 다른 팀원이 공용 브랜치에 병합한 내용을 로컬로 내려받는 용도입니다.
   * 작업 트리에 커밋되지 않은 변경이 있으면 먼저 정리하도록 안내합니다(덮어쓰기 방지).
   */
  const runPull = async (): Promise<void> => {
    errorEl.textContent = '';
    const repo = access.repoPath();
    if (!repo) { errorEl.textContent = '저장소를 선택하세요.'; return; }
    const active = access.readActive().filter((branch) => branch.trim().length > 0);
    if (active.length !== 1) {
      errorEl.textContent = active.length === 0 ? '활성 브랜치를 1개 선택하세요.' : 'Pull 은 활성 브랜치가 정확히 1개일 때만 가능합니다. 다른 브랜치를 비활성화하세요.';
      return;
    }
    const branch = active[0]!;
    setBusy(true);
    setStatus("'" + branch + "' 원격 변경을 가져오는 중…");
    try {
      const git = access.readGit();
      if (git && !git.clean) {
        errorEl.textContent = '커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 변경사항을 폐기한 뒤 Pull 하세요.';
        setStatus('Pull 실패');
        return;
      }
      const result = await window.hub.gitPull({ repository: repo, branch });
      access.writePendingPush(false);
      if (result.updated) {
        setStatus("'" + branch + "' 원격 변경 " + result.commits + "개 커밋을 가져왔습니다.");
      } else {
        setStatus("'" + branch + "' 이미 원격과 최신 상태입니다.");
      }
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/not possible to fast-forward|divergent|diverging|non-fast-forward|Not possible to fast-forward/i.test(message)) {
        errorEl.textContent = '원격과 로컬 이력이 갈라져 자동으로 가져올 수 없습니다. 관리자에게 문의하거나 직접 병합(merge)하세요.';
      } else {
        errorEl.textContent = gitErrorSummary(cause);
      }
      setStatus('Pull 실패');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 변경사항을 폐기해 브랜치를 전환할 수 있게 합니다.
   *
   * 되돌릴 수 없는 작업이므로, 무엇이 사라지는지 먼저 보여주고 확인을 받습니다.
   * 새로 만든 파일은 기본적으로 남기되, 사용자가 원하면 함께 지울 수 있습니다.
   */
  const runDiscard = async (): Promise<void> => {
    errorEl.textContent = "";
    const repo = access.repoPath();
    if (!repo) { errorEl.textContent = "저장소를 선택하세요."; return; }

    setBusy(true);
    setStatus("폐기 대상을 확인하는 중…");
    try {
      const preview = await window.hub.gitDiscardPreview(repo);
      const untracked = preview.untrackedFiles;
      if (preview.changedFiles === 0 && untracked.length === 0) {
        errorEl.textContent = "폐기할 변경사항이 없습니다.";
        setStatus("폐기할 변경사항 없음");
        return;
      }

      // 무엇이 사라지는지 명확히 보여줍니다.
      const sample = untracked.slice(0, 5).map((file) => "  - " + file).join("\n");
      const more = untracked.length > 5 ? "\n  … 외 " + (untracked.length - 5) + "개" : "";
      const message = [
        "변경사항을 폐기하면 되돌릴 수 없습니다.",
        "",
        "바뀐 파일: " + preview.changedFiles + "개 (수정 내용이 원래대로 돌아갑니다)",
        "새로 만든 파일: " + untracked.length + "개",
        sample ? sample + more : "",
        "",
        "[확인] 을 누르면 진행합니다.",
      ].filter(Boolean).join("\n");

      // 새 파일까지 지울지 별도로 묻습니다(실수로 작업물을 잃지 않도록 기본은 남김).
      const includeUntracked = untracked.length > 0
        ? window.confirm(message + "\n\n새로 만든 파일도 함께 삭제할까요?\n[확인]=삭제, [취소]=남기기")
        : false;
      if (preview.changedFiles > 0 && !window.confirm(message)) {
        setStatus("폐기를 취소했습니다.");
        return;
      }

      const git = await window.hub.gitDiscard({ repository: repo, includeUntracked });
      access.writeGit(git);
      renderGitView(git);
      setStatus(
        "변경사항을 폐기했습니다." + (includeUntracked && untracked.length > 0 ? " (새 파일 " + untracked.length + "개 포함)" : ""),
      );
      await refresh();
    } catch (cause) {
      errorEl.textContent = cause instanceof Error ? cause.message : String(cause);
      setStatus("폐기 실패");
    } finally {
      setBusy(false);
    }
  };

  const runDailyReport = async (): Promise<void> => {
    if (!reportBtn) return;
    errorEl.textContent = '';
    const repo = access.repoPath();
    if (!repo) { errorEl.textContent = '저장소를 선택하세요.'; return; }
    const targetRepo = repositorySettingForPath(repo);
    if (!targetRepo || !targetRepo.notionDatabaseId?.trim() || !targetRepo.discordChannelId?.trim()) {
      errorEl.textContent = '저장소에 연결되어 있지 않습니다. Notion DB ID와 Discord 채널 ID를 입력하세요.';
      return;
    }
    const branches = access.readActive().filter((branch) => branch.trim().length > 0);
    if (branches.length === 0) { errorEl.textContent = '활성 브랜치를 하나 이상 선택하세요.'; return; }
    setBusy(true);
    const range = previousEightIso();
    setStatus('전날 08시~당일 08시 커밋을 브랜치별로 요약해 Notion에 등록하는 중…');
    try {
      const result = await window.hub.reportManualDailyReport({
        date: range.date,
        sinceIso: range.sinceIso,
        untilIso: range.untilIso,
        repositories: [repo],
        branches,
      });
      const failed = result.branches.filter((item) => item.status === 'failed');
      if (failed.length > 0) {
        errorEl.textContent = failed.map((item) => item.repositoryLabel + '/' + item.branch + ': ' + item.message).join('\n');
      } else {
        setStatus(range.date + ' 일일 요약 등록 완료 (브랜치 ' + result.branches.length + '개)');
      }
    } catch (cause) {
      errorEl.textContent = gitErrorSummary(cause);
      setStatus('일일 요약 등록 실패');
    } finally {
      setBusy(false);
    }
  };

  if (dom.refreshBtn) dom.refreshBtn.addEventListener('click', () => void refresh());
  if (discardBtn) discardBtn.addEventListener('click', () => void runDiscard());
  commitBtn.addEventListener('click', () => void runCommit());
  pushBtn.addEventListener('click', () => void runPush());
  if (pullBtn) pullBtn.addEventListener('click', () => void runPull());
  if (reportBtn) reportBtn.addEventListener('click', () => void runDailyReport());

  return { refresh };
}

function mountDashboardMainGitCard(): GitCardController {
  const access: GitCardAccess = {
    repoPath: () => selectedRepository() ?? '',
    readGit: () => state.git,
    writeGit: (git) => { state.git = git; },
    branchNames: () => state.gitBranches,
    writeBranchNames: (branches) => { state.gitBranches = branches; },
    readWork: () => state.gitWorkBranches,
    writeWork: (branches) => { state.gitWorkBranches = branches; persistGitWorkBranches(); },
    readActive: () => state.gitActiveBranches,
    writeActive: (active) => { state.gitActiveBranches = active; persistGitActiveBranches(); },
    readBusy: () => state.gitBusy,
    writeBusy: (busy) => { state.gitBusy = busy; },
    readClean: () => (state.git ? state.git.clean : true),
    writeClean: () => {},
    readPendingPush: () => mainGitPendingPush,
    writePendingPush: (pending) => { mainGitPendingPush = pending; },
  };
  const controller = mountGitCard({
    repoPath: () => selectedRepository() ?? '',
    refreshBtn: $.gitRefresh,
    branchesEl: $.gitBranches,
    summary: $.gitSummary,
    conflicts: $.gitConflicts,
    table: $.gitFiles,
    filesToggle: required<HTMLButtonElement>(document.getElementById("git-files-toggle"), "git-files-toggle"),
    filesHidden: required<HTMLElement>(document.getElementById("git-files-hidden"), "git-files-hidden"),
    commitBtn: $.gitCommit,
    pushBtn: $.gitPush,
    pullBtn: $.gitPull,
    discardBtn: $.gitDiscard,
    reportBtn: $.gitDailyReport,
    errorEl: $.gitError,
    currentBranchEl: $.gitCurrentBranch,
  }, access);
  mainGitController = controller;
  return controller;
}
function renderDailyAutomation(view: DailyAutomationView): void {
  $.automationEnabled.checked = view.enabled;
  $.automationState.textContent = view.running ? "실행 중" : view.enabled ? "활성" : "비활성";
  $.automationState.className = `status-pill ${view.running ? "running" : view.enabled ? "on" : "off"}`;
  $.automationNext.textContent = view.nextRunAt
    ? `다음 실행: ${formatTime(view.nextRunAt)}`
    : "다음 실행 없음";

  $.automationProjects.innerHTML = "";
  const projects = projectNames(state.dashboard?.config.repositories ?? []);
  for (const project of projects) {
    const label = document.createElement("label");
    label.className = "checkbox-row repository-card readonly";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = view.selectedProjects.includes(project);
    input.addEventListener("change", () => {
      const selected = new Set(view.selectedProjects);
      input.checked ? selected.add(project) : selected.delete(project);
      view.selectedProjects = [...selected];
      updateAutomationButtons(view);
    });
    label.append(input, document.createTextNode(project));
    $.automationProjects.appendChild(label);
  }
  if (projects.length === 0) $.automationProjects.innerHTML = '<p class="empty">설정된 프로젝트가 없습니다.</p>';

  if (view.lastRun) {
    const run = view.lastRun;
    const lines = [
      `최근 실행: ${run.status} · ${formatTime(run.startedAt)}`,
      ...run.branches.map((branch) => `  - [${branch.repositoryLabel ?? "저장소"}] ${branch.branch}: ${branch.message}`),
    ];
    if (run.error) lines.push(`오류: ${run.error}`);
    $.automationLastRun.innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  } else {
    $.automationLastRun.innerHTML = "";
  }
  updateAutomationButtons(view);
}

function updateAutomationButtons(view: DailyAutomationView): void {
  const hasSelectedBranch = view.selectedProjects.length > 0 && view.repositories.some((repo) => repo.selectedBranches.length > 0 && repo.path);
  $.automationRun.disabled = state.automationBusy || view.running || !hasSelectedBranch;
}

async function saveDailyAutomation(): Promise<void> {
  const api = settingsHub();
  if (!api || state.automationBusy) return;
  const projects = state.dashboard?.dailyAutomation.selectedProjects ?? [];
  if (projects.length === 0) {
    $.automationMessageText.textContent = "최소 하나 이상의 프로젝트를 선택하세요.";
    $.automationMessageText.className = "error-text";
    return;
  }
  state.automationBusy = true;
  $.automationMessageText.textContent = "저장 중…";
  $.automationMessageText.className = "success-text";
  if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  try {
    const result = await api.saveSettings({
      HUB_DAILY_AUTOMATION_ENABLED: String($.automationEnabled.checked),
      HUB_DAILY_AUTOMATION_PROJECTS: projects.join(","),
    });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.automationMessageText.textContent = "설정이 저장되었습니다.";
    $.automationMessageText.className = "success-text";
    await refreshState();
  } catch (error) {
    $.automationMessageText.textContent = `저장 실패: ${error instanceof Error ? error.message : String(error)}`;
    $.automationMessageText.className = "error-text";
  } finally {
    state.automationBusy = false;
    if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  }
}

async function runDailyAutomationNow(): Promise<void> {
  if (state.automationBusy) return;
  state.automationBusy = true;
  $.automationMessageText.textContent = "자동화를 실행 중입니다…";
  $.automationMessageText.className = "success-text";
  if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  try {
    const run = await window.hub.runDailyAutomation();
    $.automationMessageText.textContent = run.status === "succeeded"
      ? "자동화 실행이 완료되었습니다."
      : `자동화 실행 결과: ${run.status}`;
    $.automationMessageText.className = run.status === "succeeded" ? "success-text" : "error-text";
    await refreshState();
  } catch (error) {
    $.automationMessageText.textContent = `실행 실패: ${error instanceof Error ? error.message : String(error)}`;
    $.automationMessageText.className = "error-text";
  } finally {
    state.automationBusy = false;
    if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  }
}

async function refreshState(): Promise<boolean> {
  try {
    const [dashboard, projects, license] = await Promise.all([
      window.hub.getState(),
      // 일시적 오류로 프로젝트 조회가 실패하면 null 을 돌려주고, 이전 목록을 유지합니다.
      // (빈 배열로 덮어쓰면 네트워크가 잠깐 흔들릴 때마다 프로젝트가 사라져 보입니다.)
      window.hub.getProjects().catch(() => null as ProjectView[] | null),
      window.hub.getLicenseStatus().catch(() => null),
    ]);
    // 빈 응답도 반영해야 Config에서 프로젝트가 삭제되거나,
    // 일반 사용자에게 라이선스별 브랜치 배정이 없을 때 이전 목록이 남지 않습니다.
    if (projects !== null) state.projects = projects;
    state.licenseOwner = license?.owner ?? "";
    renderDashboard(dashboard);
    return true;
  } catch (error) {
    setStatus(`상태 로드 실패: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** 헤더 우측 상단 '새로고침' 버튼 처리.
 *  대시보드 상태와 Git 카드들을 다시 읽고, 처리 중에는 버튼을 비활성화합니다. */
let headerRefreshBusy = false;
async function runHeaderRefresh(): Promise<void> {
  if (headerRefreshBusy) return;
  headerRefreshBusy = true;
  $.refreshState.disabled = true;
  $.refreshState.classList.add("is-busy");
  try {
    const ok = await refreshState();
    if (mainGitController) await mainGitController.refresh();
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".dashboard-extra-card"));
    await Promise.all(cards.map((card) => extraCardControllers.get(card)?.refresh() ?? Promise.resolve()));
    if (ok) setStatus("새로고침 완료: " + new Date().toLocaleTimeString());
  } catch (error) {
    setStatus("새로고침 실패: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    headerRefreshBusy = false;
    $.refreshState.disabled = false;
    $.refreshState.classList.remove("is-busy");
  }
}

function renderDashboard(dashboard: DashboardState): void {
  state.dashboard = dashboard;
  renderSettingsNotion();
  renderSettingsDiscord();
  renderHeader(dashboard);
  $.mainTabAutomation.hidden = dashboard.role !== "admin";
  if (dashboard.role !== "admin" && !$.panelAutomation.hidden) switchMainPanel("dashboard");
  const isAdmin = dashboard.role === "admin";
  $.settingsTabApikey.hidden = !isAdmin;
  // 일반 사용자(.env 수정, Git/Notion/Discord 저장소 설정, API 키) 탭을 숨깁니다.
  $.settingsTabEnv.hidden = !isAdmin;
  $.settingsTabGit.hidden = !isAdmin;
  $.settingsTabNotion.hidden = !isAdmin;
  $.settingsTabDiscord.hidden = !isAdmin;
  // Git 접속(토큰·SSH 키) 탭은 저장소 자격증명을 다루므로 관리자 전용입니다.
  // 일반 사용자는 라이선스로 배포된 자격증명을 자동으로 사용하므로 설정할 것이 없습니다.
  $.settingsTabGitAccess.hidden = !isAdmin;
  if (!isAdmin && (!$.settingsPaneApikey.hidden || !$.settingsPaneEnv.hidden || !$.settingsPaneGit.hidden || !$.settingsPaneNotion.hidden || !$.settingsPaneDiscord.hidden)) {
    switchSettingsPanel("license");
  }
  // 일일 요약 등록 버튼은 관리자(admin) 라이선스에서만 노출합니다.
  $.gitDailyReport.hidden = !isAdmin;
  renderProjectOptions(dashboard.config.repositories);
  renderGitRepositoryOptions();
  renderDailyAutomation(dashboard.dailyAutomation);
}

function appendBranchOptions(select: HTMLSelectElement, branches: string[]): void {
  const groups = new Map<string, string[]>();
  for (const branch of branches) {
    const index = branch.indexOf("/");
    const groupPrefix = index > 0 ? branch.slice(0, index) : "";
    if (groupPrefix) {
      const bucket = groups.get(groupPrefix) ?? [];
      bucket.push(branch);
      groups.set(groupPrefix, bucket);
    } else {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = branch;
      select.appendChild(option);
    }
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of sortedKeys) {
    const groupHeading = document.createElement("option");
    groupHeading.value = "";
    groupHeading.disabled = true;
    groupHeading.textContent = "─ " + key + " ─";
    select.appendChild(groupHeading);
    const bucket = groups.get(key)!.sort((a, b) => a.localeCompare(b));
    for (const branch of bucket) {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = "  ↳ " + branch;
      select.appendChild(option);
    }
  }
}

function projectName(value?: string): string {
  return value?.trim() || "미지정 프로젝트";
}

/** 프로젝트 정의(Git URL)와 등록된 Git 저장소(URL)가 동일한지 비교합니다. */
function sameRepoUrl(projectUrl: string, repoUrl: string): boolean {
  // 원격 URL 동일성 판정은 shared/repo-identity 의 단일 구현만 사용합니다.
  return isSameRepository(projectUrl, repoUrl);
}

interface CardEntry {
  id: string;
  path: string;
  /** 이 카드에서 "저장소 폴더 선택"으로 직접 지정한 로컬 Git 폴더. */
  localPath?: string;
  workBranches: string[];
  activeBranches: string[];
}

function currentCardBranches(id: string): string[] {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const found = cards.find((item) => item.id === id);
  return found ? found.workBranches.slice() : [];
}

function saveCardBranches(id: string, branches: string[]): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const found = cards.find((item) => item.id === id);
  if (found) {
    found.workBranches = branches.slice();
    persistGitSelectionState();
  }
}

function currentCardActiveBranches(id: string): string[] {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const found = cards.find((item) => item.id === id);
  return found ? found.activeBranches.slice() : [];
}

function saveCardActiveBranches(id: string, active: string[]): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const found = cards.find((item) => item.id === id);
  if (found) {
    found.activeBranches = active.slice();
    persistGitSelectionState();
  }
}

function ensureCardEntry(id: string, path: string, localPath = ""): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const existing = cards.find((item) => item.id === id);
  if (existing) {
    existing.path = path;
    existing.localPath = localPath;
  } else {
    state.gitCardsByProject[project] = [...cards, { id, path, localPath, workBranches: [], activeBranches: [] }];
  }
  persistGitSelectionState();
}

/** 카드의 전용 로컬 폴더를 저장합니다(카드별 저장소 지정). */
function saveCardLocalPath(id: string, localPath: string): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const found = cards.find((item) => item.id === id);
  if (found) {
    found.localPath = localPath;
    persistGitSelectionState();
  }
}

function removeCardEntry(id: string): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  state.gitCardsByProject[project] = cards.filter((item) => item.id !== id);
  persistGitSelectionState();
}

function moveCardEntry(id: string, newPath: string): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const entry = cards.find((item) => item.id === id);
  if (entry) entry.path = newPath;
  persistGitSelectionState();
}

function projectNames(repositories: GitRepositorySetting[]): string[] {
  return [...new Set(repositories.map((repository) => projectName(repository.project)))].sort((a, b) => a.localeCompare(b));
}

function renderProjectOptions(repositories: GitRepositorySetting[]): void {
  const previous = $.dashboardProject.value;
  $.dashboardProject.innerHTML = "";
  const isAdminRole = state.dashboard?.role === "admin";
  // 일반 사용자는 Config에서 라이선스에 배정된 프로젝트만 선택할 수 있습니다.
  // 로컬 폴더 연결 전에도 프로젝트를 보여줘야 하므로 로컬 저장소와 조인하지 않습니다.
  const projectNamesList = isAdminRole
    // 관리자도 Config(중앙 projects.json)에 정의된 프로젝트를 로컬 저장소 등록 여부와
    // 무관하게 볼 수 있어야 합니다. 그렇지 않으면 새 PC(로컬 저장소 미등록)에서
    // 중앙에 정의된 프로젝트가 통째로 사라져 보입니다.
    ? [...new Set([...projectNames(repositories), ...state.projects.map((project) => project.name)])].sort((a, b) => a.localeCompare(b))
    : state.projects.map((project) => project.name);
  if (!isAdminRole && projectNamesList.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "이 라이선스에 배정된 프로젝트가 없습니다.";
    $.dashboardProject.appendChild(option);
  } else {
    for (const project of projectNamesList) {
      const option = document.createElement("option");
      option.value = project;
      option.textContent = project;
      $.dashboardProject.appendChild(option);
    }
  }
  if (previous && Array.from($.dashboardProject.options).some((option) => option.value === previous)) {
    $.dashboardProject.value = previous;
  } else if (state.lastSelectedProject && Array.from($.dashboardProject.options).some((option) => option.value === state.lastSelectedProject)) {
    $.dashboardProject.value = state.lastSelectedProject;
  }
  const isAdmin = state.dashboard?.role === 'admin';
  $.dashboardProjectRenameInput.hidden = !isAdmin;
  $.dashboardProjectRename.hidden = !isAdmin;
  $.dashboardProjectRename.disabled = !isAdmin || !$.dashboardProject.value;
}

function currentProjectView(): ProjectView | undefined {
  const project = $.dashboardProject.value || "";
  if (!project) return undefined;
  return state.projects.find((item) => item.name === project || item.id === project);
}

/** 설정 탭에 등록된(=config.repositories) 프로젝트 저장소만 반환합니다. */
function configuredRepositoriesForProject(project: string): GitRepositorySetting[] {
  return (state.dashboard?.config.repositories ?? []).filter((repo) => !project || projectName(repo.project) === project);
}

/** 설정 저장소 중 선택한 프로젝트의 첫 경로(관리자/공용 저장소). */
function configuredRepositoryPath(project: string): string {
  const repo = configuredRepositoriesForProject(project).find((item) => (item.path ?? "").trim().length > 0);
  return (repo?.path ?? "").trim();
}

/**
 * 한 카드(패널)가 사용할 저장소 폴더를 하나로 결정합니다.
 *
 * 카드에서 "저장소 폴더 선택"으로 직접 고른 폴더가 있으면 그 폴더를,
 * 없으면 설정에 등록된 저장소 경로를 씁니다. 패널마다 저장소는 하나로 고정됩니다.
 */
function resolveRepositoryPath(project: string, localPath: string): string {
  const local = (localPath ?? "").trim();
  if (local) return local;
  return configuredRepositoryPath(project);
}

/** 저장소 경로 표시 문구. 경로가 없으면 안내 문구를 돌려줍니다. */
function repositoryPathLabel(project: string, repoPath: string): string {
  if (!project) return "프로젝트를 선택하세요.";
  const p = (repoPath ?? "").trim();
  return p || "저장소 폴더를 선택하세요.";
}
/** Current selected project allowed branch list (normal user). Shown even without a local folder. */
function projectSelectableBranches(): string[] {
  const view = currentProjectView();
  if (!view) return [];
  const allowed = Array.isArray(view.selectableBranches) ? view.selectableBranches : [];
  if (allowed.length > 0) return allowed.slice();
  return Array.isArray(view.allowedBranches) ? view.allowedBranches.slice() : [];
}

/**
 * 프로젝트 배정(라이선스별 허용 브랜치) 정보를 최신으로 갱신합니다.
 *
 * 관리자가 라이선스에 브랜치를 추가하거나 회수하면 중앙 projects.json 이 바뀝니다.
 * 화면의 브랜치 판단은 state.projects 를 기준으로 하므로, 새로고침 때 이 값을 다시 받아와야
 * 새로 추가된 브랜치가 목록에 나타나고 회수된 브랜치가 사라집니다.
 */
/**
 * 프로젝트 배정(라이선스별 허용 브랜치)을 최신으로 받아옵니다.
 *
 * 관리자가 브랜치를 추가/회수하면 중앙 projects.json 이 바뀌므로,
 * 새로고침할 때 이 값을 다시 받아와야 새 브랜치가 나타나고 회수된 브랜치가 사라집니다.
 * (자동 주기 확인은 하지 않고, 사용자가 새로고침할 때만 갱신합니다.)
 */
async function refreshProjectAssignments(): Promise<void> {
  try {
    const projects = await window.hub.getProjects();
    const changed = assignmentsChanged(state.projects, projects);
    state.projects = projects;
    // 배정이 바뀌었으면 프로젝트 목록과 브랜치 체크를 다시 맞춥니다.
    if (changed) {
      const project = currentlySelectedProject();
      renderProjectOptions(state.dashboard?.config.repositories ?? []);
      if (project) $.dashboardProject.value = project;
      renderGitRepositoryOptions();
      restoreProjectWorkBranches();
      restoreProjectActiveBranches();
    }
  } catch {
    // 조회 실패 시 기존 배정을 유지합니다(다시 새로고침하면 재시도됩니다).
  }
}



/**
 * 카드 하나의 "저장소 폴더 선택" 버튼 처리입니다.
 *
 * 고른 폴더를 그 카드의 저장소로 지정합니다. 메인 카드는 프로젝트별
 * (state.projectConnectPaths)로, 추가 카드는 카드별(localPath)로 저장합니다.
 * 이로써 Git 커밋/푸시 패널마다 서로 다른 로컬 저장소를 지정할 수 있습니다.
 */
async function chooseCardRepositoryFolder(options: {
  setMessage: (message: string, isError?: boolean) => void;
  applyPath: (path: string) => void;
  refreshCards: () => void;
}): Promise<void> {
  const { setMessage, applyPath, refreshCards } = options;
  try {
    const project = currentProjectView();
    if (!project) { setMessage('먼저 연결할 프로젝트를 선택하세요.', true); return; }
    const directory = await window.hub.chooseGitRepository();
    if (!directory) return;
    setMessage('저장소를 연결하는 중...');
    const result = await window.hub.connectOrCloneGitRepository({ url: project.url, directory });
    // 성공했을 때만 경로를 저장합니다(실패한 경로를 다음 실행에서 재사용하지 않도록).
    applyPath(result.path);
    addConnectedPath(result.path);
    setMessage((result.action === 'clone' ? '클론 완료: ' : '연결 완료: ') + result.path);
    refreshCards();
  } catch (error) {
    setMessage('연결 실패: ' + (error instanceof Error ? error.message : String(error)), true);
  }
}
function addConnectedPath(p: string): void {
  const t = p.trim();
  if (!t || state.connectedPaths.includes(t)) return;
  state.connectedPaths.push(t);
  persistGitSelectionState();
}

/** 앱 시작 시 저장된 프로젝트 연결 경로가 여전히 유효한 git 저장소인지 검사하고,
 *  죽은 경로(삭제됨/다른 저장소/존재하지 않음)는 자동으로 정리한다. */
async function cleanupStaleProjectConnections(): Promise<void> {
  const keys = Object.keys(state.projectConnectPaths);
  if (keys.length === 0) return;
  let changed = false;
  for (const key of keys) {
    const stored = (state.projectConnectPaths[key] ?? '').trim();
    if (!stored) continue;
    const project = state.projects.find((item) => item.name === key || item.id === key);
    try {
      const identity = await window.hub.connectGitRepository({ directory: stored });
      // 유효한 git 저장소라도 선택 프로젝트의 원격 URL과 다르면 죽은 연결로 본다.
      if (project) {
        // 원격 URL 동일성 판정은 shared/repo-identity 의 단일 구현만 사용합니다.
        // 로컬 클론이 ssh(SCP) 형식 원격을 쓰더라도 중앙 정의(https)와 같은
        // 저장소로 인식되어, 유효한 연결이 죽은 연결로 오판·삭제되지 않습니다.
        if (!isSameRepository(identity.url, project.url)) {
          delete state.projectConnectPaths[key];
          delete state.projectConnectMessages[key];
          changed = true;
        }
      }
    } catch {
      // 경로가 유효한 git 저장소가 아니면 제거한다.
      delete state.projectConnectPaths[key];
      delete state.projectConnectMessages[key];
      changed = true;
    }
  }
  if (changed) {
    persistGitSelectionState();
    // 저장소 드롭다운과 연결 메시지도 갱신해 죽은 경로가 화면에 남지 않게 한다.
    renderGitRepositoryOptions();
    if (mainGitController) void mainGitController.refresh();
  }
}


function addDashboardGitCard(options?: { initialPath?: string; entry?: CardEntry }): void {
  const restoreEntry = options?.entry;
  const project = $.dashboardProject.value;
  if (!project) {
    setStatus('먼저 프로젝트를 선택하세요.');
    return;
  }
  const primary = $.gitBranches.closest<HTMLElement>('.card');
  if (!primary) return;
  const card = primary.cloneNode(true) as HTMLElement;
  card.classList.add('dashboard-extra-card');
  card.querySelectorAll<HTMLElement>('[id]').forEach((element) => element.removeAttribute('id'));
  trackCardFocus(card);
  const refresh = card.querySelector<HTMLButtonElement>('.card-head button')!;
  const branches = card.querySelector<HTMLElement>('.git-branch-picker')!;
  branches.innerHTML = '';
  // 요약은 .stack 의 직계 .muted 입니다(.card-connect 안의 상태 스팬과 구분).
  const summary = card.querySelector<HTMLElement>('.stack > .muted')!;
  const conflicts = card.querySelector<HTMLElement>('.conflicts')!;
  const table = card.querySelector<HTMLTableElement>('table')!;
  const currentBranch = card.querySelector<HTMLElement>('.git-current-branch') ?? undefined;
  const connectBtn = card.querySelector<HTMLButtonElement>('.card-connect button')!;
  const connectMsg = card.querySelector<HTMLElement>('.card-connect span')!;
  const repoPathEl = card.querySelector<HTMLElement>('.git-repository-path')!;
  const buttons = card.querySelectorAll<HTMLButtonElement>('.row button');
  const commit = buttons[0]!;
  const push = buttons[1]!;
  const pull = buttons[2] as HTMLButtonElement | undefined;
  const discard = buttons[3] as HTMLButtonElement | undefined;
  const report = buttons[4] as HTMLButtonElement | undefined;
  push.classList.add('push-button');
  // 일일 요약 등록 버튼은 관리자(admin) 라이선스에서만 노출합니다.
  const extraIsAdminRole = state.dashboard?.role === "admin";
  if (report) report.hidden = !extraIsAdminRole;
  const error = card.querySelector<HTMLElement>('.error-text')!;
  let busy = false;
  let clean = true;
  let cardPendingPush = false;
  let cardGitCache: GitStatusView | null = null;
  let cardBranchNames: string[] = [];
  const cardId = restoreEntry?.id ?? 'git-card-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  // 이 카드(패널) 전용 로컬 저장소 폴더. 카드마다 따로 지정할 수 있습니다.
  let cardLocalPath = (restoreEntry?.localPath ?? '').trim();
  const repoPath = (): string => resolveRepositoryPath(project, cardLocalPath);
  const renderRepoPath = (): void => {
    const resolved = repoPath();
    repoPathEl.textContent = repositoryPathLabel(project, resolved);
    repoPathEl.className = resolved ? 'git-repository-path' : 'git-repository-path error-text';
  };
  renderRepoPath();
  const setConnectMessage = (message: string, isError = false): void => {
    connectMsg.textContent = message;
    connectMsg.className = isError ? 'error-text' : 'muted';
  };
  setConnectMessage(cardLocalPath ? '연결됨: ' + cardLocalPath : '경로가 지정되지 않았습니다.', !cardLocalPath);
  const access: GitCardAccess = {
    repoPath: repoPath,
    readGit: () => cardGitCache,
    writeGit: (git) => { cardGitCache = git; },
    branchNames: () => cardBranchNames,
    writeBranchNames: (branches) => { cardBranchNames = branches; },
    readWork: () => currentCardBranches(cardId),
    writeWork: (list) => saveCardBranches(cardId, list),
    readActive: () => currentCardActiveBranches(cardId),
    writeActive: (list) => saveCardActiveBranches(cardId, list),
    readBusy: () => busy,
    writeBusy: (value) => { busy = value; },
    readClean: () => clean,
    writeClean: (value) => { clean = value; },
    readPendingPush: () => cardPendingPush,
    writePendingPush: (pending) => { cardPendingPush = pending; },
  };
  const controller = mountGitCard({
    repoPath: repoPath,
    refreshBtn: refresh,
    branchesEl: branches,
    summary: summary,
    conflicts: conflicts,
    table: table,
    commitBtn: commit,
    pushBtn: push,
    pullBtn: pull,
    discardBtn: discard,
    reportBtn: report,
    errorEl: error,
    currentBranchEl: currentBranch,
  }, access);
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'ghost danger';
  removeButton.textContent = '카드 삭제';
  removeButton.addEventListener('click', () => {
    removeCardEntry(cardId);
    card.remove();
  });
  card.querySelector('.card-head')!.append(removeButton);
  $.dashboardAddCard.before(card);
  ensureCardEntry(cardId, repoPath(), cardLocalPath);
  extraCardControllers.set(card, controller);
  void controller.refresh();

  // 이 패널 전용 저장소 폴더를 고릅니다.
  connectBtn.addEventListener('click', () => void chooseCardRepositoryFolder({
    setMessage: setConnectMessage,
    applyPath: (picked) => {
      cardLocalPath = picked;
      saveCardLocalPath(cardId, picked);
    },
    refreshCards: () => {
      renderRepoPath();
      moveCardEntry(cardId, repoPath());
      void controller.refresh();
    },
  }));
}

function restoreDashboardGitCards(): void {
  const project = currentlySelectedProject();
  const saved = state.gitCardsByProject[project];
  if (!saved || saved.length === 0) return;
  let added = 0;
  for (let index = 0; index < saved.length; index += 1) {
    const entry = saved[index];
    if (!entry) continue;
    addDashboardGitCard({ entry });
    added += 1;
  }
  if (added === 0) setStatus("저장된 Git 카드가 없습니다.");
}

function buildWorkBranchPicker(options: {
  container: HTMLElement;
  names: string[];
  current: string;
  selected?: string[];
  active?: string[];
  onActiveChange?: (active: string[]) => void;
  onSwitch: (branch: string) => Promise<void>;
  onChange?: (branches: string[]) => void;
  onOpenRefresh?: () => Promise<string[]>;
}): void {
  const { container, names, current, onSwitch, onChange, onActiveChange, onOpenRefresh } = options;
  container.innerHTML = "";
  // 저장된 값(빈 배열 포함)이 전달되면 그대로 사용하고, 없을 때만 현재 브랜치로 채운다.
  const seed = Array.isArray(options.selected) ? options.selected : [current];
  const workBranches: string[] = [];
  for (const branch of seed) {
    if (!workBranches.includes(branch)) workBranches.push(branch);
  }
  const activeBranches: string[] = [];
  const seedActive = Array.isArray(options.active) ? options.active : seed;
  for (const branch of seedActive) {
    if (workBranches.includes(branch) && !activeBranches.includes(branch)) activeBranches.push(branch);
  }
  const select = document.createElement("select");
  select.className = "branch-select";
  // 드롭다운에 띄울 문구: 활성 브랜치가 하나면 그 이름, 여러 개면 안내, 없으면 기본 안내.
  const selectLabel = (): string => {
    if (activeBranches.length === 1) return activeBranches[0]!;
    if (activeBranches.length > 1) return "활성 메인 브랜치 선택 불가";
    return "작업 브랜치 선택…";
  };
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = selectLabel();
  select.appendChild(placeholder);
  appendBranchOptions(select, names.filter((branch) => !workBranches.includes(branch)));
  select.addEventListener("change", () => {
    const branch = select.value;
    select.value = "";
    if (!branch || workBranches.includes(branch)) return;
    workBranches.push(branch);
    if (!activeBranches.includes(branch)) activeBranches.push(branch);
    const target = activeBranches.length > 0 ? activeBranches[0]! : branch;
    void onSwitch(target);
    renderChips();
    refreshSelectOptions();
    onChange?.(workBranches.slice());
    onActiveChange?.(activeBranches.slice());
  });
  const topRow = document.createElement("div");
  topRow.className = "branch-top-row";
  topRow.appendChild(select);
  container.appendChild(topRow);
  let openRefreshInFlight = false;
  const refreshFromSource = async (): Promise<void> => {
    if (!onOpenRefresh || openRefreshInFlight) return;
    openRefreshInFlight = true;
    try {
      const fresh = await onOpenRefresh();
      if (Array.isArray(fresh)) {
        names.length = 0;
        for (const branch of fresh) { if (!names.includes(branch)) names.push(branch); }
        refreshSelectOptions();
        renderChips();
        updateAllInput();
      }
    } finally {
      openRefreshInFlight = false;
    }
  };
  select.addEventListener("mousedown", () => void refreshFromSource());
  select.addEventListener("focus", () => void refreshFromSource());
  function refreshSelectOptions(): void {
    const current = select.value;
    select.innerHTML = "";
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = selectLabel();
    select.appendChild(placeholderOpt);
    appendBranchOptions(select, names.filter((branch) => !workBranches.includes(branch)));
    select.value = current && !workBranches.includes(current) ? current : "";
  }
  const allRow = document.createElement("label");
  allRow.className = "branch-all-row";
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allInput.title = "전체 선택";
  allInput.addEventListener("change", () => {
    activeBranches.length = 0;
    if (allInput.checked) for (const branch of workBranches) activeBranches.push(branch);
    renderChips();
    updateAllInput();
    refreshSelectOptions();
    onActiveChange?.(activeBranches.slice());
    if (activeBranches.length > 0) void onSwitch(activeBranches[0]!);
  });
  const allText = document.createElement("span");
  allText.textContent = "전체 선택";
  allRow.append(allInput, allText);
  topRow.appendChild(allRow);
  const chips = document.createElement("div");
  chips.className = "branch-options";
  container.appendChild(chips);
  function updateAllInput(): void {
    allInput.checked = workBranches.length > 0 && activeBranches.length === workBranches.length;
  }
  function renderChips(): void {
    chips.innerHTML = "";
    if (workBranches.length === 0) {
      chips.textContent = "선택된 작업 브랜치가 없습니다.";
      updateAllInput();
      return;
    }
    const nameOrder = new Map<string, number>();
    names.forEach((name, index) => { if (!nameOrder.has(name)) nameOrder.set(name, index); });
    const orderedBranches = workBranches.slice().sort((a, b) => {
      const ai = nameOrder.get(a);
      const bi = nameOrder.get(b);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
    for (const branch of orderedBranches) {
      const label = document.createElement("span");
      const isActive = activeBranches.includes(branch);
      label.className = "branch-option" + (isActive ? " active" : "");
      const activeInput = document.createElement("input");
      activeInput.type = "checkbox";
      activeInput.className = "branch-active-cb";
      activeInput.checked = isActive;
      activeInput.title = "활성/비활성";
      activeInput.addEventListener("change", (event) => {
        event.stopPropagation();
        if (activeInput.checked) {
          if (!activeBranches.includes(branch)) activeBranches.push(branch);
        } else {
          const index = activeBranches.indexOf(branch);
          if (index >= 0) activeBranches.splice(index, 1);
        }
        renderChips();
        refreshSelectOptions();
        onActiveChange?.(activeBranches.slice());
        if (activeBranches.length > 0) void onSwitch(activeBranches[0]!);
      });
      const text = document.createElement("span");
      text.textContent = branch;
      const toggle = document.createElement("label");
      toggle.className = "branch-toggle";
      toggle.append(activeInput, text);
      label.append(toggle);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.textContent = "×";
      remove.title = "작업 브랜치에서 제거";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = workBranches.indexOf(branch);
        if (index >= 0) workBranches.splice(index, 1);
        const activeIndex = activeBranches.indexOf(branch);
        if (activeIndex >= 0) activeBranches.splice(activeIndex, 1);
        renderChips();
        refreshSelectOptions();
        onChange?.(workBranches.slice());
        onActiveChange?.(activeBranches.slice());
      });
      label.appendChild(remove);
      chips.appendChild(label);
    }
    updateAllInput();
  }
  renderChips();
}

async function saveProjectAssignments(repositories: GitRepositorySetting[]): Promise<void> {
  const api = settingsHub();
  if (!api) return;
  const payload = repositories.map((item) => ({
    ...item,
    project: item.project?.trim() || undefined,
    notionDatabaseId: item.notionDatabaseId?.trim() || undefined,
  }));
  await api.saveSettings({ HUB_GIT_REPOSITORIES: JSON.stringify(payload) });
  state.repositoryDrafts = [];
  await refreshState();
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function settingsHub(): HubSettingsApi | null {
  const candidate = window.hub as unknown as HubSettingsApi;
  if (
    typeof candidate.getSettings === "function" &&
    typeof candidate.saveSettings === "function" &&
    typeof candidate.testIntegrations === "function"
  ) {
    return candidate;
  }
  return null;
}

function setSettingsMessage(message: string, color: "success" | "error" | "neutral" = "neutral"): void {
  $.settingsMessage.textContent = message;
  $.settingsMessage.className = color === "success" ? "success-text" : color === "error" ? "error-text" : "muted";
}

function setSettingsBusy(busy: boolean): void {
  $.settingsSave.disabled = busy;
  $.settingsTest.disabled = busy;
}


// ----- 칸반보드 (Notion 동기화) -----

let kanbanDragCardId: string | null = null;

async function refreshKanban(): Promise<void> {
  if (state.kanbanBusy) return;
  state.kanbanBusy = true;
  try {
    const board = await window.hub.getKanbanBoard();
    renderKanban(board);
  } catch (error) {
    $.kanbanMessage.className = "error-text";
    $.kanbanMessage.textContent = "칸반보드를 불러오지 못했습니다: " + (error instanceof Error ? error.message : String(error));
  } finally {
    state.kanbanBusy = false;
  }
}

function renderKanban(board: KanbanBoard): void {
  state.kanban = board;
  $.kanbanBoardTitle.textContent = board.databaseTitle || "칸반보드";
  $.kanbanBoardMeta.textContent = board.message
    ? board.message
    : board.fetchedAt
      ? "마지막 동기화 " + formatTime(board.fetchedAt) + " · 카드 " + board.cards.length + "개"
      : "";
  $.kanbanMessage.className = "muted";
  $.kanbanMessage.textContent = "";

  $.kanbanBoard.innerHTML = "";
  for (const column of board.columns) {
    const columnEl = document.createElement("div");
    columnEl.className = "kanban-column";
    columnEl.dataset.columnId = column.id;

    const head = document.createElement("div");
    head.className = "kanban-column-head";
    const count = board.cards.filter((card) => card.columnId === column.id).length;
    head.textContent = column.name + " (" + count + ")";
    columnEl.appendChild(head);

    const list = document.createElement("div");
    list.className = "kanban-cards";
    list.dataset.columnId = column.id;
    // 드롭 대상
    list.addEventListener("dragover", (event) => {
      if (kanbanDragCardId) event.preventDefault();
      list.classList.add("kanban-drop");
    });
    list.addEventListener("dragleave", () => list.classList.remove("kanban-drop"));
    list.addEventListener("drop", (event) => {
      event.preventDefault();
      list.classList.remove("kanban-drop");
      const cardId = kanbanDragCardId ?? event.dataTransfer?.getData("text/plain") ?? "";
      kanbanDragCardId = null;
      if (cardId) void moveKanbanCardTo(cardId, column.id);
    });

    for (const card of board.cards.filter((item) => item.columnId === column.id)) {
      list.appendChild(renderKanbanCard(card));
    }
    columnEl.appendChild(list);
    $.kanbanBoard.appendChild(columnEl);
  }

  // 열이 하나도 없을 때 안내
  if (board.columns.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = board.readOnly
      ? "이 데이터베이스는 칸반 열로 쓸 status/select 속성이 없습니다."
      : "표시할 열이 없습니다.";
    $.kanbanBoard.appendChild(empty);
  }
}

function renderKanbanCard(card: KanbanBoard["cards"][number]): HTMLElement {
  const el = document.createElement("div");
  el.className = "kanban-card";
  el.draggable = true;
  el.dataset.cardId = card.id;

  const title = document.createElement("div");
  title.className = "kanban-card-title";
  title.textContent = card.title;
  el.appendChild(title);

  if (card.assignees.length > 0) {
    const meta = document.createElement("div");
    meta.className = "kanban-card-meta";
    meta.textContent = card.assignees.join(", ");
    el.appendChild(meta);
  }

  const actions = document.createElement("div");
  actions.className = "kanban-card-actions";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost danger kanban-card-delete";
  remove.textContent = "삭제";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    void deleteKanbanCard(card.id);
  });
  actions.appendChild(remove);
  el.appendChild(actions);

  el.addEventListener("dragstart", (event) => {
    kanbanDragCardId = card.id;
    event.dataTransfer?.setData("text/plain", card.id);
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => {
    kanbanDragCardId = null;
    el.classList.remove("dragging");
  });
  return el;
}

/** 낙관적 이동: 화면을 먼저 옮기고 서버 반영 후 보드를 맞춥니다. */
async function moveKanbanCardTo(cardId: string, columnId: string): Promise<void> {
  const board = state.kanban;
  if (!board) return;
  const card = board.cards.find((item) => item.id === cardId);
  if (!card || card.columnId === columnId) return;
  const previousColumn = card.columnId;
  card.columnId = columnId;
  renderKanban(board);
  try {
    const next = await window.hub.moveKanbanCard({ cardId, columnId, expectedEditedAt: card.lastEditedAt });
    renderKanban(next);
  } catch (error) {
    card.columnId = previousColumn;
    renderKanban(board);
    $.kanbanMessage.className = "error-text";
    $.kanbanMessage.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function applyKanbanDatabase(): Promise<void> {
  const url = $.kanbanDbUrl.value.trim();
  if (!url) {
    $.kanbanMessage.className = "error-text";
    $.kanbanMessage.textContent = "노션 데이터베이스 링크를 입력하세요.";
    return;
  }
  $.kanbanDbApply.disabled = true;
  $.kanbanMessage.className = "muted";
  $.kanbanMessage.textContent = "연결을 확인하는 중입니다…";
  try {
    const board = await window.hub.setKanbanDatabase(url);
    $.kanbanDbUrl.value = "";
    renderKanban(board);
    $.kanbanMessage.className = "muted";
    $.kanbanMessage.textContent = "'" + (board.databaseTitle || "데이터베이스") + "'에 연결했습니다.";
  } catch (error) {
    $.kanbanMessage.className = "error-text";
    $.kanbanMessage.textContent = "연결 실패: " + (error instanceof Error ? error.message : String(error));
  } finally {
    $.kanbanDbApply.disabled = false;
  }
}

async function createKanbanCard(): Promise<void> {
  const title = $.kanbanNewTitle.value.trim();
  if (!title) {
    $.kanbanMessage.className = "error-text";
    $.kanbanMessage.textContent = "카드 제목을 입력하세요.";
    return;
  }
  const firstColumn = state.kanban?.columns[0]?.id;
  try {
    const board = await window.hub.createKanbanCard({ title, columnId: firstColumn });
    $.kanbanNewTitle.value = "";
    renderKanban(board);
  } catch (error) {
    $.kanbanMessage.className = "error-text";
    $.kanbanMessage.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function deleteKanbanCard(cardId: string): Promise<void> {
  try {
    const board = await window.hub.deleteKanbanCard({ cardId });
    renderKanban(board);
  } catch (error) {
    $.kanbanMessage.className = "error-text";
    $.kanbanMessage.textContent = error instanceof Error ? error.message : String(error);
  }
}

function switchMainPanel(panel: "dashboard" | "automation" | "kanban" | "settings"): void {
  $.panelDashboard.hidden = panel !== "dashboard";
  $.panelAutomation.hidden = panel !== "automation";
  $.panelKanban.hidden = panel !== "kanban";
  $.panelSettings.hidden = panel !== "settings";
  $.pageTitle.textContent = panel === "dashboard" ? "대시보드" : panel === "automation" ? "일일 작업등록" : "설정";
  $.mainTabDashboard.classList.toggle("active", panel === "dashboard");
  $.mainTabAutomation.classList.toggle("active", panel === "automation");
  $.mainTabKanban.classList.toggle("active", panel === "kanban");
  $.mainTabSettings.classList.toggle("active", panel === "settings");
  if (panel === "dashboard") {
    const repos = state.dashboard?.config.repositories ?? [];
    if (repos.length > 0) void refreshState();
  } else if (panel === "settings" && state.settings === null) {
    void refreshSettings();
  }
}


// ----- 자동 업데이트 -----

const UPDATE_PHASE_LABELS: Record<UpdateStatus["phase"], string> = {
  disabled: "사용 안 함",
  idle: "확인 전",
  checking: "확인 중",
  available: "새 버전 있음",
  downloading: "내려받는 중",
  downloaded: "설치 준비됨",
  "not-available": "최신 버전",
  error: "오류",
};

const UPDATE_PHASE_CLASS: Record<UpdateStatus["phase"], string> = {
  disabled: "off",
  idle: "off",
  checking: "running",
  available: "running",
  downloading: "running",
  downloaded: "succeeded",
  "not-available": "on",
  error: "error",
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return size.toFixed(unit === 0 ? 0 : 1) + " " + units[unit];
}

async function refreshUpdateStatus(): Promise<void> {
  const status = await window.hub.getUpdateStatus();
  if (status) renderUpdate(status);
}

function renderUpdate(status: UpdateStatus): void {
  state.update = status;
  const label = UPDATE_PHASE_LABELS[status.phase] ?? status.phase;
  $.updatePhasePill.textContent = label;
  $.updatePhasePill.className = "status-pill " + (UPDATE_PHASE_CLASS[status.phase] ?? "off");
  $.updateCurrentVersion.textContent = status.currentVersion ? "v" + status.currentVersion : "-";

  // 사이드바 표시기
  $.updateIndicator.dataset.phase = status.phase;
  $.updateIndicatorText.textContent = status.latestVersion && status.phase !== "not-available"
    ? "v" + status.currentVersion + " → v" + status.latestVersion
    : "v" + status.currentVersion;

  $.updateLatest.textContent = status.latestVersion
    ? "최신 확인 버전: v" + status.latestVersion + (status.checkedAt ? " (" + formatTime(status.checkedAt) + " 확인)" : "")
    : "";

  const showProgress = status.phase === "downloading" && status.progress;
  $.updateProgressWrap.hidden = !showProgress;
  if (showProgress && status.progress) {
    const percent = Math.round(status.progress.percent);
    $.updateProgressBar.style.width = percent + "%";
    $.updateProgressText.textContent =
      percent + "% · " + formatBytes(status.progress.transferred) + " / " + formatBytes(status.progress.total) +
      (status.progress.bytesPerSecond > 0 ? " · " + formatBytes(status.progress.bytesPerSecond) + "/s" : "");
  }

  const showNotes = Boolean(status.releaseNotes) && (status.phase === "available" || status.phase === "downloaded" || status.phase === "downloading");
  $.updateNotesWrap.hidden = !showNotes;
  $.updateNotes.textContent = showNotes ? (status.releaseNotes ?? "") : "";

  $.updateMessage.textContent = status.message;
  $.updateMessage.className = status.phase === "error" ? "error-text" : "muted";
  $.updateDetail.textContent = status.phase === "error" ? (status.detail ?? "") : "";

  const busy = status.phase === "checking" || status.phase === "downloading";
  $.updateCheck.disabled = busy || status.phase === "disabled";
  $.updateInstall.disabled = status.phase !== "downloaded";
  $.updateInstall.hidden = status.phase !== "downloaded";
  $.updateManual.hidden = status.phase !== "error";
}

async function performCheckForUpdates(): Promise<void> {
  $.updateCheck.disabled = true;
  $.updateMessage.className = "muted";
  $.updateMessage.textContent = "업데이트를 확인하는 중입니다…";
  try {
    const status = await window.hub.checkForUpdates();
    if (status) renderUpdate(status);
  } catch (error) {
    $.updateMessage.className = "error-text";
    $.updateMessage.textContent = "업데이트 확인 실패: " + (error instanceof Error ? error.message : String(error));
  } finally {
    $.updateCheck.disabled = false;
  }
}

async function performInstallUpdate(): Promise<void> {
  const status = state.update;
  if (!status || status.phase !== "downloaded") return;
  $.updateInstall.disabled = true;
  $.updateMessage.className = "muted";
  $.updateMessage.textContent = "설치를 시작합니다. 앱이 잠시 후 다시 시작됩니다…";
  try {
    await window.hub.installUpdate();
  } catch (error) {
    $.updateInstall.disabled = false;
    $.updateMessage.className = "error-text";
    $.updateMessage.textContent = "설치 실패: " + (error instanceof Error ? error.message : String(error));
  }
}

function openManualDownload(): void {
  const url = state.update?.manualDownloadUrl;
  if (url) window.open(url, "_blank", "noopener");
}

function switchSettingsPanel(panel: "env" | "git" | "notion" | "discord" | "license" | "gitaccess" | "apikey" | "update"): void {
  $.settingsPaneEnv.hidden = panel !== "env";
  $.settingsPaneGit.hidden = panel !== "git";
  $.settingsPaneNotion.hidden = panel !== "notion";
  $.settingsPaneDiscord.hidden = panel !== "discord";
  $.settingsPaneLicense.hidden = panel !== "license";
  $.settingsPaneGitAccess.hidden = panel !== "gitaccess";
  $.settingsPaneApikey.hidden = panel !== "apikey";
  $.settingsPaneUpdate.hidden = panel !== "update";
  $.settingsTabEnv.classList.toggle("active", panel === "env");
  $.settingsTabGit.classList.toggle("active", panel === "git");
  $.settingsTabNotion.classList.toggle("active", panel === "notion");
  $.settingsTabDiscord.classList.toggle("active", panel === "discord");
  $.settingsTabLicense.classList.toggle("active", panel === "license");
  $.settingsTabGitAccess.classList.toggle("active", panel === "gitaccess");
  $.settingsTabApikey.classList.toggle("active", panel === "apikey");
  $.settingsTabUpdate.classList.toggle("active", panel === "update");
  if (panel === "update") void refreshUpdateStatus();
}

async function refreshSettings(): Promise<void> {
  const api = settingsHub();
  if (!api) {
    $.settingsApiMissing.hidden = false;
    setSettingsBusy(true);
    setSettingsMessage("Settings API가 연결되지 않았습니다.");
    return;
  }
  $.settingsApiMissing.hidden = true;
  try {
    state.settings = await api.getSettings();
    state.settingsDrafts = {};
   renderSettingsForm();
   renderSettingsRepositories();
   renderSettingsNotion();
   renderSettingsDiscord();
    renderSettingsApiKey();
    renderSettingsGitAccess();
    setSettingsMessage("설정을 불러왔습니다.");
  } catch (error) {
    setSettingsMessage(`설정 로드 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderSettingsForm(): void {
  const settings = state.settings;
  $.settingsGroups.innerHTML = "";
  if (!settings) return;

  let lastGroup: string | null = null;
  let groupContainer: HTMLElement | null = null;

  for (const field of settings.fields) {
   if (field.key === "HUB_GIT_REPOSITORIES") continue; // managed by Git repositories tab
   if (field.key === "HUB_DAILY_AUTOMATION_PROJECTS") continue; // managed by Automation tab
    if (field.adminOnly) continue; // managed by API 키 tab (관리자 전용)
   if (field.group !== lastGroup) {
      groupContainer = document.createElement("div");
      groupContainer.className = "settings-group";
      const heading = document.createElement("h3");
      heading.textContent = field.group;
      groupContainer.appendChild(heading);
      $.settingsGroups.appendChild(groupContainer);
      lastGroup = field.group;
    }
    groupContainer?.appendChild(settingsFieldRow(field));
  }
}

function settingsFieldRow(field: SettingFieldView): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting-field";

  const label = document.createElement("label");
  label.htmlFor = `env-${field.key}`;

  const titleRow = document.createElement("div");
  titleRow.className = "setting-label-row";
  const name = document.createElement("span");
  name.className = "setting-label";
  name.textContent = field.label;
  titleRow.appendChild(name);
  if (field.kind === "secret") {
    const badge = document.createElement("span");
    badge.className = field.configured ? "badge badge-on" : "badge badge-off";
    badge.textContent = field.configured ? "설정됨" : "미설정";
    titleRow.appendChild(badge);
  }

  const inputRow = document.createElement("div");
  inputRow.className = "setting-input-row";
  const input = document.createElement("input") as HTMLInputElement;
  input.id = `env-${field.key}`;
  input.name = field.key;
  input.dataset["key"] = field.key;
  if (field.kind === "secret") {
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = field.configured ? "•••••• (비우면 기존 값 유지)" : "미설정 (입력 시 새 값)";
  } else if (field.kind === "number") {
    input.type = "number";
    input.placeholder = field.value;
  } else {
    input.type = "text";
    input.placeholder = field.value;
  }

  const draft = state.settingsDrafts[field.key];
  input.value = field.kind === "secret" ? "" : draft ?? field.value;
  inputRow.appendChild(input);

  if (field.kind === "secret") {
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "ghost reveal-toggle";
    reveal.textContent = "표시";
    reveal.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      reveal.textContent = show ? "숨김" : "표시";
    });
    inputRow.appendChild(reveal);
  }

  label.appendChild(titleRow);
  label.appendChild(inputRow);
  row.appendChild(label);

  if (field.hint) {
    const hint = document.createElement("span");
    hint.className = "muted";
    hint.textContent = field.hint;
    row.appendChild(hint);
  }

  return row;
}

function collectSettingsValues(): Record<string, string> {
  const values: Record<string, string> = {};
  if (!state.settings) return values;
  for (const field of state.settings.fields) {
   if (field.key === "HUB_GIT_REPOSITORIES") continue; // managed by Git repositories tab
   if (field.key === "HUB_DAILY_AUTOMATION_PROJECTS") continue; // managed by Automation tab
    if (field.adminOnly) continue; // managed by API 키 tab (관리자 전용)
   const input = document.getElementById(`env-${field.key}`) as HTMLInputElement | null;
    const raw = input?.value ?? "";
    if (field.kind === "secret") {
      if (raw !== "") values[field.key] = raw;
    } else {
      values[field.key] = raw;
    }
  }
  return values;
}

/** 관리자 전용 API 키 필드(Gemini 등)를 API 키 탭에 렌더링합니다. */

/** GitHub 접속 토큰 필드를 "Git 접속" 탭에 렌더링합니다(일반 사용자도 비공개 저장소를 쓸 수 있게). */
function renderSettingsGitAccess(): void {
  const settings = state.settings;
  $.settingsGitAccessGroup.innerHTML = "";
  if (!settings) return;
  const field = settings.fields.find((item) => item.key === "GITHUB_TOKEN");
  if (!field) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "GitHub 토큰 설정 항목을 찾을 수 없습니다.";
    $.settingsGitAccessGroup.appendChild(empty);
    return;
  }
  $.settingsGitAccessGroup.appendChild(settingsFieldRow(field));
  // GitHub 계정이 없는 사용자를 위해 SSH 배포 키 경로 입력란도 함께 제공합니다.
  const sshField = settings.fields.find((item) => item.key === "GIT_SSH_KEY_PATH");
  if (sshField) $.settingsGitAccessGroup.appendChild(settingsFieldRow(sshField));
}

/** Git 접속 탭에서 입력한 GitHub 토큰을 저장합니다(비우면 기존 값 유지). */
async function performSaveGitAccess(): Promise<void> {
  const api = settingsHub();
  if (!api || state.settingsBusy) return;
  const input = document.getElementById("env-GITHUB_TOKEN") as HTMLInputElement | null;
  const raw = input?.value ?? "";
  const sshInput = document.getElementById("env-GIT_SSH_KEY_PATH") as HTMLInputElement | null;
  const sshPath = sshInput?.value ?? "";
  state.settingsBusy = true;
  $.settingsGitAccessSave.disabled = true;
  $.settingsGitAccessMessage.textContent = "토큰 저장 중…";
  $.settingsGitAccessMessage.className = "muted";
  try {
    const result = await api.saveSettings({ GITHUB_TOKEN: raw, GIT_SSH_KEY_PATH: sshPath });
    state.settings = result.settings;
    renderSettingsGitAccess();
    $.settingsGitAccessMessage.textContent = result.message || "GitHub 토큰이 저장되었습니다.";
    $.settingsGitAccessMessage.className = "success-text";
    void refreshState();
  } catch (error) {
    $.settingsGitAccessMessage.textContent = "저장 실패: " + (error instanceof Error ? error.message : String(error));
    $.settingsGitAccessMessage.className = "error-text";
  } finally {
    state.settingsBusy = false;
    $.settingsGitAccessSave.disabled = false;
  }
}

 function renderSettingsApiKey(): void {
   const settings = state.settings;
   $.settingsApikeyGroup.innerHTML = "";
   if (!settings) return;
   const fields = settings.fields.filter((field) => field.adminOnly);
   if (fields.length === 0) {
     const emptyRow = document.createElement("div");
     emptyRow.className = "muted";
     emptyRow.textContent = "관리자 전용 API 키 설정 항목이 없습니다.";
     $.settingsApikeyGroup.appendChild(emptyRow);
     return;
   }
   for (const field of fields) {
     $.settingsApikeyGroup.appendChild(settingsFieldRow(field));
   }
 }
 
 function collectApiKeyValues(): Record<string, string> {
   const values: Record<string, string> = {};
   if (!state.settings) return values;
   for (const field of state.settings.fields) {
     if (!field.adminOnly) continue;
     const input = document.getElementById("env-" + field.key) as HTMLInputElement | null;
     const raw = input?.value ?? "";
     if (field.kind === "secret") {
       if (raw !== "") values[field.key] = raw;
     } else {
       values[field.key] = raw;
     }
   }
   return values;
 }
 
 async function performSaveApiKeySettings(): Promise<void> {
   const api = settingsHub();
   if (!api || state.settingsBusy) return;
   state.settingsBusy = true;
   $.settingsApikeySave.disabled = true;
   $.settingsApikeyMessage.textContent = "API 키 저장 중…";
   $.settingsApikeyMessage.className = "muted";
   try {
     const result = await api.saveSettings(collectApiKeyValues());
     state.settings = result.settings;
     renderSettingsApiKey();
     $.settingsApikeyMessage.textContent = result.message || "API 키가 저장되었습니다.";
     $.settingsApikeyMessage.className = "success-text";
     void refreshState();
   } catch (error) {
     $.settingsApikeyMessage.textContent = "저장 실패: " + (error instanceof Error ? error.message : String(error));
     $.settingsApikeyMessage.className = "error-text";
   } finally {
     state.settingsBusy = false;
     $.settingsApikeySave.disabled = false;
   }
 }
 
async function performSaveSettings(source: "manual" | "auto"): Promise<void> {
  const api = settingsHub();
  if (!api || state.settingsBusy) return;
  state.settingsBusy = true;
  setSettingsBusy(true);
  setSettingsMessage(source === "auto" ? "자동 저장 중…" : "저장 중…", "success");
  try {
    const result = await api.saveSettings(collectSettingsValues());
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    state.settingsDrafts = {};
   renderSettingsForm();
   renderSettingsRepositories();
   renderIntegrationStatuses(result.statuses);
    renderSettingsApiKey();
    if (result.restartRequired) {
      $.settingsRestart.hidden = false;
      $.settingsRestart.textContent = "일부 변경 사항(포트 등)은 앱 재시작 후 적용됩니다.";
    } else {
      $.settingsRestart.hidden = true;
    }
    setSettingsMessage(result.message || (source === "auto" ? "자동 저장 완료." : "저장 완료."), "success");
    setStatus(result.message || "Settings saved");
    void refreshState();
    void checkRepositoryConnections();
  } catch (error) {
    setSettingsMessage(`저장 실패: ${error instanceof Error ? error.message : String(error)}`, "error");
    setStatus("Settings save failed");
  } finally {
    state.settingsBusy = false;
    setSettingsBusy(false);
  }
}

async function performTestIntegrations(): Promise<void> {
  const api = settingsHub();
  if (!api || state.settingsBusy) return;
  state.settingsBusy = true;
  setSettingsBusy(true);
  setSettingsMessage("연결 상태 확인 중…");
  try {
    const statuses = await api.testIntegrations();
    state.settingsStatuses = statuses;
    renderIntegrationStatuses(statuses);
    if (state.dashboard) renderHeader(state.dashboard);
    setSettingsMessage(`연결 상태 확인 완료 (${statuses.length}개). 자세한 결과는 '연결 상태' 탭에서 확인하세요.`);
  } catch (error) {
    setSettingsMessage(`연결 테스트 실패: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.settingsBusy = false;
    setSettingsBusy(false);
  }
}

/** 저장소별 Notion DB / Discord 채널 연결 검사를 실행해 상단 상태 점에 즉시 반영합니다. */
async function checkRepositoryConnections(): Promise<void> {
  const api = window.hub as unknown as HubSettingsApi & {
    checkRepositoryConnections?: () => Promise<RepositoryConnectionCheck[]>;
  };
  if (typeof api.checkRepositoryConnections !== "function") return;
  try {
    const checks = await api.checkRepositoryConnections();
    const notionByRepo = new Map<string, RepositoryConnectionCheck>();
    const discordByRepo = new Map<string, RepositoryConnectionCheck>();
    for (const check of checks) {
      if (check.integration === "notion") notionByRepo.set(check.repository, check);
      else discordByRepo.set(check.repository, check);
    }
    for (let index = 0; index < state.notionRepositories.length; index += 1) {
      const item = state.notionRepositories[index];
      if (!item) continue;
      const check = notionByRepo.get(item.path);
      if (check) {
        state.notionTestStates[index] = {
          state: check.state === "connected" ? "connected" : "error",
          message: check.message,
        };
      }
    }
    for (let index = 0; index < state.discordRepositories.length; index += 1) {
      const item = state.discordRepositories[index];
      if (!item) continue;
      const check = discordByRepo.get(item.path);
      if (check) {
        state.discordTestStates[index] = {
          state: check.state === "connected" ? "connected" : "error",
          message: check.message,
        };
      }
    }
    if (state.dashboard) renderHeader(state.dashboard);
  } catch {
    // 배치 검사는 보조 기능이므로 실패 시 무시하고 기존 상태를 유지합니다.
  }
}

function renderSettingsRepositories(skipAutoLoad = false): void {
  const configured = state.dashboard?.config.repositories ?? [];
  if (!skipAutoLoad && state.repositoryDrafts.length === 0 && configured.length > 0) {
    state.repositoryDrafts = configured.map((item) => {
      const itemPath = (item.path ?? "").replace(/[\\/]+$/, "");
      return {
        label: item.label ?? "",
        username: item.username ?? "",
        defaultBranch: item.defaultBranch ?? "",
        path: itemPath,
        url: item.url ?? "",
        branches: item.branches ?? [],
        discordMinCommits: item.discordMinCommits ?? 0,
        discordBranches: item.discordBranches ?? [],
        project: item.project ?? "",
        notionDatabaseId: item.notionDatabaseId ?? "",
        notionToken: item.notionToken ?? "",
        discordChannelId: item.discordChannelId ?? "",
      };
    });
  }
  $.settingsRepositories.innerHTML = "";
  for (let index = 0; index < state.repositoryDrafts.length; index += 1) {
    $.settingsRepositories.appendChild(buildSettingsRepositoryCard(index));
  }
  if (state.repositoryDrafts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "등록된 Git 저장소가 없습니다. 저장 버튼을 누르면 빈 목록으로 저장됩니다.";
    $.settingsRepositories.appendChild(empty);
  }
}

/** 카드 헤더에 크게 표시할 프로젝트 이름. 미입력 시 안내 문구를 사용한다. */
function projectDisplayName(project: string | undefined): string {
  const name = (project ?? "").trim();
  return name.length > 0 ? name : "(프로젝트 이름 미입력)";
}

/** 카드 헤더에 마우스를 올렸을 때 보여줄 사용자/라벨/로컬 경로 요약. */
function repoSummaryTitle(username: string | undefined, label: string | undefined, path: string | undefined): string {
  const user = username && username.trim().length > 0 ? username.trim() : "KCWJEDI";
  const field = label && label.trim().length > 0 ? label.trim() : "미입력";
  const local = (path ?? "").trim();
  return "[ " + user + " : " + field + " ]" + (local.length > 0 ? " " + local : "");
}

function buildSettingsRepositoryCard(index: number): HTMLElement {
  const draft = state.repositoryDrafts[index]!;
  const summaryText = (): string => {
    return projectDisplayName(draft.project);
  };
  const summaryTitle = (): string => {
    return repoSummaryTitle(draft.username, draft.label, draft.path);
  };
  const viewItem = state.dashboard?.dailyAutomation.repositories.find((item) => {
    const itemPath = (item.path ?? "").replace(/[\\/]+$/, "");
    const currentPath = draft.path.replace(/[\\/]+$/, "");
    return itemPath === currentPath && currentPath.length > 0;
  });

  const card = document.createElement("div");
  card.className = "repository-card";
  // 기본값(키 없음)은 '접힘'입니다. false로 저장된 카드만 펼쳐 보여줍니다.
  if (state.repositoryCollapsed[index] !== false) card.classList.add("collapsed");

  const head = document.createElement("div");
  head.className = "repository-card-head";
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "repo-toggle";
  toggleButton.title = "세부 내용 열기/닫기";
  toggleButton.setAttribute("aria-expanded", state.repositoryCollapsed[index] === false ? "true" : "false");
  toggleButton.textContent = state.repositoryCollapsed[index] === false ? "▲" : "▼";
  const summary = document.createElement("span");
  summary.className = "repo-summary project-title";
  summary.textContent = summaryText();
  summary.title = summaryTitle();
  // 제목(저장소 이름)을 눌러도 세부 내용이 열리고 닫히게 합니다.
  summary.role = "button";
  summary.tabIndex = 0;
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "repository-label-input";
  labelInput.placeholder = "분야 라벨 (예: 프로그래머, 그래픽, 기획)";
  labelInput.value = draft.label;
  labelInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
    if (!item) return;
    item.label = labelInput.value.trim();
    summary.title = summaryTitle();
  });
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "ghost danger";
  removeButton.textContent = "삭제";
  const toggleDetails = (): void => {
    const nextCollapsed = state.repositoryCollapsed[index] === false;
    state.repositoryCollapsed[index] = nextCollapsed;
    card.classList.toggle("collapsed", nextCollapsed);
    toggleButton.textContent = nextCollapsed ? "▼" : "▲";
    toggleButton.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
  };
  toggleButton.addEventListener("click", toggleDetails);
  summary.addEventListener("click", toggleDetails);
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleDetails();
    }
  });
  removeButton.addEventListener("click", () => {
    state.repositoryDrafts.splice(index, 1);
    renderSettingsRepositories(true);
  });
  head.append(toggleButton, summary, removeButton);
  card.appendChild(head);
  const labelTitle = document.createElement("div");
  labelTitle.className = "setting-label repo-field-title";
  labelTitle.textContent = "분야 라벨";
  card.appendChild(labelTitle);
  card.appendChild(labelInput);

  const projectLabel = document.createElement("label");
  projectLabel.className = "repository-url-field";
  projectLabel.textContent = "프로젝트 이름";
  const projectInput = document.createElement("input");
  projectInput.type = "text";
  projectInput.className = "repository-project-input";
  projectInput.placeholder = "예: DiceGambit";
  projectInput.value = draft.project ?? "";
  projectInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
    if (item) item.project = projectInput.value.trim();
    summary.textContent = summaryText();
  });
  projectLabel.appendChild(projectInput);
  card.appendChild(projectLabel);

  const pathTitle = document.createElement("div");
  pathTitle.className = "setting-label repo-field-title";
  pathTitle.textContent = "프로젝트 로컬 저장소";
  card.appendChild(pathTitle);
  const pathRow = document.createElement("div");
  pathRow.className = "repository-picker";
  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.className = "repository-path-input";
  pathInput.placeholder = "예: W:\\\\WorkSpace\\\\TestGithubProject";
  pathInput.value = draft.path;
  pathInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
    if (!item) return;
    item.path = pathInput.value.trim();
    summary.title = summaryTitle();
  });
  const chooseButton = document.createElement("button");
  chooseButton.type = "button";
  chooseButton.className = "ghost";
  chooseButton.textContent = "폴터 선택";
  chooseButton.addEventListener("click", async () => {
    const selected = await window.hub.chooseGitRepository();
    if (!selected) return;
    const item = state.repositoryDrafts[index];
    if (!item) return;
    item.path = selected;
    renderSettingsRepositories();
  });
  pathRow.append(pathInput, chooseButton);
  card.appendChild(pathRow);

  const usernameLabel = document.createElement("label");
  usernameLabel.className = "repository-url-field";
  usernameLabel.textContent = "GitHub 사용자 이름";
  const usernameInput = document.createElement("input");
  usernameInput.type = "text";
  usernameInput.placeholder = "예: KCWJEDI";
  usernameInput.value = draft.username ?? "";
  usernameInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
    if (item) item.username = usernameInput.value.trim();
    summary.title = summaryTitle();
  });
  usernameLabel.appendChild(usernameInput);
  card.appendChild(usernameLabel);

  const urlLabel = document.createElement("label");
  urlLabel.className = "repository-url-field";
  urlLabel.textContent = "GitHub 저장소 URL";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "repository-url-input";
  urlInput.placeholder = "예: https://github.com/사용자명/저장소명";
  urlInput.value = draft.url ?? "";
  urlInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
    if (!item) return;
    item.url = urlInput.value.trim();
  });
  urlLabel.appendChild(urlInput);
  card.appendChild(urlLabel);

  if (viewItem?.repositoryError) {
    const error = document.createElement("p");
    error.className = "error-text";
    error.textContent = viewItem.repositoryError;
    card.appendChild(error);
  }

  const discordBlock = document.createElement("div");
  discordBlock.className = "discord-condition-block";
  const discordTitle = document.createElement("div");
  discordTitle.className = "setting-label";
  discordTitle.textContent = "Discord 알림 조건";
  discordBlock.appendChild(discordTitle);
  const minimumLabel = document.createElement("label");
  minimumLabel.textContent = "저장소별 최소 커밋 수 (0이면 제한 없음)";
  const minimumInput = document.createElement("input");
  minimumInput.type = "number";
  minimumInput.min = "0";
  minimumInput.step = "1";
  minimumInput.value = String(draft.discordMinCommits ?? 0);
  minimumInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
    if (item) item.discordMinCommits = Math.max(0, Number.parseInt(minimumInput.value || "0", 10) || 0);
  });
  minimumLabel.appendChild(minimumInput);
  discordBlock.appendChild(minimumLabel);

  card.appendChild(discordBlock);
  return card;
}

async function saveRepositories(): Promise<void> {
  const api = settingsHub();
  if (!api) return;
  const missingProjectIndex = state.repositoryDrafts.findIndex(
    (draft) => draft.path.trim().length > 0 && !draft.project?.trim(),
  );
  if (missingProjectIndex >= 0) {
    state.repositoryCollapsed[missingProjectIndex] = false;
    renderSettingsRepositories();
    const input = $.settingsRepositories.querySelectorAll<HTMLInputElement>(".repository-project-input")[missingProjectIndex];
    input?.classList.add("input-required");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus();
    $.settingsRepositoriesMessage.textContent = "프로젝트 이름을 입력해야 저장할 수 있습니다.";
    $.settingsRepositoriesMessage.className = "error-text";
    return;
  }
  $.settingsRepositoriesMessage.textContent = "저장 중…";
  $.settingsRepositoriesMessage.className = "success-text";
  const payload = state.repositoryDrafts
    .filter((draft) => draft.path.trim().length > 0)
    .map((draft) => ({
      label: draft.label || "저장소",
      username: draft.username?.trim() ?? "",
      defaultBranch: draft.defaultBranch?.trim() ?? "",
      path: draft.path.trim(),
      url: draft.url?.trim() ?? "",
      branches: draft.branches,
      discordMinCommits: draft.discordMinCommits ?? 0,
      discordBranches: draft.discordBranches ?? [],
      project: draft.project!.trim(),
      notionDatabaseId: draft.notionDatabaseId?.trim() || undefined,
      notionToken: draft.notionToken?.trim() || undefined,
      discordChannelId: draft.discordChannelId?.trim() || undefined,
    }));
  try {
    const result = await api.saveSettings({
      HUB_GIT_REPOSITORIES: JSON.stringify(payload),
      // Git 저장소 탭에서 '저장'을 누른 것은 명시적이므로, 빈 목록일 경우 저장소 삭제로 취급합니다.
      ...(payload.length === 0 ? { HUB_GIT_REPOSITORIES_CLEAR: "1" } : {}),
    });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.settingsRepositoriesMessage.textContent = "저장소 설정이 저장되었습니다.";
    $.settingsRepositoriesMessage.className = "success-text";
    state.repositoryDrafts = [];
    await refreshState();
    renderSettingsRepositories();
    renderSettingsNotion();
    renderSettingsDiscord();
  } catch (error) {
    $.settingsRepositoriesMessage.textContent = `저장 실패: ${error instanceof Error ? error.message : String(error)}`;
    $.settingsRepositoriesMessage.className = "error-text";
  }
}

function notionDatabaseDrafts(): GitRepositorySetting[] {
  return state.dashboard?.config.repositories ?? [];
}

async function saveNotionSettings(): Promise<void> {
  const api = settingsHub();
  if (!api) return;
  $.settingsNotionMessage.textContent = "저장 중...";
  $.settingsNotionMessage.className = "success-text";
  // 저장소 목록은 config(저장된 원본)를 기준으로 유지하고, Notion DB ID만 덮어쓴다.
  const payload = (state.dashboard?.config.repositories ?? [])
    .filter((draft) => draft.path.trim().length > 0)
    .map((draft) => {
      const override = state.notionRepositories.find((item) => item.path === draft.path);
      return {
        ...draft,
        project: draft.project?.trim() || undefined,
        notionDatabaseId: (override?.notionDatabaseId ?? draft.notionDatabaseId)?.trim() || undefined,
        notionToken: (override?.notionToken ?? draft.notionToken)?.trim() || undefined,
        discordChannelId: draft.discordChannelId?.trim() || undefined,
      };
    });
  try {
    const result = await api.saveSettings({ HUB_GIT_REPOSITORIES: JSON.stringify(payload) });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.settingsNotionMessage.textContent = "Notion 저장소 설정이 저장되었습니다.";
    $.settingsNotionMessage.className = "success-text";
    void refreshState();
  } catch (error) {
    $.settingsNotionMessage.textContent = "저장 실패: " + (error instanceof Error ? error.message : String(error));
    $.settingsNotionMessage.className = "error-text";
  }
}

function normalizeNotionIdInput(value: string): string {
  const trimmed = (value || "").trim();
  const match = trimmed.match(/[a-zA-Z0-9]{32}/);
  return match ? match[0] : trimmed;
}

function renderSettingsNotion(): void {
  const repositories = notionDatabaseDrafts();
  state.notionRepositories = repositories.map((item, index) => {
    const previous = state.notionRepositories[index];
    return {
      label: item.label ?? "",
      username: item.username ?? "",
      defaultBranch: item.defaultBranch ?? "",
      path: item.path ?? "",
      url: item.url ?? "",
      branches: item.branches ?? [],
      discordMinCommits: item.discordMinCommits ?? 0,
      discordBranches: item.discordBranches ?? [],
      project: item.project ?? "",
      notionDatabaseId: previous?.notionDatabaseId ?? item.notionDatabaseId ?? "",
      notionToken: previous?.notionToken ?? item.notionToken ?? "",
      discordChannelId: previous?.discordChannelId ?? item.discordChannelId ?? "",
    };
  });
  $.settingsNotionRepositories.innerHTML = "";
  if (repositories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "등록된 Git 저장소가 없습니다. 먼저 설정 탭의 Git 저장소에서 저장소를 추가하세요.";
    $.settingsNotionRepositories.appendChild(empty);
    return;
  }
  for (let index = 0; index < repositories.length; index += 1) {
    $.settingsNotionRepositories.appendChild(buildSettingsNotionCard(state.notionRepositories[index]!, index));
  }
}

async function runNotionDatabaseTest(index: number): Promise<void> {
  const item = state.notionRepositories[index];
  if (!item || !item.notionDatabaseId?.trim()) return;
  const dbId = normalizeNotionIdInput(item.notionDatabaseId);
  item.notionDatabaseId = dbId;
  state.notionTestStates[index] = { state: "testing", message: "연결 테스트 중..." };
  $.settingsNotionMessage.textContent = "연결 테스트 중...";
  try {
    const result = await window.hub.testNotionDatabase({ repository: item.path, databaseId: dbId, token: item.notionToken });
    state.notionTestStates[index] = {
      state: result.ok ? "connected" : "error",
      message: result.message,
    };
    $.settingsNotionMessage.textContent = result.message;
    $.settingsNotionMessage.className = result.ok ? "success-text" : "error-text";
    if (state.dashboard) renderHeader(state.dashboard);
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    state.notionTestStates[index] = { state: "error", message: errorText };
    $.settingsNotionMessage.textContent = "테스트 실패: " + errorText;
    $.settingsNotionMessage.className = "error-text";
    if (state.dashboard) renderHeader(state.dashboard);
  }
}

function buildSettingsNotionCard(repository: GitRepositorySetting, index: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "repository-card";
  // 기본값(키 없음)은 '접힘'입니다. false로 저장된 카드만 펼쳐 보여줍니다.
  if (state.notionCollapsed[index] !== false) card.classList.add("collapsed");

  const head = document.createElement("div");
  head.className = "repository-card-head";
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "repo-toggle";
  toggleButton.title = "세부 내용 열기/닫기";
  toggleButton.setAttribute("aria-expanded", state.notionCollapsed[index] === false ? "true" : "false");
  toggleButton.textContent = state.notionCollapsed[index] === false ? "▲" : "▼";
  const toggleDetails = (): void => {
    const nextCollapsed = state.notionCollapsed[index] === false;
    state.notionCollapsed[index] = nextCollapsed;
    card.classList.toggle("collapsed", nextCollapsed);
    toggleButton.textContent = nextCollapsed ? "▼" : "▲";
    toggleButton.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
  };
  toggleButton.addEventListener("click", toggleDetails);
  const summary = document.createElement("span");
  summary.className = "repo-summary project-title";
  summary.textContent = projectDisplayName(repository.project);
  summary.title = repoSummaryTitle(repository.username, repository.label, repository.path);
  // 제목(저장소 이름)을 눌러도 세부 내용이 열리고 닫히게 합니다.
  summary.role = "button";
  summary.tabIndex = 0;
  summary.addEventListener("click", toggleDetails);
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleDetails();
    }
  });
  head.append(toggleButton, summary);
  card.appendChild(head);

  const pathLabel = document.createElement("div");
  pathLabel.className = "muted";
  pathLabel.textContent = "경로: " + (repository.path || repository.url || "—");
  card.appendChild(pathLabel);

  const databaseLabel = document.createElement("label");
  databaseLabel.className = "repository-url-field";
  databaseLabel.textContent = "Notion Database ID (URL 또는 ID)";
  const databaseInput = document.createElement("input");
  databaseInput.type = "text";
  databaseInput.placeholder = "예: 3c67d5bccac580d38e2af8848f5f7abd 또는 노션 URL";
  databaseInput.value = repository.notionDatabaseId ?? "";
  let testTimer = undefined as ReturnType<typeof setTimeout> | undefined;
  databaseInput.addEventListener("input", () => {
    const draft = state.notionRepositories[index];
    if (!draft) return;
    draft.notionDatabaseId = databaseInput.value.trim();
    if (testTimer) clearTimeout(testTimer);
    if (draft.notionDatabaseId) {
      testTimer = setTimeout(() => void runNotionDatabaseTest(index), 700);
    }
  });
  databaseLabel.appendChild(databaseInput);
  card.appendChild(databaseLabel);

  const tokenLabel = document.createElement("label");
  tokenLabel.className = "repository-url-field";
  tokenLabel.textContent = "Notion Integration Token";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.spellcheck = false;
  tokenInput.placeholder = "ntn_... (이 워크스페이스의 연결/통합 토큰)";
  tokenInput.value = repository.notionToken ?? "";
  tokenInput.addEventListener("input", () => {
    const draft = state.notionRepositories[index];
    if (!draft) return;
    draft.notionToken = tokenInput.value.trim();
  });
  tokenLabel.appendChild(tokenInput);
  card.appendChild(tokenLabel);

  const row = document.createElement("div");
  row.className = "repository-branch-row";
  const testButton = document.createElement("button");
  testButton.type = "button";
  testButton.className = "ghost";
  testButton.textContent = "연결 테스트";
  const message = document.createElement("span");
  message.className = "muted";
  const testState = state.notionTestStates[index];
  if (testState) {
    message.textContent = testState.message;
    if (testState.state === "connected") message.className = "success-text";
    else if (testState.state === "error") message.className = "error-text";
  }
  const runTest = async (): Promise<void> => {
    const item = state.notionRepositories[index];
    if (!item || !item.notionDatabaseId?.trim()) {
      message.textContent = "Database ID를 먼저 입력하세요.";
      return;
    }
    const dbId = normalizeNotionIdInput(item.notionDatabaseId);
    item.notionDatabaseId = dbId;
    databaseInput.value = dbId;
    state.notionTestStates[index] = { state: "testing", message: "연결 테스트 중..." };
    message.textContent = "연결 테스트 중...";
    message.className = "muted";
    try {
      const result = await window.hub.testNotionDatabase({ repository: item.path, databaseId: dbId, token: item.notionToken });
      state.notionTestStates[index] = {
        state: result.ok ? "connected" : "error",
        message: result.message,
      };
      message.textContent = result.message;
      message.className = result.ok ? "success-text" : "error-text";
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      state.notionTestStates[index] = { state: "error", message: errorText };
      message.textContent = "테스트 실패: " + errorText;
      message.className = "error-text";
    }
  };
  testButton.addEventListener("click", () => void runTest());
  row.append(testButton, message);
  card.appendChild(row);
  return card;
}

function discordDatabaseDrafts(): GitRepositorySetting[] {
  return state.dashboard?.config.repositories ?? [];
}

function renderSettingsDiscord(): void {
  const repositories = discordDatabaseDrafts();
  state.discordRepositories = repositories.map((item, index) => {
    const previous = state.discordRepositories[index];
    return {
      label: item.label ?? "",
      username: item.username ?? "",
      defaultBranch: item.defaultBranch ?? "",
      path: item.path ?? "",
      url: item.url ?? "",
      branches: item.branches ?? [],
      discordMinCommits: item.discordMinCommits ?? 0,
      discordBranches: item.discordBranches ?? [],
      project: item.project ?? "",
      notionDatabaseId: item.notionDatabaseId ?? "",
      discordChannelId: previous?.discordChannelId ?? item.discordChannelId ?? "",
    };
  });
  $.settingsDiscordRepositories.innerHTML = "";
  if (repositories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "등록된 Git 저장소가 없습니다. 먼저 설정 탭의 Git 저장소에서 저장소를 추가하세요.";
    $.settingsDiscordRepositories.appendChild(empty);
    return;
  }
  for (let index = 0; index < repositories.length; index += 1) {
    $.settingsDiscordRepositories.appendChild(buildSettingsDiscordCard(state.discordRepositories[index]!, index));
  }
}

function buildSettingsDiscordCard(repository: GitRepositorySetting, index: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "repository-card";
  // 기본값(키 없음)은 '접힘'입니다. false로 저장된 카드만 펼쳐 보여줍니다.
  if (state.discordCollapsed[index] !== false) card.classList.add("collapsed");

  const head = document.createElement("div");
  head.className = "repository-card-head";
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "repo-toggle";
  toggleButton.title = "세부 내용 열기/닫기";
  toggleButton.setAttribute("aria-expanded", state.discordCollapsed[index] === false ? "true" : "false");
  toggleButton.textContent = state.discordCollapsed[index] === false ? "▲" : "▼";
  const toggleDetails = (): void => {
    const nextCollapsed = state.discordCollapsed[index] === false;
    state.discordCollapsed[index] = nextCollapsed;
    card.classList.toggle("collapsed", nextCollapsed);
    toggleButton.textContent = nextCollapsed ? "▼" : "▲";
    toggleButton.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
  };
  toggleButton.addEventListener("click", toggleDetails);
  const summary = document.createElement("span");
  summary.className = "repo-summary project-title";
  summary.textContent = projectDisplayName(repository.project);
  summary.title = repoSummaryTitle(repository.username, repository.label, repository.path);
  // 제목(저장소 이름)을 눌러도 세부 내용이 열리고 닫히게 합니다.
  summary.role = "button";
  summary.tabIndex = 0;
  summary.addEventListener("click", toggleDetails);
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleDetails();
    }
  });
  head.append(toggleButton, summary);
  card.appendChild(head);

  const pathLabel = document.createElement("div");
  pathLabel.className = "muted";
  pathLabel.textContent = "경로: " + (repository.path || repository.url || "—");
  card.appendChild(pathLabel);

  const channelLabel = document.createElement("label");
  channelLabel.className = "repository-url-field";
  channelLabel.textContent = "Discord 채널 ID";
  const channelInput = document.createElement("input");
  channelInput.type = "text";
  channelInput.placeholder = "예: 1345800000000000000 (디스코드 개발자 모드에서 채널 우클릭 → ID 복사)";
  channelInput.value = repository.discordChannelId ?? "";
  let testTimer = undefined as ReturnType<typeof setTimeout> | undefined;
  channelInput.addEventListener("input", () => {
    const draft = state.discordRepositories[index];
    if (!draft) return;
    draft.discordChannelId = channelInput.value.trim();
    if (testTimer) clearTimeout(testTimer);
    if (draft.discordChannelId) {
      testTimer = setTimeout(() => void runDiscordChannelTest(index), 700);
    }
  });
  channelLabel.appendChild(channelInput);
  card.appendChild(channelLabel);

  const row = document.createElement("div");
  row.className = "repository-branch-row";
  const testButton = document.createElement("button");
  testButton.type = "button";
  testButton.className = "ghost";
  testButton.textContent = "연결 테스트";
  const message = document.createElement("span");
  message.className = "muted";
  const testState = state.discordTestStates[index];
  if (testState) {
    message.textContent = testState.message;
    if (testState.state === "connected") message.className = "success-text";
    else if (testState.state === "error") message.className = "error-text";
  }
  const runTest = async (): Promise<void> => {
    const item = state.discordRepositories[index];
    if (!item || !item.discordChannelId?.trim()) {
      message.textContent = "채널 ID를 먼저 입력하세요.";
      return;
    }
    state.discordTestStates[index] = { state: "testing", message: "연결 테스트 중..." };
    message.textContent = "연결 테스트 중...";
    message.className = "muted";
    try {
      const result = await window.hub.testDiscordChannel({ repository: item.path, channelId: item.discordChannelId.trim() });
      state.discordTestStates[index] = {
        state: result.ok ? "connected" : "error",
        message: result.message,
      };
      message.textContent = result.message;
      message.className = result.ok ? "success-text" : "error-text";
      if (state.dashboard) renderHeader(state.dashboard);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      state.discordTestStates[index] = { state: "error", message: errorText };
      message.textContent = "테스트 실패: " + errorText;
      message.className = "error-text";
      if (state.dashboard) renderHeader(state.dashboard);
    }
  };
  testButton.addEventListener("click", () => void runTest());
  row.append(testButton, message);
  card.appendChild(row);
  return card;
}

async function runDiscordChannelTest(index: number): Promise<void> {
  const item = state.discordRepositories[index];
  if (!item || !item.discordChannelId?.trim()) return;
  state.discordTestStates[index] = { state: "testing", message: "연결 테스트 중..." };
  $.settingsDiscordMessage.textContent = "연결 테스트 중...";
  try {
    const result = await window.hub.testDiscordChannel({ repository: item.path, channelId: item.discordChannelId.trim() });
    state.discordTestStates[index] = {
      state: result.ok ? "connected" : "error",
      message: result.message,
    };
    $.settingsDiscordMessage.textContent = result.message;
    $.settingsDiscordMessage.className = result.ok ? "success-text" : "error-text";
    if (state.dashboard) renderHeader(state.dashboard);
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    state.discordTestStates[index] = { state: "error", message: errorText };
    $.settingsDiscordMessage.textContent = "테스트 실패: " + errorText;
    $.settingsDiscordMessage.className = "error-text";
    if (state.dashboard) renderHeader(state.dashboard);
  }
}

async function saveDiscordSettings(): Promise<void> {
  const api = settingsHub();
  if (!api) return;
  $.settingsDiscordMessage.textContent = "저장 중...";
  $.settingsDiscordMessage.className = "success-text";
  // 저장소 목록은 config(저장된 원본)를 기준으로 유지하고, Discord 채널 ID만 덮어쓴다.
  const payload = (state.dashboard?.config.repositories ?? [])
    .filter((draft) => draft.path.trim().length > 0)
    .map((draft) => {
      const override = state.discordRepositories.find((item) => item.path === draft.path);
      return {
        ...draft,
        project: draft.project?.trim() || undefined,
        notionDatabaseId: draft.notionDatabaseId?.trim() || undefined,
        discordChannelId: (override?.discordChannelId ?? draft.discordChannelId)?.trim() || undefined,
      };
    });
  try {
    const result = await api.saveSettings({
      HUB_GIT_REPOSITORIES: JSON.stringify(payload),
      // Git 저장소 탭에서 빈 목록으로 저장하면 명시적 삭제로 취급한다.
      ...(payload.length === 0 ? { HUB_GIT_REPOSITORIES_CLEAR: "1" } : {}),
    });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.settingsDiscordMessage.textContent = "Discord 저장소 설정이 저장되었습니다.";
    $.settingsDiscordMessage.className = "success-text";
    void refreshState();
  } catch (error) {
    $.settingsDiscordMessage.textContent = "저장 실패: " + (error instanceof Error ? error.message : String(error));
    $.settingsDiscordMessage.className = "error-text";
  }
}

const INTEGRATION_LABELS: Record<IntegrationConnectionStatus["integration"], string> = {
  discord: "Discord",
  notion: "Notion",
  github: "GitHub",
};

const INTEGRATION_STATE_LABELS: Record<IntegrationConnectionStatus["state"], string> = {
  connected: "연결됨",
  disconnected: "연결 안 됨",
  error: "오류",
  "not-configured": "미설정",
};

function renderIntegrationStatuses(statuses: IntegrationConnectionStatus[]): void {
  $.integrationStatuses.innerHTML = "";
  if (statuses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "아직 확인된 연결 상태가 없습니다.";
    $.integrationStatuses.appendChild(empty);
    return;
  }
  const filtered = statuses.filter((status) => status.integration === "github");
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "GitHub 연결 상태만 표시됩니다. 저장소 연결은 설정 탭의 Notion/Discord 저장소에서 확인하세요.";
    $.integrationStatuses.appendChild(empty);
    return;
  }
  for (const status of filtered) {
    const card = document.createElement("div");
    card.className = `status-card ${status.state}`;
    const head = document.createElement("div");
    head.className = "status-card-head";
    const name = document.createElement("span");
    name.className = "status-name";
    name.textContent = INTEGRATION_LABELS[status.integration];
    const stateBadge = document.createElement("span");
    stateBadge.className = `status-state ${status.state}`;
    stateBadge.textContent = INTEGRATION_STATE_LABELS[status.state];
    head.append(name, stateBadge);
    const message = document.createElement("div");
    message.className = "status-message";
    message.textContent = status.message || "—";
    const checked = document.createElement("div");
    checked.className = "status-checked muted";
    checked.textContent = `확인 시각: ${formatTime(status.checkedAt)}`;
    card.append(head, message, checked);
    $.integrationStatuses.appendChild(card);
  }
}

function scheduleAutoSave(): void {
  if (!$.settingsAutoSave.checked || state.settingsBusy) return;
  window.clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = window.setTimeout(() => {
    void performSaveSettings("auto");
  }, 700);
}

function bindEvents(): void {
  const primaryCard = $.gitBranches.closest<HTMLElement>(".card");
  if (primaryCard) trackCardFocus(primaryCard);
  mountDashboardMainGitCard();
  $.themeToggle.addEventListener("click", () => {
    applyTheme(document.body.classList.contains("theme-light") ? "dark" : "light");
  });
  $.refreshState.addEventListener("click", () => void runHeaderRefresh());
  $.mainTabDashboard.addEventListener("click", () => switchMainPanel("dashboard"));
  $.mainTabAutomation.addEventListener("click", () => switchMainPanel("automation"));
  $.mainTabSettings.addEventListener("click", () => switchMainPanel("settings"));
  $.mainTabKanban.addEventListener("click", () => {
    switchMainPanel("kanban");
    void refreshKanban();
  });
  $.kanbanRefresh.addEventListener("click", () => void refreshKanban());
  $.kanbanAdd.addEventListener("click", () => void createKanbanCard());
  $.kanbanNewTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void createKanbanCard();
  });
  $.kanbanDbApply.addEventListener("click", () => void applyKanbanDatabase());
  $.kanbanDbUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void applyKanbanDatabase();
  });
  $.dashboardProject.addEventListener("change", () => {
    document.querySelectorAll(".dashboard-extra-card").forEach((card) => card.remove());
    restoreProjectWorkBranches();
    restoreProjectActiveBranches();
    renderGitRepositoryOptions();
    if (mainGitController) void mainGitController.refresh();
    restoreDashboardGitCards();
  });
  $.dashboardProjectRename.addEventListener("click", async () => {
    const current = $.dashboardProject.value;
    if (!current) return;
    const name = $.dashboardProjectRenameInput.value.trim();
    if (!name || name === current || !state.dashboard) return;
    try {
      const repositories = state.dashboard.config.repositories.map((item) =>
        projectName(item.project) === current ? { ...item, project: name } : item,
      );
      await saveProjectAssignments(repositories);
      $.dashboardProject.value = name;
      $.dashboardProjectRenameInput.value = "";
      renderGitRepositoryOptions();
      setStatus(`프로젝트 이름을 '${name}'으로 변경했습니다.`);
    } catch (error) {
      setStatus(`프로젝트 이름 변경 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  $.dashboardAddCard.addEventListener("click", () => addDashboardGitCard());
  $.gitConnectChoose.addEventListener("click", () => void chooseCardRepositoryFolder({
    setMessage: (message, isError) => {
      $.gitConnectMessage.textContent = message;
      $.gitConnectMessage.className = isError ? "error-text" : "muted";
    },
    applyPath: (picked) => {
      const project = $.dashboardProject.value || "";
      if (project) {
        state.projectConnectPaths[project] = picked;
        state.projectConnectMessages[project] = "연결됨: " + picked;
      }
      // 메인 카드의 저장소 폴더도 재시작 후 유지되도록 즉시 디스크에 저장합니다.
      persistGitSelectionState();
    },
    refreshCards: () => {
      renderGitRepositoryOptions();
      if (mainGitController) void mainGitController.refresh();
    },
  }));
  $.settingsTabEnv.addEventListener("click", () => switchSettingsPanel("env"));
  $.settingsTabGit.addEventListener("click", () => switchSettingsPanel("git"));
  $.settingsTabNotion.addEventListener("click", () => {
    switchSettingsPanel("notion");
    renderSettingsNotion();
  });
  $.settingsTabDiscord.addEventListener("click", () => {
    switchSettingsPanel("discord");
    renderSettingsDiscord();
  });
  $.settingsDiscordSave.addEventListener("click", () => void saveDiscordSettings());
  $.settingsTabLicense.addEventListener("click", () => switchSettingsPanel("license"));
  $.settingsTabGitAccess.addEventListener("click", () => {
    switchSettingsPanel("gitaccess");
    renderSettingsGitAccess();
  });
  $.settingsGitAccessSave.addEventListener("click", () => void performSaveGitAccess());
  $.settingsTabApikey.addEventListener("click", () => {
    switchSettingsPanel("apikey");
    renderSettingsApiKey();
  });
  $.settingsTabUpdate.addEventListener("click", () => switchSettingsPanel("update"));
  $.updateCheck.addEventListener("click", () => void performCheckForUpdates());
  $.updateInstall.addEventListener("click", () => void performInstallUpdate());
  $.updateManual.addEventListener("click", () => openManualDownload());
  $.updateIndicator.addEventListener("click", () => {
    switchMainPanel("settings");
    switchSettingsPanel("update");
  });
  $.settingsApikeySave.addEventListener("click", () => void performSaveApiKeySettings());
  $.settingsLicenseChange.addEventListener("click", async () => {
    const key = $.settingsLicenseKey.value.trim();
    if (!key) { $.settingsLicenseMessage.textContent = "새 라이선스 키를 입력하세요."; return; }
    $.settingsLicenseChange.disabled = true;
    $.settingsLicenseMessage.textContent = "라이선스를 확인하는 중입니다…";
    try {
      await window.hub.replaceLicense(key);
      $.settingsLicenseMessage.textContent = "라이선스가 변경되었습니다. 프로그램을 재시작합니다.";
    } catch (error) {
      $.settingsLicenseMessage.textContent = error instanceof Error ? error.message : String(error);
      $.settingsLicenseChange.disabled = false;
    }
  });
  $.settingsTest.addEventListener("click", () => void performTestIntegrations());
  $.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(state.autoSaveTimer);
    void performSaveSettings("manual");
  });
  $.settingsForm.addEventListener("input", (event) => {
    const input = (event.target as HTMLElement | null)?.closest("input[name]") as HTMLInputElement | null;
    if (!input) return;
    state.settingsDrafts[input.name] = input.value;
    scheduleAutoSave();
  });
  $.settingsRepositoryAdd.addEventListener("click", () => {
    state.repositoryDrafts.push({ label: "", username: "", defaultBranch: "", path: "", url: "", branches: [], discordMinCommits: 0, discordBranches: [] });
    renderSettingsRepositories();
  });
  $.settingsRepositoriesSave.addEventListener("click", () => void saveRepositories());
  $.settingsNotionSave.addEventListener("click", () => void saveNotionSettings());
  $.automationSave.addEventListener("click", () => void saveDailyAutomation());
  $.automationRun.addEventListener("click", () => void runDailyAutomationNow());
}

async function init(): Promise<void> {
  initializeTheme();
  bindEvents();
  setStatus("Connecting to hub…");
  await loadGitSelectionState();
  await refreshState();
  await cleanupStaleProjectConnections();
  state.gitWorkBranches = [];
  restoreProjectWorkBranches();
  restoreProjectActiveBranches();
  restoreDashboardGitCards();
  if (mainGitController) void mainGitController.refresh();
  if (settingsHub()) {
    void refreshSettings();
  } else {
    $.settingsApiMissing.hidden = false;
    setSettingsBusy(true);
    setSettingsMessage("Settings API가 아직 연결되지 않았습니다. main 프로세스 구현 후 재실행하세요.");
  }
  window.hub.onStateChanged((dashboard) => {
    renderDashboard(dashboard);
  });
  window.hub.onUpdateStatus((status) => renderUpdate(status));
  void refreshUpdateStatus();
  window.hub.onKanbanChanged((board) => {
    // 사용자가 드래그 중이 아니면 폴링 결과로 보드를 갱신합니다.
    if (!kanbanDragCardId) renderKanban(board);
  });
  // 연결된 폴더가 외부에서 변경되면 Git 상태를 자동으로 다시 읽습니다.
  window.hub.onRepositoryChanged((repository) => {
    if (repository !== watchedRepository) return;
    // 배경 새로고침(silent)으로 처리해 새로고침 버튼이 깜빡이지 않게 합니다.
    if (mainGitController) void mainGitController.refresh({ silent: true });
    document.querySelectorAll<HTMLElement>(".dashboard-extra-card").forEach((card) => {
      const select = card.querySelector<HTMLSelectElement>("select");
      if (select && select.value === repository) {
        // 추가 카드도 버튼을 누르지 않고 조용히 갱신합니다.
        const controller = extraCardControllers.get(card);
        if (controller) void controller.refresh({ silent: true });
      }
    });
  });
  setInterval(() => {
    if (state.dashboard && settingsHub()) void performTestIntegrations();
    void checkRepositoryConnections();
  }, 60_000);
  if (settingsHub()) void performTestIntegrations();
  // 앱 시작 시 저장소별 Notion/Discord 연결 상태를 배치 검사해 상단 점에 반영합니다.
  void checkRepositoryConnections();
}

void init();
