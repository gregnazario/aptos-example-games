import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const cloudflare = (process.env.NITRO_PRESET ?? "").startsWith("cloudflare");

// @aptos-labs/aptos-client only exports `node` and `browser` conditions, so the
// workerd resolver finds no matching entry; its exports map also blocks deep
// imports, so the browser build is aliased by file path. @aptos-labs/ts-sdk is
// pinned exactly in package.json — if a bump ever moves this file, fail the
// build here with a clear message instead of breaking a worker deploy.
function resolveAptosBrowserClient(): string {
  const path = fileURLToPath(
    new URL(
      "./node_modules/@aptos-labs/aptos-client/dist/browser/index.browser.mjs",
      import.meta.url,
    ),
  );
  if (!existsSync(path)) {
    throw new Error(
      `@aptos-labs/aptos-client browser build missing at ${path}. ` +
        "Check the exact @aptos-labs/ts-sdk pin; the Cloudflare (workerd) build requires this file.",
    );
  }
  return path;
}

const aptosWorkerAlias = {
  "@aptos-labs/aptos-client": resolveAptosBrowserClient(),
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
            alias: aptosWorkerAlias,
          }
        : undefined,
    ),
  ],
});
