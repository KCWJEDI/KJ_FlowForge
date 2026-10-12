import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  DailyAutomationRunView,
  DailyAutomationView,
  DashboardState,
  GitCloneResult,
  GitConnectResult,
  GitConnectOrCloneResult,
  GitPullResult,
  GitStatusView,
  IntegrationConnectionStatus,
  LicenseRole,
  ManualDailyReportInput,
  ManualDailyReportResult,
  ProjectDefinition,
  ProjectView,
  RepositoryConnectionCheck,
  SettingsSaveResult,
  SettingsView,
  CredentialBundle,
} from "../shared/ipc";
import type { HubConfig } from "./config";
import { toPublicConfig } from "./config";
import { ENV_DEFINITIONS, readEnvFile, writeEnvFile } from "./env-store";
import { DailyAutomation } from "./automation/daily-schedule";
import { GitService, type GitChangeSummary } from "./git/git-service";
import { RepositoryWatcher } from "./git/repository-watcher";
import { isProtectedBranch } from "../shared/branch-policy";
import { findBundleEnvelope, installCredentialBundle, type InstalledCredentialMap } from "./credential-store";
import { normalizeRepoIdentity } from "../shared/repo-identity";
import { GitSelectionStore, type GitSelectionState } from "./git-selection-store";
import { DiscordAdapter } from "./integrations/discord-adapter";
import { GeminiAdapter } from "./integrations/gemini-adapter";
import { GitHubAdapter } from "./integrations/github-adapter";
import { NotionAdapter } from "./integrations/notion-adapter";
import {
  allowedBranchesOf,
  buildProjectViews,
  defaultFetchText,
  ensureProjectsCacheDir,
  hasUserBranchAssignment,
  loadProjects,
  parseProjectsFile,
  sameIdentity,
  serializeProjectsFile,
  upsertProjectsFromRepositories,
  userBranchesOf,
} from "./projects-store";

// 공용 브랜치(main/master/develop) 정의는 shared/branch-policy 를 유일한 기준으로 사용합니다.
// 화면과 서버가 같은 규칙을 공유해야 "선택은 되는데 푸시는 막히는" 혼란이 생기지 않습니다.

export class HubRuntime extends EventEmitter {
  private readonly startedAt = new Date().toISOString();
  private readonly createdCommits = new Map<string, GitChangeSummary>();
  private readonly currentBranchCache = new Map<string, string>();
  private lastRepositoriesWarning: string | null = null;
  private projects: ProjectDefinition[] = [];
  private projectsCacheFile = "";
  /** 라이선스 키로 암호화된 Git 자격증명을 복호화하기 위한 라이선스 키 원문입니다. */
  private licenseKey = "";
  /** 프로젝트 id -> 이 PC 에 설치된 SSH 개인키 경로. */
  /** 저장소 식별자 -> 이 PC 에 설치된 SSH 개인키 경로. */
  private installedCredentials: InstalledCredentialMap = {};
  /** 라이선스 저장소에서 자격증명 묶음을 가져오는 콜백(메인 프로세스가 주입). */
  private credentialLoader: (() => Promise<CredentialBundle | null>) | null = null;
  private gitSelectionState: GitSelectionState = {
    workBranchesByProject: {},
    activeBranchesByProject: {},
    cardsByProject: {},
    selectedProject: "",
    connectedPaths: [],
    projectConnectPaths: {},
    projectConnectMessages: {},
    projectConnectPath: "",
    projectConnectMessage: "",
  };
  private readonly gitSelectionStore: GitSelectionStore;
  public readonly git = new GitService();
  /** 연결된 폴더의 변경을 감지해 화면을 자동 새로고침하기 위한 감시자입니다. */
  private readonly watcher = new RepositoryWatcher({
    onChange: (repository) => this.emit("repositoryChanged", repository),
  });
  public readonly discord: DiscordAdapter;
  public readonly notion: NotionAdapter;
  public readonly github: GitHubAdapter;
  public readonly gemini: GeminiAdapter;
  public readonly dailyAutomation: DailyAutomation;

  public constructor(
    public readonly config: HubConfig,
    public role: LicenseRole = "user",
    public readonly keyId: string = "",
    licenseKey: string = "",
  ) {
    super();
    this.licenseKey = licenseKey;
    this.gitSelectionStore = new GitSelectionStore(config.selectionFile ?? path.join(config.dataDirectory, "git-selection.json"));
    // 비공개 저장소 clone/fetch/push/ls-remote 에 GitHub 토큰을 사용합니다.
    this.git.setToken(config.github.token);
    // SSH 배포 키가 지정되면 토큰 없이도(계정 로그인 없이) 저장소에 접속합니다.
    this.git.setSshKey(config.sshKeyPath);
    this.discord = new DiscordAdapter(config.discord);
    this.notion = new NotionAdapter({});
    this.github = new GitHubAdapter(config.github);
    this.gemini = new GeminiAdapter(config.gemini);
    this.dailyAutomation = new DailyAutomation({
      config,
      git: this.git,
      notion: this.notion,
      discord: this.discord,
      gemini: this.gemini,
      allBranches: this.role === "admin",
      onChanged: () => this.emitState(),
    });
  }

  public async start(): Promise<void> {
    this.gitSelectionState = await this.gitSelectionStore.load();
    this.projectsCacheFile = await ensureProjectsCacheDir(this.config.dataDirectory);
    // 1) 라이선스 자격증명을 먼저 받아 둡니다. 그래야 config 가 비공개여도 읽을 수 있습니다.
    const bundle = await this.credentialLoader?.() ?? null;
    await this.installUserCredentials(bundle ?? undefined);
    const loaded = await loadProjects(this.config.projectsUrl, this.projectsCacheFile, async () => {
      try {
        // Config 저장소가 public이라면 별도 토큰 없이 raw 주소에서 항상 최신 프로젝트를 받아옵니다.
        return await defaultFetchText(this.config.projectsUrl);
      } catch {
        // raw 접근 실패(config 비공개, offline 등) 시 인증된 경로로 폴백합니다.
        return await this.readConfigFile("projects.json");
      }
    });
    this.projects = loaded.projects;
    if (this.discord.enabled) await this.discord.start();
    // 매일 오전 08:00 자동 일일작업 등록은 관리자 라이선스 전용 기능입니다.
    if (this.role === "admin") {
      await this.dailyAutomation.start();
    } else {
      await this.dailyAutomation.stop();
    }
  }

  public async stop(): Promise<void> {
    await this.dailyAutomation.stop();
    this.watcher.closeAll();
    await Promise.allSettled([this.discord.stop()]);
  }

  /**
   * 라이선스 저장소에서 암호화 Git 자격증명을 가져오는 로더를 주입합니다.
   * config 저장소가 비공개여도 자격증명을 먼저 확보하기 위해 시작 시 사용됩니다.
   */
  public setCredentialLoader(loader: () => Promise<CredentialBundle | null>): void {
    this.credentialLoader = loader;
  }

  /**
   * config 저장소에 배포된 라이선스별 Git 자격증명(SSH 개인키)을 이 PC에 설치합니다.
   *
   * 팀원은 라이선스 키만 입력하면 되고, 앱이 자기 몫의 암호문을 찾아 복호화해
   * 로컬 개인키 파일로 만든 뒤 Git 접속에 사용합니다.
   */
  private async installUserCredentials(bundle: CredentialBundle | undefined): Promise<void> {
    if (!this.licenseKey || !bundle) return;
    const credentialsDir = path.join(this.config.dataDirectory, "git-credentials");
    try {
      const result = await installCredentialBundle({
        directory: credentialsDir,
        licenseKey: this.licenseKey,
        bundle,
      });
      this.installedCredentials = result.installed;
      for (const warning of result.warnings) {
        this.lastRepositoriesWarning =
          (this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : "") +
          "Git 자격증명 설치 경고: " + warning;
      }
    } catch (error) {
      this.lastRepositoriesWarning =
        (this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : "") +
        "Git 자격증명을 설치하지 못했습니다: " +
        (error instanceof Error ? error.message : String(error));
    }
  }

  /** config 저장소(configRepo)에 접근할 개인키 경로를 반환합니다. */
  private configRepoKey(): string {
    if (!this.config.configRepo) return "";
    return this.credentialKeyForUrl("https://github.com/" + this.config.configRepo + ".git");
  }

  /** 주어진 원격 URL 에 대응하는 설치된 개인키 경로를 반환합니다(없으면 빈 문자열). */
  private credentialKeyForUrl(url: string): string {
    const identity = normalizeRepoIdentity(url);
    if (identity && this.installedCredentials[identity]) return this.installedCredentials[identity]!;
    return "";
  }

  /** config 저장소를 읽을 자격증명(토큰 또는 SSH 키)이 있는지 확인합니다. */
  private canReadConfigRepo(): boolean {
    if (!this.config.configRepo) return false;
    if (this.github.enabled && this.config.github.owner && this.config.github.repo) return true;
    return Boolean(this.configRepoKey()) || this.git.hasSshKey || Boolean(this.config.sshKeyPath);
  }

  /**
   * config 저장소의 파일을 읽습니다. GitHub 토큰이 있으면 API 로,
   * 없으면 SSH 키로 임시 클론해 읽습니다(config 저장소가 비공개인 경우).
   *
   * 여기서 쓰는 SSH 키는 라이선스 저장소에서 미리 받아 둔 config 전용 키입니다.
   */
  private async readConfigFile(filePath: string, branch = "main"): Promise<string> {
    if (this.github.enabled && this.config.github.owner && this.config.github.repo) {
      const raw = await this.github.readFile(filePath, branch);
      if (raw === null) throw new Error("config 저장소에서 " + filePath + " 를 찾을 수 없습니다.");
      return raw;
    }
    if (!this.config.configRepo) {
      throw new Error("config 저장소(owner/repo)가 설정되지 않았습니다.");
    }
    // config 전용 키를 우선 사용하고, 없으면 지정된 키로 시도합니다.
    const key = this.configRepoKey();
    if (key) this.git.setSshKey(key);
    else if (!this.git.hasSshKey) this.git.setSshKey(this.config.sshKeyPath);
    if (!this.git.hasSshKey) {
      throw new Error("config 저장소에 접근할 자격증명이 없습니다. 라이선스를 다시 확인하세요.");
    }
    const url = "https://github.com/" + this.config.configRepo + ".git";
    const workDir = path.join(this.config.dataDirectory, "config-cache");
    const root = await this.git.ensureRepositoryAt(url, workDir, branch);
    return await readFile(path.join(root, filePath), "utf8");
  }


  /** 원격 URL 에 대응하는 개인키 경로를 고릅니다(없으면 지정 키/첫 설치 키). */
  private sshKeyForUrl(url: string): string {
    return this.credentialKeyForUrl(url) || this.config.sshKeyPath || Object.values(this.installedCredentials)[0] || "";
  }

  /** 로컬 저장소 경로가 어떤 저장소인지 찾아 해당 개인키를 Git 서비스에 적용합니다. */
  private applyCredentialForRepository(repository?: string): void {
    if (!repository) return;
    const repo = this.config.repositories.find((item) => item.path === repository || item.label === repository);
    if (!repo?.url) return;
    const key = this.sshKeyForUrl(repo.url);
    if (key) this.git.setSshKey(key);
  }

  public setRole(role: LicenseRole): void {
    if (this.role === role) return;
    this.role = role;
    if (role === "admin") void this.dailyAutomation.start();
    else void this.dailyAutomation.stop();
    this.emitState();
  }

  public getState(): DashboardState {
    return {
      startedAt: this.startedAt,
      config: toPublicConfig(this.config, this.role),
      role: this.role,
      recentEvents: [],
      dailyAutomation: this.dailyAutomation.getView(),
    };
  }

  public getDailyAutomation(): DailyAutomationView {
    return this.dailyAutomation.getView();
  }

  public runDailyAutomation(): Promise<DailyAutomationRunView> {
    if (this.role !== "admin") {
      throw new Error("관리자 라이선스가 필요합니다. 자동 일일작업 등록은 관리자만 사용할 수 있습니다.");
    }
    return this.dailyAutomation.run("manual");
  }

  public reportManualDailyReport(input: ManualDailyReportInput): Promise<ManualDailyReportResult> {
    return this.dailyAutomation.reportManualCommits(input);
  }

  public async inspectGit(repository?: string): Promise<GitStatusView> {
    return this.git.inspect(this.resolveRepository(repository));
  }

  /**
   * 지정한 저장소 폴더의 변경 감시를 시작합니다(자동 새로고침용).
   * .git 내부 변경은 제외해 Git 상태와 무관한 잡음을 걸러냅니다.
   */
  public watchRepository(repository: string): void {
    this.watcher.watch(repository);
  }

  /** 지정한 저장소 폴더의 변경 감시를 중단합니다. */
  public unwatchRepository(repository: string): void {
    this.watcher.unwatch(repository);
  }

  public async listGitBranches(repository?: string): Promise<string[]> {
    const target = this.resolveRepository(repository);
    // 로케일 브랜치 조회는 실패할 수 있으므로 정상 흔름을 방해하지 않도록 빈 배열로 보호합니다.
    let local: string[] = [];
    try { local = await this.git.listBranches(target); } catch { local = []; }
    let repo = this.config.repositories.find((item) => item.path === target || item.label === target);
    let project = repo ? this.projects.find((item) => item.id === repo.project) : undefined;
    if (!project && repo?.url) {
      project = this.projects.find((item) => sameIdentity(item.url, repo.url)) ?? undefined;
    }
    if (!repo || !project) {
      try {
        const identity = await this.git.getRepositoryIdentity(target);
        project = this.projects.find((item) => sameIdentity(item.url, identity.originUrl)) ?? undefined;
      } catch {}
    }
    const isNormal = this.role !== "admin";
    // 일반 사용자는 Config(라이선스)에 이 유저에게 배정된 브랜치가 있어야만
    // 브랜치를 볼 수 있다. 배정이 없거나 연결 폴더가 다른 저장소면 빈 목록을 반환해
    // 로컬 폴더의 다른 브랜치(main 등)가 노출되지 않게 한다.
    if (isNormal && !hasUserBranchAssignment(project, this.keyId)) return [];
    const restricted = isNormal ? userBranchesOf(project, this.keyId) : allowedBranchesOf(project);
    // 허용 브랜치가 설정되지 않은 경우(관리자) 로컬 저장소의 브랜치만 노출.
    if (restricted.length === 0) return local;
    // 보통 사용자: 허용 브랜치는 Config(원격)에도 존재하밍로, 로케일 폴더가 아직 checkout 되지 않았거나 비어있어도 원격 브랜치로 선택 가능하게 합니다.
    let source: string[] = local;
    const projectUrl = project?.url || repo?.url || "";
    if (projectUrl) {
      try {
        this.git.setSshKey(this.sshKeyForUrl(projectUrl));
        source = [...new Set([...local, ...(await this.git.listRemoteBranches(projectUrl))])];
      }
      catch { /* 원격 조회 실패시 로케일 브랜치만 사용 */ }
    }
    const limited = source.filter((branch) => restricted.includes(branch));
    return [...limited.filter((branch) => local.includes(branch)), ...limited.filter((branch) => !local.includes(branch))];
  }


  /** Config/KJ_FlowForge_Config의 projects.json에 정의된 프로젝트 목록(일반 유저 화면용)을 반환합니다. */
  public async getProjects(): Promise<ProjectView[]> {
    this.projectsCacheFile = this.projectsCacheFile || (await ensureProjectsCacheDir(this.config.dataDirectory));
    const loaded = await loadProjects(this.config.projectsUrl, this.projectsCacheFile, async () => {
      try {
        return await defaultFetchText(this.config.projectsUrl);
      } catch {
        if (this.canReadConfigRepo()) {
          const raw = await this.github.readFile('projects.json', 'main');
          if (raw === null) throw new Error('projects.json not found in config repo');
          return raw;
        }
        throw new Error('config 저장소에 접근할 수 없습니다. 라이선스를 확인하거나 Git 접속 설정을 확인하세요.');
      }
    });
    // 빈 결과도 반영해야 Config에서 프로젝트/라이선스별 브랜치 배정이
    // 삭제된 경우 이전 상태가 화면에 남지 않습니다.
    this.projects = loaded.projects;
    // 일반 사용자는 라이선스별 배정 브랜치를 기준으로 뷰를 만들기 때문에,
    // 배정이 있으면 원격 조회 없이도 브랜치 목록이 채워집니다(오프라인에서도 표시).
    const views = await buildProjectViews(
      this.projects,
      this.config.repositories,
      (url) => this.git.listRemoteBranches(url),
      this.role === "admin" ? "" : this.keyId,
    );
    if (this.role !== "admin") {
      return views.filter((view) => {
        const project = this.projects.find((item) => item.id === view.id);
        const restricted = userBranchesOf(project, this.keyId);
        if (!hasUserBranchAssignment(project, this.keyId)) return false;
        view.selectableBranches = view.selectableBranches.filter((branch) => restricted.includes(branch));
        view.branchRestricted = true;
        view.allowedBranches = restricted;
        return true;
      });
    }
    return views;
  }

  /** 일반 유저가 선택한 프로젝트를 로컬 빈 폴더에 클론합니다. */
  public async cloneGitRepository(args: { url: string; directory: string }): Promise<GitCloneResult> {
    this.git.setSshKey(this.sshKeyForUrl(args.url));
    const root = await this.git.cloneRepository(args.url, args.directory);
    const identity = await this.git.getRepositoryIdentity(root);
    return { path: root, url: identity.originUrl, identity: identity.key };
  }

  /** 일반 유저가 .git 폴더를 지정해 기존 로컬 저장소를 프로젝트에 연결합니다. */
  public async connectGitRepository(args: { directory: string }): Promise<GitConnectResult> {
    const identity = await this.git.getRepositoryIdentity(args.directory);
    return { path: identity.root, url: identity.originUrl, identity: identity.key };
  }

  /** 빈 폴더면 clone, 기존 git 저장소면 연결을 자동 판별해 수행합니다. */
  public async connectOrCloneGitRepository(args: { url: string; directory: string }): Promise<GitConnectOrCloneResult> {
    this.git.setSshKey(this.sshKeyForUrl(args.url));
    const result = await this.git.connectOrClone(args.url, args.directory);
    return { action: result.action, path: result.root, url: result.originUrl, identity: result.identity };
  }

  public async switchGitBranch(repository: string | undefined, branch: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.assertUserProjectAccess(target, branch);
    await this.git.switchBranch(target, branch);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitCreateBranch(repository: string | undefined, branch: string, startPoint?: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.assertUserProjectAccess(target, branch, true);
    await this.git.createBranch(target, branch, startPoint);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitStage(repository: string | undefined, paths: string[]): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.git.stage(target, paths);
    this.emitState();
    return this.git.inspect(target);
  }

  /**
   * 작업 트리의 변경사항을 폐기합니다(브랜치 전환을 막는 변경사항 정리).
   *
   * 일반 사용자도 자기 작업 폴더의 변경만 폐기할 수 있습니다.
   * 새로 만든 파일은 기본적으로 남기고(안전), includeUntracked 가 true 일 때만 함께 지웁니다.
   */
  public async gitDiscardChanges(repository: string | undefined, includeUntracked = false): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.git.discardChanges(target);
    if (includeUntracked) {
      const untracked = await this.git.listUntrackedFiles(target);
      if (untracked.length > 0) await this.git.cleanUntracked(target, untracked);
    }
    this.emitState();
    return this.git.inspect(target);
  }

  /** 폐기 대상 미리보기: 추적 파일 변경 수와 새 파일 목록을 반환합니다. */
  public async gitDiscardPreview(repository: string | undefined): Promise<{
    changedFiles: number;
    untrackedFiles: string[];
  }> {
    const target = this.resolveRepository(repository);
    const status = await this.git.inspect(target);
    const untracked = await this.git.listUntrackedFiles(target);
    return { changedFiles: status.files.length, untrackedFiles: untracked };
  }

  public async gitCommitWithSummary(repository?: string): Promise<GitChangeSummary> {
    const target = this.resolveRepository(repository);
    const status = await this.git.inspect(target);
    this.currentBranchCache.set(target, status.branch);
    await this.assertUserProjectAccess(target, status.branch);
    this.assertPersonalBranch(target);
    const summary = await this.git.commitWithSummary(target);
    this.createdCommits.set(target, summary);
    this.emitState();
    return summary;
  }

  public async gitPushCreatedCommit(repository?: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    const status = await this.git.inspect(target);
    this.currentBranchCache.set(target, status.branch);
    await this.assertUserProjectAccess(target, status.branch);
    this.assertPersonalBranch(target);
    const created = this.createdCommits.get(target);
    if (!created) throw new Error("먼저 '변경사항 요약 후 커밋'을 실행해야 푸시할 수 있습니다.");
    if (status.head !== created.newHead) {
      throw new Error("생성한 커밋 이후 HEAD가 변경되었습니다. 새로고침 후 다시 시도하세요.");
    }
    await this.git.push(target);
    this.createdCommits.delete(target);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitPushBranch(repository: string | undefined, branch: string, remote = "origin"): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.assertUserProjectAccess(target, branch);
    if (this.currentBranchCache.get(target) !== branch) {
      this.currentBranchCache.set(target, branch);
    }
    await this.git.switchBranch(target, branch);
    await this.git.push(target, remote, branch);
    this.emitState();
    return this.git.inspect(target);
  }

  /**
   * 선택한 브랜치로 원격(main 등)의 최신 커밋을 가져옵니다(Pull).
   *
   * 다른 팀원이 공용 브랜치에 병합한 내용을 로컬로 내려받는 용도입니다.
   * 공용 브랜치도 '가져오기'는 허용합니다(커밋·푸시만 제한). 작업 트리가 깨끗해야 합니다.
   */
  public async gitPull(repository: string | undefined, branch: string, remote = "origin"): Promise<GitPullResult> {
    const target = this.resolveRepository(repository);
    await this.assertUserProjectAccess(target, branch);
    // 원격 인증(배포 키/토큰)을 저장소 URL 기준으로 설정합니다.
    this.applyCredentialForRepository(target);
    const result = await this.git.pull(target, branch, remote);
    this.createdCommits.delete(target);
    this.emitState();
    const status = await this.git.inspect(target);
    return {
      repository: status.repository,
      branch: status.branch,
      updated: result.oldHead !== result.newHead,
      oldHead: result.oldHead,
      newHead: result.newHead,
      commits: result.commits,
      status,
    };
  }

  private assertPersonalBranch(target: string): void {
    if (this.role === "admin") return;
    const repository = this.config.repositories.find((item) => item.path === target);
    const defaultBranch = (repository?.defaultBranch ?? "").trim().toLowerCase();
    const current = this.currentBranchCache.get(target) ?? "";
    // 공용 브랜치 정책 판정은 shared/branch-policy 한 곳에서만 합니다.
    if (isProtectedBranch(current, repository?.defaultBranch)) {
      throw new Error(
        "일반 사용자는 개인 작업 브랜치에서만 커밋/푸시할 수 있습니다. 현재 브랜치('" +
          (current || "알 수 없음") +
          "')에서는 관리자 라이선스가 필요합니다.",
      );
    }
  }

  private async assertUserProjectAccess(target: string, branch: string, allowNewBranch = false): Promise<void> {
    if (this.role === "admin") return;
    const repository = this.config.repositories.find((item) => item.path === target);
    let project = repository ? this.projects.find((item) => item.id === repository.project) : undefined;
    if (!project) {
      try {
        const identity = await this.git.getRepositoryIdentity(target);
        project = this.projects.find((item) => sameIdentity(item.url, identity.originUrl));
      } catch {}
    }
    if (!hasUserBranchAssignment(project, this.keyId)) {
      throw new Error("이 라이선스에 허용된 프로젝트 또는 브랜치가 없습니다.");
    }
    if (!allowNewBranch && !userBranchesOf(project, this.keyId).includes(branch)) {
      throw new Error("이 라이선스에 허용되지 않은 브랜치입니다.");
    }
  }

  private resolveRepository(repository?: string): string {
    if (repository) {
      const byPath = this.config.repositories.find((item) => item.path === repository);
      const byLabel = this.config.repositories.find((item) => item.label === repository);
      const target = byPath?.path ?? byLabel?.path ?? repository;
      if (target.trim()) return target.trim();
    }
    const first = this.config.repositories.find((item) => item.path.trim().length > 0);
    if (!first) throw new Error("설정된 Git 저장소가 없습니다. 설정 탭에서 저장소를 추가하세요.");
    return first.path;
  }

  public async getSettings(): Promise<SettingsView> {
    const values = await readEnvFile(this.config.envFile);
    return {
      envFile: this.config.envFile,
      fields: ENV_DEFINITIONS.filter((definition) => this.role === "admin" || !definition.adminOnly).map((definition) => {
        const value = values.get(definition.key) ?? "";
        return {
          ...definition,
          value: definition.kind === "secret" ? "" : value,
          configured: Boolean(value),
        };
      }),
    };
  }

  /** 작업 브랜치 체크박스 선택 상태를 반환합니다(앱 재시작 후에도 유지). */
  public async getGitSelection(): Promise<GitSelectionState> {
    this.gitSelectionState = await this.gitSelectionStore.load();
    return this.gitSelectionState;
  }

  /** 작업 브랜치 체크박스 선택 상태를 저장합니다. */
  public async saveGitSelection(state: GitSelectionState): Promise<GitSelectionState> {
    this.gitSelectionState = await this.gitSelectionStore.save(state);
    return this.gitSelectionState;
  }

  /** 설정 탭 'Notion 저장소'에서 특정 데이터베이스 ID의 연결을 테스트합니다. */
  public async testNotionDatabase(args: { repository?: string; databaseId: string; token?: string }): Promise<{ ok: boolean; message: string }> {
    const databaseId = (args.databaseId ?? "").trim();
    if (!databaseId) return { ok: false, message: "데이터베이스 ID를 먼저 입력하세요." };
    // 화면에 방금 입력한 토큰이 전달되면 그 값을 우선해 검증한다. 값이 없으면
    // 저장된(in-memory) 저장소 토큰으로 검증한다.
    const explicitToken = (args.token ?? "").trim();
    const repository = this.config.repositories.find((r) => r.path === args.repository || r.label === args.repository);
    const token = explicitToken || repository?.notionToken?.trim();
    if (!token) return { ok: false, message: "Notion integration token이 저장소에 설정되지 않았습니다." };
    try {
      const adapter = NotionAdapter.forToken(token);
      const message = await adapter.testConnection(databaseId);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 설정 탭 'Discord 채널'에서 특정 채널 ID의 연결을 테스트합니다. */
  public async testDiscordChannel(args: { repository?: string; channelId: string }): Promise<{ ok: boolean; message: string }> {
    const channelId = (args.channelId ?? "").trim();
    if (!channelId) return { ok: false, message: "채널 ID를 먼저 입력하세요." };
    try {
      const message = await this.discord.testChannel(channelId);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 저장소별 Notion DB · Discord 채널 연결 상태를 배치로 확인해 상단 상태 점에 즉시 반영합니다. */
  public async checkRepositoryConnections(): Promise<RepositoryConnectionCheck[]> {
    const checks: RepositoryConnectionCheck[] = [];
    const seen = new Map<string, Set<"notion" | "discord">>();
    for (const repository of this.config.repositories) {
      const repoPath = repository.path.trim();
      const bucket = seen.get(repoPath) ?? new Set<"notion" | "discord">();
      seen.set(repoPath, bucket);

      const notionId = (repository.notionDatabaseId ?? "").trim();
      const notionToken = (repository.notionToken ?? "").trim();
      if (notionId && notionToken && !bucket.has("notion")) {
        bucket.add("notion");
        try {
          const adapter = NotionAdapter.forToken(notionToken);
          const message = await adapter.testConnection(notionId);
          checks.push({ repository: repoPath, integration: "notion", targetId: notionId, state: "connected", message });
        } catch (error) {
          checks.push({
            repository: repoPath,
            integration: "notion",
            targetId: notionId,
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const channelId = (repository.discordChannelId ?? "").trim();
      if (channelId && !bucket.has("discord")) {
        bucket.add("discord");
        try {
          const message = await this.discord.testChannel(channelId);
          checks.push({ repository: repoPath, integration: "discord", targetId: channelId, state: "connected", message });
        } catch (error) {
          checks.push({
            repository: repoPath,
            integration: "discord",
            targetId: channelId,
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return checks;
  }

  private async normalizeNotionDatabaseId(value: string): Promise<string> {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const withoutQuery = trimmed.split("?")[0] ?? trimmed;
    const match = /([0-9a-fA-F]{32})/.exec(withoutQuery.replace(/-/g, ""));
    if (match?.[1]) {
      const hex = match[1].toLowerCase();
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return trimmed;
  }

  public async saveSettings(input: Record<string, string>): Promise<SettingsSaveResult> {
    this.lastRepositoriesWarning = null;
    const entries: Record<string, string> = { ...input };
    // Git 저장소 탭에서 명시적으로 전체 삭제했는지 여부 (그 외 경로는 빈 목록으로 저장소를 덮어쓰지 않는다).
    const explicitRepositoryClear = entries.HUB_GIT_REPOSITORIES_CLEAR === "1";
    delete entries.HUB_GIT_REPOSITORIES_CLEAR;
    // 일반 사용자는 08:00 자동화 설정을 변경할 수 없습니다.
    if (this.role !== "admin") {
      delete entries.HUB_DAILY_AUTOMATION_ENABLED;
      delete entries.HUB_DAILY_AUTOMATION_PROJECTS;
      // 중앙 프로젝트 정의 주소는 관리자만 변경할 수 있습니다.
      delete entries.HUB_PROJECTS_URL;
      // 관리자 전용 필드(Gemini API 키 등)는 일반 사용자가 변경할 수 없습니다.
      for (const definition of ENV_DEFINITIONS) {
        if (definition.adminOnly) delete entries[definition.key];
      }
    }
    const current = await readEnvFile(this.config.envFile);
    const updates: Record<string, string> = {};
    for (const definition of ENV_DEFINITIONS) {
      if (!(definition.key in entries)) continue;
      const value = entries[definition.key]!.trim();
      if (definition.kind === "secret" && !value) continue;
      updates[definition.key] = value;
    }
    if ("HUB_GIT_REPOSITORIES" in updates) {
      const raw = updates.HUB_GIT_REPOSITORIES ?? "";
      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw) as Array<Partial<{
            label: string; username: string; defaultBranch: string; path: string;
            url: string; branches: string[]; discordMinCommits: number; discordBranches: string[];
            project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
          }>>;
          const validated: Array<{
            label: string; username: string; defaultBranch: string; path: string; url: string;
            branches: string[]; discordMinCommits: number; discordBranches: string[];
            project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
          }> = [];
          for (const item of parsed) {
            const project = typeof item?.project === "string" ? item.project.trim() : "";
            const label = typeof item?.label === "string" && item.label.trim() ? item.label.trim() : "저장소";
            const username = typeof item?.username === "string" ? item.username.trim() : "";
            const defaultBranch = typeof item?.defaultBranch === "string" ? item.defaultBranch.trim() : "";
            const rawPath = typeof item?.path === "string" ? item.path.trim() : "";
            const url = typeof item?.url === "string" && item.url.trim() ? item.url.trim() : "";
            if (!rawPath) continue;
            let repoPath = rawPath;
            try {
              repoPath = await this.git.validateRepository(rawPath);
            } catch (validationError) {
              const message = validationError instanceof Error ? validationError.message : String(validationError);
              this.lastRepositoriesWarning =
                (this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : "") +
                "저장소 검증 지연: " + message;
            }
            validated.push({
              project,
              label,
              username,
              defaultBranch,
              path: repoPath,
              url,
              branches: Array.isArray(item?.branches) ? item.branches.filter((b): b is string => typeof b === "string") : [],
              discordMinCommits:
                typeof item?.discordMinCommits === "number" && Number.isInteger(item.discordMinCommits) && item.discordMinCommits >= 0
                  ? item.discordMinCommits
                  : 0,
              discordBranches: Array.isArray(item?.discordBranches)
                ? item.discordBranches.filter((b): b is string => typeof b === "string")
                : [],
              notionDatabaseId:
                typeof item?.notionDatabaseId === "string"
                  ? (await this.normalizeNotionDatabaseId(item.notionDatabaseId))
                  : "",
              notionToken: typeof item?.notionToken === "string" ? item.notionToken.trim() : "",
              discordChannelId: typeof item?.discordChannelId === "string" ? item.discordChannelId.trim() : "",
            });
          }
          if (validated.length === 0 && !explicitRepositoryClear) {
            // 빈 배열("[]")은 여러 저장 경로(자동저장·Notion·Discord)에서 기존 목록을
            // 의도치 않게 덮어쓰는 원인이 되므로, 명시적 삭제가 아닌 경우 기존 저장소를 유지합니다.
            const existing = current.get("HUB_GIT_REPOSITORIES")?.trim();
            if (existing) {
              delete updates.HUB_GIT_REPOSITORIES;
            } else {
              updates.HUB_GIT_REPOSITORIES = "[]";
            }
          } else {
            updates.HUB_GIT_REPOSITORIES = JSON.stringify(validated);
          }
        } catch (error) {
          // 손상된 저장소 JSON은 다른 설정 저장을 막지 않도록 이전 값을 유지합니다.
          delete updates.HUB_GIT_REPOSITORIES;
          this.lastRepositoriesWarning =
            "저장소 목록 JSON이 손상되어 변경사항을 건너뛰고 이전 값을 유지했습니다: " +
            (error instanceof Error ? error.message : String(error));
        }
      } else {
        if (explicitRepositoryClear) {
          updates.HUB_GIT_REPOSITORIES = "";
        } else {
          // 저장소 목록을 비우지 않고 기존 값을 유지합니다 (정책: Git 탭에서만 삭제 가능).
          delete updates.HUB_GIT_REPOSITORIES;
          const currentRepos = current.get("HUB_GIT_REPOSITORIES")?.trim();
          if (currentRepos) {
            this.lastRepositoriesWarning =
              "저장소 목록은 Git 저장소 탭에서만 삭제할 수 있습니다. 기존 저장소를 유지합니다.";
          }
        }
      }
    }
    const next = await writeEnvFile(this.config.envFile, updates);
    const restartKeys = ["HUB_HTTP_PORT", "HUB_TCP_PORT", "HUB_COMMAND_TIMEOUT_MS", "HUB_MAX_FRAME_BYTES", "HUB_API_TOKEN"];
    const restartRequired = restartKeys.some((key) => (current.get(key) ?? "") !== (next.get(key) ?? ""));

    this.config.repositories = parseRepositoriesForConfig(next.get("HUB_GIT_REPOSITORIES"));
    // 관리자가 Git 저장소 탭에서 저장소를 등록·저장하면 Config 저장소의 projects.json에도 병합·푸시합니다.
    // 일반 사용자는 저장소를 관리할 수 없으므로 동기화하지 않습니다.
    if (this.role === "admin" && this.config.configRepo && this.github.enabled) {
      try {
        await this.syncProjectsToConfig(this.config.repositories);
      } catch (error) {
        this.lastRepositoriesWarning =
          (this.lastRepositoriesWarning ? this.lastRepositoriesWarning + " / " : "") +
          "Config projects.json 동기화 실패: " + (error instanceof Error ? error.message : String(error));
      }
    }
    this.config.dailyAutomation = {
      enabled: this.role === "admin" && parseBoolean(next.get("HUB_DAILY_AUTOMATION_ENABLED")),
      projects: this.role === "admin"
        ? [...new Set((next.get("HUB_DAILY_AUTOMATION_PROJECTS") ?? "").split(",").map((value) => value.trim()).filter(Boolean))]
        : [],
    };
    this.config.discord = {
      token: next.get("DISCORD_BOT_TOKEN") || undefined,
      channelId: next.get("DISCORD_CHANNEL_ID") || undefined,
    };
    this.config.notion = {
      enabled: this.config.repositories.some(
        (repo) => Boolean(repo.notionToken?.trim()) && Boolean((repo.notionDatabaseId ?? "").trim()),
      ),
    };
    // 관리자가 Git 저장소 탭에서 저장소를 저장하면 Config projects.json에 push하기 위해
    // owner/repo를 유지합니다. owner/repo는 최초 loadConfig 시 HUB_CONFIG_REPO(또는
    // HUB_PROJECTS_URL)에서 유도되어 이.config.github에 담깁니다.
    this.config.github = {
      token: next.get("GITHUB_TOKEN") || undefined,
      ...(this.config.github?.owner && this.config.github?.repo
        ? { owner: this.config.github.owner, repo: this.config.github.repo }
        : {}),
    };

    this.config.gemini = {
      apiKey: next.get("GEMINI_API_KEY") || undefined,
      model: (next.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite").trim() || "gemini-3.5-flash-lite",
    };
    this.github.configure(this.config.github);
    this.git.setToken(this.config.github.token);
    this.config.sshKeyPath = (next.get("GIT_SSH_KEY_PATH") ?? "").trim();
    this.git.setSshKey(this.config.sshKeyPath);
    this.gemini.configure(this.config.gemini);
    this.dailyAutomation.reconfigure();
    let discordConfigureError: Error | null = null;
    try {
      await this.discord.configure(this.config.discord);
    } catch (error) {
      discordConfigureError = error instanceof Error ? error : new Error(String(error));
    }
    this.emitState();

    const statuses = await this.testIntegrations();
    if (discordConfigureError) {
      const index = statuses.findIndex((status) => status.integration === "discord");
      const status: IntegrationConnectionStatus = {
        integration: "discord",
        state: "error",
        message: discordConfigureError.message,
        checkedAt: new Date().toISOString(),
      };
      if (index >= 0) statuses[index] = status;
      else statuses.push(status);
    }
    return {
      settings: await this.getSettings(),
      statuses,
      restartRequired,
      message: this.lastRepositoriesWarning
        ? this.lastRepositoriesWarning
        : restartRequired
          ? "설정이 저장되었습니다. 포트·타임아웃·프레임 크기·API 토큰 변경은 앱 재시작이 필요합니다."
          : "설정이 저장되었고 통합 연결이 새로고침되었습니다.",
    };
  }

  public async testIntegrations(): Promise<IntegrationConnectionStatus[]> {
    const notionRepo = this.config.repositories.find((r) => r.notionToken?.trim() && r.notionDatabaseId?.trim());
    return Promise.all([
      this.testIntegration("discord", this.discord.enabled, () => this.discord.testConnection()),
      this.testIntegration("notion", Boolean(notionRepo), async () => {
        if (!notionRepo?.notionToken?.trim() || !notionRepo.notionDatabaseId?.trim()) {
          throw new Error("Notion integration token 또는 database ID가 설정된 저장소가 없습니다.");
        }
        const adapter = NotionAdapter.forToken(notionRepo.notionToken);
        return adapter.testConnection(notionRepo.notionDatabaseId);
      }),
      this.testIntegration("github", this.github.enabled, () => this.github.testConnection()),
    ]);
  }

  private async testIntegration(
    integration: IntegrationConnectionStatus["integration"],
    enabled: boolean,
    test: () => Promise<string>,
  ): Promise<IntegrationConnectionStatus> {
    const checkedAt = new Date().toISOString();
    if (!enabled) return { integration, state: "not-configured", message: "토큰이 설정되지 않았습니다.", checkedAt };
    try {
      return { integration, state: "connected", message: await test(), checkedAt };
    } catch (error) {
      return {
        integration,
        state: "error",
        message: error instanceof Error ? error.message : String(error),
        checkedAt,
      };
    }
  }

  private emitState(): void {
    this.emit("stateChanged", this.getState());
  }

  /** 로컬 저장소 목록을 Config 저장소의 projects.json에 병합한 뒤 GitHub로 푸시합니다. */
  private async syncProjectsToConfig(
    repositories: Array<{
      project?: string; label: string; username?: string; defaultBranch?: string; path: string; url: string;
      branches: string[]; discordMinCommits?: number; discordBranches?: string[];
      notionDatabaseId?: string; discordChannelId?: string;
    }>,
  ): Promise<void> {
    const existingText = await this.github.readFile("projects.json", "main");
    const current = existingText ? parseProjectsFile(existingText) : this.projects;
    // 중앙 projects.json 을 확인하지 못했고 로컬 캐시마저 비어 있다면,
    // 로컬 저장소 목록만으로 중앙 정의를 덮어써 다른 컴퓨터에서 프로젝트가
    // 사라지는 일이 없도록 이번 동기화를 건너뜁니다.
    if (!existingText && current.length === 0) {
      throw new Error("중앙 projects.json 을 읽지 못해 동기화를 건너뛰었습니다. 기존 정의를 보존합니다.");
    }
    const merged = upsertProjectsFromRepositories(current, repositories);
    this.projects = merged;
    await this.github.writeFile(
      "projects.json",
      serializeProjectsFile(merged),
      "main",
      "chore: sync repositories into projects.json",
    );
    await this.refreshProjectsCache();
  }

  private async refreshProjectsCache(): Promise<void> {
    try {
      this.projectsCacheFile = this.projectsCacheFile || (await ensureProjectsCacheDir(this.config.dataDirectory));
      const { writeFile } = await import("node:fs/promises");
      await writeFile(this.projectsCacheFile, JSON.stringify({ fetchedAt: new Date().toISOString(), projects: this.projects }, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch {
      /* cache write is best-effort */
    }
  }
}

function parseBoolean(value?: string): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

function parseRepositoriesForConfig(raw?: string): Array<{
  label: string; username: string; defaultBranch: string; path: string; url: string;
  branches: string[]; discordMinCommits: number; discordBranches: string[];
  project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
}> {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<{
      label: string; username: string; defaultBranch: string; path: string; url: string;
      branches: string[]; discordMinCommits: number; discordBranches: string[];
      project: string; notionDatabaseId: string; notionToken: string; discordChannelId: string;
    }>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is typeof item & { path: string } =>
        Boolean(item && typeof item === "object" && typeof item.path === "string" && item.path.trim()))
      .map((item) => ({
        label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : "저장소",
        username: typeof item.username === "string" ? item.username.trim() : "",
        defaultBranch: typeof item.defaultBranch === "string" ? item.defaultBranch.trim() : "",
        path: item.path.trim(),
        url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : "",
        branches: Array.isArray(item.branches) ? item.branches.filter((b): b is string => typeof b === "string") : [],
        discordMinCommits:
          typeof item.discordMinCommits === "number" && Number.isInteger(item.discordMinCommits) && item.discordMinCommits >= 0
            ? item.discordMinCommits
            : 0,
        discordBranches: Array.isArray(item.discordBranches)
          ? item.discordBranches.filter((b): b is string => typeof b === "string")
          : [],
        project: typeof item.project === "string" ? item.project.trim() : "",
        notionDatabaseId: typeof item.notionDatabaseId === "string" ? item.notionDatabaseId.trim() : "",
        notionToken: typeof item.notionToken === "string" ? item.notionToken.trim() : "",
        discordChannelId: typeof item.discordChannelId === "string" ? item.discordChannelId.trim() : "",
      }));
  } catch {
    return [];
  }
}
