from pathlib import Path
p = Path(r'W:\WorkSpace\KJ_FlowForge\apps\hub\src\main\hub-runtime.ts')
text = p.read_text(encoding='utf-8')
old = '''  public async gitCommit(repository: string | undefined, message: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.git.commit(target, message);
    this.emitState();
    return this.git.inspect(target);
  }

  public async gitPush(repository: string | undefined, remote?: string, branch?: string): Promise<GitStatusView> {
    const target = this.resolveRepository(repository);
    await this.git.push(target, remote, branch);
    this.emitState();
    return this.git.inspect(target);
  }

  private resolveRepository(repository?: string): string {
    const firstName = this.config.repositories.find((item) => item.path.trim().length > 0);
    const target = repository || firstName?.path;
    if (!target) throw new Error("No Git repository is configured or selected");
    return target;
  }

 public async gitCommitWithSummary(repository?: string): Promise<GitChangeSummary> {'''
new = '''  public async gitCommitWithSummary(repository?: string): Promise<GitChangeSummary> {'''
if old not in text:
    print('OLD not found')
else:
    text = text.replace(old, new)
    p.write_text(text, encoding='utf-8')
    print('fixed')
