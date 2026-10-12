import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface GitCardSelection {
  id: string;
  path: string;
  workBranches: string[];
  activeBranches: string[];
  /** 이 카드(패널)에서 "저장소 폴더 선택"으로 직접 지정한 로컬 Git 폴더. */
  localPath?: string;
}

export interface GitSelectionState {
  workBranchesByProject: Record<string, string[]>;
  activeBranchesByProject: Record<string, string[]>;
  cardsByProject: Record<string, GitCardSelection[]>;
  selectedProject: string;
  connectedPaths: string[];
  projectConnectPaths: Record<string, string>;
  projectConnectMessages: Record<string, string>;
  projectConnectPath: string;
  projectConnectMessage: string;
}

const EMPTY_STATE: GitSelectionState = {
  workBranchesByProject: {},
  activeBranchesByProject: {},
  cardsByProject: {},
  selectedProject: "",
  connectedPaths: [],
  projectConnectPaths: {},
  projectConnectMessages: {},
  projectConnectPath: "",
  projectConnectMessage: "",
};

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function sanitizeCards(value: unknown): GitCardSelection[] {
  if (!Array.isArray(value)) return [];
  const result: GitCardSelection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const card = item as { id?: unknown; path?: unknown; workBranches?: unknown; activeBranches?: unknown };
    if (typeof card.id !== "string" || !card.id) continue;
    result.push({
      id: card.id,
      path: typeof card.path === "string" ? card.path : "",
      workBranches: sanitizeStringArray(card.workBranches),
      activeBranches: sanitizeStringArray(card.activeBranches),
      localPath: typeof (card as { localPath?: unknown }).localPath === "string" ? (card as { localPath: string }).localPath : "",
    });
  }
  return result;
}

function sanitizeStringArrayMap(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [project, branches] of Object.entries(value as Record<string, unknown>)) {
    result[project] = sanitizeStringArray(branches);
  }
  return result;
}

function sanitizeCardsMap(value: unknown): Record<string, GitCardSelection[]> {
  const result: Record<string, GitCardSelection[]> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [project, cards] of Object.entries(value as Record<string, unknown>)) {
    result[project] = sanitizeCards(cards);
  }
  return result;
}
function sanitizeStringMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [project, path] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path === "string" && path.trim().length > 0) result[project] = path;
  }
  return result;
}


export function sanitizeSelectionState(value: unknown): GitSelectionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_STATE };
  const parsed = value as Partial<GitSelectionState>;
  return {
    workBranchesByProject: sanitizeStringArrayMap(parsed.workBranchesByProject),
    activeBranchesByProject: sanitizeStringArrayMap(parsed.activeBranchesByProject),
    cardsByProject: sanitizeCardsMap(parsed.cardsByProject),
    selectedProject: typeof parsed.selectedProject === "string" ? parsed.selectedProject : "",
    connectedPaths: sanitizeStringArray(parsed.connectedPaths),
    projectConnectPaths: sanitizeStringMap(parsed.projectConnectPaths),
    projectConnectMessages: sanitizeStringMap(parsed.projectConnectMessages),
    projectConnectPath: typeof parsed.projectConnectPath === "string" ? parsed.projectConnectPath : "",
    projectConnectMessage: typeof parsed.projectConnectMessage === "string" ? parsed.projectConnectMessage : "",
  };
}

export class GitSelectionStore {
  private readonly filePath: string;
  /** 저장 작업을 한 번에 하나씩만 실행합니다(동시 저장이 파일을 깨뜨리는 것 방지). */
  private writeQueue: Promise<unknown> = Promise.resolve();

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensure(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(this.filePath, JSON.stringify(EMPTY_STATE, null, 2), { encoding: "utf8", mode: 0o600 });
    }
  }

  public async load(): Promise<GitSelectionState> {
    try {
      await this.ensure();
      const raw = await readFile(this.filePath, "utf8");
      return sanitizeSelectionState(JSON.parse(raw));
    } catch {
      // 예전 버그로 파일이 깨졌을 수 있습니다. 백업본이 있으면 그것으로 복구해,
      // 사용자가 지정한 저장소 경로가 재시작 후 사라지지 않게 합니다.
      try {
        const backup = await readFile(`${this.filePath}.bak`, "utf8");
        return sanitizeSelectionState(JSON.parse(backup));
      } catch {
        return { ...EMPTY_STATE };
      }
    }
  }

  public async save(state: GitSelectionState): Promise<GitSelectionState> {
    const clean = sanitizeSelectionState(state);
    // 이전 저장이 끝난 뒤에만 다음 저장을 시작하도록 직렬화합니다.
    this.writeQueue = this.writeQueue.then(() => this.writeAtomic(clean)).catch(() => undefined);
    await this.writeQueue;
    return clean;
  }

  /**
   * 임시 파일에 먼저 쓴 뒤 rename 으로 교체합니다.
   *
   * 같은 파일에 직접 덮어쓰면 저장이 겹칠 때 내용이 섞여 JSON 이 깨집니다.
   * 그렇게 깨진 파일은 다음 실행에서 파싱에 실패해 저장해 둔 저장소 경로가
   * 통째로 사라집니다. rename 은 원자적이므로 항상 온전한 파일만 남습니다.
   */
  private async writeAtomic(clean: GitSelectionState): Promise<void> {
    await this.ensure();
    const tempFile = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempFile, JSON.stringify(clean, null, 2), { encoding: "utf8", mode: 0o600 });
    // 교체 직전 상태를 백업해 둡니다(교체 도중 문제가 생겨도 복구 가능).
    try { await rename(this.filePath, `${this.filePath}.bak`); } catch { /* 첫 저장이면 백업할 원본이 없음 */ }
    await rename(tempFile, this.filePath);
  }
}
