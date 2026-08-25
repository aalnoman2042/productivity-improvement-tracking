import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest had no config at all until route tests arrived, and the reason is
 * the one line below: a `route.ts` imports `@/lib/...`, and without the alias
 * every attempt to test a handler failed at resolution rather than at an
 * assertion. That is why 50 route handlers had no tests while every pure
 * module had plenty — the door was locked, not the work undone.
 *
 * `lib/` specs still import relatively (`../lib/foo`) and always will; the
 * alias exists for the files that cannot.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
