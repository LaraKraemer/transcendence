import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["srcs/**/*.ts"],
      exclude: ["srcs/index.ts", "srcs/db/schema.ts", "srcs/db/seed.ts", "srcs/db/migrate*.ts"],
      reporter: ["text", "html"],
    },
  },
});
