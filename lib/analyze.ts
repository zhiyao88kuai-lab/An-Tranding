import { makeConditionalReport, makeNvdaDemoReport } from "./demo-report";
import { inferMarket, probeOfficialSource } from "./providers/official-data";
import { probeVibeMcp } from "./providers/vibe-mcp";
import type {
  AnalysisProgressUpdate,
  AnalysisRequest,
  ResearchReport,
  SourceRecord,
} from "./types";

type ProgressReporter = (update: AnalysisProgressUpdate) => void;

const noopProgress: ProgressReporter = () => {};

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
  reportProgress: ProgressReporter = noopProgress,
): Promise<ResearchReport> {
  const market = inferMarket(input.symbol, input.market);
  const sources: SourceRecord[] = [];

  reportProgress({
    stage: "route",
    status: "done",
    message: `已识别 ${market} 市场路由`,
    detail:
      market === "CN"
        ? "a-stock-data + vibe_trading_dev0"
        : "global-stock-data + vibe_trading_dev0",
  });

  if (input.dataMode !== "DEMO") {
    reportProgress({
      stage: "sources",
      status: "running",
      message: "正在验证官方数据源与 dev0 MCP",
      detail: "连接结果会写入证据账本；失败不会回填伪数据。",
    });
    const [official, vibe] = await Promise.all([
      probeOfficialSource(input.symbol, market),
      probeVibeMcp(),
    ]);
    sources.push(official, vibe);
    const connected = sources.filter(
      (source) => source.status === "connected",
    ).length;
    reportProgress({
      stage: "sources",
      status: connected > 0 ? "done" : "warning",
      message:
        connected > 0
          ? `已连接 ${connected}/${sources.length} 个数据源`
          : "实时数据源未连接",
      detail: sources
        .map((source) => `${source.name}: ${source.status}`)
        .join("；"),
    });
  } else {
    reportProgress({
      stage: "sources",
      status: "skipped",
      message: "演示模式：未请求实时数据",
      detail: "将加载明确标记的功能样例，不用于交易。",
    });
  }

  reportProgress({
    stage: "evidence",
    status: "running",
    message: "正在检查一致预期与证据门槛",
    detail: "核对冻结时间、GAAP 口径、KPI 历史序列与做空约束。",
  });

  if (input.symbol === "NVDA") {
    const report = makeNvdaDemoReport(input, sources);
    report.meta.market = market === "US" ? "NASDAQ" : market;
    if (
      input.dataMode !== "DEMO" &&
      sources.some((source) => source.status === "connected")
    ) {
      report.meta.asOf =
        "混合模式 · 官方连接状态已验证，分析样例待实时一致预期替换";
    }
    reportProgress({
      stage: "evidence",
      status: "warning",
      message: "实时一致预期未接入，报告保持演示标识",
      detail: "不会把连接探测结果冒充为实时财报预测。",
    });
    reportProgress({
      stage: "scenarios",
      status: "done",
      message: "已生成演示情景与仓位规则",
      detail: "Bull / Base / Bear 概率合计 100%。",
    });
    return report;
  }

  const gaps = [
    "未获得带冻结时间的一致预期与买方高端门槛。",
    "核心 KPI 的 t/t-1/t-4/t-8 历史序列不完整。",
    "毛利率桥接、GAAP/非 GAAP 调整项未验证。",
    "事件期权、借券成本与拥挤度未形成同一时间快照。",
  ];

  reportProgress({
    stage: "evidence",
    status: "warning",
    message: "关键实时证据不足，方向门槛未通过",
    detail: "系统将输出 WAIT，而不是 LONG / SHORT。",
  });
  reportProgress({
    stage: "scenarios",
    status: "skipped",
    message: "未生成可交易目标价",
    detail: "缺少一致预期和估值基准，情景值保持不可计算。",
  });
  return makeConditionalReport(input, sources, gaps);
}

