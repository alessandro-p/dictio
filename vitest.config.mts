import { defineConfig } from "vitest/config";

// Unit tests for logic and synchronous components. Async Server Components
// can't render here; they need end-to-end tests.
//
// No plugins: Vite 8 compiles JSX with Oxc and resolves the `@/` alias from
// tsconfig.json itself, which the Next.js guide's two plugins used to do.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
