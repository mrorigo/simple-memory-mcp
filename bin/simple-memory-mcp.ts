#!/usr/bin/env bun

import { startServer } from "../index";

startServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
