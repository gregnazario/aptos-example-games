import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const cloudflare = (process.env.NITRO_PRESET ?? "").startsWith("cloudflare");

// @aptos-labs/aptos-client only exports `node` and `browser` conditions, so the
// workerd resolver finds no matching entry, and its exports map blocks deep
// imports. Alias straight to the fetch-based browser build file.
const aptosWorkerAlias = {
  "@aptos-labs/aptos-client": fileURLToPath(
    new URL(
      "./node_modules/@aptos-labs/aptos-client/dist/browser/index.browser.mjs",
      import.meta.url,
    ),
  ),
};

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...(cloudflare ? aptosWorkerAlias : {}),
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
    nitro(
      cloudflare
        ? {
            rollupConfig: { alias: aptosWorkerAlias },
          }
        : undefined,
    ),
  ],
});
