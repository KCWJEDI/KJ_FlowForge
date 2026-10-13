import { contextBridge, ipcRenderer } from "electron";
import type { DashboardState, HubApi, KanbanBoard, UpdateStatus } from "../shared/ipc";

const api: HubApi = {
  getState: () => ipcRenderer.invoke("hub:get-state"),
  inspectGit: (repository) => ipcRenderer.invoke("hub:inspect-git", repository),
  listGitBranches: (repository) => ipcRenderer.invoke("hub:list-git-branches", repository),
  watchRepository: (directory) => ipcRenderer.invoke("hub:watch-repository", directory),
  unwatchRepository: (directory) => ipcRenderer.invoke("hub:unwatch-repository", directory),
  switchGitBranch: (args) => ipcRenderer.invoke("hub:switch-git-branch", args),
  gitCreateBranch: (args) => ipcRenderer.invoke("hub:git-create-branch", args),
  gitStage: (args) => ipcRenderer.invoke("hub:git-stage", args),
  gitDiscardPreview: (repository) => ipcRenderer.invoke("hub:git-discard-preview", repository),
  gitDiscard: (args) => ipcRenderer.invoke("hub:git-discard", args),
  gitCommit: (args) => ipcRenderer.invoke("hub:git-commit", args),
  gitPush: (args) => ipcRenderer.invoke("hub:git-push", args),
  gitPushBranch: (args) => ipcRenderer.invoke("hub:git-push-branch", args),
  gitPull: (args) => ipcRenderer.invoke("hub:git-pull", args),
  getDailyAutomation: () => ipcRenderer.invoke("hub:get-daily-automation"),
  runDailyAutomation: () => ipcRenderer.invoke("hub:run-daily-automation"),
  reportManualDailyReport: (args) => ipcRenderer.invoke("hub:report-manual-daily-report", args),
  getProjects: () => ipcRenderer.invoke("hub:get-projects"),
  cloneGitRepository: (args) => ipcRenderer.invoke("hub:clone-git-repository", args),
  connectGitRepository: (args) => ipcRenderer.invoke("hub:connect-git-repository", args),
  connectOrCloneGitRepository: (args) => ipcRenderer.invoke("hub:connect-or-clone-git-repository", args),
  chooseGitRepository: () => ipcRenderer.invoke("hub:choose-git-repository"),
  listGitRemoteBranches: (url) => ipcRenderer.invoke("hub:list-git-remote-branches", url),
  getSettings: () => ipcRenderer.invoke("hub:get-settings"),
  saveSettings: (values) => ipcRenderer.invoke("hub:save-settings", values),
  getGitSelection: () => ipcRenderer.invoke("hub:get-git-selection"),
  saveGitSelection: (state) => ipcRenderer.invoke("hub:save-git-selection", state),
  testIntegrations: () => ipcRenderer.invoke("hub:test-integrations"),
  testNotionDatabase: (args) => ipcRenderer.invoke("hub:test-notion-database", args),
  testDiscordChannel: (args) => ipcRenderer.invoke("hub:test-discord-channel", args),
  checkRepositoryConnections: () => ipcRenderer.invoke("hub:check-repository-connections"),
  getLicenseStatus: () => ipcRenderer.invoke("hub:get-license-status"),
  activateLicense: (key) => ipcRenderer.invoke("hub:activate-license", { key }),
  replaceLicense: (key) => ipcRenderer.invoke("hub:replace-license", { key }),
  getUpdateStatus: () => ipcRenderer.invoke("hub:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("hub:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("hub:install-update"),
  onUpdateStatus: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => listener(status);
    ipcRenderer.on("hub:update-status", wrapped);
    return () => ipcRenderer.removeListener("hub:update-status", wrapped);
  },
  getKanbanBoard: () => ipcRenderer.invoke("hub:get-kanban-board"),
  moveKanbanCard: (args) => ipcRenderer.invoke("hub:move-kanban-card", args),
  createKanbanCard: (args) => ipcRenderer.invoke("hub:create-kanban-card", args),
  deleteKanbanCard: (args) => ipcRenderer.invoke("hub:delete-kanban-card", args),
  onKanbanChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, board: KanbanBoard): void => listener(board);
    ipcRenderer.on("hub:kanban-changed", wrapped);
    return () => ipcRenderer.removeListener("hub:kanban-changed", wrapped);
  },
  onStateChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: DashboardState): void => listener(state);
    ipcRenderer.on("hub:state-changed", wrapped);
    return () => ipcRenderer.removeListener("hub:state-changed", wrapped);
  },
  onRepositoryChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, repository: string): void => listener(repository);
    ipcRenderer.on("hub:repository-changed", wrapped);
    return () => ipcRenderer.removeListener("hub:repository-changed", wrapped);
  },
};

contextBridge.exposeInMainWorld("hub", api);
