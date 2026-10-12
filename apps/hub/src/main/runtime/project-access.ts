import type { ProjectDefinition, ProjectView } from "../../shared/ipc";
import { isProtectedBranch } from "../../shared/branch-policy";
import type { HubConfig } from "../config";
import type { GitService } from "../git/git-service";
import type { GitHubAdapter } from "../integrations/github-adapter";
import {
  allowedBranchesOf,
  buildProjectViews,
  defaultFetchText,
  ensureProjectsCacheDir,
  hasUserBranchAssignment,
  loadProjects,
  sameIdentity,
  userBranchesOf,
} from "../projects-store";
import type { GitBranchState } from "./git-state";
import type { CredentialManager } from "./credential-manager";
import type { RuntimeContext } from "./runtime-context";

/**
 * 로드된 프로젝트 정의를 읽고 쓰는 저장소입니다.
 *
 * HubRuntime이 자신의 private 상태로 구현하며, ProjectAccess는 이 인터페이스를
 * 통해서만 프로젝트 목록에 접근합니다(캡슐화 유지).
 */
export interface ProjectRegistry {
  get(): ProjectDefinition[];
  set(projects: ProjectDefinition[]): void;
  getCacheFile(): string;
  setCacheFile(file: string): void;
}

export interface ProjectAccessDeps {
  config: HubConfig;
  git: GitService;
  github: GitHubAdapter;
  credentials: CredentialManager;
  branchState: GitBranchState;
  registry: ProjectRegistry;
  context: RuntimeContext;
}

/**
 * 프로젝트(브랜치) 접근 정책과 조회를 담당합니다.
 *
 * 일반 사용자는 라이선스에 배정된 프로젝트/브랜치만 보고 작업할 수 있고,
 * 관리자는 모든 프로젝트/브랜치를 사용할 수 있습니다.
 */
export class ProjectAccess {
  public constructor(private readonly deps: ProjectAccessDeps) {}

  /** 설정된 Git 저장소가 없을 때의 안내 문구를 담은 오류를 만듭니다. */
  public resolveRepository(repository?: string): string {
    if (repository) {
      const byPath = this.deps.config.repositories.find((item) => item.path === repository);
      const byLabel = this.deps.config.repositories.find((item) => item.label === repository);
      const target = byPath?.path ?? byLabel?.path ?? repository;
      if (target.trim()) return target.trim();
    }
    const first = this.deps.config.repositories.find((item) => item.path.trim().length > 0);
    if (!first) throw new Error("설정된 Git 저장소가 없습니다. 설정 탭에서 저장소를 추가하세요.");
    return first.path;
  }

  /**
   * 브랜치 목록을 반환합니다.
   *
   * 일반 사용자는 Config(라이선스)에 배정된 브랜치만 볼 수 있습니다. 배정이 없거나
   * 연결 폴더가 다른 저장소면 빈 목록을 돌려주어 로컬 폴더의 다른 브랜치(main 등)가
   * 노출되지 않게 합니다.
   */
  public async listGitBranches(repository?: string): Promise<string[]> {
    const { git, registry, context, credentials } = this.deps;
    const target = this.resolveRepository(repository);
    let local: string[] = [];
    try { local = await git.listBranches(target); } catch { local = []; }
    const repo = this.deps.config.repositories.find((item) => item.path === target || item.label === target);
    let project = repo ? registry.get().find((item) => item.id === repo.project) : undefined;
    if (!project && repo?.url) {
      project = registry.get().find((item) => sameIdentity(item.url, repo.url)) ?? undefined;
    }
    if (!repo || !project) {
      try {
        const identity = await git.getRepositoryIdentity(target);
        project = registry.get().find((item) => sameIdentity(item.url, identity.originUrl)) ?? undefined;
      } catch {}
    }
    const isNormal = context.role !== "admin";
    if (isNormal && !hasUserBranchAssignment(project, context.keyId)) return [];
    const restricted = isNormal ? userBranchesOf(project, context.keyId) : allowedBranchesOf(project);
    if (restricted.length === 0) return local;
    let source: string[] = local;
    const projectUrl = project?.url || repo?.url || "";
    if (projectUrl) {
      try {
        git.setSshKey(credentials.sshKeyForUrl(projectUrl));
        source = [...new Set([...local, ...(await git.listRemoteBranches(projectUrl))])];
      } catch {
        /* 원격 조회 실패 시 로컬 브랜치만 사용 */
      }
    }
    const limited = source.filter((branch) => restricted.includes(branch));
    return [...limited.filter((branch) => local.includes(branch)), ...limited.filter((branch) => !local.includes(branch))];
  }

  /** Config/KJ_FlowForge_Config의 projects.json에 정의된 프로젝트 목록(화면용)을 반환합니다. */
  public async getProjects(): Promise<ProjectView[]> {
    const { config, registry, credentials, github, git, context } = this.deps;
    if (!registry.getCacheFile()) {
      registry.setCacheFile(await ensureProjectsCacheDir(config.dataDirectory));
    }
    const loaded = await loadProjects(config.projectsUrl, registry.getCacheFile(), async () => {
      try {
        return await defaultFetchText(config.projectsUrl);
      } catch {
        if (credentials.canReadConfigRepo()) {
          const raw = await github.readFile("projects.json", "main");
          if (raw === null) throw new Error("projects.json not found in config repo");
          return raw;
        }
        throw new Error("config 저장소에 접근할 수 없습니다. 라이선스를 확인하거나 Git 접속 설정을 확인하세요.");
      }
    });
    registry.set(loaded.projects);
    const views = await buildProjectViews(
      registry.get(),
      config.repositories,
      (url) => git.listRemoteBranches(url),
      context.role === "admin" ? "" : context.keyId,
    );
    if (context.role !== "admin") {
      return views.filter((view) => {
        const project = registry.get().find((item) => item.id === view.id);
        const restricted = userBranchesOf(project, context.keyId);
        if (!hasUserBranchAssignment(project, context.keyId)) return false;
        view.selectableBranches = view.selectableBranches.filter((branch) => restricted.includes(branch));
        view.branchRestricted = true;
        view.allowedBranches = restricted;
        return true;
      });
    }
    return views;
  }

  /** 일반 사용자가 공용 브랜치에서 커밋/푸시하지 못하도록 막습니다. */
  public assertPersonalBranch(target: string): void {
    if (this.deps.context.role === "admin") return;
    const repository = this.deps.config.repositories.find((item) => item.path === target);
    const current = this.deps.branchState.currentBranch.get(target) ?? "";
    if (isProtectedBranch(current, repository?.defaultBranch)) {
      throw new Error(
        "일반 사용자는 개인 작업 브랜치에서만 커밋/푸시할 수 있습니다. 현재 브랜치('" +
          (current || "알 수 없음") +
          "')에서는 관리자 라이선스가 필요합니다.",
      );
    }
  }

  /** 일반 사용자가 이 브랜치에 접근할 권한이 있는지 확인합니다. */
  public async assertUserProjectAccess(target: string, branch: string, allowNewBranch = false): Promise<void> {
    const { config, git, registry, context } = this.deps;
    if (context.role === "admin") return;
    const repository = config.repositories.find((item) => item.path === target);
    let project = repository ? registry.get().find((item) => item.id === repository.project) : undefined;
    if (!project) {
      try {
        const identity = await git.getRepositoryIdentity(target);
        project = registry.get().find((item) => sameIdentity(item.url, identity.originUrl));
      } catch {}
    }
    if (!hasUserBranchAssignment(project, context.keyId)) {
      throw new Error("이 라이선스에 허용된 프로젝트 또는 브랜치가 없습니다.");
    }
    if (!allowNewBranch && !userBranchesOf(project, context.keyId).includes(branch)) {
      throw new Error("이 라이선스에 허용되지 않은 브랜치입니다.");
    }
  }
}

