import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { LicenseRole } from "../shared/ipc";

const DEFAULT_MANIFEST_URL =
  "https://raw.githubusercontent.com/KCWJEDI/KJ_FlowForge_Config/main/licenses.json";
const FETCH_TIMEOUT_MS = 8_000;
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_INTERVAL_MS = 60 * 60 * 1000;

interface ManifestEntry {
  id: string;
  key?: string;
  hash?: string;
  owner?: string;
  role?: string;
  expiresAt?: string;
}

interface Manifest {
  version?: number;
  keys: ManifestEntry[];
  revoked?: string[];
}

export interface StoredLicense {
  key: string;
  keyId: string;
  owner?: string;
  role: LicenseRole;
  expiresAt?: string;
  lastVerifiedAt: string;
}

export type LicenseCheckResult =
  | { status: "ok"; keyId: string; owner?: string; role: LicenseRole }
  | { status: "offline" }
  | { status: "blocked" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "revoked" };

function normalizeRole(value: unknown): LicenseRole {
  return value === "admin" ? "admin" : "user";
}

export class LicenseService {
  private stored: StoredLicense | null = null;
  private verificationTimer: ReturnType<typeof setInterval> | null = null;
  private offlineGrace = false;
  private verificationRunning = false;

  public constructor(
    private readonly userDataPath: string,
    private readonly options: { manifestUrl?: string; githubToken?: string; onRoleChanged?: (role: LicenseRole) => void } = {},
  ) {}

  private get licenseFile(): string {
    return path.join(this.userDataPath, "license.json");
  }

  private get manifestUrl(): string {
    const fromEnv = this.options.manifestUrl?.trim();
    return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MANIFEST_URL;
  }

  public async loadStored(): Promise<StoredLicense | null> {
    try {
      const raw = await fs.readFile(this.licenseFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredLicense>;
      if (typeof parsed.key === "string" && parsed.key.trim().length > 0 && typeof parsed.keyId === "string") {
        this.stored = {
          key: parsed.key.trim(),
          keyId: parsed.keyId,
          owner: parsed.owner,
          role: normalizeRole(parsed.role),
          expiresAt: parsed.expiresAt,
          lastVerifiedAt:
            typeof parsed.lastVerifiedAt === "string" ? parsed.lastVerifiedAt : new Date(0).toISOString(),
        };
      }
    } catch {
      this.stored = null;
    }
   return this.stored;
 }

  public getStatus(): { activated: boolean; reason: "missing" | "grace-offline" | "invalid" | "blocked" | undefined } {
    if (!this.stored) return { activated: false, reason: "missing" };
    const age = Date.now() - Date.parse(this.stored.lastVerifiedAt);
    if (Number.isFinite(age) && age <= GRACE_MS) return { activated: true, reason: undefined };
    return { activated: false, reason: "grace-offline" };
  }

  public getEffectiveRole(): LicenseRole {
    return this.offlineGrace ? "user" : this.stored?.role ?? "user";
  }

  public async verifyOnStartup(): Promise<{
    activated: boolean;
    reason: "missing" | "grace-offline" | "invalid" | "blocked" | undefined;
    role?: LicenseRole;
  }> {
    const stored = await this.loadStored();
    if (!stored) return { activated: false, reason: "missing" };
    const result = await this.check(stored.key);
    if (result.status === "ok") {
      this.offlineGrace = false;
      return { activated: true, reason: undefined, role: result.role };
    }
    if (result.status === "blocked") return { activated: false, reason: "blocked" };
    if (result.status === "offline") {
      const status = this.getStatus();
      if (!status.activated) return { activated: false, reason: "grace-offline" };
      this.offlineGrace = true;
      // Offline grace never carries administrator authority.
      return { activated: true, reason: undefined, role: "user" };
    }
    await this.clear();
    return { activated: false, reason: "invalid" };
  }

  public peek(): StoredLicense | null {
    return this.stored;
  }

  public startPeriodicVerification(): void {
    this.stopPeriodicVerification();
    this.verificationTimer = setInterval(() => {
      void this.verifyStoredKey();
    }, VERIFY_INTERVAL_MS);
    this.verificationTimer.unref?.();
  }

  public stopPeriodicVerification(): void {
    if (this.verificationTimer) clearInterval(this.verificationTimer);
    this.verificationTimer = null;
  }

  private async verifyStoredKey(): Promise<void> {
    if (this.verificationRunning) return;
    this.verificationRunning = true;
    try {
    const key = this.stored?.key;
    if (!key) return;
    const previousRole = this.offlineGrace ? "user" : this.stored?.role ?? "user";
    const result = await this.check(key);
    if (result.status === "ok") {
      this.offlineGrace = false;
      if (previousRole !== result.role) this.options.onRoleChanged?.(result.role);
      return;
    }
    if (result.status === "offline") {
      this.offlineGrace = true;
      if (previousRole === "admin") this.options.onRoleChanged?.("user");
      return;
    }
    await this.clear();
    this.options.onRoleChanged?.("user");
    } finally {
      this.verificationRunning = false;
    }
  }

  public async check(rawKey: string): Promise<LicenseCheckResult> {
    const key = rawKey.trim();
    if (!key) return { status: "invalid" };
    let manifest: Manifest;
    try {
      manifest = await this.fetchManifest();
    } catch (error) {
      if ((error as Error)?.name === "BlockedError") return { status: "blocked" };
      return { status: "offline" };
    }
    const hash = createHash("sha256").update(key).digest("hex");
    const entry = manifest.keys.find((item) => item.key === key || (item.hash && item.hash.toLowerCase() === hash));
    if (!entry) return { status: "invalid" };
    if ((manifest.revoked ?? []).includes(entry.id)) return { status: "revoked" };
    if (entry.expiresAt && Date.parse(entry.expiresAt) < Date.now()) return { status: "expired" };
    this.stored = {
      key,
      keyId: entry.id,
      owner: entry.owner,
      role: normalizeRole(entry.role),
      expiresAt: entry.expiresAt,
      lastVerifiedAt: new Date().toISOString(),
    };
    await fs.writeFile(this.licenseFile, JSON.stringify(this.stored, null, 2), "utf8");
    return { status: "ok", keyId: entry.id, owner: entry.owner, role: this.stored.role };
  }

  public async clear(): Promise<void> {
    this.stored = null;
    this.offlineGrace = false;
    try {
      await fs.rm(this.licenseFile, { force: true });
    } catch {
      /* ignore */
    }
  }


  private async fetchManifest(): Promise<Manifest> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (this.options.githubToken?.trim()) headers.Authorization = `Bearer ${this.options.githubToken.trim()}`;
      let url = this.manifestUrl;
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        const parts = url.replace("https://raw.githubusercontent.com/", "").split("/");
        const owner = parts.shift();
        const repo = parts.shift();
        const branch = parts.shift();
        const filePath = parts.join("/");
        url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch ?? "main"}`;
        headers.Accept = "application/vnd.github+json";
      } else {
        headers.Accept = "application/vnd.github.raw+json";
      }
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { name: "BlockedError" });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let body: Manifest;
      if (url.includes("api.github.com")) {
        const wrapped = (await response.json()) as { content?: string; encoding?: string };
        if (typeof wrapped.content !== "string") {
          throw Object.assign(new Error("manifest not found"), { name: "BlockedError" });
        }
        body = JSON.parse(
          Buffer.from(wrapped.content, "base64")
            .toString("utf8")
            .replace(/^\uFEFF/, ""),
        ) as Manifest;
      } else {
        const rawText = await response.text();
        body = JSON.parse(rawText.replace(/^\uFEFF/, "")) as Manifest;
      }
      if (!Array.isArray(body.keys)) throw new Error("manifest keys missing");
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}
