import assert from "node:assert/strict";

const configuredOrigin = process.env.SMOKE_ORIGIN;
assert.ok(configuredOrigin, "SMOKE_ORIGIN is required");
const origin = configuredOrigin.replace(/\/+$/, "");

async function request(path, options) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(`${origin}${path}`, {
        ...options,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 6) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, attempt * 5_000),
        );
      }
    }
  }
  throw lastError;
}

const home = await request("/");
assert.equal(home.status, 200);
assert.match(home.headers.get("content-type") ?? "", /^text\/html\b/i);
assert.match(await home.text(), /SignalForge · 财报前研究决策台/);

const health = await request("/api/health");
assert.equal(health.status, 200);
const healthPayload = await health.json();
assert.equal(healthPayload.ok, true);
assert.equal(healthPayload.capabilities.reportEngine, true);
assert.equal(healthPayload.capabilities.liveAnalysisImplemented, true);
assert.equal(typeof healthPayload.capabilities.liveReady, "boolean");

const stream = await request("/api/analyze/stream", {
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
assert.equal(stream.status, 200);
assert.match(
  stream.headers.get("content-type") ?? "",
  /^application\/x-ndjson\b/i,
);
const events = (await stream.text())
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert.equal(events.at(-1).type, "complete");
assert.equal(events.at(-1).report.meta.symbol, "NVDA");
assert.equal(events.at(-1).report.meta.liveDataReady, false);

console.log(`Production smoke test passed: ${origin}`);
