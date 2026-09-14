import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const config = {
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Handler tests that dynamically import chatCore take ~1s alone but exceed
    // vitest's 5000ms default under full-suite parallel load, turning the run
    // intermittently red — and __baseline__/known-fails.txt is empty, so
    // qa-gate counts any failure as a regression. Raised rather than retried:
    // retries would mask genuine hangs.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: path.resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: path.resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: path.resolve(__dirname, "../src") + "/" },
    ],
  },
  // Next compiles JSX inside plain `.js` files; vitest's default transform does
  // not, so a test that imports a React component from src/ fails to parse.
  // Scoped to src/ only — every other file keeps the default loader.
  oxc: {
    lang: "jsx",
    include: [/src[\\/].*\.js$/],
    exclude: [/node_modules/],
  },
};

export default config;
