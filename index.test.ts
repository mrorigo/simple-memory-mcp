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
});
