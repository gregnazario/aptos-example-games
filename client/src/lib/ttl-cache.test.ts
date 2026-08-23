import { afterEach, describe, expect, test, vi } from "vitest";
import { TtlCache } from "./ttl-cache";

describe("TtlCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns a stored value before expiry", () => {
    const cache = new TtlCache<string>(1_000);
    cache.set("alice", "0x1");
    expect(cache.get("alice")).toBe("0x1");
  });

  test("expires entries after the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cache = new TtlCache<string>(1_000);
    cache.set("alice", "0x1");
    vi.setSystemTime(new Date("2026-01-01T00:00:01.001Z"));
    expect(cache.get("alice")).toBeNull();
  });

  test("overwrite replaces the previous value and TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cache = new TtlCache<string>(1_000);
    cache.set("alice", "old");
    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    cache.set("alice", "new");
    vi.setSystemTime(new Date("2026-01-01T00:00:01.400Z"));
    expect(cache.get("alice")).toBe("new");
  });

  test("evicts the least recently used key when over maxSize", () => {
    const cache = new TtlCache<string>(60_000, { maxSize: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  test("get refreshes LRU order", () => {
    const cache = new TtlCache<string>(60_000, { maxSize: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.get("a")).toBe("1");
    cache.set("c", "3");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toBe("1");
    expect(cache.get("c")).toBe("3");
  });

  test("set sweeps expired keys before inserting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cache = new TtlCache<string>(1_000, { maxSize: 2 });
    cache.set("old", "1");
    vi.setSystemTime(new Date("2026-01-01T00:00:01.001Z"));
    cache.set("new", "2");
    expect(cache.size).toBe(1);
    expect(cache.get("old")).toBeNull();
    expect(cache.get("new")).toBe("2");
  });
});
