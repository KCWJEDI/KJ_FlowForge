import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { loadConfig } from "../src/main/config";
import { readEnvFile, writeEnvFile, ENV_KEYS } from "../src/main/env-store";
import { parseProjectsFile, serializeProjectsFile, sanitizeProjectDefinition } from "../src/main/projects-store";
import { buildEnvTemplate } from "../src/main/env-store";
import { ensureEnvFile } from "../src/main/env-store";
import { parseEnvFile } from "../src/main/env-store";

describe("config resolution across machines", () => {
  it("derives configRepo owner/repo from the default projects URL", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-config-"));
    const envFile = path.join(dir, ".env");
    await ensureEnvFile(envFile);
    const config = await loadConfig(path.join(dir, "runtime"), envFile);
    expect(config.configRepo).toBe("KCWJEDI/KJ_FlowForge_Config");
    expect(config.github.owner).toBe("KCWJEDI");
    expect(config.github.repo).toBe("KJ_FlowForge_Config");
    expect(config.projectsUrl).toContain("raw.githubusercontent.com");
  });

  it("honours HUB_PROJECTS_URL and HUB_CONFIG_REPO from env", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-config-"));
    const envFile = path.join(dir, ".env");
    writeFileSync(envFile, [
      "HUB_PROJECTS_URL=https://raw.githubusercontent.com/Other/ConfigRepo/main/projects.json",
      "HUB_CONFIG_REPO=Other/ConfigRepo",
      "",
    ].join("\n"), "utf8");
    const config = await loadConfig(path.join(dir, "runtime"), envFile);
    expect(config.configRepo).toBe("Other/ConfigRepo");
    expect(config.github.owner).toBe("Other");
    expect(config.github.repo).toBe("ConfigRepo");
  });

  it("creates the runtime data directory and session secret file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-config-"));
    const runtimeDir = path.join(dir, "runtime");
    const envFile = path.join(dir, ".env");
    await ensureEnvFile(envFile);
    const config = await loadConfig(runtimeDir, envFile);
    const secret = JSON.parse(readFileSync(config.secretFile, "utf8"));
    expect(secret.host).toBe("127.0.0.1");
    expect(typeof secret.sessionSecret).toBe("string");
    expect(secret.sessionSecret.length).toBeGreaterThan(16);
    expect(config.selectionFile).toBe(path.join(runtimeDir, "git-selection.json"));
  });

  it("env template round-trips values containing spaces, quotes and backslashes", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-env-"));
    const envFile = path.join(dir, ".env");
    const tricky = 'C:\\WorkSpace\\My "Project" #1';
    await writeEnvFile(envFile, { HUB_GIT_REPOSITORIES: JSON.stringify([{ label: tricky, path: "W:\\a\\b", url: "", branches: [] }]) });
    const read = await readEnvFile(envFile);
    const parsed = JSON.parse(read.get("HUB_GIT_REPOSITORIES") ?? "[]");
    expect(parsed[0].label).toBe(tricky);
  });

  it("keeps unknown/custom env keys when rewriting the managed template", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-env-"));
    const envFile = path.join(dir, ".env");
    writeFileSync(envFile, "CUSTOM_KEY=keep-me\nHUB_HTTP_PORT=43111\n", "utf8");
    const next = await writeEnvFile(envFile, { HUB_TCP_PORT: "43112" });
    expect(next.get("CUSTOM_KEY")).toBe("keep-me");
    const text = readFileSync(envFile, "utf8");
    expect(text).toContain("CUSTOM_KEY=keep-me");
    expect(text).toContain("HUB_HTTP_PORT=43111");
    expect(text).toContain("HUB_TCP_PORT=43112");
    for (const key of ENV_KEYS) expect(text).toContain(key + "=");
  });
});

describe("projects.json robustness", () => {
  it("tolerates a BOM prefix (Windows editors)", () => {
    const raw = "\uFEFF" + JSON.stringify({ version: 1, projects: [{ id: "p", name: "P", url: "https://github.com/a/b.git" }] });
    expect(parseProjectsFile(raw).map((project) => project.id)).toEqual(["p"]);
  });

  it("drops invalid entries but keeps valid ones", () => {
    const raw = JSON.stringify({ projects: [
      { id: "ok", name: "Ok", url: "https://github.com/a/b.git" },
      { id: "", name: "NoId", url: "https://github.com/a/b.git" },
      { id: "no-url", name: "NoUrl" },
      null,
      42,
    ] });
    expect(parseProjectsFile(raw).map((project) => project.id)).toEqual(["ok"]);
  });

  it("sanitize never leaks tokens embedded in project definitions", () => {
    const clean = sanitizeProjectDefinition({
      id: "p", name: "P", url: "https://github.com/a/b.git",
      notionToken: "secret_abc", discordToken: "xyz", password: "pw",
    });
    const text = JSON.stringify(clean);
    expect(text).not.toContain("secret_abc");
    expect(text).not.toContain("xyz");
    expect(text).not.toContain("pw");
  });

  it("round-trips a projects file through serialize and parse", () => {
    const projects = parseProjectsFile(JSON.stringify({ projects: [
      { id: "a", name: "A", url: "https://github.com/x/a.git", userBranches: { User1: ["Test1"] }, allowedBranches: ["main"] },
      { id: "b", name: "B", url: "git@github.com:x/b.git" },
    ] }));
    const reparsed = parseProjectsFile(serializeProjectsFile(projects));
    expect(reparsed.map((project) => project.id)).toEqual(["a", "b"]);
    expect(reparsed[0]?.userBranches).toEqual({ User1: ["Test1"] });
    expect(reparsed[0]?.allowedBranches).toEqual(["main"]);
  });
});


describe("env round-trip safety for repository JSON", () => {
  it("preserves Windows backslash paths across save and restart", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-env-roundtrip-"));
    const envFile = path.join(dir, ".env");
    await ensureEnvFile(envFile);
    const repositories = [{ label: "저장소", path: "C:\\WorkSpace\\TestGithub", url: "", branches: [] as string[] }];
    await writeEnvFile(envFile, { HUB_GIT_REPOSITORIES: JSON.stringify(repositories) });
    const reloaded = await readEnvFile(envFile);
    expect(JSON.parse(reloaded.get("HUB_GIT_REPOSITORIES") ?? "")).toEqual(repositories);
  });

  it("recovers a legacy value whose backslashes were not escaped", async () => {
    const legacy = 'HUB_GIT_REPOSITORIES="[{\"label\":\"x\",\"path\":\"C:\\repo\",\"url\":\"\",\"branches\":[]}]"';
    const values = parseEnvFile(legacy);
    const parsed = JSON.parse(values.get("HUB_GIT_REPOSITORIES") ?? "[]");
    expect(parsed[0].path).toBe("C:\\repo");
  });
});

