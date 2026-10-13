import { EventEmitter } from "node:events";
import path from "node:path";
import type {
  CredentialBundle,
  DailyAutomationRunView,
  DailyAutomationView,
  DashboardState,
  GitChangeSummary,
  GitCloneResult,
  GitConnectOrCloneResult,
  GitConnectResult,
  GitPullResult,
  GitStatusView,
  IntegrationConnectionStatus,
  KanbanBoard,
  KanbanMoveInput,
  LicenseRole,
  ManualDailyReportInput,
  ManualDailyReportResult,
  ProjectDefinition,
  ProjectView,
  RepositoryConnectionCheck,
  SettingsSaveResult,
  SettingsView,
} from "../shared/ipc";
import type { HubConfig } from "./config";
import { toPublicConfig } from "./config";
import { DailyAutomation } from "./automation/daily-schedule";
import { GitService } from "./git/git-service";
import { RepositoryWatcher } from "./git/repository-watcher";
import { GitSelectionStore, type GitSelectionState } from "./git-selection-store";
import { DiscordAdapter } from "./integrations/discord-adapter";
import { GeminiAdapter } from "./integrations/gemini-adapter";
import { GitHubAdapter } from "./integrations/github-adapter";
import { NotionAdapter } from "./integrations/notion-adapter";
import { ensureProjectsCacheDir } from "./projects-store";
import { CredentialManager } from "./runtime/credential-manager";
import { GitBranchState } from "./runtime/git-state";
import { GitWorkflow } from "./runtime/git-workflow";
import { Integrations } from "./runtime/integrations";
import { ProjectAccess, type ProjectRegistry } from "./runtime/project-access";
import type { RuntimeContext } from "./runtime/runtime-context";
import { SettingsService } from "./runtime/settings-service";
import { KanbanService } from "./runtime/kanban-service";

/**
 * 앱의 런타임 파사드입니다.
 *
 * 실제 기능은 src/main/runtime/* 모듈로 분리되어 있고, HubRuntime은 IPC/HTTP가
 * 사용하는 공개 API를 유지하며 각 모듈을 조합하고 생명주기(start/stop)만 관리합니다.
 */
export class HubRuntime extends EventEmitter {
  private readonly startedAt = new Date().toISOString();
  private readonly context: RuntimeContext;
  private projects: ProjectDefinition[] = [];
  private projectsCacheFile = "";
  private readonly registry: ProjectRegistry;
  private readonly gitSelectionStore: GitSelectionStore;
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

  public readonly git = new GitService();
  private readonly branchState = new GitBranchState();
  private readonly credentials: CredentialManager;
  private readonly watcher: RepositoryWatcher;
  private readonly access: ProjectAccess;
  private readonly workflow: GitWorkflow;
  private readonly integrations: Integrations;
  private readonly settingsService: SettingsService;
  private readonly kanban: KanbanService;

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
    this.context = { role, keyId };

    this.gitSelectionStore = new GitSelectionStore(
      config.selectionFile ?? path.join(config.dataDirectory, "git-selection.json"),
    );
    // 비공개 저장소 clone/fetch/push/ls-remote에 GitHub 토큰을 사용합니다.
    this.git.setToken(config.github.token);
    // SSH 배포 키가 지정되면 토큰 없이도(계정 로그인 없이) 저장소에 접속합니다.
    this.git.setSshKey(config.sshKeyPath);

    this.discord = new DiscordAdapter(config.discord);
    // 앱 공용 Notion 토큰(NOTION_TOKEN). 저장소별 토큰은 일일보고에서 별도로 사용합니다.
    this.notion = new NotionAdapter({ token: config.notion.token, databaseId: config.kanbanDatabaseId });
    this.github = new GitHubAdapter(config.github);
    this.gemini = new GeminiAdapter(config.gemini);
    this.dailyAutomation = new DailyAutomation({
      config,
      git: this.git,
      notion: this.notion,
      discord: this.discord,
      gemini: this.gemini,
      allBranches: role === "admin",
      onChanged: () => this.emitState(),
    });

    this.credentials = new CredentialManager({
      config,
      git: this.git,
      github: this.github,
      licenseKey,
    });
    this.watcher = new RepositoryWatcher({
      onChange: (repository) => this.emit("repositoryChanged", repository),
    });
    this.registry = {
      get: () => this.projects,
      set: (projects) => { this.projects = projects; },
      getCacheFile: () => this.projectsCacheFile,
      setCacheFile: (file) => { this.projectsCacheFile = file; },
    };
    this.access = new ProjectAccess({
      config,
      git: this.git,
      github: this.github,
      credentials: this.credentials,
      branchState: this.branchState,
      registry: this.registry,
      context: this.context,
    });
    this.workflow = new GitWorkflow({
      git: this.git,
      credentials: this.credentials,
      access: this.access,
      branchState: this.branchState,
      onChanged: () => this.emitState(),
    });
    this.integrations = new Integrations({
      discord: this.discord,
      notion: this.notion,
      github: this.github,
      gemini: this.gemini,
      getRepositories: () => this.config.repositories,
    });
    this.settingsService = new SettingsService({
      config,
      git: this.git,
      github: this.github,
      notion: this.notion,
      gemini: this.gemini,
      discord: this.discord,
      dailyAutomation: this.dailyAutomation,
      integrations: this.integrations,
      registry: this.registry,
      context: this.context,
      onChanged: () => this.emitState(),
    });
    this.kanban = new KanbanService(
      () => this.notion.rawClient(),
      config.kanbanDatabaseId,
      config.kanbanGroupProperty,
    );
    this.kanban.on("changed", (board: KanbanBoard) => this.emit("kanbanChanged", board));
    this.kanban.on("error", (message: string) => this.emit("kanbanError", message));
  }

  public async start(): Promise<void> {
    this.gitSelectionState = await this.gitSelectionStore.load();
    this.projectsCacheFile = await ensureProjectsCacheDir(this.config.dataDirectory);
    // 1) 라이선스 자격증명을 먼저 받아 둡니다. 그래야 config가 비공개여도 읽을 수 있습니다.
    const bundle = (await this.credentialLoader?.()) ?? null;
    for (const warning of await this.credentials.install(bundle)) {
      this.settingsService.addWarning(warning);
    }
    // 프로젝트 정의를 로드해 캐시에 채웁니다(일반 사용자 브랜치 배정 판정에도 필요).
    await this.access.getProjects();
    if (this.discord.enabled) await this.discord.start();
    // 칸반보드는 관리자·일반 모두 조회 가능(노션이 권한을 관리).
    this.kanban.start();
    // 매일 오전 08:00 자동 일일작업 등록은 관리자 라이선스 전용 기능입니다.
    if (this.role === "admin") await this.dailyAutomation.start();
    else await this.dailyAutomation.stop();
  }

  public async stop(): Promise<void> {
    this.kanban.stop();
    await this.dailyAutomation.stop();
    this.watcher.closeAll();
    await Promise.allSettled([this.discord.stop()]);
  }

  /** 라이선스 저장소에서 암호화 Git 자격증명을 가져오는 로더를 주입합니다. */
  private credentialLoader: (() => Promise<CredentialBundle | null>) | null = null;

  public setCredentialLoader(loader: () => Promise<CredentialBundle | null>): void {
    this.credentialLoader = loader;
  }

  public setRole(role: LicenseRole): void {
    if (this.role === role) return;
    this.role = role;
    this.context.role = role;
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

  public inspectGit(repository?: string): Promise<GitStatusView> {
    return this.workflow.inspect(repository);
  }

  public watchRepository(repository: string): void {
    this.watcher.watch(repository);
  }

  public unwatchRepository(repository: string): void {
    this.watcher.unwatch(repository);
  }

  public listGitBranches(repository?: string): Promise<string[]> {
    return this.access.listGitBranches(repository);
  }

  public getProjects(): Promise<ProjectView[]> {
    return this.access.getProjects();
  }

  public cloneGitRepository(args: { url: string; directory: string }): Promise<GitCloneResult> {
    return this.workflow.clone(args);
  }

  public connectGitRepository(args: { directory: string }): Promise<GitConnectResult> {
    return this.workflow.connect(args);
  }

  public connectOrCloneGitRepository(args: { url: string; directory: string }): Promise<GitConnectOrCloneResult> {
    return this.workflow.connectOrClone(args);
  }

  public switchGitBranch(repository: string | undefined, branch: string): Promise<GitStatusView> {
    return this.workflow.switchBranch(repository, branch);
  }

  public gitCreateBranch(repository: string | undefined, branch: string, startPoint?: string): Promise<GitStatusView> {
    return this.workflow.createBranch(repository, branch, startPoint);
  }

  public gitStage(repository: string | undefined, paths: string[]): Promise<GitStatusView> {
    return this.workflow.stage(repository, paths);
  }

  public gitDiscardChanges(repository: string | undefined, includeUntracked = false): Promise<GitStatusView> {
    return this.workflow.discardChanges(repository, includeUntracked);
  }

  public gitDiscardPreview(repository: string | undefined): Promise<{ changedFiles: number; untrackedFiles: string[] }> {
    return this.workflow.discardPreview(repository);
  }

  public gitCommitWithSummary(repository?: string): Promise<GitChangeSummary> {
    return this.workflow.commitWithSummary(repository);
  }

  public gitPushCreatedCommit(repository?: string): Promise<GitStatusView> {
    return this.workflow.pushCreatedCommit(repository);
  }

  public gitPushBranch(repository: string | undefined, branch: string, remote = "origin"): Promise<GitStatusView> {
    return this.workflow.pushBranch(repository, branch, remote);
  }

  public gitPull(repository: string | undefined, branch: string, remote = "origin"): Promise<GitPullResult> {
    return this.workflow.pull(repository, branch, remote);
  }

  public getSettings(): Promise<SettingsView> {
    return this.settingsService.getSettings();
  }

  public saveSettings(input: Record<string, string>): Promise<SettingsSaveResult> {
    return this.settingsService.saveSettings(input);
  }

  public async getGitSelection(): Promise<GitSelectionState> {
    this.gitSelectionState = await this.gitSelectionStore.load();
    return this.gitSelectionState;
  }

  public async saveGitSelection(state: GitSelectionState): Promise<GitSelectionState> {
    this.gitSelectionState = await this.gitSelectionStore.save(state);
    return this.gitSelectionState;
  }

  public testNotionDatabase(args: { repository?: string; databaseId: string; token?: string }): Promise<{ ok: boolean; message: string }> {
    return this.integrations.testNotionDatabase(args);
  }

  public testDiscordChannel(args: { repository?: string; channelId: string }): Promise<{ ok: boolean; message: string }> {
    return this.integrations.testDiscordChannel(args);
  }

  public checkRepositoryConnections(): Promise<RepositoryConnectionCheck[]> {
    return this.integrations.checkRepositoryConnections();
  }

  public testIntegrations(): Promise<IntegrationConnectionStatus[]> {
    return this.integrations.testIntegrations();
  }

  // ----- 칸반보드 (Notion 동기화) -----

  public getKanbanBoard(): Promise<KanbanBoard> {
    return this.kanban.getBoard();
  }

  public moveKanbanCard(input: KanbanMoveInput): Promise<KanbanBoard> {
    return this.kanban.move(input);
  }

  public createKanbanCard(input: { title: string; columnId?: string }): Promise<KanbanBoard> {
    return this.kanban.create(input);
  }

  public deleteKanbanCard(cardId: string): Promise<KanbanBoard> {
    return this.kanban.remove(cardId);
  }

  private emitState(): void {
    this.emit("stateChanged", this.getState());
  }
}

