import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so the test run never inherits the
// production-only API origin check.
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/i18n/testSetup.ts"],
  },
});
