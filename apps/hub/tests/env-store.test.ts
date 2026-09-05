import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SettingFieldView } from "../src/shared/ipc";
import {
  ENV_DEFINITIONS,
  ENV_KEYS,
  applyEnvToProcess,
  buildEnvTemplate,
  ensureEnvFile,
  parseEnvFile,
  readEnvFile,
  writeEnvFile,
} from "../src/main/env-store";

const EXPECTED_ENV_KEYS = [
  "HUB_HTTP_PORT",
  "HUB_TCP_PORT",
  "HUB_COMMAND_TIMEOUT_MS",
  "HUB_MAX_FRAME_BYTES",
  "HUB_API_TOKEN",
  "HUB_GIT_REPOSITORIES",
  "HUB_PROJECTS_URL",
  "HUB_CONFIG_REPO",
  "HUB_DAILY_AUTOMATION_ENABLED",
  "HUB_DAILY_AUTOMATION_PROJECTS",
  "DISCORD_BOT_TOKEN",
  "DISCORD_CHANNEL_ID",
  "NOTION_TOKEN",
  "GITHUB_TOKEN",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
] as const;

describe("env store definitions", () => {
  it("exposes the exact contract of keys the hub loads", () => {
    expect(ENV_KEYS).toEqual([...EXPECTED_ENV_KEYS]);
  });

  it("keeps definition keys unique and fully populated", () => {
    const seen = new Set<string>();
    for (const definition of ENV_DEFINITIONS) {
      expect(definition.key.length).toBeGreaterThan(0);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.group.length).toBeGreaterThan(0);
      expect(seen.has(definition.key)).toBe(false);
      seen.add(definition.key);
    }
    expect(seen.size).toBe(ENV_KEYS.length);
  });

  it("uses a fixed set of groups in template order", () => {
    const groups = ENV_DEFINITIONS.filter(
      (definition, index) => index === 0 || definition.group !== ENV_DEFINITIONS[index - 1]?.group,
    ).map((definition) => definition.group);
expect(groups).toEqual(["Hub", "Automation", "Discord", "Notion", "GitHub", "AI 요약"]);
  });
});

describe("parseEnvFile", () => {
  it("parses simple key/value lines", () => {
    const values = parseEnvFile("HUB_HTTP_PORT=43100\nHUB_TCP_PORT=43101");
    expect(values.get("HUB_HTTP_PORT")).toBe("43100");
    expect(values.get("HUB_TCP_PORT")).toBe("43101");
  });

  it("strips surrounding whitespace and handles CRLF", () => {
    const values = parseEnvFile("  KEY  =  value  \r\nOTHER=1\r\n");
    expect(values.get("KEY")).toBe("value");
    expect(values.get("OTHER")).toBe("1");
  });

  it("unquotes double and single quoted values", () => {
    const values = parseEnvFile('A="hello world"\nB=\'with spaces\'');
    expect(values.get("A")).toBe("hello world");
    expect(values.get("B")).toBe("with spaces");
  });

  it("keeps the full value when it contains an equals sign", () => {
    expect(parseEnvFile("TOKEN=one=two").get("TOKEN")).toBe("one=two");
  });

  it("keeps inline comments as part of the value", () => {
    expect(parseEnvFile("A=x # comment").get("A")).toBe("x # comment");
  });

  it("records explicitly empty values as empty strings", () => {
    expect(parseEnvFile("EMPTY=").get("EMPTY")).toBe("");
  });

  it("ignores comments, blank lines, and lines without an equals sign", () => {
    const values = parseEnvFile("# comment\n\nnoequals\n!export A=1\nA=real");
    expect(values.get("A")).toBe("real");
    expect(values.get("noequals")).toBeUndefined();
    expect(values.size).toBe(1);
  });

  it("lets the last occurrence of a duplicate key win", () => {
    expect(parseEnvFile("A=first\nA=second").get("A")).toBe("second");
  });
});

describe("buildEnvTemplate", () => {
  it("emits every definition with group headers and hints", () => {
    const template = buildEnvTemplate();
    expect(template).toContain("# ----- Hub -----");
    expect(template).toContain("# ----- Automation -----");
    expect(template).toContain("# ----- Discord -----");
    expect(template).toContain("# ----- Notion -----");
    expect(template).toContain("# ----- GitHub -----");
    for (const definition of ENV_DEFINITIONS) {
      expect(template).toContain(`${definition.key}=`);
      if (definition.hint) expect(template).toContain(`# ${definition.hint}`);
    }
    expect(template.endsWith("\n")).toBe(true);
  });

  it("fills provided values and leaves missing values empty", () => {
    const template = buildEnvTemplate(new Map([["HUB_HTTP_PORT", "43110"]]));
    expect(template).toContain("HUB_HTTP_PORT=43110");
    expect(template).toContain("HUB_TCP_PORT=");
  });

  it("quotes values that need escaping and leaves simple values bare", () => {
    const template = buildEnvTemplate(
      new Map([
        ["HUB_GIT_REPOSITORY", "C:\\Projects\\My Game"],
        ["NOTION_DATABASE_ID", "efe8e17c-55ed-823a-a68a-8111ca9334f8"],
        ["GITHUB_TOKEN", 'he said "hi"'],
      ]),
    );
    expect(template).toContain('HUB_GIT_REPOSITORY="C:\\Projects\\My Game"');
    expect(template).toContain("NOTION_DATABASE_ID=efe8e17c-55ed-823a-a68a-8111ca9334f8");
    expect(template).toContain('GITHUB_TOKEN="he said \\"hi\\""');
  });
});

describe("env file read/write", () => {
  let directory: string;
  let envFile: string;

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "hub-env-store-"));
    envFile = path.join(directory, ".env");
    await ensureEnvFile(envFile);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("ensureEnvFile creates a template file when missing", async () => {
    await ensureEnvFile(envFile);
    const content = readFileSync(envFile, "utf8");
    expect(content).toContain("HUB_HTTP_PORT=");
    expect(content).toContain("# ----- Hub -----");
  });

  it("ensureEnvFile leaves an existing file untouched", async () => {
    const before = readFileSync(envFile, "utf8");
    await ensureEnvFile(envFile);
    expect(readFileSync(envFile, "utf8")).toBe(before);
  });

  it("writeEnvFile creates the file when it does not exist yet", async () => {
    const missing = path.join(directory, "missing.env");
    const values = await writeEnvFile(missing, { HUB_HTTP_PORT: "43100" });
    expect(values.get("HUB_HTTP_PORT")).toBe("43100");
    expect(readFileSync(missing, "utf8")).toContain("HUB_HTTP_PORT=43100");
  });

  it("readEnvFile returns parsed values from disk", async () => {
    await writeEnvFile(envFile, { HUB_HTTP_PORT: "43200" });
    const values = await readEnvFile(envFile);
    expect(values.get("HUB_HTTP_PORT")).toBe("43200");
  });

  it("writeEnvFile updates values, returns the merged map, and persists them", async () => {
    await writeEnvFile(envFile, { HUB_HTTP_PORT: "43100" });
    const values = await writeEnvFile(envFile, { HUB_HTTP_PORT: "43200", GITHUB_TOKEN: "ghp_testtoken" });
    expect(values.get("HUB_HTTP_PORT")).toBe("43200");
    expect(values.get("GITHUB_TOKEN")).toBe("ghp_testtoken");

    const reloaded = await readEnvFile(envFile);
    expect(reloaded.get("HUB_HTTP_PORT")).toBe("43200");
    expect(reloaded.get("GITHUB_TOKEN")).toBe("ghp_testtoken");
  });

  it("writeEnvFile clears a key when given an empty string or undefined", async () => {
    await writeEnvFile(envFile, { HUB_API_TOKEN: "secret" });
    const cleared = await writeEnvFile(envFile, { HUB_API_TOKEN: "" });
    expect(cleared.get("HUB_API_TOKEN")).toBe("");
    expect((await readEnvFile(envFile)).get("HUB_API_TOKEN")).toBe("");

    await writeEnvFile(envFile, { HUB_API_TOKEN: "secret" });
    const removed = await writeEnvFile(envFile, { HUB_API_TOKEN: undefined });
    expect(removed.get("HUB_API_TOKEN")).toBe("");
    expect((await readEnvFile(envFile)).get("HUB_API_TOKEN")).toBe("");
  });

  it("writeEnvFile normalizes the file and preserves unknown custom keys", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(envFile, "GITHUB_TOKEN=old-token\nCUSTOM_KEY=stays\n", "utf8");
    await writeEnvFile(envFile, { GITHUB_TOKEN: "new-token" });
    const content = readFileSync(envFile, "utf8");
    expect(content).toContain("GITHUB_TOKEN=new-token");
    expect(content).toContain("CUSTOM_KEY=stays");
  });

  it("keeps a quoted JSON value stable across repeated read/write cycles", async () => {
    const repositories = [
      { project: "ET", label: "awef", path: "W:/x", notionDatabaseId: "3c67d5bc-cac5-80d3-8e2a-f8848f5f7abd", discordChannelId: "1536922065423044630" },
    ];
    await writeEnvFile(envFile, { HUB_GIT_REPOSITORIES: JSON.stringify(repositories) });
    for (let run = 0; run < 5; run += 1) {
      await writeEnvFile(envFile, { HUB_DAILY_AUTOMATION_ENABLED: String(run % 2 === 0) });
    }
    const reloaded = await readEnvFile(envFile);
    expect(JSON.parse(reloaded.get("HUB_GIT_REPOSITORIES") ?? "")).toEqual(repositories);
  });

  it("parseEnvFile decodes escaped quotes so a stored JSON value survives unquote+re-quote", () => {
    const json = JSON.stringify([{ project: "ET", label: "awef", notionDatabaseId: "3c67d5bc-cac5-80d3-8e2a-f8848f5f7abd" }]);
    const quoted = '"' + json.replace(/"/g, '\\"') + '"';
    expect(parseEnvFile("HUB_GIT_REPOSITORIES=" + quoted).get("HUB_GIT_REPOSITORIES")).toBe(json);
  });
});

describe("applyEnvToProcess", () => {
  const trident = "HUB_SETTINGS_TEST_UNRELATED";

  beforeEach(() => {
    delete process.env[trident];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    delete process.env[trident];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("sets known keys and removes known keys that are absent or empty", () => {
    process.env[trident] = "untouched";
    process.env.HUB_HTTP_PORT = "stale";

    applyEnvToProcess(new Map([["HUB_HTTP_PORT", "43100"], ["HUB_API_TOKEN", ""]]));

    expect(process.env.HUB_HTTP_PORT).toBe("43100");
    expect(process.env.HUB_API_TOKEN).toBeUndefined();
    expect(process.env[trident]).toBe("untouched");
  });

  it("clears all managed keys when the map is empty", () => {
    process.env.DISCORD_BOT_TOKEN = "token";
    applyEnvToProcess(new Map());
    expect(process.env.DISCORD_BOT_TOKEN).toBeUndefined();
  });
});

describe("settings view contract (type review bridge)", () => {
  function toSettingsFields(values: ReadonlyMap<string, string>): SettingFieldView[] {
    return ENV_DEFINITIONS.map((definition) => {
      const value = values.get(definition.key) ?? "";
      return {
        key: definition.key,
        label: definition.label,
        group: definition.group,
        kind: definition.kind,
        hint: definition.hint,
        value,
        configured: value.length > 0,
      };
    });
  }

  it("maps every env definition to a setting field", () => {
    const fields = toSettingsFields(new Map([["HUB_HTTP_PORT", "43100"]]));
    expect(fields).toHaveLength(ENV_KEYS.length);
    expect(fields.map((field) => field.key)).toEqual(ENV_KEYS);
    expect(fields.map((field) => field.group)).toEqual(ENV_DEFINITIONS.map((definition) => definition.group));
  });

  it("marks fields as configured only when a non-empty value exists", () => {
    const fields = toSettingsFields(
      new Map([
        ["HUB_HTTP_PORT", "43100"],
        ["DISCORD_BOT_TOKEN", ""],
      ]),
    );
    const hubPort = fields.find((field) => field.key === "HUB_HTTP_PORT");
    const discordToken = fields.find((field) => field.key === "DISCORD_BOT_TOKEN");
    expect(hubPort?.configured).toBe(true);
    expect(hubPort?.value).toBe("43100");
    expect(discordToken?.configured).toBe(false);
  });

  it("keeps secret values readable for the settings editor", () => {
    const fields = toSettingsFields(new Map([["GITHUB_TOKEN", "ghp_secret"]]));
    const field = fields.find((item) => item.key === "GITHUB_TOKEN");
    expect(field?.kind).toBe("secret");
    expect(field?.value).toBe("ghp_secret");
  });
});
