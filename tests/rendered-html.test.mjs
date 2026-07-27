import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL(
  `../dist/server/index.js?test=${process.pid}-${Date.now()}`,
  import.meta.url,
);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the finished research cockpit", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SignalForge · 财报前研究决策台<\/title>/i);
  assert.match(html, /把财报噪音/);
  assert.match(html, /创建分析任务/);
  assert.match(html, /财报前决策摘要/);
  assert.doesNotMatch(html, /react-loading-skeleton|codex-preview/);
});

test("analysis API applies position-aware risk guidance", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/api/analyze", {
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
    }),
    env,
    ctx,
  );

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
  const response = await worker.fetch(
    new Request("http://localhost/api/analyze", {
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
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.decision.side, "WAIT");
  assert.equal(report.decision.actionability, "screen-grade");
  assert.ok(report.evidenceGaps.length >= 3);
});

