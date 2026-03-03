import { afterEach, expect, test } from "bun:test";
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tempDbPaths: string[] = [];
const tempFilePaths: string[] = [];
type TextContentBlock = { type: "text"; text: string };

afterEach(() => {
  for (const dbPath of tempDbPaths.splice(0)) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
  for (const filePath of tempFilePaths.splice(0)) {
    rmSync(filePath, { force: true });
  }
});

test("MCP stdio smoke: list tools, ingest, and search", async () => {
  const dbPath = join(tmpdir(), `memory-smoke-${Date.now()}-${Math.random()}.db`);
  const filePath = join(tmpdir(), `smoke-note-${Date.now()}-${Math.random()}.md`);
  tempDbPaths.push(dbPath);
  tempFilePaths.push(filePath);
  await Bun.write(filePath, "Bun MCP smoke test memory content.");
  const expectedCreatedAt = statSync(filePath).birthtime.toISOString();

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "index.ts"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      MEMORY_DB_PATH: dbPath,
    },
    stderr: "pipe",
  });

  const client = new Client(
    {
      name: "simple-memory-mcp-smoke-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    expect(toolNames).toContain("ingest_document");
    expect(toolNames).toContain("search_memory");

    const ingest = await client.callTool({
      name: "ingest_document",
      arguments: {
        filename: filePath,
      },
    });

    expect("content" in ingest).toBe(true);

    const search = await client.callTool({
      name: "search_memory",
      arguments: {
        query: "smoke test memory",
        limit: 3,
      },
    });

    if (!("content" in search)) {
      throw new Error("Expected content result from search_memory");
    }

    const content = search.content as unknown[];
    const text = content
      .filter(
        (item): item is TextContentBlock =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          "text" in item &&
          (item as { type?: unknown }).type === "text" &&
          typeof (item as { text?: unknown }).text === "string"
      )
      .map((item) => item.text)
      .join("\n");

    expect(text).toContain(filePath);
    expect(text).toContain("Bun MCP smoke test memory content.");
    expect(text).toContain(`Date: ${expectedCreatedAt}`);
  } finally {
    await client.close();
    await transport.close();
  }
}, 30_000);
