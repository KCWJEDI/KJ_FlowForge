import { contextBridge, ipcRenderer } from "electron";
import type { DashboardState, HubApi } from "../shared/ipc";

const api: HubApi = {
  getState: () => ipcRenderer.invoke("hub:get-state"),
  inspectGit: (repository) => ipcRenderer.invoke("hub:inspect-git", repository),
  listGitBranches: (repository) => ipcRenderer.invoke("hub:list-git-branches", repository),
  switchGitBranch: (args) => ipcRenderer.invoke("hub:switch-git-branch", args),
  gitCreateBranch: (args) => ipcRenderer.invoke("hub:git-create-branch", args),
  gitStage: (args) => ipcRenderer.invoke("hub:git-stage", args),
  gitCommit: (args) => ipcRenderer.invoke("hub:git-commit", args),
  gitPush: (args) => ipcRenderer.invoke("hub:git-push", args),
  gitPushBranch: (args) => ipcRenderer.invoke("hub:git-push-branch", args),
  getDailyAutomation: () => ipcRenderer.invoke("hub:get-daily-automation"),
  runDailyAutomation: () => ipcRenderer.invoke("hub:run-daily-automation"),
  reportManualDailyReport: (args) => ipcRenderer.invoke("hub:report-manual-daily-report", args),
  chooseGitRepository: () => ipcRenderer.invoke("hub:choose-git-repository"),
  listGitRemoteBranches: (url) => ipcRenderer.invoke("hub:list-git-remote-branches", url),
  getSettings: () => ipcRenderer.invoke("hub:get-settings"),
  saveSettings: (values) => ipcRenderer.invoke("hub:save-settings", values),
  testIntegrations: () => ipcRenderer.invoke("hub:test-integrations"),
  testNotionDatabase: (args) => ipcRenderer.invoke("hub:test-notion-database", args),
  testDiscordChannel: (args) => ipcRenderer.invoke("hub:test-discord-channel", args),
  getLicenseStatus: () => ipcRenderer.invoke("hub:get-license-status"),
  activateLicense: (key) => ipcRenderer.invoke("hub:activate-license", { key }),
  replaceLicense: (key) => ipcRenderer.invoke("hub:replace-license", { key }),
  onStateChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: DashboardState): void => listener(state);
    ipcRenderer.on("hub:state-changed", wrapped);
    return () => ipcRenderer.removeListener("hub:state-changed", wrapped);
  },
};

contextBridge.exposeInMainWorld("hub", api);
