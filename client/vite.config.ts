import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

const cloudflare = (process.env.NITRO_PRESET ?? "").startsWith("cloudflare");

// The workerd resolver cannot resolve some @aptos-labs/aptos-client versions
// natively (2.x exports only `node`/`browser` conditions with no
// `workerd`/`default` fallback), so each importer is bound to its own
// closure's copy: resolve the nearest node_modules install from the importer
// and, for 2.x layouts, alias to the browser build by file path. 4.x+ copies
// (nested under @aptos-labs/ts-sdk 7+) export `workerd`/`default` conditions
// and resolve natively. A single global alias would bind every closure to one
// file — e.g. ts-sdk 7 silently running against the 2.x copy kept for the
// wallet adapter's nested ts-sdk 5.
function aptosClientWorkerdPlugin(): Plugin {
  return {
    name: "aptos-client-workerd-entry",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "@aptos-labs/aptos-client" || !importer) return null;
      let dir = dirname(importer);
      for (;;) {
        const pkgDir = join(dir, "node_modules", "@aptos-labs", "aptos-client");
        if (existsSync(pkgDir)) {
          const legacyBrowser = join(
            pkgDir,
            "dist",
            "browser",
            "index.browser.mjs",
          );
          if (!existsSync(legacyBrowser)) return null; // 4.x+: resolves natively
          return legacyBrowser;
        }
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
      }
    },
  };
}

const aptosClientPlugin = aptosClientWorkerdPlugin();

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    ...(cloudflare ? [aptosClientPlugin] : []),
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
    nitro(
      cloudflare
        ? {
            rollupConfig: { plugins: [aptosClientPlugin] },
          }
        : undefined,
    ),
  ],
});
