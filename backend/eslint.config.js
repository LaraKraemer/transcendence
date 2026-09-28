import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["drizzle/**", "bruno/**", "coverage/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Express error handlers need a fourth argument even when it is unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
]);
