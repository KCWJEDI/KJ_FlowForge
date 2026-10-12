import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitRepositorySetting, ProjectDefinition, ProjectView } from "../shared/ipc";
import { isSameRepository } from "../shared/repo-identity";

export function sameIdentity(a: string, b: string): boolean {
  // 원격 URL 동일성 판정은 shared/repo-identity 의 단일 구현만 사용합니다.
  // (SCP 형식 git@host:path 와 스킴 형식을 모두 동일하게 취급)
  return isSameRepository(a, b);
}

function slugify(value: string): string {
  const ascii = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase();
  const base = ascii.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return base || "project-" + Math.random().toString(36).slice(2, 6);
}

function serializeBranches(branches: string[]): string[] {
  return [...new Set(branches.filter((branch) => typeof branch === "string" && branch.trim().length > 0))];
}

export interface RepoLike {
  project?: string;
  label?: string;
  username?: string;
  path: string;
  url: string;
  branches: string[];
  notionDatabaseId?: string;
  discordChannelId?: string;
}

export function upsertProjectsFromRepositories(
  currentProjects: ProjectDefinition[],
  repositories: RepoLike[],
): ProjectDefinition[] {
  const result = currentProjects.slice();
  for (const repo of repositories) {
    const url = (repo.url ?? "").trim();
    const label = (repo.label ?? "").trim() || "저장소";
    const projectName = (repo.project ?? "").trim();
    const username = (repo.username ?? "").trim();
    const branches = serializeBranches(repo.branches);
    const existingIndex = result.findIndex((project) => project.url.trim().length > 0 && sameIdentity(project.url, url));
    if (existingIndex >= 0) {
      const existing = result[existingIndex]!;
      if (branches.length > 0) existing.allowedBranches = branches;
      if (repo.notionDatabaseId?.trim()) existing.notionDatabaseId = repo.notionDatabaseId.trim();
      if (repo.discordChannelId?.trim()) existing.discordChannelId = repo.discordChannelId.trim();
      // 분야 라벨(label)이 프로젝트 이름(name)으로 잘못 저장된 경우, 사용자가 입력한 프로젝트 이름으로 교정합니다.
      if (projectName && existing.name !== projectName) existing.name = projectName;
    } else {
      if (!url) continue;
      const id = projectName || slugify(label + (username ? "-" + username : ""));
      result.push({
        id,
        name: projectName || label,
        url,
        ...(branches.length > 0 ? { allowedBranches: branches } : {}),
        ...(repo.notionDatabaseId?.trim() ? { notionDatabaseId: repo.notionDatabaseId.trim() } : {}),
        ...(repo.discordChannelId?.trim() ? { discordChannelId: repo.discordChannelId.trim() } : {}),
      });
    }
  }
  return result;
}

export function serializeProjectsFile(projects: ProjectDefinition[]): string {
  return JSON.stringify({ version: 1, projects }, null, 2) + "\n";
}

export interface ProjectsCacheEntry {
  fetchedAt: string;
  projects: ProjectDefinition[];
}

/** 허용 브랜치 결정: allowedBranches 설정 시 해당 브랜치만, 미설정 시 빈 배열(전체 허용). */
export function allowedBranchesOf(project: ProjectDefinition | undefined): string[] {
  if (!project) return [];
  const base = Array.isArray(project.allowedBranches)
    ? [...new Set(project.allowedBranches.filter((branch) => typeof branch === "string" && branch.trim().length > 0))]
    : [];
  // 유저별(userBranches) 설정이 있으면 해당 유저 기준으로 계산하도록 별도 helper에서 처리.
  return base;
}

/** 특정 유저(keyId)의 허용 브랜치 목록. userBranches에 해당 keyId가 없으면 allowedBranches(공통)를 사용. */
export function userBranchesOf(project: ProjectDefinition | undefined, keyId: string): string[] {
  if (!project || !keyId) return allowedBranchesOf(project);
  if (project.userBranches && Array.isArray(project.userBranches[keyId])) {
    return [...new Set(project.userBranches[keyId].filter((branch) => typeof branch === "string" && branch.trim().length > 0))];
  }
  return allowedBranchesOf(project);
}

export function hasUserBranchAssignment(project: ProjectDefinition | undefined, keyId: string): boolean {
  return Boolean(project && keyId && project.userBranches && Array.isArray(project.userBranches[keyId]) && project.userBranches[keyId].some((branch) => typeof branch === "string" && branch.trim().length > 0));
}

/** projects.json 원본 값에서 시크릿(토큰)이 포함되지 않도록 안전하게 필터링합니다. */
export function sanitizeProjectDefinition(value: unknown): ProjectDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "";
  const url = typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : "";
  if (!id || !url) return null;
  const allowed = Array.isArray(raw.allowedBranches)
    ? [...new Set(raw.allowedBranches.filter((branch): branch is string => typeof branch === "string" && branch.trim().length > 0))]
    : [];
  const userBranches: Record<string, string[]> = {};
  if (raw.userBranches && typeof raw.userBranches === "object" && !Array.isArray(raw.userBranches)) {
    for (const [key, value] of Object.entries(raw.userBranches as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const cleaned = [...new Set(value.filter((branch): branch is string => typeof branch === "string" && branch.trim().length > 0))];
        if (cleaned.length > 0) userBranches[key] = cleaned;
      }
    }
  }
  return {
    id,
    name: name || id,
    url,
    allowedBranches: allowed.length > 0 ? allowed : undefined,
    userBranches: Object.keys(userBranches).length > 0 ? userBranches : undefined,
    notionDatabaseId: typeof raw.notionDatabaseId === "string" && raw.notionDatabaseId.trim() ? raw.notionDatabaseId.trim() : undefined,
    discordChannelId: typeof raw.discordChannelId === "string" && raw.discordChannelId.trim() ? raw.discordChannelId.trim() : undefined,
    gitOwner: typeof raw.gitOwner === "string" && raw.gitOwner.trim() ? raw.gitOwner.trim() : undefined,
    gitRepo: typeof raw.gitRepo === "string" && raw.gitRepo.trim() ? raw.gitRepo.trim() : undefined,
  };
}

export function parseProjectsFile(content: string): ProjectDefinition[] {
  try {
    const parsed = JSON.parse(content.replace(/^﻿/, '')) as { projects?: unknown } | undefined;
    const projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
    const result: ProjectDefinition[] = [];
    const seen = new Set<string>();
    for (const item of projects) {
      const clean = sanitizeProjectDefinition(item);
      if (!clean) continue;
      if (seen.has(clean.id)) continue;
      seen.add(clean.id);
      result.push(clean);
    }
    return result;
  } catch {
    return [];
  }
}

export async function loadProjects(
  projectsUrl: string,
  cacheFilePath: string,
  fetcher: (url: string) => Promise<string> = defaultFetchText,
): Promise<{ projects: ProjectDefinition[]; fromCache: boolean }> {
  if (!projectsUrl.trim()) return { projects: [], fromCache: false };
  try {
    const text = await fetcher(projectsUrl);
    const projects = parseProjectsFile(text);
    if (projects.length === 0) {
      const cached = await readProjectsCache(cacheFilePath);
      if (cached.length > 0) return { projects: cached, fromCache: true };
    }
    await writeFile(cacheFilePath, JSON.stringify({ fetchedAt: new Date().toISOString(), projects }, null, 2), { encoding: "utf8", mode: 0o600 });
    return { projects, fromCache: false };
  } catch {
    return { projects: await readProjectsCache(cacheFilePath), fromCache: true };
  }
}

async function readProjectsCache(cacheFilePath: string): Promise<ProjectDefinition[]> {
  try {
    const raw = await readFile(cacheFilePath, "utf8");
    const parsed = JSON.parse(raw) as ProjectsCacheEntry | undefined;
    return Array.isArray(parsed?.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

/** raw.githubusercontent.com URL을 api.github.com contents URL로 변환합니다. */
export function toGithubApiUrl(rawUrl: string): string | null {
    const trimmed = rawUrl.trim();
  const marker = 'https://raw.githubusercontent.com/';
  if (!trimmed.startsWith(marker)) return null;
  const rest = trimmed.slice(marker.length).split('/');
  if (rest.length < 4) return null;
  const owner = rest.shift() || '';
  const repo = rest.shift() || '';
  const ref = rest.shift() || '';
  const filePath = rest.join('/');
  if (!owner || !repo || !ref || !filePath) return null;
  return 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + filePath + '?ref=' + ref;
}

/** GitHub API(최신 커밋 기준)를 먼저, 실패하면 raw CDN을 사용합니다. CDN이 이전 버전을 주는 경우를 방지합니다. */
export async function fetchProjectsText(rawUrl: string): Promise<string> {
  const apiUrl = toGithubApiUrl(rawUrl);
  if (apiUrl) {
    try {
      const res = await fetch(apiUrl, { headers: { "Accept": "application/vnd.github.raw+json", "Cache-Control": "no-cache", "User-Agent": "KJ_FlowForge" } });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 0 && text.indexOf("projects") >= 0) return text;
      }
    } catch { /* fall through to raw */ }
  }
  const separator = rawUrl.includes("?") ? "&" : "?";
  const response = await fetch(rawUrl + separator + "_flowforge_refresh=" + Date.now(), { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.text();
}

export async function defaultFetchText(url: string): Promise<string> {
  return fetchProjectsText(url);
}

export async function ensureProjectsCacheDir(dataDirectory: string): Promise<string> {
  await mkdir(dataDirectory, { recursive: true });
  return path.join(dataDirectory, "projects-cache.json");
}

/** Config 프로젝트 정의와 로컬 HUB_GIT_REPOSITORIES를 조인해 일반 유저 화면용 ProjectView를 생성합니다. 시크릿(토큰) 필드는 포함하지 않습니다. */
export async function buildProjectViews(
  projects: ProjectDefinition[],
  repositories: GitRepositorySetting[],
  resolveRemoteBranches: (url: string) => Promise<string[]> = async () => [],
  keyId = "",
): Promise<ProjectView[]> {
  const seen = new Set<string>();
  const views: ProjectView[] = [];
  for (const project of projects) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    const repository = repositories.find((repo) => repo.project?.trim() === project.id || sameIdentity(repo.url, project.url)) ?? null;
    // 일반 사용자는 공통 allowedBranches보다 라이선스별 userBranches를 우선합니다.
    const restricted = keyId ? userBranchesOf(project, keyId) : allowedBranchesOf(project);
    let selectableBranches: string[] = [];
    if (restricted.length > 0) {
      selectableBranches = restricted;
    } else {
      try {
        selectableBranches = await resolveRemoteBranches(project.url);
      } catch {
        selectableBranches = [];
      }
    }
    views.push({
      id: project.id,
      // 로컬 저장소의 project 필드는 분야 라벨일 수 있으므로
      // 사용자에게 보여줄 이름은 중앙 projects.json의 name만 사용합니다.
      name: project.name || project.id,
      url: project.url,
      allowedBranches: restricted,
      branchRestricted: restricted.length > 0,
      repository,
      selectableBranches,
    });
  }
  return views;
}
