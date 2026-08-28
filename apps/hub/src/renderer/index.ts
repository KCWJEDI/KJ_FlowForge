import type {
  DailyAutomationView,
  DashboardState,
  GitRepositorySetting,
  GitStatusView,
  IntegrationConnectionStatus,
  SettingsSaveResult,
  SettingsView,
  SettingFieldView,
} from "../shared/ipc";

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
  integrationDots: required<HTMLElement>(document.getElementById("integration-dots"), "integration-dots"),
  refreshState: required<HTMLButtonElement>(document.getElementById("refresh-state"), "refresh-state"),
  gitRefresh: required<HTMLButtonElement>(document.getElementById("git-refresh"), "git-refresh"),
  gitRepository: required<HTMLSelectElement>(document.getElementById("git-repository"), "git-repository"),
  gitBranches: required<HTMLElement>(document.getElementById("git-branches"), "git-branches"),
  gitSummary: required<HTMLElement>(document.getElementById("git-summary"), "git-summary"),
  gitConflicts: required<HTMLElement>(document.getElementById("git-conflicts"), "git-conflicts"),
  gitFiles: required<HTMLTableElement>(document.getElementById("git-files"), "git-files"),
  gitCommit: required<HTMLButtonElement>(document.getElementById("git-commit"), "git-commit"),
  gitPush: required<HTMLButtonElement>(document.getElementById("git-push"), "git-push"),
  gitDailyReport: required<HTMLButtonElement>(document.getElementById("git-daily-report"), "git-daily-report"),
  gitError: required<HTMLElement>(document.getElementById("git-error"), "git-error"),
  statusBar: required<HTMLElement>(document.getElementById("status-bar-text"), "status-bar-text"),
  automationSection: required<HTMLElement>(document.getElementById("automation-section"), "automation-section"),
  mainTabDashboard: required<HTMLButtonElement>(document.getElementById("tab-dashboard"), "tab-dashboard"),
  mainTabAutomation: required<HTMLButtonElement>(document.getElementById("tab-automation"), "tab-automation"),
  mainTabSettings: required<HTMLButtonElement>(document.getElementById("tab-settings"), "tab-settings"),
  panelDashboard: required<HTMLElement>(document.getElementById("panel-dashboard"), "panel-dashboard"),
  panelAutomation: required<HTMLElement>(document.getElementById("panel-automation"), "panel-automation"),
  panelSettings: required<HTMLElement>(document.getElementById("panel-settings"), "panel-settings"),
  dashboardProject: required<HTMLSelectElement>(document.getElementById("dashboard-project"), "dashboard-project"),
  dashboardProjectRenameInput: required<HTMLInputElement>(document.getElementById("dashboard-project-rename-input"), "dashboard-project-rename-input"),
  dashboardProjectRename: required<HTMLButtonElement>(document.getElementById("dashboard-project-rename"), "dashboard-project-rename"),
  dashboardAddCard: required<HTMLButtonElement>(document.getElementById("dashboard-add-card"), "dashboard-add-card"),
  settingsTabEnv: required<HTMLButtonElement>(document.getElementById("settings-tab-env"), "settings-tab-env"),
  settingsTabGit: required<HTMLButtonElement>(document.getElementById("settings-tab-git"), "settings-tab-git"),
  settingsTabNotion: required<HTMLButtonElement>(document.getElementById("settings-tab-notion"), "settings-tab-notion"),
  settingsTabStatus: required<HTMLButtonElement>(document.getElementById("settings-tab-status"), "settings-tab-status"),
  settingsTabLicense: required<HTMLButtonElement>(document.getElementById("settings-tab-license"), "settings-tab-license"),
  settingsPaneEnv: required<HTMLElement>(document.getElementById("settings-pane-env"), "settings-pane-env"),
  settingsPaneGit: required<HTMLElement>(document.getElementById("settings-pane-git"), "settings-pane-git"),
  settingsPaneNotion: required<HTMLElement>(document.getElementById("settings-pane-notion"), "settings-pane-notion"),
  settingsPaneStatus: required<HTMLElement>(document.getElementById("settings-pane-status"), "settings-pane-status"),
  settingsPaneLicense: required<HTMLElement>(document.getElementById("settings-pane-license"), "settings-pane-license"),
  settingsLicenseKey: required<HTMLInputElement>(document.getElementById("settings-license-key"), "settings-license-key"),
  settingsLicenseChange: required<HTMLButtonElement>(document.getElementById("settings-license-change"), "settings-license-change"),
  settingsLicenseMessage: required<HTMLElement>(document.getElementById("settings-license-message"), "settings-license-message"),
  settingsEnvFile: required<HTMLElement>(document.getElementById("settings-env-file"), "settings-env-file"),
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
  integrationStatuses: required<HTMLElement>(document.getElementById("integration-statuses"), "integration-statuses"),
  settingsTestStatus: required<HTMLButtonElement>(document.getElementById("settings-test-status"), "settings-test-status"),
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
  gitBranches: string[];
  gitWorkBranches: string[];
  gitWorkBranchesProject: string;
  gitWorkBranchesByProject: Record<string, string[]>;
  gitActiveBranches: string[];
  gitActiveBranchesByProject: Record<string, string[]>;
  gitCardsByProject: Record<string, Array<{ path: string; workBranches: string[]; activeBranches: string[] }>>;
  settings: SettingsView | null;
  settingsStatuses: IntegrationConnectionStatus[];
  settingsBusy: boolean;
  settingsDrafts: Record<string, string>;
  autoSaveTimer: number | undefined;
  automationBusy: boolean;
  repositoryDrafts: GitRepositorySetting[];
  repositoryCollapsed: Record<number, boolean>;
  notionRepositories: GitRepositorySetting[];
  notionCollapsed: Record<number, boolean>;
  notionTestStates: Record<number, { state: "untested" | "testing" | "connected" | "error"; message: string }>;
  discordRepositories: GitRepositorySetting[];
  discordTestStates: Record<number, { state: "untested" | "testing" | "connected" | "error"; message: string }>;
} = {
  dashboard: null,
  git: null,
  gitBusy: false,
  gitBranches: [],
  gitWorkBranches: [],
  gitWorkBranchesProject: "",
  gitWorkBranchesByProject: {},
  gitActiveBranches: [],
  gitActiveBranchesByProject: {},
  gitCardsByProject: {},
  settings: null,
  settingsStatuses: [],
  settingsBusy: false,
  settingsDrafts: {},
  autoSaveTimer: undefined,
  automationBusy: false,
  repositoryDrafts: [],
  repositoryCollapsed: {},
  notionRepositories: [],
  notionCollapsed: {},
  notionTestStates: {},
  discordRepositories: [],
  discordTestStates: {},
};

function setStatus(message: string): void {
  $.statusBar.textContent = message;
}

function setGitError(message: string): void {
  $.gitError.textContent = message;
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
  $.headerMeta.textContent = `Started ${formatTime(dashboard.startedAt)} · HTTP ${dashboard.config.httpPort}`;
  const integrations = [
    { key: "discord" as const, label: "Discord", on: dashboard.config.integrations.discord },
    { key: "notion" as const, label: "Notion", on: dashboard.config.integrations.notion },
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
  const previous = $.gitRepository.value;
  $.gitRepository.innerHTML = "";
  const project = $.dashboardProject.value;
  const repos = (state.dashboard?.config.repositories ?? []).filter((repo) => !project || projectName(repo.project) === project);
  if (repos.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "설정된 저장소 없음";
    $.gitRepository.appendChild(option);
  } else {
    for (const [index, repo] of repos.entries()) {
      const repoPath = repo.path ?? "";
      const option = document.createElement("option");
      option.value = String(index);
      option.dataset.path = repoPath;
      option.textContent = `${projectName(repo.project)} · ${repo.label || "저장소"} · ${repo.username || "KCWJEDI"} · ${repoPath}`;
      $.gitRepository.appendChild(option);
    }
  }
  let selected = "";
  if (previous && Array.from($.gitRepository.options).some((o) => o.value === previous)) {
    selected = previous;
  } else if (repos.length > 0) {
    selected = "0";
  }
  $.gitRepository.value = selected;
  if (selected && selected !== previous && !state.gitBusy) {
    void refreshGit();
  }
}
function selectedRepository(): string | undefined {
  const value = $.gitRepository.selectedOptions[0]?.dataset.path?.trim() ?? "";
  return value || undefined;
}

function repositorySettingForPath(path: string): GitRepositorySetting | undefined {
  return (state.dashboard?.config.repositories ?? []).find((item) => item.path === path);
}

function persistGitWorkBranches(): void {
  const project = $.dashboardProject.value || "";
  state.gitWorkBranchesByProject[project] = state.gitWorkBranches.slice();
}

function persistGitActiveBranches(): void {
  const project = $.dashboardProject.value || "";
  state.gitActiveBranchesByProject[project] = state.gitActiveBranches.slice();
}

function currentlySelectedProject(): string {
  return $.dashboardProject.value || "";
}

function restoreProjectWorkBranches(): void {
  const project = currentlySelectedProject();
  const saved = state.gitWorkBranchesByProject[project];
  if (saved && saved.length > 0) {
    state.gitWorkBranches = saved.slice();
  }
}

function restoreProjectActiveBranches(): void {
  const project = currentlySelectedProject();
  const saved = state.gitActiveBranchesByProject[project];
  if (saved && saved.length > 0) {
    state.gitActiveBranches = saved.slice();
  } else {
    // 저장된 활성 브랜치가 없으면 빈 상태로 시작해 전체 선택이 자동으로 켜지지 않게 한다.
    state.gitActiveBranches = [];
  }
}

async function refreshGit(): Promise<void> {
  setGitError("");
  state.gitBusy = true;
  $.gitRefresh.disabled = true;
  $.gitCommit.disabled = true;
  $.gitPush.disabled = true;
  try {
    const repository = selectedRepository();
    [state.git, state.gitBranches] = await Promise.all([
      window.hub.inspectGit(repository),
      window.hub.listGitBranches(repository),
    ]);
    if (state.git && state.git.branch && !state.gitWorkBranches.includes(state.git.branch)) {
      const project = $.dashboardProject.value || "";
      const saved = state.gitWorkBranchesByProject[project] ?? [];
      if (saved.length > 0) {
        state.gitWorkBranches = saved;
      } else {
        // 기존 저장된 작업 브랜치가 없으면 자동으로 채우지 않는다.
        state.gitWorkBranches = [];
      }
    }
    renderGit();
  } catch (error) {
    $.gitSummary.textContent = "Git 사용 불가";
    state.git = null;
    state.gitBranches = [];
    renderGit();
    setGitError(error instanceof Error ? error.message : String(error));
  } finally {
    state.gitBusy = false;
    $.gitRefresh.disabled = false;
    updateGitButtons();
  }
}

function renderGit(): void {
  const git = state.git;
  renderGitBranches();
  const empty: GitStatusView = {
    repository: "",
    branch: "",
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    conflicts: [],
    clean: true,
  };
  const current = git ?? empty;

  if (git) {
    const parts = [
      `브랜치 ${git.branch}`,
      git.upstream ? `upstream ${git.upstream}` : "upstream 없음",
      git.ahead > 0 ? `${git.ahead} ahead` : null,
      git.behind > 0 ? `${git.behind} behind` : null,
      git.clean ? "변경 없음" : `${git.files.length}개 파일 변경`,
    ].filter(Boolean);
    $.gitSummary.textContent = parts.join(" · ");
  } else {
    $.gitSummary.textContent = "Git 상태를 불러올 수 없습니다";
  }

  if (git && git.conflicts.length > 0) {
    $.gitConflicts.hidden = false;
    $.gitConflicts.textContent = `병합 충돌: ${git.conflicts.join(", ")}`;
  } else {
    $.gitConflicts.hidden = true;
  }

  const body = $.gitFiles.tBodies[0]!;
  body.innerHTML = "";
  for (const file of current.files) {
    const row = document.createElement("tr");
    const path = document.createElement("td");
    path.textContent = file.path;
    const index = document.createElement("td");
    index.textContent = file.indexStatus;
    const workTree = document.createElement("td");
    workTree.textContent = file.workTreeStatus;
    row.append(path, index, workTree);
    body.appendChild(row);
  }
}

function updateGitButtons(): void {
  if (state.gitBusy) {
    $.gitCommit.disabled = true;
    $.gitPush.disabled = true;
    $.gitDailyReport.disabled = true;
    return;
  }
  const hasRepo = Boolean(selectedRepository());
  const hasChanges = state.git !== null && !state.git.clean;
  const activeBranches = state.gitActiveBranches.filter((branch) => branch.trim().length > 0);
  const hasActiveBranches = activeBranches.length > 0;
  $.gitCommit.disabled = !hasRepo || !hasChanges || activeBranches.length !== 1;
  $.gitPush.disabled = !hasRepo || !hasChanges || activeBranches.length !== 1;
  $.gitDailyReport.disabled = !hasRepo || !hasActiveBranches;
}

async function runGitCommit(): Promise<void> {
  setGitError("");
  const repo = selectedRepository();
  if (!repo) {
    setGitError("저장소를 선택하세요.");
    return;
  }
  const activeBranches = state.gitActiveBranches.filter((branch) => branch.trim().length > 0);
  if (activeBranches.length !== 1) {
    setGitError(activeBranches.length === 0 ? "활성 브랜치를 1개 선택하세요." : "커밋은 활성 브랜치가 정확히 1개일 때만 가능합니다. 다른 브랜치를 비활성화하세요.");
    return;
  }
  state.gitBusy = true;
  $.gitCommit.disabled = true;
  $.gitPush.disabled = true;
  setStatus("변경사항을 요약해 커밋하는 중…");
  try {
    if (state.git?.branch !== activeBranches[0]) {
      await window.hub.switchGitBranch({ repository: repo, branch: activeBranches[0]! });
    }
    const summary = await window.hub.gitCommit({ repository: repo });
    setStatus(`커밋 완료(푸시 대기): ${summary.newHead.slice(0, 8)} — 푸시 버튼을 눌러야 원격에 반영됩니다`);
    await refreshGit();
  } catch (error) {
    setGitError(error instanceof Error ? error.message : String(error));
    setStatus("커밋 실패");
  } finally {
    state.gitBusy = false;
    updateGitButtons();
  }
}

async function runGitPush(): Promise<void> {
  setGitError("");
  const repo = selectedRepository();
  if (!repo) {
    setGitError("저장소를 선택하세요.");
    return;
  }
  const targetRepo = repositorySettingForPath(repo);
  if (!targetRepo || !targetRepo.notionDatabaseId?.trim() || !targetRepo.discordChannelId?.trim()) {
    setGitError("저장소에 연결되어 있지 않습니다. Notion DB ID와 Discord 채널 ID를 입력하세요.");
    return;
  }
  const branches = state.gitActiveBranches.filter((branch) => branch.trim().length > 0);
  if (branches.length === 0) {
    setGitError("활성 브랜치를 하나 이상 선택하세요.");
    return;
  }
  state.gitBusy = true;
  $.gitCommit.disabled = true;
  $.gitPush.disabled = true;
  setStatus("푸시하는 중…");
  const errors: string[] = [];
  const pushed: string[] = [];
  try {
    for (const branch of branches) {
      setStatus("푸시하는 중 … " + branch);
      try {
        await window.hub.gitPushBranch({ repository: repo, branch });
        pushed.push(branch);
      } catch (error) {
        errors.push(branch + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
    if (errors.length > 0) setGitError(errors.join("\n"));
    setStatus(errors.length > 0 ? "푸시 부분 완료 (" + pushed.length + "개 성공)" : "푸시 완료 (" + pushed.join(", ") + ")");
    await refreshGit();
  } catch (error) {
    setGitError(error instanceof Error ? error.message : String(error));
    setStatus("푸시 실패");
  } finally {
    state.gitBusy = false;
    updateGitButtons();
  }
}

async function gitPushActiveBranches(args: { repository: string }): Promise<void> {
  const active = currentCardActiveBranches(args.repository).filter((branch) => branch.trim().length > 0);
  if (active.length === 0) throw new Error("활성 브랜치를 하나 이상 선택하세요.");
  const errors: string[] = [];
  for (const branch of active) {
    try {
      await window.hub.gitPushBranch({ repository: args.repository, branch: branch });
    } catch (cause: unknown) {
      errors.push(branch + ": " + (cause instanceof Error ? cause.message : String(cause)));
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
}
function previousEightIso() {
  const now = new Date();
  // "당일 08시"을 기준으로, 실제 실행 시각과 무관하게 항상 [전날 08시 ~ 당일 08시) 구간을 만든다.
  const until = new Date(now);
  until.setHours(8, 0, 0, 0);
  const since = new Date(until);
  since.setDate(since.getDate() - 1);
  const month = String(until.getMonth() + 1).padStart(2, "0");
  const day = String(until.getDate()).padStart(2, "0");
  return {
    date: until.getFullYear() + "-" + month + "-" + day,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
  };
}

async function runGitDailyReport() {
  setGitError("");
  const repo = selectedRepository();
  if (!repo) {
    setGitError("저장소를 선택하세요.");
    return;
  }
  const branches = state.gitActiveBranches.filter((branch) => branch.trim().length > 0);
  if (branches.length === 0) {
    setGitError("활성 브랜치를 하나 이상 선택하세요.");
    return;
  }
  state.gitBusy = true;
  $.gitCommit.disabled = true;
  $.gitPush.disabled = true;
  $.gitDailyReport.disabled = true;
  const range = previousEightIso();
  setStatus("전날 08시~당일 08시 커밋을 브랜치별로 요약해 Notion에 등록하는 중…");
  try {
    const result = await window.hub.reportManualDailyReport({
      date: range.date,
      sinceIso: range.sinceIso,
      untilIso: range.untilIso,
      repositories: [repo],
      branches,
    });
    const failed = result.branches.filter((item) => item.status === "failed");
    if (failed.length > 0) {
      setGitError(failed.map((item) => item.repositoryLabel + "/" + item.branch + ": " + item.message).join("\n"));
    } else {
      setStatus(range.date + " 일일 요약 등록 완료 (브랜치 " + result.branches.length + "개)");
    }
  } catch (error) {
    setGitError(error instanceof Error ? error.message : String(error));
    setStatus("일일 요약 등록 실패");
  } finally {
    state.gitBusy = false;
    updateGitButtons();
    $.gitDailyReport.disabled = false;
  }
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
    return;
  }
  state.automationBusy = true;
  $.automationMessageText.textContent = "저장 중…";
  if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  try {
    const result = await api.saveSettings({
      HUB_DAILY_AUTOMATION_ENABLED: String($.automationEnabled.checked),
      HUB_DAILY_AUTOMATION_PROJECTS: projects.join(","),
    });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.automationMessageText.textContent = "설정이 저장되었습니다.";
    await refreshState();
  } catch (error) {
    $.automationMessageText.textContent = `저장 실패: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.automationBusy = false;
    if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  }
}

async function runDailyAutomationNow(): Promise<void> {
  if (state.automationBusy) return;
  state.automationBusy = true;
  $.automationMessageText.textContent = "자동화를 실행 중입니다…";
  if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  try {
    const run = await window.hub.runDailyAutomation();
    $.automationMessageText.textContent = run.status === "succeeded"
      ? "자동화 실행이 완료되었습니다."
      : `자동화 실행 결과: ${run.status}`;
    await refreshState();
  } catch (error) {
    $.automationMessageText.textContent = `실행 실패: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.automationBusy = false;
    if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  }
}

async function refreshState(): Promise<void> {
  try {
    const dashboard = await window.hub.getState();
    renderDashboard(dashboard);
  } catch (error) {
    setStatus(`상태 로드 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderDashboard(dashboard: DashboardState): void {
  state.dashboard = dashboard;
  renderSettingsNotion();
  renderSettingsDiscord();
  renderHeader(dashboard);
  $.mainTabAutomation.hidden = dashboard.role !== "admin";
  if (dashboard.role !== "admin" && !$.panelAutomation.hidden) switchMainPanel("dashboard");
  renderProjectOptions(dashboard.config.repositories);
  renderGitRepositoryOptions();
  renderDailyAutomation(dashboard.dailyAutomation);
}

function renderGitBranches(): void {
  $.gitBranches.innerHTML = "";
  if (state.gitBranches.length === 0) {
    $.gitBranches.textContent = "선택 가능한 로컬 브랜치가 없습니다.";
    return;
  }
  const select = document.createElement("select");
  select.className = "branch-select";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "작업 브랜치 선택…";
  select.appendChild(placeholder);
  appendBranchOptions(select, state.gitBranches.filter((branch) => !state.gitWorkBranches.includes(branch)));
  const syncGitActiveBranch = async (): Promise<void> => {
    const active = state.gitActiveBranches.filter((branch) => branch.trim().length > 0);
    if (active.length === 0) return;
    const target = active[0]!;
    if (state.git && state.git.branch === target) return;
    state.gitBusy = true;
    try {
      state.git = await window.hub.switchGitBranch({ repository: selectedRepository(), branch: target });
      await refreshGit();
    } catch (error) {
      setGitError(error instanceof Error ? error.message : String(error));
      renderGitBranches();
    } finally {
      state.gitBusy = false;
    }
  };
  select.addEventListener("change", async () => {
    const branch = select.value;
    select.value = "";
    if (!branch || state.gitWorkBranches.includes(branch)) return;
    state.gitWorkBranches.push(branch);
    if (!state.gitActiveBranches.includes(branch)) state.gitActiveBranches.push(branch);
    persistGitWorkBranches();
    persistGitActiveBranches();
    renderGitBranches();
    updateGitButtons();
    await syncGitActiveBranch();
  });
  $.gitBranches.appendChild(select);
  const allRow = document.createElement("label");
  allRow.className = "branch-all-row";
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allInput.checked = state.gitWorkBranches.length > 0 && state.gitActiveBranches.length === state.gitWorkBranches.length;
  allInput.title = "전체 선택";
  allInput.addEventListener("change", () => {
    state.gitActiveBranches = allInput.checked ? state.gitWorkBranches.slice() : [];
    persistGitActiveBranches();
    renderGitBranches();
    updateGitButtons();
    void syncGitActiveBranch();
  });
  const allText = document.createElement("span");
  allText.textContent = "전체 선택";
  allRow.append(allInput, allText);
  $.gitBranches.appendChild(allRow);
  const chips = document.createElement("div");
  chips.className = "branch-options";
  for (const branch of state.gitWorkBranches) {
    const isActive = state.gitActiveBranches.includes(branch);
    const label = document.createElement("span");
    label.className = isActive ? "branch-option active" : "branch-option";
    const activeInput = document.createElement("input");
    activeInput.type = "checkbox";
    activeInput.className = "branch-active-cb";
    activeInput.checked = isActive;
    activeInput.title = "활성/비활성";
    activeInput.addEventListener("change", (event) => {
      event.stopPropagation();
      if (activeInput.checked) {
        if (!state.gitActiveBranches.includes(branch)) state.gitActiveBranches.push(branch);
      } else {
        state.gitActiveBranches = state.gitActiveBranches.filter((value) => value !== branch);
      }
      persistGitActiveBranches();
      renderGitBranches();
      updateGitButtons();
      void syncGitActiveBranch();
    });
    const text = document.createElement("span");
    text.textContent = branch;
    label.append(activeInput, text);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.textContent = "×";
    remove.title = "작업 브랜치에서 제거";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      state.gitWorkBranches = state.gitWorkBranches.filter((value) => value !== branch);
      state.gitActiveBranches = state.gitActiveBranches.filter((value) => value !== branch);
      persistGitWorkBranches();
      persistGitActiveBranches();
      renderGitBranches();
      updateGitButtons();
    });
    label.appendChild(remove);
    chips.appendChild(label);
  }
  $.gitBranches.appendChild(chips);
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

function currentCardBranches(path: string): string[] {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const found = cards.find((item) => item.path === path);
  return found ? found.workBranches.slice() : [];
}

function saveCardBranches(path: string, branches: string[]): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  let found = cards.find((item) => item.path === path);
  if (found) {
    found.workBranches = branches.slice();
  } else {
    state.gitCardsByProject[project] = [...cards, { path, workBranches: branches.slice(), activeBranches: branches.slice() }];
  }
}

function currentCardActiveBranches(path: string): string[] {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  const found = cards.find((item) => item.path === path);
  return found ? found.activeBranches.slice() : [];
}

function saveCardActiveBranches(path: string, active: string[]): void {
  const project = currentlySelectedProject();
  const cards = state.gitCardsByProject[project] ?? [];
  let found = cards.find((item) => item.path === path);
  if (found) {
    found.activeBranches = active.slice();
  } else {
    const storedBranches = currentCardBranches(path);
    state.gitCardsByProject[project] = [...cards, { path, workBranches: storedBranches, activeBranches: active.slice() }];
  }
}

function projectNames(repositories: GitRepositorySetting[]): string[] {
  return [...new Set(repositories.map((repository) => projectName(repository.project)))].sort((a, b) => a.localeCompare(b));
}

function renderProjectOptions(repositories: GitRepositorySetting[]): void {
  const previous = $.dashboardProject.value;
  $.dashboardProject.innerHTML = "";
  for (const project of projectNames(repositories)) {
    const option = document.createElement("option");
    option.value = project;
    option.textContent = project;
    $.dashboardProject.appendChild(option);
  }
  if (previous && Array.from($.dashboardProject.options).some((option) => option.value === previous)) {
    $.dashboardProject.value = previous;
  }
  $.dashboardProjectRename.disabled = !$.dashboardProject.value;
}

function addDashboardGitCard(initialPath?: string): void {
  const project = $.dashboardProject.value;
  const repositories = (state.dashboard?.config.repositories ?? []).filter((item) => projectName(item.project) === project);
  if (repositories.length === 0) {
    setStatus("현재 프로젝트에 추가된 Git 저장소가 없습니다.");
    return;
  }
  const primary = $.gitRepository.closest<HTMLElement>(".card");
  if (!primary) return;
  const card = primary.cloneNode(true) as HTMLElement;
  card.classList.add("dashboard-extra-card");
  card.querySelectorAll<HTMLElement>("[id]").forEach((element) => element.removeAttribute("id"));
  trackCardFocus(card);
  const select = card.querySelector<HTMLSelectElement>("select")!;
  const refresh = card.querySelector<HTMLButtonElement>(".card-head button")!;
  const branches = card.querySelector<HTMLElement>(".git-branch-picker")!;
  branches.innerHTML = "";
  const summary = card.querySelector<HTMLElement>(".muted")!;
  const conflicts = card.querySelector<HTMLElement>(".conflicts")!;
  const table = card.querySelector<HTMLTableElement>("table")!;
  const buttons = card.querySelectorAll<HTMLButtonElement>(".row button");
  const commit = buttons[0]!;
  const push = buttons[1]!;
  const report = buttons[2] as HTMLButtonElement | undefined;
  push.classList.add("push-button");
  const error = card.querySelector<HTMLElement>(".error-text")!;
  select.innerHTML = "";
  let preselected = "";
  for (const repository of repositories) {
    const option = document.createElement("option");
    option.value = repository.path;
    option.textContent = `${repository.label || "저장소"} · ${repository.username || "KCWJEDI"} · ${repository.path}`;
    select.appendChild(option);
    if (initialPath && repository.path === initialPath) preselected = repository.path;
  }
  if (preselected) select.value = preselected;
  let busy = false;
  let clean = true;
  const currentActive = (): string[] => currentCardActiveBranches(select.value).filter((branch) => branch.trim().length > 0);
 const applyCardButtonState = (): void => {
   if (busy) return;
    const active = currentActive();
    commit.disabled = active.length !== 1 || clean;
    push.disabled = active.length !== 1 || clean;
    if (report) report.disabled = active.length === 0;
  };
  const setBusy = (value: boolean): void => {
    busy = value;
    commit.disabled = value;
    push.disabled = value;
    if (report) report.disabled = value;
    if (!value) applyCardButtonState();
  };
 const render = async (): Promise<void> => {
    error.textContent = "";
    try {
      const [git, names] = await Promise.all([window.hub.inspectGit(select.value), window.hub.listGitBranches(select.value)]);
      summary.textContent = `브랜치 ${git.branch} · ${git.clean ? "변경 없음" : `${git.files.length}개 파일 변경`}`;
      conflicts.hidden = git.conflicts.length === 0;
      conflicts.textContent = git.conflicts.length ? `병합 충돌: ${git.conflicts.join(", ")}` : "";
      clean = git.clean;
      buildWorkBranchPicker({
        container: branches,
        names,
        current: git.branch,
        selected: currentCardBranches(select.value),
        active: currentCardActiveBranches(select.value),
        onSwitch: async (branch) => {
          setBusy(true);
          try { await window.hub.switchGitBranch({ repository: select.value, branch }); await render(); }
          catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
          finally { setBusy(false); }
        },
        onChange: (list) => saveCardBranches(select.value, list),
        onActiveChange: (active) => {
          saveCardActiveBranches(select.value, active);
          void render();
          applyCardButtonState();
        },
      });
      const body = table.tBodies[0]!;
      body.innerHTML = "";
      for (const file of git.files) {
        const row = body.insertRow();
        row.insertCell().textContent = file.path;
        row.insertCell().textContent = file.indexStatus;
        row.insertCell().textContent = file.workTreeStatus;
      }
      applyCardButtonState();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  };
  select.addEventListener("change", () => void render());
  refresh.addEventListener("click", () => void render());
  commit.addEventListener("click", async () => {
    if (busy) return;
    try {
      const active = currentActive();
      if (active.length !== 1) {
        error.textContent = active.length === 0 ? "활성 브랜치를 1개 선택하세요." : "커밋은 활성 브랜치가 정확히 1개일 때만 가능합니다.";
        return;
      }
      setBusy(true);
      const git = await window.hub.inspectGit(select.value);
      if (git.branch !== active[0]) await window.hub.switchGitBranch({ repository: select.value, branch: active[0]! });
      await window.hub.gitCommit({ repository: select.value });
      setStatus("커밋 완료(푸시 대기): " + active[0] + " — 푸시 버튼을 눌러야 원격에 반영됩니다");
      await render();
      setBusy(false);
    }
    catch (cause) { setBusy(false); error.textContent = cause instanceof Error ? cause.message : String(cause); }
  });
  push.addEventListener("click", async () => {
    if (busy) return;
    try {
      const active = currentActive();
      if (active.length === 0) { error.textContent = "활성 브랜치를 하나 이상 선택하세요."; return; }
      setBusy(true);
      await gitPushActiveBranches({ repository: select.value });
      setStatus("푸시 완료 (" + active.join(", ") + ")");
      await render();
      setBusy(false);
    }
    catch (cause) { setBusy(false); error.textContent = cause instanceof Error ? cause.message : String(cause); }
  });
  if (report) {
    report.addEventListener("click", async () => {
      if (busy) return;
      try {
        const targetRepo = repositorySettingForPath(select.value);
        if (!targetRepo || !targetRepo.notionDatabaseId?.trim() || !targetRepo.discordChannelId?.trim()) {
          error.textContent = "저장소에 연결되어 있지 않습니다. Notion DB ID와 Discord 채널 ID를 입력하세요.";
          return;
        }
        const branches = currentActive();
        if (branches.length === 0) {
          error.textContent = "활성 브랜치를 하나 이상 선택하세요.";
          return;
        }
        setBusy(true);
        const range = previousEightIso();
        const result = await window.hub.reportManualDailyReport({
          date: range.date,
          sinceIso: range.sinceIso,
          untilIso: range.untilIso,
          repositories: [select.value],
          branches,
        });
        const failed = result.branches.filter((item) => item.status === "failed");
        error.textContent = failed.map((item) => item.repositoryLabel + "/" + item.branch + ": " + item.message).join("\n");
        if (failed.length === 0) setStatus(range.date + " 일일 요약 등록 완료 (브랜치 " + branches.length + "개)");
        setBusy(false);
      } catch (cause) {
        setBusy(false); error.textContent = cause instanceof Error ? cause.message : String(cause);
      }
    });
  }
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "ghost danger";
  removeButton.textContent = "카드 삭제";
  removeButton.addEventListener("click", () => {
    const project = currentlySelectedProject();
    const cards = state.gitCardsByProject[project] ?? [];
    state.gitCardsByProject[project] = cards.filter((item) => item.path !== select.value);
    card.remove();
  });
  card.querySelector(".card-head")!.append(removeButton);
  $.dashboardAddCard.before(card);
  void render();
}

function restoreDashboardGitCards(): void {
  const project = currentlySelectedProject();
  const saved = state.gitCardsByProject[project];
  if (!saved || saved.length === 0) return;
  let added = 0;
  for (let index = 0; index < Math.min(saved.length, 3); index += 1) {
    const entry = saved[index];
    if (!entry) continue;
    addDashboardGitCard(entry.path);
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
}): void {
  const { container, names, current, onSwitch, onChange, onActiveChange } = options;
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
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "작업 브랜치 선택…";
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
    onChange?.(workBranches.slice());
    onActiveChange?.(activeBranches.slice());
  });
  container.appendChild(select);
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
    onActiveChange?.(activeBranches.slice());
    if (activeBranches.length > 0) void onSwitch(activeBranches[0]!);
  });
  const allText = document.createElement("span");
  allText.textContent = "전체 선택";
  allRow.append(allInput, allText);
  container.appendChild(allRow);
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
    for (const branch of workBranches) {
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
        onActiveChange?.(activeBranches.slice());
        if (activeBranches.length > 0) void onSwitch(activeBranches[0]!);
      });
      const text = document.createElement("span");
      text.textContent = branch;
      label.append(activeInput, text);
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

function setSettingsMessage(message: string): void {
  $.settingsMessage.textContent = message;
}

function setSettingsBusy(busy: boolean): void {
  $.settingsSave.disabled = busy;
  $.settingsTest.disabled = busy;
  $.settingsTestStatus.disabled = busy;
}

function switchMainPanel(panel: "dashboard" | "automation" | "settings"): void {
  $.panelDashboard.hidden = panel !== "dashboard";
  $.panelAutomation.hidden = panel !== "automation";
  $.panelSettings.hidden = panel !== "settings";
  $.mainTabDashboard.classList.toggle("active", panel === "dashboard");
  $.mainTabAutomation.classList.toggle("active", panel === "automation");
  $.mainTabSettings.classList.toggle("active", panel === "settings");
  if (panel === "dashboard") {
    const repos = state.dashboard?.config.repositories ?? [];
    if (repos.length > 0) void refreshState();
  } else if (panel === "settings" && state.settings === null) {
    void refreshSettings();
  }
}

function switchSettingsPanel(panel: "env" | "git" | "notion" | "discord" | "status" | "license"): void {
  $.settingsPaneEnv.hidden = panel !== "env";
  $.settingsPaneGit.hidden = panel !== "git";
  $.settingsPaneNotion.hidden = panel !== "notion";
  $.settingsPaneDiscord.hidden = panel !== "discord";
  $.settingsPaneStatus.hidden = panel !== "status";
  $.settingsPaneLicense.hidden = panel !== "license";
  $.settingsTabEnv.classList.toggle("active", panel === "env");
  $.settingsTabGit.classList.toggle("active", panel === "git");
  $.settingsTabNotion.classList.toggle("active", panel === "notion");
  $.settingsTabDiscord.classList.toggle("active", panel === "discord");
  $.settingsTabStatus.classList.toggle("active", panel === "status");
  $.settingsTabLicense.classList.toggle("active", panel === "license");
  if (panel === "status" && state.settingsStatuses.length === 0) {
    void performTestIntegrations();
  }
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
    $.settingsEnvFile.textContent = state.settings.envFile;
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

async function performSaveSettings(source: "manual" | "auto"): Promise<void> {
  const api = settingsHub();
  if (!api || state.settingsBusy) return;
  state.settingsBusy = true;
  setSettingsBusy(true);
  setSettingsMessage(source === "auto" ? "자동 저장 중…" : "저장 중…");
  try {
    const result = await api.saveSettings(collectSettingsValues());
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    state.settingsDrafts = {};
    renderSettingsForm();
    renderSettingsRepositories();
    renderIntegrationStatuses(result.statuses);
    $.settingsEnvFile.textContent = result.settings.envFile;
    if (result.restartRequired) {
      $.settingsRestart.hidden = false;
      $.settingsRestart.textContent = "일부 변경 사항(포트 등)은 앱 재시작 후 적용됩니다.";
    } else {
      $.settingsRestart.hidden = true;
    }
    setSettingsMessage(result.message || (source === "auto" ? "자동 저장 완료." : "저장 완료."));
    setStatus(result.message || "Settings saved");
    void refreshState();
  } catch (error) {
    setSettingsMessage(`저장 실패: ${error instanceof Error ? error.message : String(error)}`);
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

function buildSettingsRepositoryCard(index: number): HTMLElement {
  const draft = state.repositoryDrafts[index]!;
  const summaryText = (): string => {
    const username = draft.username && draft.username.trim().length > 0 ? draft.username.trim() : "KCWJEDI";
    const label = draft.label && draft.label.trim().length > 0 ? draft.label.trim() : "미입력";
    const path = draft.path ? " — " + draft.path : "";
    return "{ " + username + " : " + label + " }" + path;
  };
  const viewItem = state.dashboard?.dailyAutomation.repositories.find((item) => {
    const itemPath = (item.path ?? "").replace(/[\\/]+$/, "");
    const currentPath = draft.path.replace(/[\\/]+$/, "");
    return itemPath === currentPath && currentPath.length > 0;
  });

  const card = document.createElement("div");
  card.className = "repository-card";
  if (state.repositoryCollapsed[index]) card.classList.add("collapsed");

  const head = document.createElement("div");
  head.className = "repository-card-head";
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "repo-toggle";
  toggleButton.title = "세부 내용 열기/닫기";
  toggleButton.setAttribute("aria-expanded", state.repositoryCollapsed[index] ? "false" : "true");
  toggleButton.textContent = state.repositoryCollapsed[index] ? "▼" : "▲";
  const summary = document.createElement("span");
  summary.className = "repo-summary";
  summary.textContent = summaryText();
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "repository-label-input";
  labelInput.placeholder = "분야 라벨 (예: 프로그래머, 그래픽, 기획)";
  labelInput.value = draft.label;
  labelInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
    if (!item) return;
    item.label = labelInput.value.trim();
    summary.textContent = summaryText();
  });
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "ghost danger";
  removeButton.textContent = "삭제";
  toggleButton.addEventListener("click", () => {
    state.repositoryCollapsed[index] = !state.repositoryCollapsed[index];
    card.classList.toggle("collapsed", Boolean(state.repositoryCollapsed[index]));
    toggleButton.textContent = state.repositoryCollapsed[index] ? "▼" : "▲";
    toggleButton.setAttribute("aria-expanded", state.repositoryCollapsed[index] ? "false" : "true");
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
    summary.textContent = summaryText();
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
    summary.textContent = summaryText();
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
    return;
  }
  $.settingsRepositoriesMessage.textContent = "저장 중…";
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
      discordChannelId: draft.discordChannelId?.trim() || undefined,
    }));
  try {
    const result = await api.saveSettings({ HUB_GIT_REPOSITORIES: JSON.stringify(payload) });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.settingsRepositoriesMessage.textContent = "저장소 설정이 저장되었습니다.";
    state.repositoryDrafts = [];
    await refreshState();
    renderSettingsRepositories();
    renderSettingsNotion();
    renderSettingsDiscord();
  } catch (error) {
    $.settingsRepositoriesMessage.textContent = `저장 실패: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function notionDatabaseDrafts(): GitRepositorySetting[] {
  return state.dashboard?.config.repositories ?? [];
}

function notionProjectName(repository: GitRepositorySetting): string {
  if (repository.project && repository.project.trim().length > 0) return repository.project.trim();
  return repository.label && repository.label.trim().length > 0 ? repository.label.trim() : "미설정";
}

function notionUserLabel(repository: GitRepositorySetting): string {
  return repository.username && repository.username.trim().length > 0 ? repository.username.trim() : "KCWJEDI";
}

function notionSectionLabel(repository: GitRepositorySetting): string {
  return repository.label && repository.label.trim().length > 0 ? repository.label.trim() : "미입력";
}

async function saveNotionSettings(): Promise<void> {
  const api = settingsHub();
  if (!api) return;
  $.settingsNotionMessage.textContent = "저장 중...";
  // 저장소 목록은 config(저장된 원본)를 기준으로 유지하고, Notion DB ID만 덮어쓴다.
  const payload = (state.dashboard?.config.repositories ?? [])
    .filter((draft) => draft.path.trim().length > 0)
    .map((draft) => {
      const override = state.notionRepositories.find((item) => item.path === draft.path);
      return {
        ...draft,
        project: draft.project?.trim() || undefined,
        notionDatabaseId: (override?.notionDatabaseId ?? draft.notionDatabaseId)?.trim() || undefined,
        discordChannelId: draft.discordChannelId?.trim() || undefined,
      };
    });
  try {
    const result = await api.saveSettings({ HUB_GIT_REPOSITORIES: JSON.stringify(payload) });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.settingsNotionMessage.textContent = "Notion 저장소 설정이 저장되었습니다.";
    void refreshState();
  } catch (error) {
    $.settingsNotionMessage.textContent = "저장 실패: " + (error instanceof Error ? error.message : String(error));
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
    const result = await window.hub.testNotionDatabase({ repository: item.path, databaseId: dbId });
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

  const head = document.createElement("div");
  head.className = "repository-card-head";
  const summary = document.createElement("span");
  summary.className = "repo-summary";
  summary.textContent = "{ " + notionSectionLabel(repository) + " : " + notionUserLabel(repository) + " : " + notionProjectName(repository) + " }";
  head.appendChild(summary);
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
      const result = await window.hub.testNotionDatabase({ repository: item.path, databaseId: dbId });
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

  const head = document.createElement("div");
  head.className = "repository-card-head";
  const summary = document.createElement("span");
  summary.className = "repo-summary";
  summary.textContent = "{ " + notionSectionLabel(repository) + " : " + notionUserLabel(repository) + " : " + notionProjectName(repository) + " }";
  head.appendChild(summary);
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
    void refreshState();
  } catch (error) {
    $.settingsDiscordMessage.textContent = "저장 실패: " + (error instanceof Error ? error.message : String(error));
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
  const primaryCard = $.gitRepository.closest<HTMLElement>(".card");
  if (primaryCard) trackCardFocus(primaryCard);
  $.refreshState.addEventListener("click", () => void refreshState());
  $.gitRefresh.addEventListener("click", () => void refreshGit());
  $.gitRepository.addEventListener("change", () => void refreshGit());
  $.gitCommit.addEventListener("click", () => void runGitCommit());
  $.gitPush.addEventListener("click", () => void runGitPush());
  $.gitDailyReport.addEventListener("click", () => void runGitDailyReport());
  $.mainTabDashboard.addEventListener("click", () => switchMainPanel("dashboard"));
  $.mainTabAutomation.addEventListener("click", () => switchMainPanel("automation"));
  $.mainTabSettings.addEventListener("click", () => switchMainPanel("settings"));
  $.dashboardProject.addEventListener("change", () => {
    document.querySelectorAll(".dashboard-extra-card").forEach((card) => card.remove());
    restoreProjectWorkBranches();
    restoreProjectActiveBranches();
    renderGitRepositoryOptions();
    void refreshGit();
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
  $.settingsTabStatus.addEventListener("click", () => switchSettingsPanel("status"));
  $.settingsTabLicense.addEventListener("click", () => switchSettingsPanel("license"));
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
  $.settingsTestStatus.addEventListener("click", () => void performTestIntegrations());
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
  bindEvents();
  setStatus("Connecting to hub…");
  await refreshState();
  state.gitWorkBranches = [];
  restoreProjectWorkBranches();
  restoreProjectActiveBranches();
  void refreshGit();
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
  setInterval(() => {
    if (state.dashboard && settingsHub()) void performTestIntegrations();
  }, 60_000);
  if (settingsHub()) void performTestIntegrations();
}

void init();
