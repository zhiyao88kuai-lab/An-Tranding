import { makeConditionalReport, makeNvdaDemoReport } from "./demo-report";
import { inferMarket, probeOfficialSource } from "./providers/official-data";
import { probeVibeMcp } from "./providers/vibe-mcp";
import type { AnalysisRequest, ResearchReport, SourceRecord } from "./types";

export function validateRequest(value: unknown): AnalysisRequest {
  if (!value || typeof value !== "object") {
    throw new Error("请求体格式错误");
  }
  const body = value as Partial<AnalysisRequest>;
  const symbol = String(body.symbol || "")
    .trim()
    .toUpperCase();
  if (!symbol || symbol.length > 16 || !/^[A-Z0-9.\-]+$/.test(symbol)) {
    throw new Error("请输入有效股票代码");
  }
  const weight = Number(body.positionWeight || 0);
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
    throw new Error("仓位比例必须在 0–100% 之间");
  }
  return {
    symbol,
    companyName: String(body.companyName || "").trim(),
    market: ["AUTO", "US", "HK", "CN"].includes(String(body.market))
      ? (body.market as AnalysisRequest["market"])
      : "AUTO",
    positionSide: ["NONE", "LONG", "SHORT"].includes(
      String(body.positionSide),
    )
      ? (body.positionSide as AnalysisRequest["positionSide"])
      : "NONE",
    positionWeight: weight,
    costBasis:
      body.costBasis === undefined || body.costBasis === null
        ? undefined
        : Number(body.costBasis),
    horizon: ["EVENT", "QUARTER", "YEAR"].includes(String(body.horizon))
      ? (body.horizon as AnalysisRequest["horizon"])
      : "EVENT",
    riskTolerance: ["LOW", "MEDIUM", "HIGH"].includes(
      String(body.riskTolerance),
    )
      ? (body.riskTolerance as AnalysisRequest["riskTolerance"])
      : "MEDIUM",
    dataMode: ["DEMO", "OFFICIAL", "LOCAL_RESEARCH"].includes(
      String(body.dataMode),
    )
      ? (body.dataMode as AnalysisRequest["dataMode"])
      : "DEMO",
    thesis: String(body.thesis || "").slice(0, 2_000),
  };
}

export async function analyzeEquity(
  input: AnalysisRequest,
): Promise<ResearchReport> {
  const market = inferMarket(input.symbol, input.market);
  const sources: SourceRecord[] = [];

  if (input.dataMode !== "DEMO") {
    const [official, vibe] = await Promise.all([
      probeOfficialSource(input.symbol, market),
      probeVibeMcp(),
    ]);
    sources.push(official, vibe);
  }

  if (input.symbol === "NVDA") {
    const report = makeNvdaDemoReport(input, sources);
    report.meta.market = market === "US" ? "NASDAQ" : market;
    if (
      input.dataMode !== "DEMO" &&
      sources.some((source) => source.status === "connected")
    ) {
      report.meta.asOf = "混合模式 · 官方连接状态已验证，分析样例待实时一致预期替换";
    }
    return report;
  }

  const gaps = [
    "未获得带冻结时间的一致预期与买方高端门槛。",
    "核心 KPI 的 t/t-1/t-4/t-8 历史序列不完整。",
    "毛利率桥接、GAAP/非 GAAP 调整项未验证。",
    "事件期权、借券成本与拥挤度未形成同一时间快照。",
  ];

  return makeConditionalReport(input, sources, gaps);
}

