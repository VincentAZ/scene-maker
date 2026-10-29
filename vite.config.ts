import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import packageInfo from "./package.json";
const buildNumber = new Date().toISOString().replace(/[-:]/g, "").replace("T", ".").slice(0, 15);
const privateData = resolve(process.env.SCENE_MAKER_DATA || ".data");
export default defineConfig({
  plugins: [react()],
  define: {
    __STUDIO_VERSION__: JSON.stringify(packageInfo.version),
    __STUDIO_BUILD__: JSON.stringify(buildNumber),
  },
  test: { include: ["tests/**/*.test.ts"] },
  server: {
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        `${privateData}/**`,
      ],
    },
    watch: { ignored: [`${privateData}/**`] },
    proxy: {
      "/api": "http://127.0.0.1:4311",
      "/uploads": "http://127.0.0.1:4311",
      "/engine": "http://127.0.0.1:4311",
      "/exports": "http://127.0.0.1:4311",
      "/library": "http://127.0.0.1:4311",
    },
  },
});
