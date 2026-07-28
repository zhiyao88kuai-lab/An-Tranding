import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { parsePayload } from "../lib/providers/vibe-mcp.ts";

const port = 32_000 + (process.pid % 10_000);
const origin = `http://127.0.0.1:${port}`;
const projectRoot = resolve(import.meta.dirname, "..");
let server;
let serverLogs = "";

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before startup:\n${serverLogs}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for Next.js:\n${serverLogs}`);
}

before(
  async () => {
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: "1",
          DATA_MODE: "DEMO",
          VIBE_MCP_URL: "",
          CONSENSUS_PROVIDER_URL: "http://127.0.0.1:1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (chunk) => {
      serverLogs += chunk;
    });
    server.stderr.on("data", (chunk) => {
      serverLogs += chunk;
    });
    await waitForServer();
  },
  { timeout: 35_000 },
);

after(async () => {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
});

test("server-renders the finished research cockpit", async () => {
  const response = await fetch(origin, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SignalForge · 财报前研究决策台<\/title>/i);
  assert.match(html, /把财报噪音/);
  assert.match(html, /创建分析任务/);
  assert.match(html, /财报前决策摘要/);
  assert.match(html, /演示报告 · 非实时 · 不可据此交易/);
  assert.match(html, /2026-08-12 至 2026-08-23/);
  assert.match(
    html,
    /2026-08-26 14:00 PT \/ 2026-08-27 05:00 北京/,
  );
  assert.match(html, /2026-08-27 至 2026-08-28/);
  assert.match(html, /2026-09-23 至 2026-10-21/);
  assert.doesNotMatch(html, /react-loading-skeleton|codex-preview/);

  const positionWeightInput = html.match(
    /<input[^>]+aria-label="仓位比例 %"[^>]*>/i,
  )?.[0];
  assert.ok(positionWeightInput, "position weight input should be rendered");
  assert.match(positionWeightInput, /min="0"/i);
  assert.match(positionWeightInput, /max="100"/i);
  assert.match(positionWeightInput, /step="5"/i);
  assert.match(positionWeightInput, /value="5"/i);
  assert.match(html, /aria-label="仓位比例增加 5%"/i);
  assert.match(html, /aria-label="仓位比例减少 5%"/i);
});

test("MCP parser accepts event-stream envelopes", () => {
  assert.deepEqual(
    parsePayload('event: message\ndata: {"jsonrpc":"2.0","result":{"ok":true}}'),
    { jsonrpc: "2.0", result: { ok: true } },
  );
});

test("analysis API applies position-aware risk guidance", async () => {
  const response = await fetch(`${origin}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "NVDA",
      market: "AUTO",
      positionSide: "LONG",
      positionWeight: 14,
      horizon: "EVENT",
      riskTolerance: "LOW",
      dataMode: "DEMO",
    }),
  });

  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.decision.side, "LONG");
  assert.equal(report.decision.actionability, "conditional");
  assert.match(report.decision.sizing, /偏集中/);
  assert.equal(
    report.scenarios.reduce((sum, item) => sum + item.probability, 0),
    100,
  );
});

test("unknown symbols fail closed to WAIT when evidence is missing", async () => {
  const response = await fetch(`${origin}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "AAPL",
      market: "US",
      positionSide: "NONE",
      positionWeight: 0,
      horizon: "EVENT",
      riskTolerance: "MEDIUM",
      dataMode: "DEMO",
    }),
  });

  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.decision.side, "WAIT");
  assert.equal(report.decision.actionability, "screen-grade");
  assert.equal(report.meta.market, "US");
  assert.equal(report.meta.evidenceReadiness, "insufficient");
  assert.ok(report.evidenceGaps.length >= 3);
});

test("streaming API exposes honest backend progress", async () => {
  const response = await fetch(`${origin}/api/analyze/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "NVDA",
      market: "AUTO",
      positionSide: "NONE",
      positionWeight: 0,
      horizon: "EVENT",
      riskTolerance: "MEDIUM",
      dataMode: "DEMO",
    }),
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/x-ndjson\b/i,
  );
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const sourceEvent = events.find(
    (event) =>
      event.type === "progress" && event.update.stage === "sources",
  );
  assert.equal(sourceEvent.update.status, "skipped");
  assert.match(sourceEvent.update.message, /未请求实时数据/);
  assert.equal(events.at(-1).type, "complete");
  assert.equal(events.at(-1).report.meta.liveDataReady, false);
  assert.equal(
    events.at(-1).report.meta.evidenceReadiness,
    "insufficient",
  );
});

test("health endpoint does not overstate realtime capability", async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.capabilities.liveReady, false);
  assert.equal(health.capabilities.liveAnalysisImplemented, true);
  assert.equal(health.capabilities.vibeConnected, false);
  assert.equal(health.capabilities.consensusConnected, false);
  assert.match(health.disclosure, /实施链路尚未全部就绪/);
});
