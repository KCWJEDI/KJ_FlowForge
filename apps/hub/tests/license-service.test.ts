import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LicenseService } from "../src/main/license-service";

const KEY = "KJFF-TEST-KEY-0001";
const manifest = (role = "admin", extra = {}) => ({
  version: 1,
  keys: [{ id: "test-id", key: KEY, owner: "tester", role, ...extra }],
  revoked: [],
});

describe("LicenseService role authority", () => {
  let directory = "";

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  it("does not carry admin authority through offline grace", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "kj-license-"));
    await writeFile(path.join(directory, "license.json"), JSON.stringify({
      key: KEY, keyId: "test-id", owner: "tester", role: "admin", lastVerifiedAt: new Date().toISOString(),
    }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const service = new LicenseService(directory, { manifestUrl: "https://example.test/licenses.json" });

    await expect(service.verifyOnStartup()).resolves.toMatchObject({ activated: true, role: "user" });
    expect(service.getEffectiveRole()).toBe("user");
  });

  it("takes role and revocation from the online manifest", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "kj-license-"));
    await writeFile(path.join(directory, "license.json"), JSON.stringify({
      key: KEY, keyId: "test-id", owner: "tester", role: "admin", lastVerifiedAt: new Date().toISOString(),
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest("user")), { status: 200 })));
    const service = new LicenseService(directory, { manifestUrl: "https://example.test/licenses.json" });
    await expect(service.verifyOnStartup()).resolves.toMatchObject({ activated: true, role: "user" });
    expect(JSON.parse(await readFile(path.join(directory, "license.json"), "utf8")).role).toBe("user");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...manifest("user"), revoked: ["test-id"] }), { status: 200 })));
    await expect(service.check(KEY)).resolves.toEqual({ status: "revoked" });
  });
});
