/**
 * 연결된 Git 저장소 폴더의 변경을 감시합니다.
 *
 * 사용자가 Unity 에디터 등에서 파일을 저장하면 Git 상태(변경 파일 목록)가 바뀝니다.
 * 그때마다 자동으로 화면을 새로고침하기 위해, 폴더 변경을 감지해 알립니다.
 *
 * Node 내장 fs.watch 만 사용하므로 별도 의존성이 필요 없습니다.
 * .git 내부는 제외해 잦은 내부 갱신으로 인한 과도한 이벤트를 걸러냅니다.
 */
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

export interface RepoWatcherOptions {
  /** 변경이 감지되면 호출됩니다(디바운스 적용). */
  onChange: (repository: string) => void;
  /** 변경 알림까지의 대기 시간(ms). 편집기 저장이 여러 이벤트를 만들므로 묶습니다. */
  debounceMs?: number;
}

/** 활성화된 감시 하나를 나타냅니다. */
interface ActiveWatch {
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
}

export class RepositoryWatcher {
  private readonly watches = new Map<string, ActiveWatch>();
  private readonly options: Required<RepoWatcherOptions>;

  public constructor(options: RepoWatcherOptions) {
    this.options = {
      onChange: options.onChange,
      debounceMs: options.debounceMs ?? 700,
    };
  }

  /** 저장소 감시를 시작합니다(이미 감시 중이면 무시). */
  public watch(repository: string): void {
    const target = (repository ?? "").trim();
    if (!target || this.watches.has(target)) return;
    try {
      const watcher = watch(target, { recursive: true, persistent: false }, (_event, filename) => {
        // .git 내부 변경은 Git 상태 표시와 무관하므로 무시합니다.
        const name = typeof filename === "string" ? filename : "";
        if (name && name.replace(/\\/g, "/").split("/")[0] === ".git") return;
        this.scheduleNotify(target);
      });
      // 일부 파일 시스템은 recursive 를 지원하지 않을 수 있으므로 오류를 흡수합니다.
      watcher.on("error", () => this.unwatch(target));
      this.watches.set(target, { watcher, timer: null });
    } catch {
      // 감시를 시작하지 못해도 앱 동작에는 영향이 없습니다(수동 새로고침 사용).
    }
  }

  /** 저장소 감시를 중단합니다. */
  public unwatch(repository: string): void {
    const target = (repository ?? "").trim();
    const active = this.watches.get(target);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    try { active.watcher.close(); } catch { /* 이미 닫혔으면 무시 */ }
    this.watches.delete(target);
  }

  /** 감시 중인 저장소를 주어진 목록만 남기고 정리합니다. */
  public sync(repositories: string[]): void {
    const keep = new Set(repositories.map((item) => (item ?? "").trim()).filter(Boolean));
    for (const active of [...this.watches.keys()]) {
      if (!keep.has(active)) this.unwatch(active);
    }
    for (const repository of keep) this.watch(repository);
  }

  /** 모든 감시를 중단합니다. */
  public closeAll(): void {
    for (const repository of [...this.watches.keys()]) this.unwatch(repository);
  }

  private scheduleNotify(repository: string): void {
    const active = this.watches.get(repository);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    active.timer = setTimeout(() => {
      active.timer = null;
      this.options.onChange(repository);
    }, this.options.debounceMs);
    active.timer.unref?.();
  }
}
