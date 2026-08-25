import { Client } from "@notionhq/client";

const TEXT_LIMIT = 2_000; // Notion rich text content length limit
const MAX_PAGE_CHILDREN = 100;

export interface DailyWorkReportBranch {
  repositoryLabel?: string;
  branch: string;
  author: string;
  occurredAt: string;
  content: string;
  commits: Array<{ hash: string; author: string; occurredAt: string; subject: string; body?: string }>;
}

export class NotionAdapter {
  private client: Client | null;
  private titlePropertyName: string | null | undefined = undefined;

  public constructor(private config: { token?: string; databaseId?: string }) {
    this.client = config.token ? new Client({ auth: config.token }) : null;
  }

  public get enabled(): boolean {
    return this.client !== null;
  }

  public configure(config: { token?: string; databaseId?: string }): void {
    this.config = config;
    this.client = config.token ? new Client({ auth: config.token }) : null;
    this.titlePropertyName = undefined;
  }

  private async resolveTitlePropertyName(): Promise<string> {
    if (this.titlePropertyName === undefined) {
      if (!this.client || !this.config.databaseId) throw new Error("Notion integration or database is not configured");
      const database = await this.client.databases.retrieve({ database_id: this.config.databaseId });
      const entry = Object.entries(database.properties).find(([, property]) => property.type === "title");
      this.titlePropertyName = entry ? entry[0] : null;
    }
    if (!this.titlePropertyName) throw new Error("Notion database has no title property to create a task");
    return this.titlePropertyName;
  }

  public async testConnection(): Promise<string> {
    if (!this.client || !this.config.databaseId) throw new Error("Notion integration or database is not configured");
    const database = await this.client.databases.retrieve({ database_id: this.config.databaseId });
    return `Database ${database.id}`;
  }

  public async createTask(input: {
    title: string;
    status?: string;
    description?: string;
    externalId?: string;
  }): Promise<string> {
    if (!this.client || !this.config.databaseId) throw new Error("Notion integration or database is not configured");
    const titlePropertyName = await this.resolveTitlePropertyName();
    const response = await this.client.pages.create({
      parent: { database_id: this.config.databaseId },
      properties: {
        [titlePropertyName]: { title: [{ text: { content: input.title } }] },
      },
      children: input.description
        ? [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: input.description } }] } }]
        : undefined,
    });
    return response.id;
  }

  public async appendReport(pageId: string, heading: string, content: string): Promise<void> {
    if (!this.client) throw new Error("Notion integration is not configured");
    await this.client.blocks.children.append({
      block_id: pageId,
      children: [
        { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: heading } }] } },
        {
          object: "block",
          type: "code",
          code: { language: "plain text", rich_text: [{ type: "text", text: { content: content.slice(0, 1_900) } }] },
        },
      ],
    });
  }

  public async createChangeReport(input: {
    branch: string;
    author: string;
    occurredAt: string;
    content: string;
    reportKey?: string;
    commits: Array<{ hash: string; author: string; occurredAt: string; subject: string; body?: string }>;
  }): Promise<string> {
    if (!this.client || !this.config.databaseId) throw new Error("Notion integration or database is not configured");

    const titlePropertyName = await this.resolveTitlePropertyName();
    const database = await this.client.databases.retrieve({ database_id: this.config.databaseId });
    const schema = database.properties as Record<string, { type?: string }>;

    const reportSuffix = input.reportKey ? input.reportKey.split("|").at(-1)?.slice(0, 8) : undefined;
    const titleValue = `${input.branch && input.branch.trim() ? input.branch.trim() : "변경 보고"}${reportSuffix ? ` · ${reportSuffix}` : ""}`;
    if (input.reportKey) {
      const existing = await this.findExistingReport(titlePropertyName, titleValue);
      if (existing) return existing;
    }
    const properties: Record<string, unknown> = {
      [titlePropertyName]: {
        title: [{ type: "text", text: { content: titleValue.slice(0, TEXT_LIMIT) } }],
      },
    };

    const resolveProperty = (candidates: string[]): { id: string; type: string } | null => {
      for (const candidate of candidates) {
        const property = schema[candidate];
        if (property && (property.type === "rich_text" || property.type === "select" || property.type === "date")) {
          return { id: candidate, type: property.type };
        }
      }
      return null;
    };

    const setProperty = (property: { id: string; type: string } | null, value: string): void => {
      if (!property || !value || !value.trim()) return;
      if (property.type === "rich_text") {
        properties[property.id] = { rich_text: [{ type: "text", text: { content: limitText(value) } }] };
      } else if (property.type === "select") {
        properties[property.id] = { select: { name: value.trim().slice(0, 100) } };
      } else if (property.type === "date") {
        const iso = toIsoDate(value);
        if (iso) properties[property.id] = { date: { start: iso } };
      }
    };

    setProperty(resolveProperty(["브랜치", "Branch"]), input.branch);
    setProperty(resolveProperty(["담당자", "Author"]), input.author);
    setProperty(resolveProperty(["시간", "Time"]), input.occurredAt);
    setProperty(resolveProperty(["내용", "Content"]), input.content);
    setProperty(resolveProperty(["보고키", "Report Key", "ReportKey"]), input.reportKey ?? "");

    const blocks: unknown[] = [];
    blocks.push(paragraphBlock(`브랜치: ${input.branch}`));
    blocks.push(paragraphBlock(`담당자: ${input.author}`));
    blocks.push(paragraphBlock(`시간: ${input.occurredAt}`));
    if (input.content && input.content.trim()) {
      for (const part of chunkText(input.content)) blocks.push(paragraphBlock(part));
    }
    for (const commit of input.commits ?? []) {
      const lines = [
        `커밋: ${commit.hash}`,
        `담당자: ${commit.author}`,
        `시간: ${commit.occurredAt}`,
        `제목: ${commit.subject}`,
      ];
      if (commit.body && commit.body.trim()) lines.push(`내용:\n${commit.body}`);
      blocks.push(codeBlock(lines.join("\n")));
    }
    if (blocks.length > MAX_PAGE_CHILDREN) {
      blocks.splice(MAX_PAGE_CHILDREN - 1);
      blocks.push(paragraphBlock(`보고가 ${MAX_PAGE_CHILDREN}개 블록 제한을 초과해 일부 상세 내용이 생략되었습니다.`));
    }
    const page = await this.client.pages.create({
      parent: { database_id: this.config.databaseId },
      properties: properties as never,
      children: blocks as never,
    });
    return page.id;
  }

  public async createDailyWorkReport(input: {
    date: string;
    reportKey: string;
    branches: DailyWorkReportBranch[];
  }): Promise<string> {
    if (!this.client || !this.config.databaseId) throw new Error("Notion integration or database is not configured");

    const titlePropertyName = await this.resolveTitlePropertyName();
    const database = await this.client.databases.retrieve({ database_id: this.config.databaseId });
    const schema = database.properties as Record<string, { type?: string }>;
    const titleValue = `일일작업 · ${input.date}`;
    const existing = await this.findExistingDailyReport(titlePropertyName, schema, titleValue, input.reportKey);
    const pageId = existing ?? await this.createDailyReportPage(
      titlePropertyName,
      schema,
      titleValue,
      input.date,
      input.reportKey,
      input.branches,
    );

    const existingHashes = existing ? await this.readReportedCommitHashes(pageId) : new Set<string>();
    const children = buildDailyReportBlocks(input.branches, existingHashes);
    if (children.length > 0) {
      for (let index = 0; index < children.length; index += MAX_PAGE_CHILDREN) {
        await this.client.blocks.children.append({
          block_id: pageId,
          children: children.slice(index, index + MAX_PAGE_CHILDREN) as never,
        });
      }
    }
    return pageId;
  }

  private async createDailyReportPage(
    titlePropertyName: string,
    schema: Record<string, { type?: string }>,
    title: string,
    date: string,
    reportKey: string,
    branches: DailyWorkReportBranch[],
  ): Promise<string> {
    if (!this.client || !this.config.databaseId) throw new Error("Notion integration or database is not configured");
    const properties: Record<string, unknown> = {
      [titlePropertyName]: { title: [{ type: "text", text: { content: title } }] },
    };
    setSchemaProperty(properties, schema, ["날짜", "Date", "일자"], date);
    setSchemaProperty(properties, schema, ["보고키", "Report Key", "ReportKey"], reportKey);

    const commits = branches.flatMap((branch) => branch.commits);
    if (commits.length > 0) {
      setSchemaProperty(properties, schema, ["브랜치", "Branch"], branches.map(
        (branch) => (branch.repositoryLabel ? `[${branch.repositoryLabel}] ${branch.branch}` : branch.branch)).join(", "));
      setSchemaProperty(properties, schema, ["담당자", "Author"], [...new Set(commits.map((commit) => commit.author))].join(", "));
      setSchemaProperty(properties, schema, ["시간", "Time"], latestTimestamp(commits));
      setSchemaProperty(properties, schema, ["내용", "Content"], branches.map((branch) => branch.content).filter(Boolean).join("\n\n"));
    }

    const page = await this.client.pages.create({
      parent: { database_id: this.config.databaseId },
      properties: properties as never,
      children: [paragraphBlock(`날짜: ${date}`)] as never,
    });
    return page.id;
  }

  private async findExistingDailyReport(
    titlePropertyName: string,
    schema: Record<string, { type?: string }>,
    title: string,
    reportKey: string,
  ): Promise<string | null> {
    if (!this.client || !this.config.databaseId) return null;
    const reportProperty = findSchemaProperty(schema, ["보고키", "Report Key", "ReportKey"]);
    const filter = reportProperty?.type === "rich_text"
      ? { property: reportProperty.id, rich_text: { equals: reportKey } }
      : { property: titlePropertyName, title: { equals: title } };
    const response = await this.client.databases.query({
      database_id: this.config.databaseId,
      filter: filter as never,
      page_size: 1,
    });
    return response.results[0]?.id ?? null;
  }

  private async readReportedCommitHashes(pageId: string): Promise<Set<string>> {
    if (!this.client) return new Set<string>();
    const hashes = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await this.client.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      });
      for (const block of response.results) {
        if (!("type" in block) || block.type !== "code" || !("code" in block)) continue;
        const text = block.code.rich_text.map((item) => item.plain_text).join("");
        const match = /^커밋:\s*([0-9a-f]{40})/im.exec(text);
        if (match?.[1]) hashes.add(match[1]);
      }
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);
    return hashes;
  }

  private async findExistingReport(titlePropertyName: string, title: string): Promise<string | null> {
    if (!this.client || !this.config.databaseId) return null;
    const response = await this.client.databases.query({
      database_id: this.config.databaseId,
      filter: { property: titlePropertyName, title: { equals: title } },
      page_size: 1,
    });
    return response.results[0]?.id ?? null;
  }
}

function findSchemaProperty(
  schema: Record<string, { type?: string }>,
  candidates: string[],
): { id: string; type: string } | null {
  for (const candidate of candidates) {
    const property = schema[candidate];
    if (property?.type && ["rich_text", "select", "date"].includes(property.type)) {
      return { id: candidate, type: property.type };
    }
  }
  return null;
}

function setSchemaProperty(
  properties: Record<string, unknown>,
  schema: Record<string, { type?: string }>,
  candidates: string[],
  value: string,
): void {
  const property = findSchemaProperty(schema, candidates);
  if (!property || !value.trim()) return;
  if (property.type === "rich_text") {
    properties[property.id] = { rich_text: [{ type: "text", text: { content: limitText(value) } }] };
  } else if (property.type === "select") {
    properties[property.id] = { select: { name: value.trim().slice(0, 100) } };
  } else if (property.type === "date") {
    const iso = toIsoDate(value);
    if (iso) properties[property.id] = { date: { start: iso } };
  }
}

function buildDailyReportBlocks(branches: DailyWorkReportBranch[], existingHashes: Set<string>): unknown[] {
  const blocks: unknown[] = [];
  for (const branch of branches) {
    const commits = branch.commits.filter((commit) => !existingHashes.has(commit.hash));
    if (commits.length === 0) continue;
    const heading = branch.repositoryLabel
      ? `[분야: ${branch.repositoryLabel}] 브랜치: ${branch.branch}`
      : `브랜치: ${branch.branch}`;
    blocks.push(headingBlock(heading));
    blocks.push(paragraphBlock(`담당자: ${branch.author}`));
    blocks.push(paragraphBlock(`시간: ${branch.occurredAt}`));
    const content = commits.map((commit) => {
      const details = commit.body?.trim() ? `\n${commit.body.trim()}` : "";
      return `[${commit.hash.slice(0, 8)}] ${commit.subject}${details}`;
    }).join("\n\n");
    if (content) {
      for (const part of chunkText(content)) blocks.push(paragraphBlock(part));
    }
    for (const commit of commits) {
      const lines = [
        `커밋: ${commit.hash}`,
        `담당자: ${commit.author}`,
        `시간: ${commit.occurredAt}`,
        `제목: ${commit.subject}`,
      ];
      if (commit.body?.trim()) lines.push(`내용:\n${commit.body.trim()}`);
      blocks.push(codeBlock(lines.join("\n")));
    }
  }
  return blocks;
}

function latestTimestamp(commits: Array<{ occurredAt: string }>): string {
  return commits.reduce((latest, commit) =>
    Date.parse(commit.occurredAt) > Date.parse(latest) ? commit.occurredAt : latest,
  commits[0]?.occurredAt ?? "");
}

function chunkText(text: string, limit = TEXT_LIMIT): string[] {
  const clean = text.replace(/\r\n/g, "\n");
  if (clean.length === 0) return [];
  if (clean.length <= limit) return [clean];
  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }
  return chunks;
}

function limitText(text: string): string {
  const clean = text.replace(/\r\n/g, "\n");
  return clean.slice(0, TEXT_LIMIT);
}

function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function paragraphBlock(text: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: chunkText(text).map((part) => ({ type: "text", text: { content: part } })),
    },
  };
}

function headingBlock(text: string) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: limitText(text) } }],
    },
  };
}

function codeBlock(text: string) {
  return {
    object: "block",
    type: "code",
    code: {
      language: "plain text",
      rich_text: chunkText(text).map((part) => ({ type: "text", text: { content: part } })),
    },
  };
}
