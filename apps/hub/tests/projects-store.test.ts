import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allowedBranchesOf,
  buildProjectViews,
  hasUserBranchAssignment,
  loadProjects,
  parseProjectsFile,
  sanitizeProjectDefinition,
} from "../src/main/projects-store";
import type { GitRepositorySetting } from "../src/shared/ipc";

describe("projects store", () => {
  afterEach(() => {});

  it("parses a valid projects.json into deduplicated definitions", () => {
    const raw = JSON.stringify({
      version: 1,
      projects: [
        { id: "p1", name: "Alpha", url: "https://github.com/x/a.git", allowedBranches: ["main", "dev", "main"] },
        { id: "p1", name: "Dup", url: "https://github.com/x/dup.git" },
        { id: "", name: "Bad", url: "https://github.com/x/bad.git" },
        { id: "p2", url: "https://github.com/x/b.git", notionDatabaseId: "ndb", discordChannelId: "dc" },
      ],
    });
    const projects = parseProjectsFile(raw);
    expect(projects).toHaveLength(2);
    expect(projects.map((p: { id: string }) => p.id)).toEqual(["p1", "p2"]);
    expect(projects[0]?.allowedBranches).toEqual(["main", "dev"]);
    expect(projects[1]?.notionDatabaseId).toBe("ndb");
    expect(projects[1]?.discordChannelId).toBe("dc");
  });

  it("returns empty on malformed input", () => {
    expect(parseProjectsFile("not json")).toEqual([]);
    expect(parseProjectsFile('{"projects":1}')).toEqual([]);
  });

  it("never exposes secret fields in sanitized definitions", () => {
    const clean = sanitizeProjectDefinition({
      id: "p1",
      name: "Alpha",
      url: "https://github.com/x/a.git",
      token: "SECRET",
      password: "pw",
      tokenValue: "x",
    });
    expect(clean).not.toBeNull();
    const serialized = JSON.stringify(clean);
    expect(serialized).not.toMatch(/SECRET|token|password/i);
  });

  it("loads from cache when fetch fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "projects-store-"));
    try {
      const cacheFile = path.join(dir, "projects-cache.json");
      const cached = JSON.stringify({ fetchedAt: "x", projects: [{ id: "c1", name: "C", url: "https://github.com/c/c.git" }] });
      require("node:fs").writeFileSync(cacheFile, cached, "utf8");
      const result = await loadProjects("https://example.invalid/raw/projects.json", cacheFile, async () => {
        throw new Error("network down");
      });
      expect(result.fromCache).toBe(true);
      expect(result.projects.map((p) => p.id)).toEqual(["c1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fetches and caches projects on success", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "projects-store-"));
    try {
      const cacheFile = path.join(dir, "projects-cache.json");
      const body = JSON.stringify({ projects: [{ id: "f1", name: "F", url: "https://github.com/f/f.git" }] });
      const result = await loadProjects("https://example/raw.json", cacheFile, async () => body);
      expect(result.fromCache).toBe(false);
      expect(result.projects.map((p) => p.id)).toEqual(["f1"]);
      const onDisk = JSON.parse(require("node:fs").readFileSync(cacheFile, "utf8"));
      expect((onDisk.projects as Array<{ id: string }>).map((p) => p.id)).toEqual(["f1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds project views joining local repositories and restrict branches", async () => {
    const projects = parseProjectsFile(JSON.stringify({
      projects: [
        { id: "p1", name: "Alpha", url: "https://github.com/x/a.git", allowedBranches: ["main", "release"] },
        { id: "p2", name: "Beta", url: "https://github.com/x/b.git" },
      ],
    }));
    const repos: GitRepositorySetting[] = [
      { project: "p1", label: "A", path: "C:/repo/a", url: "https://github.com/x/a.git", branches: ["main", "dev", "release"] },
    ];
    const resolver = async (url: string): Promise<string[]> => (url.includes("/b.git") ? ["main", "dev"] : []);
    const views = await buildProjectViews(projects, repos, resolver);
    expect(views).toHaveLength(2);
    const alpha = views.find((v) => v.id === "p1")!;
    expect(alpha.branchRestricted).toBe(true);
    expect(alpha.selectableBranches).toEqual(["main", "release"]);
    expect(alpha.repository?.label).toBe("A");
    const beta = views.find((v) => v.id === "p2")!;
    expect(beta.branchRestricted).toBe(false);
    expect(beta.selectableBranches).toEqual(["main", "dev"]);
  });

  it("allowedBranchesOf returns empty for unrestricted or malformed", () => {
    expect(allowedBranchesOf(undefined)).toEqual([]);
    expect(allowedBranchesOf({ id: "a", name: "a", url: "u" })).toEqual([]);
    expect(allowedBranchesOf({ id: "a", name: "a", url: "u", allowedBranches: [] })).toEqual([]);
    expect(allowedBranchesOf({ id: "a", name: "a", url: "u", allowedBranches: ["main", " ", "main"] })).toEqual(["main"]);
  });

  it("recognizes only non-empty explicit per-key branch assignments", () => {
    const project = { id: "p", name: "P", url: "u", userBranches: { key: ["dev", "dev"] } };
    expect(hasUserBranchAssignment(project, "key")).toBe(true);
    expect(hasUserBranchAssignment(project, "other")).toBe(false);
    expect(hasUserBranchAssignment({ ...project, userBranches: { key: [] } }, "key")).toBe(false);
  });
});
