import type { Client } from "@notionhq/client";
import { EventEmitter } from "node:events";
import type { KanbanBoard, KanbanMoveInput } from "../../shared/ipc";
import { createKanbanCard, deleteKanbanCard, moveKanbanCard, readKanbanBoard } from "../integrations/notion-kanban";

const POLL_INTERVAL_MS = 7_000;

/**
 * 노션 데이터베이스를 칸반보드로 동기화하는 서비스입니다.
 *
 * - 주기 폴링(기본 7초)으로 다른 사용자의 변경을 가져와 화면에 알립니다.
 * - 쓰기(이동/추가/삭제)는 그룹 속성 단위로만 수행해 다른 필드와 충돌하지 않습니다.
 * - 이동 시 expectedEditedAt으로 조용한 덮어쓰기를 방지합니다.
 */
export class KanbanService extends EventEmitter {
  private board: KanbanBoard | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private lastError: string | null = null;

  public constructor(
    private readonly client: () => Client | null,
    private databaseId: string,
    private readonly groupProperty: string,
    private readonly intervalMs: number = POLL_INTERVAL_MS,
  ) {
    super();
  }

  /** 연결할 Notion 데이터베이스를 런타임에 바꿉니다(다음 조회부터 적용). */
  public setDatabase(databaseId: string): void {
    this.databaseId = databaseId;
    this.board = null;
  }

  public get enabled(): boolean {
    return this.databaseId.trim().length > 0;
  }

  private deps(): { client: Client; databaseId: string; groupProperty: string } {
    const client = this.client();
    if (!client) throw new Error("Notion 통합 토큰이 설정되지 않았습니다.");
    if (!this.enabled) throw new Error("칸반보드 데이터베이스 ID가 설정되지 않았습니다.");
    return { client, databaseId: this.databaseId, groupProperty: this.groupProperty };
  }

  /** 최신 보드를 반환합니다(없으면 즉시 조회). */
  public async getBoard(): Promise<KanbanBoard> {
    if (!this.enabled) {
      return {
        databaseId: this.databaseId,
        databaseTitle: "",
        groupProperty: this.groupProperty,
        columns: [],
        cards: [],
        fetchedAt: new Date().toISOString(),
        readOnly: true,
        message: "설정 탭에서 칸반보드 Notion 데이터베이스 ID를 입력하세요.",
      };
    }
    return this.board ?? this.refresh();
  }

  public async refresh(): Promise<KanbanBoard> {
    const board = await readKanbanBoard(this.deps());
    this.board = board;
    this.lastError = null;
    this.emit("changed", board);
    return board;
  }

  public async move(input: KanbanMoveInput): Promise<KanbanBoard> {
    await moveKanbanCard(this.deps(), input);
    return this.refresh();
  }

  public async create(input: { title: string; columnId?: string }): Promise<KanbanBoard> {
    await createKanbanCard(this.deps(), input);
    return this.refresh();
  }

  public async remove(cardId: string): Promise<KanbanBoard> {
    await deleteKanbanCard(this.deps(), cardId);
    return this.refresh();
  }

  /** 주기 폴링을 시작합니다. */
  public start(): void {
    if (this.timer || !this.enabled) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.enabled) return;
    this.polling = true;
    try {
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 같은 오류를 반복 방출하지 않습니다.
      if (message !== this.lastError) {
        this.lastError = message;
        this.emit("error", message);
      }
    } finally {
      this.polling = false;
    }
  }
}

