import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import type { HubRuntime } from "./hub-runtime";

export class LocalHttpApi {
  private readonly server: http.Server;

  public constructor(private readonly runtime: HubRuntime) {
    this.server = http.createServer((request, response) => void this.handle(request, response));
  }

  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.runtime.config.httpPort, this.runtime.config.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", `http://${this.runtime.config.host}`);
      if (request.method === "GET" && url.pathname === "/health") {
        this.json(response, 200, { ok: true, startedAt: this.runtime.getState().startedAt });
        return;
      }
      if (request.headers.authorization !== `Bearer ${this.runtime.config.apiToken}`) {
        this.json(response, 401, { error: "Unauthorized" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        this.json(response, 200, this.runtime.getState());
      } else if (request.method === "GET" && url.pathname === "/api/git/status") {
        this.json(response, 200, await this.runtime.inspectGit(url.searchParams.get("repository") ?? undefined));
      } else {
        this.json(response, 404, { error: "Not found" });
      }
    } catch (error) {
      this.json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private json(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("Request body exceeds 1 MiB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
