import { describe, expect, it } from "vitest";
import { normalizeRepoIdentity } from "../src/shared/repo-identity";

/** CreateKey(C#) 가 만드는 저장소 식별자가 앱과 정확히 같은지 확인합니다. */
const CASES: Array<[string, string]> = [
  ["https://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["https://github.com/KCWJEDI/KJ_FlowForge_TestGit", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["https://github.com/KCWJEDI/KJ_FlowForge_TestGit/", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["http://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["ssh://git@github.com/KCWJEDI/KJ_FlowForge_TestGit.git", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["git@github.com:KCWJEDI/KJ_FlowForge_TestGit.git", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["git@github.com:KCWJEDI/KJ_FlowForge_TestGit", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["git://github.com/KCWJEDI/KJ_FlowForge_TestGit.git", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["https://GITHUB.COM/KCWJEDI/KJ_FlowForge_TestGit.git", "github.com/kcwjedi/kj_flowforge_testgit"],
  ["https://github.com/KCWJEDI/KJ_FlowForge_Config.git", "github.com/kcwjedi/kj_flowforge_config"],
];

describe("C# RepoIdentity parity with the app", () => {
  for (const [url, expected] of CASES) {
    it("matches for " + url, () => {
      expect(normalizeRepoIdentity(url)).toBe(expected);
    });
  }
});

