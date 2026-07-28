import type { Market, SourceRecord } from "../types";

const SEC_TICKER_URL =
  "https://www.sec.gov/files/company_tickers_exchange.json";

export function inferMarket(
  symbol: string,
  requested: Market,
): Exclude<Market, "AUTO"> {
  if (requested !== "AUTO") return requested;
  const value = symbol.trim().toUpperCase();
  if (/^(SH|SZ|BJ)?\d{6}$/.test(value)) return "CN";
  if (/^\d{4,5}(\.HK)?$/.test(value)) return "HK";
  return "US";
}

export async function probeOfficialSource(
  symbol: string,
  market: Market,
): Promise<SourceRecord> {
  const now = new Date().toISOString();
  if (market !== "US") {
    return {
      name: market === "CN" ? "CNINFO official route" : "Exchange filings route",
      provider: market === "CN" ? "a-stock-data" : "global-stock-data",
      status: "fallback",
      asOf: now,
      tier: "S",
      note:
        market === "CN"
          ? "公告路由已定义；本次未发起高频抓取。"
          : "港股官方公告适配器待配置。",
    };
  }

  try {
    const userAgent =
      process.env.SEC_USER_AGENT ||
      "EquityResearchCockpit local-research contact@example.com";
    const response = await fetch(SEC_TICKER_URL, {
      headers: { "user-agent": userAgent, accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
    const payload = (await response.json()) as {
      data?: Array<[number, string, string, string]>;
    };
    const found = payload.data?.some(
      (row) => String(row[2]).toUpperCase() === symbol.toUpperCase(),
    );
    return {
      name: "SEC ticker & filing route",
      provider: "SEC EDGAR · global-stock-data",
      status: found ? "connected" : "fallback",
      asOf: now,
      tier: "S",
      note: found
        ? "官方证券映射已验证。"
        : "SEC 响应正常，但未匹配到代码。",
    };
  } catch (error) {
    return {
      name: "SEC ticker & filing route",
      provider: "SEC EDGAR · global-stock-data",
      status: "missing",
      asOf: now,
      tier: "S",
      note: error instanceof Error ? error.message : "官方源连接失败",
    };
  }
}
