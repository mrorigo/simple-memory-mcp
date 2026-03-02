# simple-memory-mcp

Personal memory MCP server backed by SQLite FTS5 BM25 search with temporal reranking.

## Setup

```bash
bun install
```

## Run

```bash
bun run start
```

The server uses stdio transport and creates `memory.db` in the project root.

## Tools

- `ingest_document`
  - Inputs: `filename` (string), `content` (string), `attribution` (optional string)
- `search_memory`
  - Inputs: `query` (string), `limit` (optional number, default `5`, max `50`)
  - Ranking: `|bm25| * (1 / (1 + 0.05 * ageInDays))`

## Verify

```bash
bun test
bun run typecheck
```
