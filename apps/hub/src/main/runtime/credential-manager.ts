import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CredentialBundle } from "../../shared/ipc";
import type { HubConfig } from "../config";
import { normalizeRepoIdentity } from "../../shared/repo-identity";
import { installCredentialBundle, type InstalledCredentialMap } from "../credential-store";
import type { GitService } from "../git/git-service";
import type { GitHubAdapter } from "../integrations/github-adapter";

export interface CredentialManagerDeps {
  config: HubConfig;
  git: GitService;
  github: GitHubAdapter;
  /** 라이선스 키로 암호화된 Git 자격증명을 복호화하기 위한 라이선스 키 원문입니다. */
  licenseKey: string;
}

/**
 * 라이선스 키로 암호화된 Git(SSH) 자격증명을 이 PC에 설치하고, 저장소 URL에 맞는
 * 개인키를 Git 서비스에 적용합니다. config 저장소가 비공개여도 읽을 수 있게 합니다.
 */
export class CredentialManager {
  private installedCredentials: InstalledCredentialMap = {};

  public constructor(private readonly deps: CredentialManagerDeps) {}

  /**
   * 라이선스 저장소에 배포된 라이선스별 Git 자격증명(SSH 개인키)을 이 PC에 설치합니다.
   * 설치 중 생긴 경고를 문자열 배열로 돌려줍니다(호출자가 상태 메시지에 합칩니다).
   */
  public async install(bundle: CredentialBundle | null | undefined): Promise<string[]> {
    if (!this.deps.licenseKey || !bundle) return [];
    const credentialsDir = path.join(this.deps.config.dataDirectory, "git-credentials");
    try {
      const result = await installCredentialBundle({
        directory: credentialsDir,
        licenseKey: this.deps.licenseKey,
        bundle,
      });
      this.installedCredentials = result.installed;
      return result.warnings.map((warning) => "Git 자격증명 설치 경고: " + warning);
    } catch (error) {
      return ["Git 자격증명을 설치하지 못했습니다: " + (error instanceof Error ? error.message : String(error))];
    }
  }

  /** config 저장소(configRepo)에 접근할 개인키 경로를 반환합니다. */
  public configRepoKey(): string {
    if (!this.deps.config.configRepo) return "";
    return this.keyForUrl("https://github.com/" + this.deps.config.configRepo + ".git");
  }

  /** 주어진 원격 URL에 대응하는 설치된 개인키 경로를 반환합니다(없으면 빈 문자열). */
  public keyForUrl(url: string): string {
    const identity = normalizeRepoIdentity(url);
    if (identity && this.installedCredentials[identity]) return this.installedCredentials[identity]!;
    return "";
  }

  /** config 저장소를 읽을 자격증명(토큰 또는 SSH 키)이 있는지 확인합니다. */
  public canReadConfigRepo(): boolean {
    const { config, github, git } = this.deps;
    if (!config.configRepo) return false;
    if (github.enabled && config.github.owner && config.github.repo) return true;
    return Boolean(this.configRepoKey()) || git.hasSshKey || Boolean(config.sshKeyPath);
  }

  /**
   * config 저장소의 파일을 읽습니다. GitHub 토큰이 있으면 API로,
   * 없으면 SSH 키로 임시 클론해 읽습니다(config 저장소가 비공개인 경우).
   */
  public async readConfigFile(filePath: string, branch = "main"): Promise<string> {
    const { config, github, git } = this.deps;
    if (github.enabled && config.github.owner && config.github.repo) {
      const raw = await github.readFile(filePath, branch);
      if (raw === null) throw new Error("config 저장소에서 " + filePath + " 를 찾을 수 없습니다.");
      return raw;
    }
    if (!config.configRepo) {
      throw new Error("config 저장소(owner/repo)가 설정되지 않았습니다.");
    }
    // config 전용 키를 우선 사용하고, 없으면 지정된 키로 시도합니다.
    const key = this.configRepoKey();
    if (key) git.setSshKey(key);
    else if (!git.hasSshKey) git.setSshKey(config.sshKeyPath);
    if (!git.hasSshKey) {
      throw new Error("config 저장소에 접근할 자격증명이 없습니다. 라이선스를 다시 확인하세요.");
    }
    const url = "https://github.com/" + config.configRepo + ".git";
    const workDir = path.join(config.dataDirectory, "config-cache");
    const root = await git.ensureRepositoryAt(url, workDir, branch);
    return await readFile(path.join(root, filePath), "utf8");
  }

  /** 원격 URL에 대응하는 개인키 경로를 고릅니다(없으면 지정 키/첫 설치 키). */
  public sshKeyForUrl(url: string): string {
    return this.keyForUrl(url) || this.deps.config.sshKeyPath || Object.values(this.installedCredentials)[0] || "";
  }

  /** 로컬 저장소 경로가 어떤 저장소인지 찾아 해당 개인키를 Git 서비스에 적용합니다. */
  public applyForRepository(repository?: string): void {
    if (!repository) return;
    const repo = this.deps.config.repositories.find((item) => item.path === repository || item.label === repository);
    if (!repo?.url) return;
    const key = this.sshKeyForUrl(repo.url);
    if (key) this.deps.git.setSshKey(key);
  }
}

