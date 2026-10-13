import { describe, expect, it } from "vitest";
import type { Client } from "@notionhq/client";
import { readKanbanBoard, moveKanbanCard, createKanbanCard, deleteKanbanCard, parseNotionDatabaseId } from "../src/main/integrations/notion-kanban";

/**
 * Notion 데이터베이스 칸반 매핑의 순수 로직을 가짜 클라이언트로 검증합니다.
 *
 * 실제 Notion 왕복은 로컬 확인으로 끝내고, 여기서는 스키마 해석(status/select),
 * 카드 매핑(제목/담당자/상태), 이동 시 충돌 감지, 생성/삭제 페이로드를 고정합니다.
 */
interface FakeState {
  schema: Record<string, unknown>;
  title: string;
  rows: Array<{ id: string; url?: string; last_edited_time: string; properties: Record<string, any> }>;
  updates: Array<{ page_id: string; properties?: Record<string, unknown>; archived?: boolean }>;
  created: Array<{ parent: { database_id: string }; properties: Record<string, unknown> }>;
}

function fakeClient(state: FakeState): Client {
  return {
    databases: {
      retrieve: async () => ({ title: [{ plain_text: state.title }], properties: state.schema }),
      query: async () => ({ results: state.rows, has_more: false, next_cursor: null }),
    },
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => ({ last_edited_time: state.rows.find((r) => r.id === page_id)?.last_edited_time ?? "" }),
      update: async (args: { page_id: string; properties?: Record<string, unknown>; archived?: boolean }) => {
        state.updates.push(args);
        return {};
      },
      create: async (args: { parent: { database_id: string }; properties: Record<string, unknown> }) => {
        state.created.push(args);
        return { id: "new-page-id" };
      },
    },
  } as unknown as Client;
}

function baseState(): FakeState {
  return {
    title: "팀 칸반",
    schema: {
      "이름": { type: "title" },
      "상태": { type: "status", status: { options: [{ name: "시작 전" }, { name: "진행 중" }, { name: "완료" }] } },
      "담당자": { type: "people" },
    },
    rows: [
      {
        id: "card-1",
        url: "https://www.notion.so/card-1",
        last_edited_time: "2026-10-13T00:00:00.000Z",
        properties: {
          "이름": { type: "title", title: [{ plain_text: "로그인 화면" }] },
          "상태": { type: "status", status: { name: "진행 중" } },
          "담당자": { type: "people", people: [{ name: "윤서" }] },
        },
      },
    ],
    updates: [],
    created: [],
  };
}

describe("Notion 칸반 매핑", () => {
  it("노션 데이터베이스 링크에서 ID를 뽑아냅니다", () => {
    expect(parseNotionDatabaseId("https://app.notion.com/p/dfc41f2656fc832f8814818ad24f5c3c?v=86041f2656fc8223904908b21fcc75c6")).toBe("dfc41f26-56fc-832f-8814-818ad24f5c3c");
    expect(parseNotionDatabaseId("https://www.notion.so/My-Board-1234abcd1234abcd1234abcd1234abcd")).toBe("1234abcd-1234-abcd-1234-abcd1234abcd");
    expect(parseNotionDatabaseId("1234abcd-1234-abcd-1234-abcd1234abcd")).toBe("1234abcd-1234-abcd-1234-abcd1234abcd");
    expect(parseNotionDatabaseId("짧은문자열")).toBeNull();
  });

  it("status 옵션을 열로, 행을 카드로 읽어옵니다", async () => {
    const state = baseState();
    const board = await readKanbanBoard({ client: fakeClient(state), databaseId: "db", groupProperty: "상태" });
    expect(board.columns.map((c) => c.id)).toEqual(["시작 전", "진행 중", "완료"]);
    expect(board.readOnly).toBe(false);
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toMatchObject({ id: "card-1", title: "로그인 화면", columnId: "진행 중" });
    expect(board.cards[0]!.assignees).toEqual(["윤서"]);
  });

  it("그룹 속성 이름이 틀려도 status 속성을 자동으로 찾습니다", async () => {
    const state = baseState();
    const board = await readKanbanBoard({ client: fakeClient(state), databaseId: "db", groupProperty: "Status" });
    expect(board.readOnly).toBe(false);
    expect(board.groupProperty).toBe("상태");
    expect(board.columns.map((c) => c.id)).toEqual(["시작 전", "진행 중", "완료"]);
    expect(board.cards[0]!.columnId).toBe("진행 중");
  });

  it("그룹 속성이 status/select가 아니면 읽기 전용으로 표시합니다", async () => {
    const state = baseState();
    state.schema = { "이름": { type: "title" }, "상태": { type: "rich_text" } };
    const board = await readKanbanBoard({ client: fakeClient(state), databaseId: "db", groupProperty: "상태" });
    expect(board.readOnly).toBe(true);
    // 옵션 정의가 없어도 카드에서 열을 역으로 모아 표시만 가능하게 합니다.
    expect(board.columns.map((c) => c.id)).toEqual(["진행 중"]);
  });

  it("이동 시 status 페이로드를 보내고, 다른 수정이 있으면 거부합니다", async () => {
    const state = baseState();
    const client = fakeClient(state);
    await moveKanbanCard({ client, databaseId: "db", groupProperty: "상태" }, { cardId: "card-1", columnId: "완료" });
    expect(state.updates.at(-1)).toMatchObject({ page_id: "card-1", properties: { "상태": { status: { name: "완료" } } } });

    await expect(
      moveKanbanCard({ client, databaseId: "db", groupProperty: "상태" }, { cardId: "card-1", columnId: "완료", expectedEditedAt: "1999-01-01T00:00:00.000Z" }),
    ).rejects.toThrow(/다른 사용자/);
  });

  it("카드 생성 시 제목과 상태를 함께 넣습니다", async () => {
    const state = baseState();
    const id = await createKanbanCard({ client: fakeClient(state), databaseId: "db", groupProperty: "상태" }, { title: "새 카드", columnId: "시작 전" });
    expect(id).toBe("new-page-id");
    expect(state.created.at(-1)).toMatchObject({
      parent: { database_id: "db" },
      properties: { "이름": { title: [{ type: "text", text: { content: "새 카드" } }] }, "상태": { status: { name: "시작 전" } } },
    });
  });

  it("카드 삭제는 페이지 보관으로 수행합니다", async () => {
    const state = baseState();
    await deleteKanbanCard({ client: fakeClient(state), databaseId: "db", groupProperty: "상태" }, "card-1");
    expect(state.updates.at(-1)).toMatchObject({ page_id: "card-1", archived: true });
  });
});

