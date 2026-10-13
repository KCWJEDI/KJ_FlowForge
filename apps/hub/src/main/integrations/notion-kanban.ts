import type { Client } from "@notionhq/client";
import type { KanbanBoard, KanbanCard, KanbanColumn } from "../../shared/ipc";

/**
 * Notion 데이터베이스를 칸반보드로 읽고 씁니다(A안: status/select 속성을 열로 사용).
 *
 * - 열: 그룹 속성(기본 "상태")의 옵션들
 * - 카드: 데이터베이스의 각 행(페이지)
 *
 * 동시 수정 완화를 위해 카드의 lastEditedAt을 내려보내고, 이동 시 서버 값과
 * 비교해 다르면 적용하지 않습니다(조용한 덮어쓰기 방지).
 */
export interface KanbanDeps {
  client: Client;
  databaseId: string;
  groupProperty: string;
}

interface NotionRichText {
  plain_text?: string;
  text?: { content?: string };
}

type NotionPropertyValue = {
  type?: string;
  title?: NotionRichText[];
  status?: { name?: string } | null;
  select?: { name?: string } | null;
  people?: Array<{ name?: string; id?: string }>;
};

interface NotionPropertySchema {
  type?: string;
  status?: { options?: Array<{ name: string; color?: string }> };
  select?: { options?: Array<{ name: string; color?: string }> };
}

interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionPropertyValue>;
}

const GROUP_PROPERTY_TYPES = new Set(["status", "select"]);
const PAGE_SIZE = 100;
const TITLE_LIMIT = 2_000;

/** 그룹 속성의 타입(status/select)과 옵션 목록을 찾습니다. */
function resolveGroupSchema(
  schema: Record<string, NotionPropertySchema>,
  groupProperty: string,
): { name: string | null; type: "status" | "select" | null; options: Array<{ name: string; color?: string }> } {
  const property = schema[groupProperty];
  if (property && property.type && GROUP_PROPERTY_TYPES.has(property.type)) {
    const options = property.type === "status" ? property.status?.options ?? [] : property.select?.options ?? [];
    return { name: groupProperty, type: property.type as "status" | "select", options };
  }
  // 이름이 설정과 다르거나(오타·인코딩 문제) 없으면 status/select 속성을 자동으로 찾습니다.
  const entries = Object.entries(schema);
  const statusEntry = entries.find(([, value]) => value.type === "status");
  if (statusEntry) {
    return { name: statusEntry[0], type: "status", options: statusEntry[1].status?.options ?? [] };
  }
  const selectEntry = entries.find(([, value]) => value.type === "select");
  if (selectEntry) {
    return { name: selectEntry[0], type: "select", options: selectEntry[1].select?.options ?? [] };
  }
  return { name: null, type: null, options: [] };
}

function findTitlePropertyName(schema: Record<string, NotionPropertySchema>): string | null {
  for (const [name, property] of Object.entries(schema)) {
    if (property.type === "title") return name;
  }
  return null;
}

function richTextToString(rich: NotionRichText[] | undefined): string {
  return (rich ?? []).map((part) => part.plain_text ?? part.text?.content ?? "").join("");
}

function toCard(page: NotionPage, groupProperty: string): KanbanCard {
  const properties = page.properties ?? {};
  const titleEntry = Object.entries(properties).find(([, value]) => value.type === "title");
  const groupValue = properties[groupProperty];
  const groupName = groupValue?.status?.name ?? groupValue?.select?.name ?? "";
  const assignees = (properties["담당자"]?.people ?? properties["Assignee"]?.people ?? [])
    .map((person) => person.name || person.id || "")
    .filter(Boolean);
  return {
    id: page.id,
    title: richTextToString(titleEntry?.[1]?.title) || "(제목 없음)",
    columnId: groupName,
    assignees,
    url: page.url ?? "https://www.notion.so/" + page.id.replace(/-/g, ""),
    lastEditedAt: page.last_edited_time ?? "",
  };
}

async function retrieveSchema(deps: KanbanDeps): Promise<{
  title: string;
  schema: Record<string, NotionPropertySchema>;
  groupType: "status" | "select" | null;
  groupOptions: Array<{ name: string; color?: string }>;
  groupName: string | null;
}> {
  const database = (await deps.client.databases.retrieve({ database_id: deps.databaseId })) as unknown as {
    title?: NotionRichText[];
    properties?: Record<string, NotionPropertySchema>;
  };
  const schema = database.properties ?? {};
  const resolved = resolveGroupSchema(schema, deps.groupProperty);
  return {
    title: richTextToString(database.title) || "(제목 없음)",
    schema,
    groupType: resolved.type,
    groupOptions: resolved.options,
    groupName: resolved.name,
  };
}

/** 칸반보드를 읽습니다. 그룹 속성이 status/select가 아니면 readOnly로 표시합니다. */
export async function readKanbanBoard(deps: KanbanDeps): Promise<KanbanBoard> {
  const { title, groupType, groupOptions, groupName } = await retrieveSchema(deps);
  const groupProperty = groupName ?? deps.groupProperty;
  const columns: KanbanColumn[] = groupOptions.map((option) => ({
    id: option.name,
    name: option.name,
    color: option.color,
  }));

  const cards: KanbanCard[] = [];
  let cursor: string | undefined;
  do {
    const response = (await deps.client.databases.query({
      database_id: deps.databaseId,
      page_size: PAGE_SIZE,
      start_cursor: cursor,
    })) as unknown as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string | null };
    for (const page of response.results ?? []) {
      if (page.id) cards.push(toCard(page, groupProperty));
    }
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  // 열 옵션이 비어 있으면 카드에서 역으로 모아 표시만이라도 가능하게 합니다.
  if (columns.length === 0) {
    const seen = new Set<string>();
    for (const card of cards) {
      if (card.columnId && !seen.has(card.columnId)) {
        seen.add(card.columnId);
        columns.push({ id: card.columnId, name: card.columnId });
      }
    }
  }

  return {
    databaseId: deps.databaseId,
    databaseTitle: title,
    groupProperty,
    columns,
    cards,
    fetchedAt: new Date().toISOString(),
    readOnly: groupType === null,
    message:
      groupType === null
        ? "'" + deps.groupProperty + "' 속성이 status 또는 select가 아니어서 읽기 전용으로 표시합니다."
        : undefined,
  };
}

/**
 * 이동 직전에 서버의 lastEditedAt을 확인합니다.
 *
 * expectedEditedAt이 주어졌는데 서버 값과 다르면 다른 사람이 먼저 바꾼 것이므로
 * 충돌로 간주하고 적용하지 않습니다.
 */
async function assertNotStale(deps: KanbanDeps, cardId: string, expectedEditedAt?: string): Promise<void> {
  if (!expectedEditedAt) return;
  const page = (await deps.client.pages.retrieve({ page_id: cardId })) as unknown as { last_edited_time?: string };
  const serverEdited = page.last_edited_time ?? "";
  if (serverEdited && serverEdited !== expectedEditedAt) {
    throw new Error("다른 사용자가 먼저 이 카드를 변경했습니다. 새로고침 후 다시 시도하세요.");
  }
}

/** 카드를 다른 열로 이동합니다(그룹 속성만 변경 → 다른 필드와 충돌하지 않음). */
export async function moveKanbanCard(
  deps: KanbanDeps,
  input: { cardId: string; columnId: string; expectedEditedAt?: string },
): Promise<void> {
  await assertNotStale(deps, input.cardId, input.expectedEditedAt);
  const { groupType, groupName } = await retrieveSchema(deps);
  const groupProperty = groupName ?? deps.groupProperty;
  if (groupType === "status") {
    await deps.client.pages.update({
      page_id: input.cardId,
      properties: { [groupProperty]: { status: { name: input.columnId } } },
    });
    return;
  }
  if (groupType === "select") {
    await deps.client.pages.update({
      page_id: input.cardId,
      properties: { [groupProperty]: { select: { name: input.columnId } } },
    });
    return;
  }
  throw new Error("칸반 열로 쓸 status/select 속성을 찾지 못했습니다.");
}

/** 새 카드를 만듭니다(노션 페이지 생성). */
export async function createKanbanCard(
  deps: KanbanDeps,
  input: { title: string; columnId?: string },
): Promise<string> {
  const { schema, groupType, groupName } = await retrieveSchema(deps);
  const groupProperty = groupName ?? deps.groupProperty;
  const titleProperty = findTitlePropertyName(schema);
  if (!titleProperty) throw new Error("데이터베이스에 제목(title) 속성이 없습니다.");
  const properties: Record<string, unknown> = {
    [titleProperty]: { title: [{ type: "text", text: { content: input.title.slice(0, TITLE_LIMIT) } }] },
  };
  if (input.columnId && groupType === "status") {
    properties[groupProperty] = { status: { name: input.columnId } };
  } else if (input.columnId && groupType === "select") {
    properties[groupProperty] = { select: { name: input.columnId } };
  }
  const created = (await deps.client.pages.create({
    parent: { database_id: deps.databaseId },
    properties,
  } as Parameters<typeof deps.client.pages.create>[0])) as unknown as { id?: string };
  if (!created.id) throw new Error("노션 페이지 생성에 실패했습니다.");
  return created.id;
}

/** 카드를 삭제합니다(노션 페이지 보관). */
export async function deleteKanbanCard(deps: KanbanDeps, cardId: string): Promise<void> {
  await deps.client.pages.update({ page_id: cardId, archived: true });
}

