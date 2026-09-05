import { Octokit } from "@octokit/rest";

export class GitHubAdapter {
  private client: Octokit | null;

  public constructor(private config: { token?: string; owner?: string; repo?: string }) {
    this.client = config.token ? new Octokit({ auth: config.token }) : null;
  }

  public get enabled(): boolean {
    return this.client !== null;
  }

  public configure(config: { token?: string; owner?: string; repo?: string }): void {
    this.config = config;
    this.client = config.token ? new Octokit({ auth: config.token }) : null;
  }

  public async testConnection(): Promise<string> {
    if (!this.client) throw new Error("GitHub token is not configured");
    if (this.config.owner && this.config.repo) {
      const response = await this.client.repos.get({ owner: this.config.owner, repo: this.config.repo });
      return `${response.data.full_name} (${response.data.private ? "private" : "public"})`;
    }
    const response = await this.client.users.getAuthenticated();
    return `GitHub user: ${response.data.login}`;
  }

  public async createIssue(input: { title: string; body?: string; labels?: string[] }): Promise<{ number: number; url: string }> {
    const repository = this.repository();
    const response = await this.client!.issues.create({ ...repository, ...input });
    return { number: response.data.number, url: response.data.html_url };
  }

  public async createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
  }): Promise<{ number: number; url: string }> {
    const repository = this.repository();
    const response = await this.client!.pulls.create({ ...repository, ...input });
    return { number: response.data.number, url: response.data.html_url };
  }

  public async dispatchWorkflow(input: { workflowId: string; ref: string; inputs?: Record<string, string> }): Promise<void> {
    const repository = this.repository();
    await this.client!.actions.createWorkflowDispatch({
      ...repository,
      workflow_id: input.workflowId,
      ref: input.ref,
      inputs: input.inputs,
    });
  }

  /** Config 저장소의 파일 내용을 읽습니다 (없으면 null). */
  public async readFile(filePath: string, branch = "main"): Promise<string | null> {
    if (!this.client) throw new Error("GitHub token is not configured");
    const repository = this.repository();
    try {
      const response = await this.client.repos.getContent({
        ...repository,
        path: filePath,
        ref: branch,
      });
      const data = response.data as { type?: string; content?: string; sha?: string };
      if (data.type === "file" && typeof data.content === "string") {
        return Buffer.from(data.content, "base64").toString("utf8");
      }
      return null;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 404) return null;
      throw error;
    }
  }

  /** Config 저장소의 파일을 커밋·푸시하거나 새로 생성합니다. */
  public async writeFile(filePath: string, content: string, branch = "main", message = "chore: update " + filePath): Promise<void> {
    if (!this.client) throw new Error("GitHub token is not configured");
    const repository = this.repository();
    let sha: string | undefined;
    try {
      const existing = await this.client.repos.getContent({
        ...repository,
        path: filePath,
        ref: branch,
      });
      const data = existing.data as { type?: string; sha?: string };
      if (data.type === "file" && typeof data.sha === "string") sha = data.sha;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status !== 404) throw error;
    }
    const params: Record<string, string> = {
      ...repository,
      path: filePath,
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
    };
    if (sha) params.sha = sha;
    await this.client.repos.createOrUpdateFileContents(params as Parameters<typeof this.client.repos.createOrUpdateFileContents>[0]);
  }

  private repository(): { owner: string; repo: string } {
    if (!this.client || !this.config.owner || !this.config.repo) {
      throw new Error("GitHub 저장소(owner/repo)가 설정되지 않았습니다.");
    }
    return { owner: this.config.owner, repo: this.config.repo };
  }
}
