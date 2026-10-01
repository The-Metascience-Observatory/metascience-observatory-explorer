import { defineConfig } from "vitest/config";
import path from "node:path";

// .mts so Vite loads this natively as ESM (a .ts config is loaded as CJS and
// warns about the import syntax below).
export default defineConfig({
  resolve: {
    // Mirror the "@/*" alias from tsconfig.json so tests import the same way
    // the app does.
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    // Only pure modules are covered. Anything that opens a database is
    // deliberately out of scope: the SQLite files are ~2 TB and absent in CI.
    include: ["lib/**/*.test.ts"],
  },
});
