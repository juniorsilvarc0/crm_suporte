import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // O `next build` deixa em `.next/standalone` uma cópia de arquivos do
    // projeto, com teste junto: sem isto a suíte roda um teste velho de lá.
    exclude: [...configDefaults.exclude, ".next/**"],
  },
});
