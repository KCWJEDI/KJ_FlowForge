import { contextBridge, ipcRenderer } from "electron";
import type { DashboardState, HubApi } from "../shared/ipc";

const api: HubApi = {
  getState: () => ipcRenderer.invoke("hub:get-state"),
  inspectGit: (repository) => ipcRenderer.invoke("hub:inspect-git", repository),
  gitCreateBranch: (args) => ipcRenderer.invoke("hub:git-create-branch", args),
  gitStage: (args) => ipcRenderer.invoke("hub:git-stage", args),
  gitCommit: (args) => ipcRenderer.invoke("hub:git-commit", args),
  gitPush: (args) => ipcRenderer.invoke("hub:git-push", args),
  getDailyAutomation: () => ipcRenderer.invoke("hub:get-daily-automation"),
  runDailyAutomation: () => ipcRenderer.invoke("hub:run-daily-automation"),
  chooseGitRepository: () => ipcRenderer.invoke("hub:choose-git-repository"),
  listGitRemoteBranches: (url) => ipcRenderer.invoke("hub:list-git-remote-branches", url),
  getSettings: () => ipcRenderer.invoke("hub:get-settings"),
  saveSettings: (values) => ipcRenderer.invoke("hub:save-settings", values),
  testIntegrations: () => ipcRenderer.invoke("hub:test-integrations"),
  getLicenseStatus: () => ipcRenderer.invoke("hub:get-license-status"),
  activateLicense: (key) => ipcRenderer.invoke("hub:activate-license", { key }),
  onStateChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: DashboardState): void => listener(state);
    ipcRenderer.on("hub:state-changed", wrapped);
    return () => ipcRenderer.removeListener("hub:state-changed", wrapped);
  },
};

contextBridge.exposeInMainWorld("hub", api);
