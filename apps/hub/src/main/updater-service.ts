import { app } from "electron";
import { EventEmitter } from "node:events";
import type { UpdatePhase, UpdateStatus } from "../shared/ipc";

// 자동 업데이트가 실패했을 때 사용자가 직접 내려받을 수 있는 릴리스 페이지입니다.
const RELEASES_PAGE = "https://github.com/KCWJEDI/KJ_FlowForge_Releases/releases/latest";
// 앱 시작 직후 곧바로 확인하면 창 로딩과 겹치므로 잠시 뒤에 확인합니다.
const INITIAL_CHECK_DELAY_MS = 8_000;
// 사용자가 명시적으로 확인하면 위 지연을 건너뜁니다.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// electron-updater는 CommonJS로 로드합니다(esbuild 번들 시 require 유지).
// eslint-disable-next-line @typescript-eslint/no-var-requires
type AutoUpdater = typeof import("electron-updater").autoUpdater;

export interface UpdaterServiceOptions {
  /** 패키징되지 않은 개발 실행에서는 업데이트를 끕니다. */
  isPackaged: boolean;
  /** 휴대용(portable) 실행에서는 electron-updater가 동작하지 않습니다. */
  isPortable: boolean;
}

export class UpdaterService extends EventEmitter {
  private status: UpdateStatus;
  private autoUpdater: AutoUpdater | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private recheckTimer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private installing = false;

  public constructor(private readonly options: UpdaterServiceOptions) {
    super();
    this.status = {
      phase: options.isPackaged ? (options.isPortable ? "disabled" : "idle") : "disabled",
      currentVersion: app.getVersion(),
      message: options.isPackaged
        ? options.isPortable
          ? "휴대용 실행에서는 자동 업데이트를 사용할 수 없습니다. 설치 버전으로 실행하면 자동으로 확인합니다."
          : "업데이트 확인 대기 중입니다."
        : "개발 실행에서는 자동 업데이트를 사용할 수 없습니다.",
      manualDownloadUrl: RELEASES_PAGE,
    };
  }

  public getStatus(): UpdateStatus {
    return this.status;
  }

  /** 창이 준비된 뒤 호출합니다. 첫 확인을 예약합니다. */
  public start(): void {
    if (!this.options.isPackaged || this.options.isPortable) return;
    void this.ensureUpdater();
    this.initialTimer = setTimeout(() => void this.checkNow(), INITIAL_CHECK_DELAY_MS);
    this.initialTimer.unref?.();
    this.recheckTimer = setInterval(() => void this.checkNow(), RECHECK_INTERVAL_MS);
    this.recheckTimer.unref?.();
  }

  public stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.recheckTimer) clearInterval(this.recheckTimer);
    this.initialTimer = null;
    this.recheckTimer = null;
  }

  /** 사용자가 "업데이트 확인"을 눌렀을 때. */
  public async checkNow(): Promise<UpdateStatus> {
    if (!this.options.isPackaged || this.options.isPortable) return this.status;
    const autoUpdater = this.ensureUpdater();
    if (!autoUpdater) return this.status;
    if (this.checking) return this.status;
    this.checking = true;
    this.setStatus({ phase: "checking", message: "업데이트를 확인하는 중입니다…", progress: undefined });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // electron-updater는 실패를 error 이벤트로도 알리므로 여기서는 무시합니다.
      if (this.status.phase === "checking") this.fail(error);
    } finally {
      this.checking = false;
    }
    return this.status;
  }

  /** 다운로드를 시작합니다(자동 다운로드가 꺼진 경우의 대비). */
  public async download(): Promise<UpdateStatus> {
    if (!this.options.isPackaged || this.options.isPortable) return this.status;
    const autoUpdater = this.ensureUpdater();
    if (!autoUpdater) return this.status;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.fail(error);
    }
    return this.status;
  }

  /** 내려받은 업데이트를 설치하고 재시작합니다. */
  public install(): void {
    if (!this.autoUpdater) return;
    this.installing = true;
    // isSilent=false, isForceRunAfter=true: 설치 후 앱을 다시 실행합니다.
    this.autoUpdater.quitAndInstall(false, true);
  }

  /** 업데이트 설치로 인한 종료인지 여부. index.ts의 종료 가드에서 사용합니다. */
  public isInstallingUpdate(): boolean {
    return this.installing;
  }

  private ensureUpdater(): AutoUpdater | null {
    if (this.autoUpdater) return this.autoUpdater;
    try {
      // 패키징된 번들에서만 로드합니다(개발 중에는 app-update.yml이 없어 예외 발생).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const updaterModule = require("electron-updater") as typeof import("electron-updater");
      const autoUpdater = updaterModule.autoUpdater;
      autoUpdater.autoDownload = true;
      // 종료 시 자동 설치를 켜면 앱의 커스텀 종료 가드와 충돌하므로,
      // 사용자가 UI에서 "지금 설치"를 눌렀을 때만 설치합니다.
      autoUpdater.autoInstallOnAppQuit = false;
      // 서명 검증은 electron-builder가 넣은 publisherName 기준으로 수행됩니다.
      autoUpdater.on("checking-for-update", () =>
        this.setStatus({ phase: "checking", message: "업데이트를 확인하는 중입니다…", progress: undefined }),
      );
      autoUpdater.on("update-available", (info) =>
        this.setStatus({
          phase: "available",
          latestVersion: info.version,
          releaseNotes: normalizeNotes(info.releaseNotes),
          releaseDate: typeof info.releaseDate === "string" ? info.releaseDate : undefined,
          message: `새 버전 ${info.version}을(를) 내려받는 중입니다…`,
          progress: undefined,
          checkedAt: new Date().toISOString(),
        }),
      );
      autoUpdater.on("update-not-available", () =>
        this.setStatus({
          phase: "not-available",
          latestVersion: this.status.latestVersion,
          message: "최신 버전을 사용 중입니다.",
          progress: undefined,
          checkedAt: new Date().toISOString(),
        }),
      );
      autoUpdater.on("download-progress", (progress) =>
        this.setStatus({
          phase: "downloading",
          progress: {
            percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
            transferred: Number(progress.transferred) || 0,
            total: Number(progress.total) || 0,
            bytesPerSecond: Number(progress.bytesPerSecond) || 0,
          },
          message: "업데이트를 내려받는 중입니다…",
        }),
      );
      autoUpdater.on("update-downloaded", (info) =>
        this.setStatus({
          phase: "downloaded",
          latestVersion: info.version,
          releaseNotes: normalizeNotes(info.releaseNotes),
          message: "새 버전을 설치할 준비가 되었습니다. 설치하면 앱이 다시 시작됩니다.",
          progress: undefined,
        }),
      );
      autoUpdater.on("error", (error) => this.fail(error));
      this.autoUpdater = autoUpdater;
      return autoUpdater;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  private fail(error: unknown): void {
    const raw = error instanceof Error ? error.message : String(error);
    this.setStatus({
      phase: "error",
      message: "업데이트를 확인하지 못했습니다. 잠시 후 다시 시도하거나 릴리스 페이지에서 직접 내려받으세요.",
      detail: raw,
      progress: undefined,
      checkedAt: new Date().toISOString(),
    });
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.status);
  }
}

/** electron-updater의 releaseNotes는 문자열, 배열, 객체 등 형태가 다양합니다. */
function normalizeNotes(notes: unknown): string | undefined {
  if (typeof notes === "string") return notes.slice(0, 4_000);
  if (Array.isArray(notes)) {
    const text = notes
      .map((entry) => (entry && typeof entry === "object" && typeof (entry as { note?: unknown }).note === "string"
        ? (entry as { note: string }).note
        : ""))
      .filter(Boolean)
      .join("\n");
    return text ? text.slice(0, 4_000) : undefined;
  }
  return undefined;
}

export type { UpdatePhase, UpdateStatus };

