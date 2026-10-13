import { Client } from "@notionhq/client";
import type { KanbanBoard, KanbanCard, KanbanColumn } from "../../shared/ipc";

const TEXT_LIMIT = 2_000; // Notion rich text content length limit
const MAX_PAGE_CHILDREN = 100;

export interface DailyWorkReportBranch {
  repositoryLabel?: string;
  branchLabel?: string;
  branch: string;
  author: string;
  occurredAt: string;
  content: string;
  commits: Array<{ hash: string; author: string; occurredAt: string; subject: string; body?: string }>;
}

export class NotionAdapter {
  private client: Client | null;
  private titlePropertyName: string | null | undefined = undefined;
  private readonly titleCache = new Map<string, string>();

  public constructor(private config: { token?: string; databaseId?: string }) {
    this.client = config.token ? new Client({ auth: config.token }) : null;
  }

  /** 저장소별 토큰으로 별도 Client 인스턴스를 만듭니다. */
  public static forToken(token: string): NotionAdapter {
    return new NotionAdapter({ token });
  }

  public get hasToken(): boolean {
    return Boolean(this.config.token?.trim());
  }
  public get enabled(): boolean {
    return this.client !== null;
  }

  /** 칸반 서비스 등 다른 모듈이 같은 Notion 클라이언트를 재사용할 수 있게 합니다. */
  public rawClient(): Client | null {
    return this.client;
  }

  public configure(config: { token?: string; databaseId?: string }): void {
    this.config = config;
    this.client = config.token ? new Client({ auth: config.token }) : null;
    this.titlePropertyName = undefined;
    this.titleCache.clear();
  }

  /** 저장소별 데이터베이스 ID가 있으면 그것을 우선 사용합니다. */
  private targetDatabaseId(repositoryDatabaseId?: string): string | undefined {
    const trimmed = repositoryDatabaseId?.trim();
    if (trimmed) return trimmed;
    return this.config.databaseId || undefined;
  }

  public get configured(): boolean {
    return this.client !== null && Boolean(this.config.databaseId);
  }

  private async resolveTitlePropertyName(repositoryDatabaseId?: string): Promise<string> {
    const cacheKey = repositoryDatabaseId?.trim() || "__default__";
    const cached = this.titleCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const databaseId = this.targetDatabaseId(repositoryDatabaseId);
    if (!this.client || !databaseId) throw new Error("Notion integration or database is not configured");
    const database = await this.client.databases.retrieve({ database_id: databaseId });
    const entry = Object.entries(database.properties).find(([, property]) => property.type === "title");
    const resolved = entry ? entry[0] : "";
    if (!resolved) throw new Error("Notion database has no title property to create a task");
    this.titleCache.set(cacheKey, resolved);
    return resolved;
  }

  public async testConnection(repositoryDatabaseId?: string): Promise<string> {
    const databaseId = this.targetDatabaseId(repositoryDatabaseId);
    if (!this.client || !databaseId) throw new Error("Notion integration or database is not configured");
    const database = await this.client.databases.retrieve({ database_id: databaseId });
    const titleEntry = Object.entries(database.properties).find(([, property]) => property.type === "title");
    return `데이터베이스 연결 성공 (${titleEntry?.[0] ?? "제목 없음"})`;
  }

  public async createTask(input: {
    title: string;
    status?: string;
    description?: string;
    externalId?: string;
    repositoryDatabaseId?: string;
  }): Promise<string> {
    const databaseId = this.targetDatabaseId(input.repositoryDatabaseId);
    if (!this.client || !databaseId) throw new Error("Notion integration or database is not configured");
    const titlePropertyName = await this.resolveTitlePropertyName(input.repositoryDatabaseId);
    const response = await this.client.pages.create({
      parent: { database_id: databaseId },
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
    repositoryDatabaseId?: string;
    commits: Array<{ hash: string; author: string; occurredAt: string; subject: string; body?: string }>;
  }): Promise<string> {
    const databaseId = this.targetDatabaseId(input.repositoryDatabaseId);
    if (!this.client || !databaseId) throw new Error("Notion integration or database is not configured");

    const titlePropertyName = await this.resolveTitlePropertyName(input.repositoryDatabaseId);
    const database = await this.client.databases.retrieve({ database_id: databaseId });
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
      parent: { database_id: databaseId },
      properties: properties as never,
      children: blocks as never,
    });
    return page.id;
  }

  public async createDailyWorkReport(input: {
    date: string;
    reportKey: string;
    repositoryDatabaseId?: string;
    branches: DailyWorkReportBranch[];
  }): Promise<string> {
    const databaseId = this.targetDatabaseId(input.repositoryDatabaseId);
    if (!this.client || !databaseId) throw new Error("Notion integration or database is not configured");

    const titlePropertyName = await this.resolveTitlePropertyName(input.repositoryDatabaseId);
    const database = await this.client.databases.retrieve({ database_id: databaseId });
    const schema = database.properties as Record<string, { type?: string }>;
    const titleValue = `일일작업 · ${input.date}`;
    const existing = await this.findExistingDailyReport(databaseId, titlePropertyName, schema, titleValue, input.reportKey);
    const pageId = existing ?? await this.createDailyReportPage(
      databaseId,
      titlePropertyName,
      schema,
      titleValue,
      input.date,
      input.reportKey,
      input.branches,
    );

    const children = buildDailyReportBlocks(input.branches);
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
    databaseId: string,
    titlePropertyName: string,
    schema: Record<string, { type?: string }>,
    title: string,
    date: string,
    reportKey: string,
    branches: DailyWorkReportBranch[],
  ): Promise<string> {
    if (!this.client) throw new Error("Notion integration is not configured");
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
      setSchemaProperty(properties, schema, ["시간", "Time"], branches.map((branch) => branch.occurredAt).filter(Boolean).join(", "));
      setSchemaProperty(properties, schema, ["내용", "Content"], branches.map((branch) => branch.content).filter(Boolean).join("\n\n"));
    }

    const page = await this.client.pages.create({
      parent: { database_id: databaseId },
    properties: properties as never,
    });
    return page.id;
  }

  private async findExistingDailyReport(
    databaseId: string,
    titlePropertyName: string,
    schema: Record<string, { type?: string }>,
    title: string,
    reportKey: string,
  ): Promise<string | null> {
    if (!this.client) return null;
    const reportProperty = findSchemaProperty(schema, ["보고키", "Report Key", "ReportKey"]);
    const filter = reportProperty?.type === "rich_text"
      ? { property: reportProperty.id, rich_text: { equals: reportKey } }
      : { property: titlePropertyName, title: { equals: title } };
    const response = await this.client.databases.query({
      database_id: databaseId,
      filter: filter as never,
      page_size: 1,
    });
    return response.results[0]?.id ?? null;
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

function buildDailyReportBlocks(branches: DailyWorkReportBranch[]): unknown[] {
  const blocks: unknown[] = [];
  for (const branch of branches) {
    const content = (branch.content ?? "").trim();
    if (!content) continue;
    const heading = branch.branchLabel || branch.repositoryLabel
      ? `[${branch.branchLabel || `분야: ${branch.repositoryLabel}`}] 브랜치: ${branch.branch}`
      : `브랜치: ${branch.branch}`;
    blocks.push(headingBlock(heading));
    blocks.push(labelBlock(`담당자: ${branch.author}`));
    blocks.push(labelBlock(`시간: ${branch.occurredAt}`));
    for (const rawLine of content.split(`\n`)) {
      const line = rawLine.trim();
      if (!line) {
        blocks.push(paragraphBlock(" "));
        continue;
      }
      if (/^(요약|대표 요약):/.test(line)) {
        blocks.push(labelBlock(line));
      } else {
        blocks.push(paragraphBlock(rawLine));
      }
    }
  }
  return blocks;
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

function labelBlock(text: string) {
  return {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: [{ type: "text", text: { content: limitText(text) } }],
    },
  };
}

function headingBlock(text: string) {
  return {
    object: "block",
    type: "heading_1",
    heading_1: {
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
