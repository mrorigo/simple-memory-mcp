import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "./index";

const dbPaths: string[] = [];

afterEach(() => {
  for (const dbPath of dbPaths.splice(0)) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

describe("MemoryStore", () => {
  test("ingests and searches documents", () => {
    const dbPath = join(tmpdir(), `memory-test-${Date.now()}-${Math.random()}.db`);
    dbPaths.push(dbPath);

    const store = new MemoryStore(dbPath);

    store.ingestDocument({
      filename: "note-1.md",
      content: "Bun supports a fast TypeScript runtime.",
      attribution: "docs",
      createdAt: "2026-03-01T00:00:00.000Z",
    });

    store.ingestDocument({
      filename: "note-2.md",
      content: "TypeScript MCP servers can run over stdio.",
      attribution: "example",
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    const results = store.search({ query: "TypeScript runtime", limit: 5, now: Date.parse("2026-03-02T00:00:00.000Z") });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.filename).toBe("note-1.md");
    expect(results[0]?.finalScore).toBeGreaterThan(0);

    store.close();
  });

  test("rejects ingest when fields are not valid UTF-8 text", () => {
    const dbPath = join(tmpdir(), `memory-test-${Date.now()}-${Math.random()}.db`);
    dbPaths.push(dbPath);

    const store = new MemoryStore(dbPath);

    expect(() =>
      store.ingestDocument({
        filename: "bad-note.md",
        content: `Invalid surrogate: \ud800`,
        attribution: "tests",
        createdAt: "2026-03-01T00:00:00.000Z",
      })
    ).toThrow("valid UTF-8 text");

    store.close();
  });

  test("rejects ingest when createdAt is missing or invalid", () => {
    const dbPath = join(tmpdir(), `memory-test-${Date.now()}-${Math.random()}.db`);
    dbPaths.push(dbPath);

    const store = new MemoryStore(dbPath);

    expect(() =>
      store.ingestDocument({
        filename: "missing-created-at.md",
        content: "content",
      } as any)
    ).toThrow("createdAt");

    expect(() =>
      store.ingestDocument({
        filename: "invalid-created-at.md",
        content: "content",
        createdAt: "not-a-date",
      })
    ).toThrow("createdAt");

    store.close();
  });

  test("scrubs all records for a filename without touching other documents", () => {
    const dbPath = join(tmpdir(), `memory-test-${Date.now()}-${Math.random()}.db`);
    dbPaths.push(dbPath);

    const store = new MemoryStore(dbPath);

    store.ingestDocument({
      filename: "dup.md",
      content: "First duplicate content",
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    store.ingestDocument({
      filename: "dup.md",
      content: "Second duplicate content",
      createdAt: "2026-03-02T00:00:00.000Z",
    });
    store.ingestDocument({
      filename: "keep.md",
      content: "This should remain searchable",
      createdAt: "2026-03-03T00:00:00.000Z",
    });

    const removedCount = store.scrubDocument({ filename: "dup.md" });
    expect(removedCount).toBe(2);

    const duplicateResults = store.search({ query: "duplicate content", limit: 10 });
    expect(duplicateResults.length).toBe(0);

    const remainingResults = store.search({ query: "remain searchable", limit: 10 });
    expect(remainingResults.length).toBeGreaterThan(0);
    expect(remainingResults[0]?.filename).toBe("keep.md");

    const missingRemoved = store.scrubDocument({ filename: "does-not-exist.md" });
    expect(missingRemoved).toBe(0);

    store.close();
  });
});
