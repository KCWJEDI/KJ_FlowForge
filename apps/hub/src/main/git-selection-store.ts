import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface GitCardSelection {
  id: string;
  path: string;
  workBranches: string[];
  activeBranches: string[];
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
      return { ...EMPTY_STATE };
    }
  }

  public async save(state: GitSelectionState): Promise<GitSelectionState> {
    await this.ensure();
    const clean = sanitizeSelectionState(state);
    await writeFile(this.filePath, JSON.stringify(clean, null, 2), { encoding: "utf8", mode: 0o600 });
    return clean;
  }
}
