import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outdir = join(root, "node_modules/.cache");
await mkdir(outdir, { recursive: true });
const outfile = join(outdir, "parse-board.test.mjs");

await build({
  absWorkingDir: root,
  entryPoints: ["scripts/parse-board.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  packages: "external",
});

const child = spawn(process.execPath, ["--test", outfile], {
  cwd: root,
  stdio: "inherit",
});

const code = await new Promise((resolve) => {
  child.on("exit", (exitCode, signal) => {
    resolve(exitCode ?? (signal ? 1 : 0));
  });
});

process.exit(code);
