import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
const privateData = resolve(process.env.SCENE_MAKER_DATA || ".data");
export default defineConfig({
  plugins: [react()],
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
    },
  },
});
