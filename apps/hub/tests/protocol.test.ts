import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, createEnvelope, isEnvelope } from "../src/shared/protocol";

describe("protocol envelope", () => {
  it("creates a valid envelope with an explicit request id", () => {
    const envelope = createEnvelope("event", "console.log", {
      severity: "log",
      message: "hello",
      stackTrace: "",
      channel: null,
      occurredAt: "2026-01-01T00:00:00.000Z",
      playMode: false,
    }, "req-1");

    expect(envelope.version).toBe(PROTOCOL_VERSION);
    expect(envelope.type).toBe("event");
    expect(envelope.name).toBe("console.log");
    expect(envelope.requestId).toBe("req-1");
    expect(envelope.payload).toMatchObject({ severity: "log", message: "hello" });
    expect(Number.isNaN(Date.parse(envelope.timestamp))).toBe(false);
  });

  it("generates a UUID request id when omitted", () => {
    const envelope = createEnvelope("command", "play.enter", {});
    expect(envelope.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("isEnvelope accepts valid envelopes", () => {
    expect(isEnvelope(createEnvelope("response", "unity.hello", { ok: true }, "req-2"))).toBe(true);
  });

  it("isEnvelope rejects non-objects and malformed values", () => {
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope(undefined)).toBe(false);
    expect(isEnvelope("string")).toBe(false);
    expect(isEnvelope(42)).toBe(false);
    expect(isEnvelope({})).toBe(false);
    expect(isEnvelope({ version: 2, type: "event", requestId: "x", name: "y", timestamp: "t", payload: {} })).toBe(false);
    expect(isEnvelope({ version: 1, type: "nope", requestId: "x", name: "y", timestamp: "t", payload: {} })).toBe(false);
    expect(isEnvelope({ version: 1, type: "event", requestId: "x", timestamp: "t", payload: {} })).toBe(false);
  });
});
