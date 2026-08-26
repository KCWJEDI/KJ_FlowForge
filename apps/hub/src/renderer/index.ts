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
  gitSummary: required<HTMLElement>(document.getElementById("git-summary"), "git-summary"),
  gitConflicts: required<HTMLElement>(document.getElementById("git-conflicts"), "git-conflicts"),
  gitFiles: required<HTMLTableElement>(document.getElementById("git-files"), "git-files"),
  gitCommit: required<HTMLButtonElement>(document.getElementById("git-commit"), "git-commit"),
  gitPush: required<HTMLButtonElement>(document.getElementById("git-push"), "git-push"),
  gitError: required<HTMLElement>(document.getElementById("git-error"), "git-error"),
  statusBar: required<HTMLElement>(document.getElementById("status-bar-text"), "status-bar-text"),
  automationSection: required<HTMLElement>(document.getElementById("automation-section"), "automation-section"),
  mainTabDashboard: required<HTMLButtonElement>(document.getElementById("tab-dashboard"), "tab-dashboard"),
  mainTabSettings: required<HTMLButtonElement>(document.getElementById("tab-settings"), "tab-settings"),
  panelDashboard: required<HTMLElement>(document.getElementById("panel-dashboard"), "panel-dashboard"),
  panelSettings: required<HTMLElement>(document.getElementById("panel-settings"), "panel-settings"),
  settingsTabEnv: required<HTMLButtonElement>(document.getElementById("settings-tab-env"), "settings-tab-env"),
  settingsTabGit: required<HTMLButtonElement>(document.getElementById("settings-tab-git"), "settings-tab-git"),
  settingsTabNotion: required<HTMLButtonElement>(document.getElementById("settings-tab-notion"), "settings-tab-notion"),
  settingsTabStatus: required<HTMLButtonElement>(document.getElementById("settings-tab-status"), "settings-tab-status"),
  settingsPaneEnv: required<HTMLElement>(document.getElementById("settings-pane-env"), "settings-pane-env"),
  settingsPaneGit: required<HTMLElement>(document.getElementById("settings-pane-git"), "settings-pane-git"),
  settingsPaneNotion: required<HTMLElement>(document.getElementById("settings-pane-notion"), "settings-pane-notion"),
  settingsPaneStatus: required<HTMLElement>(document.getElementById("settings-pane-status"), "settings-pane-status"),
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
  integrationStatuses: required<HTMLElement>(document.getElementById("integration-statuses"), "integration-statuses"),
  settingsTestStatus: required<HTMLButtonElement>(document.getElementById("settings-test-status"), "settings-test-status"),
  automationState: required<HTMLElement>(document.getElementById("automation-state"), "automation-state"),
  automationEnabled: required<HTMLInputElement>(document.getElementById("automation-enabled"), "automation-enabled"),
  automationRepositories: required<HTMLElement>(document.getElementById("automation-repositories"), "automation-repositories"),
  automationSave: required<HTMLButtonElement>(document.getElementById("automation-save"), "automation-save"),
  automationRun: required<HTMLButtonElement>(document.getElementById("automation-run"), "automation-run"),
  automationNext: required<HTMLElement>(document.getElementById("automation-next"), "automation-next"),
  automationLastRun: required<HTMLElement>(document.getElementById("automation-last-run"), "automation-last-run"),
  automationMessageText: required<HTMLElement>(document.getElementById("automation-message-text"), "automation-message-text"),
}; 

const state: {
  dashboard: DashboardState | null;
  git: GitStatusView | null;
  gitBusy: boolean;
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
} = {
  dashboard: null,
  git: null,
  gitBusy: false,
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

function renderHeader(dashboard: DashboardState): void {
  $.headerMeta.textContent = `Started ${formatTime(dashboard.startedAt)} · HTTP ${dashboard.config.httpPort}`;
  const integrations = [
    { key: "discord" as const, label: "Discord", on: dashboard.config.integrations.discord },
    { key: "notion" as const, label: "Notion", on: dashboard.config.integrations.notion },
    { key: "github" as const, label: "GitHub", on: dashboard.config.integrations.github },
  ];
  $.integrationDots.innerHTML = "";
  for (const integration of integrations) {
    const meta = integrationDotMeta(integration.key);
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
  const repos = state.dashboard?.config.repositories ?? [];
  if (repos.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "설정된 저장소 없음";
    $.gitRepository.appendChild(option);
  } else {
    for (const repo of repos) {
      const repoPath = repo.path ?? "";
      const option = document.createElement("option");
      option.value = repoPath;
      option.textContent = repoPath;
      $.gitRepository.appendChild(option);
    }
  }
  let selected = "";
  if (previous && Array.from($.gitRepository.options).some((o) => o.value === previous)) {
    selected = previous;
  } else if (repos.length > 0) {
    selected = repos[0]?.path ?? "";
  }
  $.gitRepository.value = selected;
  if (selected && selected !== previous && !state.gitBusy) {
    void refreshGit();
  }
}
function selectedRepository(): string | undefined {
  const value = $.gitRepository.value.trim();
  return value || undefined;
}

async function refreshGit(): Promise<void> {
  setGitError("");
  state.gitBusy = true;
  $.gitRefresh.disabled = true;
  $.gitCommit.disabled = true;
  $.gitPush.disabled = true;
  setStatus("Git 상태 읽는 중…");
  try {
    state.git = await window.hub.inspectGit(selectedRepository());
    renderGit();
  } catch (error) {
    $.gitSummary.textContent = "Git 사용 불가";
    state.git = null;
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
    return;
  }
  const hasRepo = Boolean(selectedRepository());
  const hasChanges = state.git !== null && !state.git.clean;
  $.gitCommit.disabled = !hasRepo || !hasChanges;
  $.gitPush.disabled = !hasRepo;
}

async function runGitCommit(): Promise<void> {
  setGitError("");
  const repo = selectedRepository();
  if (!repo) {
    setGitError("저장소를 선택하세요.");
    return;
  }
  state.gitBusy = true;
  $.gitCommit.disabled = true;
  $.gitPush.disabled = true;
  setStatus("변경사항을 요약해 커밋하는 중…");
  try {
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
  state.gitBusy = true;
  $.gitCommit.disabled = true;
  $.gitPush.disabled = true;
  setStatus("푸시하는 중…");
  try {
    await window.hub.gitPush({ repository: repo });
    setStatus("푸시 완료");
    await refreshGit();
  } catch (error) {
    setGitError(error instanceof Error ? error.message : String(error));
    setStatus("푸시 실패");
  } finally {
    state.gitBusy = false;
    updateGitButtons();
  }
}

function renderDailyAutomation(view: DailyAutomationView): void {
  $.automationEnabled.checked = view.enabled;
  $.automationState.textContent = view.running ? "실행 중" : view.enabled ? "활성" : "비활성";
  $.automationState.className = `status-pill ${view.running ? "running" : view.enabled ? "on" : "off"}`;
  $.automationNext.textContent = view.nextRunAt
    ? `다음 실행: ${formatTime(view.nextRunAt)}`
    : "다음 실행 없음";

  $.automationRepositories.innerHTML = "";
  if (view.repositories.length === 0) {
    $.automationRepositories.innerHTML = '<p class="empty">설정된 저장소가 없습니다. 설정 탭에서 추가하세요.</p>';
  }
  for (const repo of view.repositories) {
    const card = document.createElement("div");
    card.className = "repository-card readonly";
    const title = document.createElement("div");
    title.className = "repository-card-head";
    title.textContent = repo.label || "저장소";
    const path = document.createElement("div");
    path.className = "muted";
    path.textContent = repo.path ?? repo.repositoryError ?? "";
    const branches = document.createElement("div");
    branches.className = "muted";
    branches.textContent = `브랜치: ${repo.selectedBranches.join(", ") || "선택 없음"}`;
    if (repo.repositoryError) {
      const error = document.createElement("p");
      error.className = "error-text";
      error.textContent = repo.repositoryError;
      card.append(title, error, path, branches);
    } else {
      card.append(title, path, branches);
    }
    $.automationRepositories.appendChild(card);
  }

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
  const hasSelectedBranch = view.repositories.some((repo) => repo.selectedBranches.length > 0 && repo.path);
  $.automationRun.disabled = state.automationBusy || view.running || !hasSelectedBranch;
}

async function saveDailyAutomation(): Promise<void> {
  const api = settingsHub();
  if (!api || state.automationBusy) return;
  const payload = state.repositoryDrafts
    .filter((draft) => draft.path.trim().length > 0)
      .map((draft) => ({
        label: draft.label || "저장소",
        path: draft.path.trim(),
        branches: draft.branches,
        discordMinCommits: draft.discordMinCommits ?? 0,
        discordBranches: draft.discordBranches ?? [],
      }));
  if (payload.length === 0) {
    $.automationMessageText.textContent = "최소 하나 이상의 저장소 폴터를 선택하세요.";
    return;
  }
  state.automationBusy = true;
  $.automationMessageText.textContent = "저장 중…";
  if (state.dashboard) renderDailyAutomation(state.dashboard.dailyAutomation);
  try {
    const result = await api.saveSettings({
      HUB_GIT_REPOSITORIES: JSON.stringify(payload),
      HUB_DAILY_AUTOMATION_ENABLED: String($.automationEnabled.checked),
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
  renderHeader(dashboard);
  // 08:00 전체 브랜치 자동화는 관리자 전용 카드입니다.
  $.automationSection.hidden = dashboard.role !== "admin";
  renderGitRepositoryOptions();
  renderDailyAutomation(dashboard.dailyAutomation);
  renderSettingsNotion();
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

function switchMainPanel(panel: "dashboard" | "settings"): void {
  const isDashboard = panel === "dashboard";
  $.panelDashboard.hidden = !isDashboard;
  $.panelSettings.hidden = isDashboard;
  $.mainTabDashboard.classList.toggle("active", isDashboard);
  $.mainTabSettings.classList.toggle("active", !isDashboard);
  if (isDashboard) {
    const repos = state.dashboard?.config.repositories ?? [];
    if (repos.length > 0) void refreshState();
  } else if (state.settings === null) {
    void refreshSettings();
  }
}

function switchSettingsPanel(panel: "env" | "git" | "notion" | "status"): void {
  $.settingsPaneEnv.hidden = panel !== "env";
  $.settingsPaneGit.hidden = panel !== "git";
  $.settingsPaneNotion.hidden = panel !== "notion";
  $.settingsPaneStatus.hidden = panel !== "status";
  $.settingsTabEnv.classList.toggle("active", panel === "env");
  $.settingsTabGit.classList.toggle("active", panel === "git");
  $.settingsTabNotion.classList.toggle("active", panel === "notion");
  $.settingsTabStatus.classList.toggle("active", panel === "status");
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
function renderSettingsRepositories(): void {
  const configured = state.dashboard?.config.repositories ?? [];
  if (state.repositoryDrafts.length === 0 && configured.length > 0) {
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
      };
    });
  }
  $.settingsRepositories.innerHTML = "";
  for (let index = 0; index < state.repositoryDrafts.length; index += 1) {
    $.settingsRepositories.appendChild(buildSettingsRepositoryCard(index));
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
    renderSettingsRepositories();
  });
  head.append(toggleButton, summary, removeButton);
  card.appendChild(head);
  card.appendChild(labelInput);

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
  let urlLoadTimer: ReturnType<typeof setTimeout> | undefined;
  urlInput.addEventListener("input", () => {
    const item = state.repositoryDrafts[index];
   if (!item) return;
   item.url = urlInput.value.trim();
    if (urlLoadTimer) clearTimeout(urlLoadTimer);
    if (item.url) urlLoadTimer = setTimeout(() => void loadRemoteBranches(), 700);
 });
 urlLabel.appendChild(urlInput);
 card.appendChild(urlLabel);

 const remoteBranchRow = document.createElement("div");
  remoteBranchRow.className = "repository-branch-row";
  const remoteBranchSelect = document.createElement("select");
  remoteBranchSelect.className = "repository-branch-select";
  const emptyBranch = document.createElement("option");
  emptyBranch.value = "";
  emptyBranch.textContent = "GitHub URL을 확인해 브랜치를 불러오세요";
  remoteBranchSelect.appendChild(emptyBranch);
  const loadBranchesButton = document.createElement("button");
  loadBranchesButton.type = "button";
  loadBranchesButton.className = "ghost";
  loadBranchesButton.textContent = "브랜치 불러오기";
  const branchMessage = document.createElement("span");
  branchMessage.className = "muted";
  const loadRemoteBranches = async (): Promise<void> => {
    const item = state.repositoryDrafts[index];
    if (!item || !item.url.trim()) {
      branchMessage.textContent = "먼저 GitHub URL을 입력하세요.";
      return;
    }
    loadBranchesButton.disabled = true;
    branchMessage.textContent = "브랜치 확인 중…";
    try {
      const branches = await window.hub.listGitRemoteBranches(item.url);
      remoteBranchSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "적용할 브랜치를 선택하세요";
      remoteBranchSelect.appendChild(placeholder);
      for (const branch of branches) {
        const option = document.createElement("option");
        option.value = branch;
        option.textContent = branch;
        remoteBranchSelect.appendChild(option);
      }
      remoteBranchSelect.value = item.defaultBranch ?? "";
      branchMessage.textContent = branches.length > 0 ? `${branches.length}개 브랜치를 불러왔습니다.` : "원격 브랜치가 없습니다.";
    } catch (error) {
      branchMessage.textContent = `브랜치 확인 실패: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      loadBranchesButton.disabled = false;
    }
  };
  remoteBranchSelect.addEventListener("change", () => {
    const item = state.repositoryDrafts[index];
    if (!item) return;
    item.defaultBranch = remoteBranchSelect.value;
    item.branches = remoteBranchSelect.value ? [remoteBranchSelect.value] : [];
    renderSettingsRepositories();
  });
  loadBranchesButton.addEventListener("click", () => void loadRemoteBranches());
  remoteBranchRow.append(remoteBranchSelect, loadBranchesButton);
  card.appendChild(remoteBranchRow);
  card.appendChild(branchMessage);
  if (draft.url.trim()) void loadRemoteBranches();


  if (viewItem?.repositoryError) {
    const error = document.createElement("p");
    error.className = "error-text";
    error.textContent = viewItem.repositoryError;
    card.appendChild(error);
  }

  const branchBlock = document.createElement("div");
  const branchTitle = document.createElement("div");
  branchTitle.className = "setting-label";
  branchTitle.textContent = "자동화 대상 브랜치";
  branchBlock.appendChild(branchTitle);
  const branchOptions = document.createElement("div");
  branchOptions.className = "branch-options";
  const branches = [...new Set([...(viewItem?.availableBranches ?? []), ...draft.branches])];
  if (branches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "먼저 정상적인 로컬 Git 저장소 폴터를 선택하세요.";
    branchOptions.appendChild(empty);
  }
  for (const branch of branches) {
    const label = document.createElement("label");
    label.className = "branch-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = branch;
    input.checked = draft.branches.includes(branch);
    input.addEventListener("change", () => {
      const item = state.repositoryDrafts[index];
      if (!item) return;
      const list = item.branches;
      if (input.checked) {
        if (!list.includes(branch)) list.push(branch);
      } else {
        const position = list.indexOf(branch);
        if (position >= 0) list.splice(position, 1);
      }
    });
    label.append(input, document.createTextNode(branch));
    branchOptions.appendChild(label);
  }
  branchBlock.appendChild(branchOptions);
  card.appendChild(branchBlock);

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

  const discordBranchTitle = document.createElement("div");
  discordBranchTitle.className = "muted";
  discordBranchTitle.textContent = "Discord로 보낼 브랜치 (선택하지 않으면 전체)";
  discordBlock.appendChild(discordBranchTitle);
  const discordBranchOptions = document.createElement("div");
  discordBranchOptions.className = "branch-options";
  const discordBranches = [...new Set([...(viewItem?.availableBranches ?? []), ...(draft.discordBranches ?? [])])];
  for (const branch of discordBranches) {
    const label = document.createElement("label");
    label.className = "branch-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = branch;
    input.checked = (draft.discordBranches ?? []).includes(branch);
    input.addEventListener("change", () => {
      const item = state.repositoryDrafts[index];
      if (!item) return;
      item.discordBranches ??= [];
      if (input.checked && !item.discordBranches.includes(branch)) item.discordBranches.push(branch);
      if (!input.checked) item.discordBranches = item.discordBranches.filter((value) => value !== branch);
    });
    label.append(input, document.createTextNode(branch));
    discordBranchOptions.appendChild(label);
  }
  discordBlock.append(discordBranchTitle, discordBranchOptions);
  card.appendChild(discordBlock);
  return card;
}

async function saveRepositories(): Promise<void> {
  const api = settingsHub();
  if (!api) return;
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
      project: draft.project?.trim() || undefined,
      notionDatabaseId: draft.notionDatabaseId?.trim() || undefined,
    }));
  try {
    const result = await api.saveSettings({ HUB_GIT_REPOSITORIES: JSON.stringify(payload) });
    state.settings = result.settings;
    state.settingsStatuses = result.statuses;
    $.settingsRepositoriesMessage.textContent = "저장소 설정이 저장되었습니다.";
    void refreshState();
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
  const payload = notionDatabaseDrafts()
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
      project: draft.project?.trim() || undefined,
      notionDatabaseId: draft.notionDatabaseId?.trim() || undefined,
    }));
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
  $.settingsNotionRepositories.innerHTML = "";
  if (repositories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "등록된 Git 저장소가 없습니다. 먼저 설정 탭의 Git 저장소에서 저장소를 추가하세요.";
    $.settingsNotionRepositories.appendChild(empty);
    return;
  }
  for (let index = 0; index < repositories.length; index += 1) {
    $.settingsNotionRepositories.appendChild(buildSettingsNotionCard(repositories[index]!, index));
  }
}

async function runNotionDatabaseTest(index: number): Promise<void> {
  const item = state.dashboard?.config.repositories[index];
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
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    state.notionTestStates[index] = { state: "error", message: errorText };
    $.settingsNotionMessage.textContent = "테스트 실패: " + errorText;
    $.settingsNotionMessage.className = "error-text";
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
    const updated = state.dashboard?.config.repositories;
    if (!updated) return;
    updated[index]!.notionDatabaseId = databaseInput.value.trim();
    if (testTimer) clearTimeout(testTimer);
    if (updated[index]!.notionDatabaseId) {
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
    const item = state.dashboard?.config.repositories[index];
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
  for (const status of statuses) {
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
  $.refreshState.addEventListener("click", () => void refreshState());
  $.gitRefresh.addEventListener("click", () => void refreshGit());
  $.gitRepository.addEventListener("change", () => void refreshGit());
  $.gitCommit.addEventListener("click", () => void runGitCommit());
  $.gitPush.addEventListener("click", () => void runGitPush());
  $.mainTabDashboard.addEventListener("click", () => switchMainPanel("dashboard"));
  $.mainTabSettings.addEventListener("click", () => switchMainPanel("settings"));
  $.settingsTabEnv.addEventListener("click", () => switchSettingsPanel("env"));
  $.settingsTabGit.addEventListener("click", () => switchSettingsPanel("git"));
  $.settingsTabNotion.addEventListener("click", () => switchSettingsPanel("notion"));
  $.settingsTabStatus.addEventListener("click", () => switchSettingsPanel("status"));
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

function init(): void {
  bindEvents();
  setStatus("Connecting to hub…");
  void Promise.all([refreshState(), refreshGit()]);
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

init();
