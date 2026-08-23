import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(
  new URL("../.output/server/index.mjs", import.meta.url),
);

function fail(message, example) {
  const hint = example ? `\n  ${example}` : "";
  throw new Error(`${message}${hint}`);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForServer(url, timeoutMs = 20_000) {
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Server did not start at ${url}: ${lastError}`);
}

async function expectStatus(url, status) {
  const response = await fetch(url, { redirect: "manual" });
  const body = await response.text();
  if (response.status !== status) {
    fail(
      `${url} returned ${response.status}, expected ${status}`,
      "npm run build && npm run test:ssr",
    );
  }
  return body;
}

if (!existsSync(serverEntry)) {
  fail(
    "Production build missing (.output/server/index.mjs).",
    "npm run build && npm run test:ssr",
  );
}

const port = process.env.PORT || String(await freePort());
const origin = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: { ...process.env, PORT: port, HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

let exitCode = 0;
try {
  await waitForServer(`${origin}/`);

  const home = await expectStatus(`${origin}/`, 200);
  for (const needle of ["Join a board", "Play tic-tac-toe", "Start a match"]) {
    if (!home.includes(needle)) {
      fail(`Home page is missing “${needle}”.`);
    }
  }

  await expectStatus(`${origin}/this-path-does-not-exist`, 404);

  const game = await expectStatus(`${origin}/game/0x1/default`, 200);
  const gameOk =
    game.includes("Game not found") ||
    game.includes("Couldn’t load this board") ||
    game.includes("Live board");
  if (!gameOk) {
    fail("Game route did not render a board, missing-game, or load-error page.");
  }

  console.log(`ssr-smoke ok (${origin})`);
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
  if (stderr.trim()) console.error(stderr.trim());
} finally {
  child.kill("SIGTERM");
  const died = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(2_000).then(() => false),
  ]);
  if (!died) child.kill("SIGKILL");
}

process.exit(exitCode);
