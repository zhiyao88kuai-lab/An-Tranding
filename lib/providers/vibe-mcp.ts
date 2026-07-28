import type { SourceRecord } from "../types";

const ALLOWED_TOOLS = new Set([
  "search_symbol",
  "get_stock_profile",
  "get_market_data",
  "get_financial_statements",
  "get_sec_filings",
  "get_options_chain",
  "analyze_options",
  "factor_analysis",
]);

type McpResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

export function parsePayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.includes("data:")) {
    const payloads = trimmed
      .split(/\r?\n/)
      .filter((line) => line.trimStart().startsWith("data:"))
      .map((line) => line.trimStart().slice(5).trim())
      .filter(Boolean);
    if (payloads.length > 0) {
      return JSON.parse(payloads.at(-1) as string);
    }
  }
  return JSON.parse(trimmed);
}

async function postMcp(
  url: string,
  body: unknown,
  token?: string,
  sessionId?: string,
) {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (sessionId) headers.set("mcp-session-id", sessionId);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}`);
  }
  return {
    data: parsePayload(await response.text()) as {
      result?: McpResult;
      error?: { message?: string };
    },
    sessionId: response.headers.get("mcp-session-id") || sessionId,
  };
}

export async function callVibeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!ALLOWED_TOOLS.has(name)) {
    throw new Error(`MCP tool is not allowlisted: ${name}`);
  }

  const url = process.env.VIBE_MCP_URL;
  if (!url) throw new Error("VIBE_MCP_URL is not configured");
  const token = process.env.VIBE_MCP_AUTH_TOKEN;

  const init = await postMcp(
    url,
    {
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "equity-research-cockpit", version: "0.1.0" },
      },
    },
    token,
  );

  await postMcp(
    url,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    token,
    init.sessionId,
  );

  const result = await postMcp(
    url,
    {
      jsonrpc: "2.0",
      id: `tool-${Date.now()}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
    token,
    init.sessionId,
  );

  if (result.data?.error) {
    throw new Error(result.data.error.message || "Unknown MCP error");
  }
  if (result.data?.result?.isError) {
    throw new Error(
      result.data.result.content?.map((item) => item.text).join("\n") ||
        "MCP tool error",
    );
  }

  const text = result.data?.result?.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n");

  if (!text) return result.data?.result || null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    "ok" in parsed &&
    parsed.ok === false
  ) {
    throw new Error(
      "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : `${name} returned ok=false`,
    );
  }
  return parsed;
}

export async function probeVibeMcp(): Promise<SourceRecord> {
  const now = new Date().toISOString();
  try {
    await callVibeTool("search_symbol", { query: "NVDA" });
    return {
      name: "vibe_trading_dev0",
      provider: "SSH tunnel + HTTP MCP",
      status: "connected",
      asOf: now,
      tier: "LOCAL",
      note: "只读工具白名单已连接。",
    };
  } catch (error) {
    return {
      name: "vibe_trading_dev0",
      provider: "SSH tunnel + HTTP MCP",
      status: "missing",
      asOf: now,
      tier: "LOCAL",
      note: error instanceof Error ? error.message : "连接失败",
    };
  }
}

export type MarketSnapshot = {
  symbol: string;
  asOf: string;
  firstClose: number;
  lastClose: number;
  lastVolume: number;
  periodReturnPct: number;
  bars: number;
};

export async function fetchVibeMarketSnapshot(
  symbol: string,
): Promise<MarketSnapshot> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 45);
  const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
  const code = symbol.includes(".") ? symbol : `${symbol}.US`;
  const payload = (await callVibeTool("get_market_data", {
    codes: [code],
    start_date: dateOnly(start),
    end_date: dateOnly(end),
    source: "auto",
    interval: "1D",
    max_rows: 40,
  })) as Record<string, unknown>;
  const rows = payload?.[code];
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error("MCP market snapshot is incomplete");
  }
  const first = rows[0] as Record<string, unknown>;
  const last = rows.at(-1) as Record<string, unknown>;
  const firstClose = Number(first.close);
  const lastClose = Number(last.close);
  const lastVolume = Number(last.volume);
  if (![firstClose, lastClose, lastVolume].every(Number.isFinite)) {
    throw new Error("MCP market snapshot contains invalid values");
  }
  return {
    symbol: code,
    asOf: String(last.trade_date || new Date().toISOString()),
    firstClose,
    lastClose,
    lastVolume,
    periodReturnPct: ((lastClose / firstClose - 1) * 100),
    bars: rows.length,
  };
}
