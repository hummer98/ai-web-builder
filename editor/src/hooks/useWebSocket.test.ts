import { describe, it, expect } from "vitest";
import { parseInboundMessage } from "./useWebSocket";

describe("parseInboundMessage", () => {
  it("parses a valid JSON message with string type", () => {
    const msg = parseInboundMessage('{"type":"stream","delta":"hi"}');
    expect(msg).toEqual({ type: "stream", delta: "hi" });
  });

  it("returns null for malformed JSON", () => {
    expect(parseInboundMessage("not json")).toBeNull();
    expect(parseInboundMessage("")).toBeNull();
    expect(parseInboundMessage("{")).toBeNull();
  });

  it("returns null when type is missing", () => {
    expect(parseInboundMessage('{"foo":"bar"}')).toBeNull();
  });

  it("returns null when type is not a string", () => {
    expect(parseInboundMessage('{"type":123}')).toBeNull();
    expect(parseInboundMessage('{"type":null}')).toBeNull();
  });

  it("returns null for primitive JSON values", () => {
    expect(parseInboundMessage('"a string"')).toBeNull();
    expect(parseInboundMessage("42")).toBeNull();
    expect(parseInboundMessage("null")).toBeNull();
  });

  it("preserves all fields on the message", () => {
    const msg = parseInboundMessage(
      '{"type":"deploy","success":true,"url":"https://x.pages.dev"}'
    );
    expect(msg).toEqual({
      type: "deploy",
      success: true,
      url: "https://x.pages.dev",
    });
  });
});
