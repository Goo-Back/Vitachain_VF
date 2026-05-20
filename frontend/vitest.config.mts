import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// AUTH-01 — Vitest base config for pure-module unit tests (node env).
// KAT-10 — extended for React component tests: jsdom env is selected per-file
// via `@vitest-environment jsdom`, and esbuild is told to emit the automatic
// JSX runtime so .tsx files do not need `import React`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    globals: false,
    setupFiles: ["./__tests__/setup.ts"],
  },
});
