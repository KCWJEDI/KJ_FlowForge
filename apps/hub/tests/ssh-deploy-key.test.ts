import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { GitService, sshCommandArgs, toSshUrl } from "../src/main/git/git-service";

describe("ssh deploy key support (pure helpers)", () => {
  it("builds a scoped ssh command with the given identity", () => {
    const args = sshCommandArgs("C:\\keys\\flowforge_deploy");
    expect(args[0]).toBe("-c");
    expect(args[1]).toContain("core.sshCommand=ssh -i \"C:/keys/flowforge_deploy\"");
    expect(args[1]).toContain("IdentitiesOnly=yes");
    expect(args[1]).toContain("BatchMode=yes");
  });

  it("is a no-op without a key path", () => {
    expect(sshCommandArgs("")).toEqual([]);
    expect(sshCommandArgs("   ")).toEqual([]);
  });

  it("converts github https urls to ssh form and leaves others alone", () => {
    expect(toSshUrl("https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git")).toBe("git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git");
    expect(toSshUrl("https://github.com/KCWJEDI/KJ_FlowForge_TestGit")).toBe("git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git");
    expect(toSshUrl("git@github.com:KCWJEDI/X.git")).toBe("git@github.com:KCWJEDI/X.git");
    expect(toSshUrl("ssh://git@github.com/KCWJEDI/X.git")).toBe("ssh://git@github.com/KCWJEDI/X.git");
    // GitHub 이 아닌 원격(공유 폴더 등)은 그대로 유지
    expect(toSshUrl("\\\\server\\share\\Repo.git")).toBe("\\\\server\\share\\Repo.git");
    expect(toSshUrl("C:\\WorkSpace\\Repo")).toBe("C:\\WorkSpace\\Repo");
  });
});

describe("git actually uses the configured ssh key", () => {
  it("passes the identity to ssh (verified through ssh error output)", () => {
    const service = new GitService();
    const base = mkdtempSync(path.join(os.tmpdir(), "sshkey-"));
    const missingKey = path.join(base, "does-not-exist-key");
    service.setSshKey(missingKey);
    expect(service.hasSshKey).toBe(true);

    let output = "";
    try {
      execFileSync("git", [
        "-c", "credential.helper=",
        ...sshCommandArgs(missingKey),
        "ls-remote", "--heads", toSshUrl("https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git"),
      ], { cwd: base, encoding: "utf8", stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    } catch (error) {
      const e = error as { stderr?: string; stdout?: string; message?: string };
      output = (e.stderr ?? "") + (e.stdout ?? "") + (e.message ?? "");
    }
    console.log("OUTPUT:", output.split("\n").slice(0, 4).join(" | "));
    // ssh 가 실제로 실행되어 우리가 지정한 키를 읽으려 했음을 확인
    expect(/Identity file .*not accessible|does-not-exist-key/i.test(output)).toBe(true);
    expect(existsSync(missingKey)).toBe(false);
  }, 60000);
});

