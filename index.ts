import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Database } from "bun:sqlite";
import * as z from "zod/v4";

type MemoryRow = {
  rowid: number;
  filename: string;
  content: string;
  attribution: string | null;
  created_at: string;
  bm25_score: number;
};

type RankedMemoryRow = MemoryRow & {
  ageInDays: number;
  finalScore: number;
};

const DECAY_RATE = 0.05;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;
const UTF8_VALIDATION_ERROR = "Document fields must be valid UTF-8 text.";

export class MemoryStore {
  private readonly db: Database;

  constructor(databasePath = "memory.db") {
    this.db = new Database(databasePath, { create: true });
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory USING fts5(
        filename,
        content,
        attribution,
        created_at UNINDEXED
      );
    `);
  }

  ingestDocument(params: {
    filename: string;
    content: string;
    attribution?: string;
    createdAt?: string;
  }): void {
    const { filename, content, attribution, createdAt } = params;
    assertUtf8Text(filename);
    assertUtf8Text(content);
    if (attribution !== undefined) {
      assertUtf8Text(attribution);
    }

    const createdAtValue = createdAt ?? new Date().toISOString();

    this.db
      .query(
        `INSERT INTO memory (filename, content, attribution, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(filename, content, attribution ?? null, createdAtValue);
  }

  search(params: { query: string; limit?: number; now?: number }): RankedMemoryRow[] {
    const { query, now = Date.now() } = params;
    const requestedLimit = params.limit ?? DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(requestedLimit)));

    const rows = this.queryMatches(query);

    const ranked = rows.map((row) => {
      const parsedTime = Date.parse(row.created_at);
      const createdAtMs = Number.isFinite(parsedTime) ? parsedTime : now;
      const ageInDays = Math.max(0, (now - createdAtMs) / 86_400_000);
      const rawScore = Math.abs(row.bm25_score);
      const finalScore = rawScore * (1 / (1 + DECAY_RATE * ageInDays));

      return {
        ...row,
        ageInDays,
        finalScore,
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);

    return ranked.slice(0, limit);
  }

  close(): void {
    this.db.close();
  }

  private queryMatches(rawQuery: string): MemoryRow[] {
    const baseSql = `
      SELECT
        rowid,
        filename,
        content,
        attribution,
        created_at,
        bm25(memory) AS bm25_score
      FROM memory
      WHERE memory MATCH ?
      ORDER BY bm25_score
      LIMIT 50
    `;

    const stmt = this.db.query(baseSql);

    try {
      return stmt.all(rawQuery) as MemoryRow[];
    } catch {
      const safeQuery = this.escapeForPhraseQuery(rawQuery);
      return stmt.all(safeQuery) as MemoryRow[];
    }
  }

  private escapeForPhraseQuery(query: string): string {
    return `"${query.replaceAll('"', '""')}"`;
  }
}

function assertUtf8Text(value: string): void {
  if (hasLoneSurrogate(value)) {
    throw new TypeError(UTF8_VALIDATION_ERROR);
  }

  const encoded = new TextEncoder().encode(value);
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
    if (decoded !== value) {
      throw new TypeError(UTF8_VALIDATION_ERROR);
    }
  } catch {
    throw new TypeError(UTF8_VALIDATION_ERROR);
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) {
      continue;
    }

    const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
    const isLeading = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    const isTrailing = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
    const hasValidTrailing = next >= 0xdc00 && next <= 0xdfff;

    if (isLeading && hasValidTrailing) {
      index += 1;
      continue;
    }

    if (isTrailing || isLeading) {
      return true;
    }
  }

  return false;
}

function formatResults(rows: RankedMemoryRow[]): string {
  if (rows.length === 0) {
    return "No matching documents found.";
  }

  return rows
    .map((row, index) => {
      const scoreText = row.finalScore.toFixed(6);
      return [
        `[Result ${index + 1}]`,
        `File: ${row.filename}`,
        `Attribution: ${row.attribution ?? "N/A"}`,
        `Date: ${row.created_at}`,
        `Score: ${scoreText}`,
        "Content:",
        row.content,
        "---",
      ].join("\n");
    })
    .join("\n\n");
}

export function buildServer(store = new MemoryStore()): McpServer {
  const server = new McpServer({
    name: "simple-memory-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "ingest_document",
    {
      description: "Ingest a document into the personal memory database.",
      inputSchema: {
        filename: z.string().min(1).describe("Document filename"),
        content: z.string().min(1).describe("Document text content"),
        attribution: z
          .string()
          .optional()
          .describe("Optional source, author, or attribution metadata"),
      },
    },
    async ({ filename, content, attribution }) => {
      store.ingestDocument({ filename, content, attribution });

      return {
        content: [
          {
            type: "text",
            text: `Successfully ingested document: ${filename}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "search_memory",
    {
      description: "Search memory using BM25 with temporal reranking.",
      inputSchema: {
        query: z.string().min(1).describe("Search query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .default(DEFAULT_LIMIT)
          .describe(`Max results to return (1-${MAX_LIMIT})`),
      },
    },
    async ({ query, limit }) => {
      const rows = store.search({ query, limit });

      return {
        content: [
          {
            type: "text",
            text: formatResults(rows),
          },
        ],
      };
    }
  );

  return server;
}

function resolveDatabasePath(): string {
  return process.env.MEMORY_DB_PATH?.trim() || "memory.db";
}

export async function startServer(databasePath = resolveDatabasePath()): Promise<void> {
  const store = new MemoryStore(databasePath);
  const server = buildServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("simple-memory-mcp running on stdio");
}

if (import.meta.main) {
  startServer().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
