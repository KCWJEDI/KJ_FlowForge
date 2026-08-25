import { randomUUID } from "node:crypto";

export const PROTOCOL_VERSION = 1 as const;

export type MessageType = "event" | "command" | "response" | "hello" | "error";

export interface MessageEnvelope<TPayload = unknown> {
  version: typeof PROTOCOL_VERSION;
  type: MessageType;
  requestId: string;
  name: string;
  payload: TPayload;
  timestamp: string;
}

export type LogSeverity = "log" | "warning" | "error" | "exception" | "assert";
export type EditorMode = "editing" | "playing" | "paused" | "compiling" | "building";

export interface UnityEventPayloadMap {
  "project.connected": {
    projectPath: string;
    projectName: string;
    unityVersion: string;
    unityPid: number;
    targetPlatform: string;
  };
  "editor.state.changed": { state: EditorMode };
  "scene.active.changed": { name: string; path: string; isDirty: boolean };
  "scene.list.changed": { scenes: Array<{ name: string; path: string; isLoaded: boolean; isDirty: boolean }> };
  "scene.loaded": { name: string; path: string; mode: "single" | "additive" };
  "scene.unloaded": { name: string; path: string };
  "build.started": { target: string; outputPath: string; scenes: string[] };
  "build.progress": { progress: number; message: string };
  "build.completed": {
    succeeded: boolean;
    result: string;
    target: string;
    outputPath: string;
    durationMs: number;
    warningCount: number;
    errorCount: number;
    log: string;
  };
  "play.mode.changed": { state: "entering" | "playing" | "paused" | "exiting" | "stopped" };
  "play.console.log": ConsoleLogPayload;
  "assets.import.started": { paths: string[] };
  "assets.import.progress": { progress: number; currentAsset: string };
  "assets.import.completed": { imported: string[]; deleted: string[]; moved: Array<{ from: string; to: string }> };
  "assets.changed": { paths: string[] };
  "assets.added": { paths: string[] };
  "console.log": ConsoleLogPayload;
  "compilation.started": { assemblies: string[] };
  "compilation.completed": { durationMs: number; succeeded: boolean };
  "compilation.errors": { errors: CompilerMessage[] };
  "git.status": GitObservationPayload;
  "runtime.metrics": { fps: number; frameTimeMs: number; memoryBytes: number };
  "work.active-file.changed": { path: string | null };
  "work.saved": { path: string; savedAt: string };
  "work.unsaved.changed": { hasUnsavedChanges: boolean; dirtyScenes: string[] };
  "status.snapshot": UnitySnapshot;
}

export interface ConsoleLogPayload {
  severity: LogSeverity;
  message: string;
  stackTrace: string;
  channel: string | null;
  occurredAt: string;
  playMode: boolean;
}

export interface CompilerMessage {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: "warning" | "error";
}

export interface GitObservationPayload {
  branch: string;
  changedFiles: Array<{ path: string; status: string }>;
  hasUncommittedChanges: boolean;
  conflicts: string[];
}

export interface UnitySnapshot {
  projectPath: string;
  projectName: string;
  unityVersion: string;
  unityPid: number;
  targetPlatform: string;
  editorState: EditorMode;
  activeScene: { name: string; path: string; isDirty: boolean };
  openScenes: Array<{ name: string; path: string; isLoaded: boolean; isDirty: boolean }>;
  git: GitObservationPayload;
  activeFile: string | null;
  lastSaveAt: string | null;
  hasUnsavedChanges: boolean;
}

export type UnityEventName = keyof UnityEventPayloadMap;

export interface UnityCommandPayloadMap {
  "scene.load": { path: string; additive?: boolean };
  "play.enter": Record<string, never>;
  "play.exit": Record<string, never>;
  "build.run": { target: string; outputPath: string; scenes?: string[]; development?: boolean };
  "assets.refresh": { forceSynchronous?: boolean };
  "scripts.recompile": Record<string, never>;
  "scene.save": { path?: string; saveAs?: boolean };
  "status.snapshot": Record<string, never>;
}

export type UnityCommandName = keyof UnityCommandPayloadMap;

export interface UnityHelloPayload {
  sessionSecret: string;
  clientId: string;
  projectPath: string;
  projectName: string;
  unityVersion: string;
  unityPid: number;
  targetPlatform: string;
}

export interface CommandResponsePayload<TResult = unknown> {
  ok: boolean;
  result?: TResult;
  error?: { code: string; message: string; details?: unknown };
}

export function createEnvelope<TPayload>(
  type: MessageType,
  name: string,
  payload: TPayload,
  requestId: string = randomUUID(),
): MessageEnvelope<TPayload> {
  return {
    version: PROTOCOL_VERSION,
    type,
    requestId,
    name,
    payload,
    timestamp: new Date().toISOString(),
  };
}

export function isEnvelope(value: unknown): value is MessageEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MessageEnvelope>;
  return (
    candidate.version === PROTOCOL_VERSION &&
    ["event", "command", "response", "hello", "error"].includes(candidate.type ?? "") &&
    typeof candidate.requestId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.timestamp === "string" &&
    "payload" in candidate
  );
}
