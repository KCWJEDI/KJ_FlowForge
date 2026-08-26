import { dialog, ipcMain, type BrowserWindow } from "electron";
import { z } from "zod";
import type { HubRuntime } from "./hub-runtime";
import type { LicenseService } from "./license-service";

const branchSchema = z.object({
  repository: z.string().min(1).optional(),
  branch: z.string().min(1),
  startPoint: z.string().min(1).optional(),
});
const stageSchema = z.object({
  repository: z.string().min(1).optional(),
  paths: z.array(z.string().min(1)).min(1),
});
const commitSchema = z.object({ repository: z.string().min(1).optional() });
const pushSchema = z.object({ repository: z.string().min(1).optional() });
const settingsSchema = z.record(z.string(), z.string().max(16_384));
const licenseSchema = z.object({ key: z.string().min(8).max(256) });
const notionDatabaseSchema = z.object({
  repository: z.string().optional(),
  databaseId: z.string().max(128),
});

async function startHubAfterActivation(): Promise<void> {
  const mainModule = await import("./index.js");
  await mainModule.startHub(lastActivatedRole);
}

let lastActivatedRole: "admin" | "user" = "user";

export function registerLicenseIpc(getLicenseService?: () => LicenseService | null): void {
  ipcMain.handle("hub:get-license-status", () => {
    const service = getLicenseService?.();
    if (!service) return { activated: true, reason: undefined };
    const stored = service.peek();
    const status = service.getStatus();
    if (!status.activated) return { activated: false, reason: status.reason };
    return {
      activated: true,
      keyId: stored?.keyId,
      owner: stored?.owner,
      role: stored?.role ?? "user",
      expiresAt: stored?.expiresAt,
      reason: undefined,
    };
  });
  ipcMain.handle("hub:activate-license", async (_event, raw: unknown) => {
    const input = licenseSchema.parse(raw);
    const service = getLicenseService?.();
    if (!service) throw new Error("License service unavailable");
    const result = await service.check(input.key);
    if (result.status === "ok") {
      lastActivatedRole = result.role;
      await startHubAfterActivation();
      return { activated: true, keyId: result.keyId, owner: result.owner, role: result.role };
    }
    if (result.status === "offline") return { activated: false, reason: "grace-offline" };
    if (result.status === "blocked") return { activated: false, reason: "blocked" };
    return { activated: false, reason: "invalid" };
  });
}

export function registerIpc(
  runtime: HubRuntime,
  getWindow: () => BrowserWindow | null,
  getLicenseService?: () => LicenseService | null,
): () => void {
  const optionalRepository = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;

  ipcMain.handle("hub:get-state", () => runtime.getState());
  ipcMain.handle("hub:inspect-git", (_event, repository?: unknown) => runtime.inspectGit(optionalRepository(repository)));
  ipcMain.handle("hub:git-create-branch", (_event, raw: unknown) => {
    const input = branchSchema.parse(raw);
    return runtime.gitCreateBranch(optionalRepository(input.repository), input.branch, input.startPoint);
  });
  ipcMain.handle("hub:git-stage", (_event, raw: unknown) => {
    const input = stageSchema.parse(raw);
    return runtime.gitStage(optionalRepository(input.repository), input.paths);
  });
  ipcMain.handle("hub:git-commit", (_event, raw: unknown) => {
    const input = commitSchema.parse(raw);
    return runtime.gitCommitWithSummary(optionalRepository(input.repository));
  });
  ipcMain.handle("hub:git-push", (_event, raw: unknown) => {
    const input = pushSchema.parse(raw);
    return runtime.gitPushCreatedCommit(optionalRepository(input.repository));
  });
  ipcMain.handle("hub:get-daily-automation", () => runtime.getDailyAutomation());
  ipcMain.handle("hub:run-daily-automation", () => runtime.runDailyAutomation());
  ipcMain.handle("hub:choose-git-repository", async () => {
    const window = getWindow();
    const options = {
      title: "로컬 Git 저장소 폴더 선택",
      properties: ["openDirectory"] as Array<"openDirectory">,
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("hub:list-git-remote-branches", (_event, raw: unknown) => {
    if (typeof raw !== "string" || !raw.trim()) throw new Error("GitHub 저장소 URL을 입력하세요.");
    return runtime.git.listRemoteBranches(raw);
  });
  ipcMain.handle("hub:get-settings", () => runtime.getSettings());
  ipcMain.handle("hub:save-settings", (_event, raw: unknown) => runtime.saveSettings(settingsSchema.parse(raw)));
  ipcMain.handle("hub:test-integrations", () => runtime.testIntegrations());
  ipcMain.handle("hub:test-notion-database", (_event, raw: unknown) => {
    const input = notionDatabaseSchema.parse(raw ?? {});
    return runtime.testNotionDatabase(input);
  });
  const stateListener = (state: unknown): void => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("hub:state-changed", state);
  };
  runtime.on("stateChanged", stateListener);
  return () => {
    runtime.off("stateChanged", stateListener);
    for (const channel of [
      "hub:get-state",
      "hub:inspect-git",
      "hub:git-create-branch",
      "hub:git-stage",
      "hub:git-commit",
      "hub:git-push",
      "hub:get-daily-automation",
      "hub:run-daily-automation",
      "hub:choose-git-repository",
      "hub:list-git-remote-branches",
      "hub:get-settings",
      "hub:save-settings",
      "hub:test-integrations",
      "hub:test-notion-database",
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
