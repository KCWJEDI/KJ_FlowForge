import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { applyEnvToProcess, ensureEnvFile, readEnvFile } from "./env-store";
import { loadConfig } from "./config";
import { HubRuntime } from "./hub-runtime";
import { LocalHttpApi } from "./http-api";
import { registerIpc, registerLicenseIpc } from "./ipc";
import { LicenseService } from "./license-service";
import type { LicenseRole } from "../shared/ipc";

let licenseService: LicenseService | null = null;

let mainWindow: BrowserWindow | null = null;
let singleInstanceLockAcquired = false;
let runtime: HubRuntime | null = null;
let httpApi: LocalHttpApi | null = null;
let unregisterIpc: (() => void) | null = null;
let shutdownStarted = false;

async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try {
    unregisterIpc?.();
  } finally {
    unregisterIpc = null;
  }
  await Promise.allSettled([httpApi?.stop() ?? Promise.resolve(), runtime?.stop() ?? Promise.resolve()]);
  httpApi = null;
  runtime = null;
}

async function bootstrap(): Promise<void> {
  if (!singleInstanceLockAcquired) {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      // 이미 다른 인스턴스가 실행 중이면 이 프로세스는 조용히 종료합니다.
      app.exit(0);
      return;
    }
    singleInstanceLockAcquired = true;
    app.on("second-instance", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
  const userData = app.getPath("userData");
  const envFile = path.join(userData, ".env");
  await ensureEnvFile(envFile);
  applyEnvToProcess(await readEnvFile(envFile));
  licenseService = new LicenseService(userData, {
    manifestUrl: process.env.HUB_LICENSE_MANIFEST_URL,
    githubToken: process.env.GITHUB_TOKEN,
  });
  registerLicenseIpc(() => licenseService);
  const gate = await licenseService.verifyOnStartup();
  if (!gate.activated) {
    await showLicenseWindow(gate.reason);
    return;
  }
  await startHub(gate.role);
}

export async function startHub(role?: LicenseRole): Promise<void> {
  const userData = app.getPath("userData");
  const envFile = path.join(userData, ".env");
  const config = await loadConfig(path.join(userData, "runtime"), envFile);
  runtime = new HubRuntime(config, role ?? "user");
  httpApi = new LocalHttpApi(runtime);
  await runtime.start();
  await httpApi.start();
  unregisterIpc = registerIpc(runtime, () => mainWindow, () => licenseService);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: "#0f1220",
    title: "KJ FlowForge",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error(error);
  app.quit();
});

async function showLicenseWindow(reason: "missing" | "grace-offline" | "invalid" | "blocked" | undefined): Promise<void> {
  const { dialog } = await import("electron");
  const message = reason === "grace-offline"
    ? "라이선스 확인을 위해 네트워크에 연결해주세요."
    : reason === "invalid"
      ? "저장된 라이선스가 더 이상 유효하지 않습니다. 유효한 키를 입력하세요."
      : "유효한 키를 입력해주세요.";
  mainWindow = new BrowserWindow({
    width: 480,
    height: 320,
    minWidth: 420,
    minHeight: 280,
    backgroundColor: "#0f1220",
    title: "KJ FlowForge - 라이선스 인증",
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  void mainWindow.loadFile(path.join(__dirname, "../renderer/license.html"), { hash: encodeURIComponent(message) });
}

export function getLicenseService(): LicenseService | null {
  return licenseService;
}

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});
