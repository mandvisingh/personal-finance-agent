import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../logger.js";

describe("createLogger", () => {
  let spyLog, spyWarn, spyError;

  beforeEach(() => {
    spyLog   = vi.spyOn(console, "log").mockImplementation(() => {});
    spyWarn  = vi.spyOn(console, "warn").mockImplementation(() => {});
    spyError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an object with debug, info, warn, error methods", () => {
    const log = createLogger("test");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("info writes to console.log", () => {
    const log = createLogger("test");
    log.info("hello");
    expect(spyLog).toHaveBeenCalled();
  });

  it("warn writes to console.warn", () => {
    const log = createLogger("test");
    log.warn("something off");
    expect(spyWarn).toHaveBeenCalled();
  });

  it("error writes to console.error", () => {
    const log = createLogger("test");
    log.error("something broke");
    expect(spyError).toHaveBeenCalled();
  });

  it("includes the namespace in the output", () => {
    const log = createLogger("pdf");
    log.info("extracted text");
    const [output] = spyLog.mock.calls[0];
    expect(output).toContain("[pdf]");
  });

  it("includes the log level in the output", () => {
    const log = createLogger("api");
    log.info("request received");
    const [output] = spyLog.mock.calls[0];
    expect(output).toContain("INFO");
  });

  it("includes a timestamp in ISO format", () => {
    const log = createLogger("agent");
    log.info("routing");
    const [output] = spyLog.mock.calls[0];
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("forwards additional arguments to console", () => {
    const log = createLogger("tools");
    const extra = { key: "value" };
    log.error("failed", extra);
    expect(spyError).toHaveBeenCalledWith(expect.any(String), extra);
  });

  it("two loggers with different namespaces produce different prefixes", () => {
    const logA = createLogger("alpha");
    const logB = createLogger("beta");

    logA.info("from A");
    logB.info("from B");

    const outputA = spyLog.mock.calls[0][0];
    const outputB = spyLog.mock.calls[1][0];

    expect(outputA).toContain("[alpha]");
    expect(outputB).toContain("[beta]");
  });
});
