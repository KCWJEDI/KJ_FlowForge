import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { applyEnvToProcess, ensureEnvFile, readEnvFile } from "./env-store";
import { loadConfig } from "./config";
import { HubRuntime } from "./hub-runtime";
import { LocalHttpApi } from "./http-api";
import { registerIpc, registerLicenseIpc } from "./ipc";
import { LicenseService } from "./license-service";
import { UpdaterService } from "./updater-service";
import type { LicenseRole } from "../shared/ipc";

let licenseService: LicenseService | null = null;
let updaterService: UpdaterService | null = null;

let mainWindow: BrowserWindow | null = null;
let singleInstanceLockAcquired = false;
let runtime: HubRuntime | null = null;
let httpApi: LocalHttpApi | null = null;
let unregisterIpc: (() => void) | null = null;
let shutdownStarted = false;
let hardExitTimer: ReturnType<typeof setTimeout> | null = null;

/** 종료 진행 중 닫기가 걸리는 일부 리소스 때문에 프로세스가 남지 않도록,
 *  cleanup이 완료되면 앱을 완전히 종료한다. cleanup이 최대 지연 시간을 넘기면
 *  강제로 프로세스를 종료해 남는 프로세스가 없도록 보장한다. */
function scheduleHardExit(afterMs = 12_000): void {
  if (hardExitTimer) return;
  hardExitTimer = setTimeout(() => {
    // 어떤 핸들이 살아있어도 모든 프로세스를 확실히 끝낸다.
    app.exit(0);
  }, afterMs);
  hardExitTimer.unref?.();
}

async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try {
    unregisterIpc?.();
  } finally {
    unregisterIpc = null;
  }
  await Promise.allSettled([httpApi?.stop() ?? Promise.resolve(), runtime?.stop() ?? Promise.resolve()]);
  licenseService?.stopPeriodicVerification();
  updaterService?.stop();
  httpApi = null;
  runtime = null;
}

/** 창이 닫힐 때 호출된다. 앱 전체를 종료해 모든 프로세스가 완전히 끝나도록 한다. */
async function quitEverything(): Promise<void> {
  scheduleHardExit();
  app.quit();
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
    onRoleChanged: (role) => runtime?.setRole(role),
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
  runtime = new HubRuntime(config, role ?? "user", licenseService?.peek()?.keyId ?? "", licenseService?.peekKey() ?? "");
  // config 저장소가 비공개여도 라이선스 저장소에서 자격증명을 먼저 확보하도록 로더를 주입합니다.
  runtime.setCredentialLoader(async () => {
    if (!licenseService) return null;
    try {
      return await licenseService.fetchCredentialBundle();
    } catch {
      return null;
    }
  });
  licenseService?.startPeriodicVerification();
  httpApi = new LocalHttpApi(runtime);
  await runtime.start();
  await httpApi.start();
  updaterService = new UpdaterService({
    isPackaged: app.isPackaged,
    // 휴대용(portable) 실행에서는 electron-updater가 동작하지 않습니다.
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  });
  unregisterIpc = registerIpc(runtime, () => mainWindow, () => licenseService, () => updaterService);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: "#0b0e19",
    icon: path.join(__dirname, "../renderer/icon.png"),
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
  updaterService?.start();
  // 창을 닫으면 남는 백그라운드/하위 프로세스까지 모두 종료되도록 전체 앱을 quit한다.
  mainWindow.on("close", () => {
    void quitEverything();
  });
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
    height: 470,
    backgroundColor: "#0b0e19",
    icon: path.join(__dirname, "../renderer/icon.png"),
    title: "KJ FlowForge - 라이선스 인증",
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
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

app.on("window-all-closed", () => quitEverything());

app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  // 자동 업데이트 설치 중에는 NSIS 설치 프로세스가 종료를 관리하므로
  // 종료를 막지 않고 그대로 진행시킵니다.
  if (updaterService?.isInstallingUpdate()) return;
  event.preventDefault();
  scheduleHardExit();
  void shutdown().finally(() => app.exit(0));
});
