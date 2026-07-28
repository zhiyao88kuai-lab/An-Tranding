import { makeConditionalReport, makeNvdaDemoReport } from "./demo-report";
import { makeGenericUsLiveReport } from "./generic-live-report";
import { makeNvdaLiveScreenReport } from "./live-report";
import {
  fetchNasdaqMarketSnapshot,
  fetchNvdaOfficialSnapshot,
  fetchNvdaPositioning,
  fetchUsPositioning,
  type NvdaOfficialSnapshot,
  type NvdaPositioningSnapshot,
} from "./providers/nvda-evidence";
import {
  fetchNasdaqConsensus,
  type ConsensusSnapshot,
} from "./providers/nasdaq-consensus";
import { inferMarket, probeOfficialSource } from "./providers/official-data";
import {
  fetchUsCompanyEvidence,
  type UsCompanyEvidence,
} from "./providers/us-company-evidence";
import {
  fetchVibeMarketSnapshot,
  probeVibeCompanyEvidence,
  probeVibeMcp,
  type MarketSnapshot,
} from "./providers/vibe-mcp";
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
  let consensus: ConsensusSnapshot | undefined;
  let marketSnapshot: MarketSnapshot | undefined;
  let officialSnapshot: NvdaOfficialSnapshot | undefined;
  let companyEvidence: UsCompanyEvidence | undefined;
  let positioning: NvdaPositioningSnapshot | undefined;

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
      probeVibeMcp(input.symbol),
    ]);
    sources.push(official, vibe);

    if (market === "US") {
      const marketPromise =
        input.dataMode === "LOCAL_RESEARCH"
          ? fetchVibeMarketSnapshot(input.symbol).catch(async () => {
              const fallback = await fetchNasdaqMarketSnapshot(input.symbol);
              sources.push(fallback.source);
              return fallback;
            })
          : fetchNasdaqMarketSnapshot(input.symbol).then((snapshot) => {
              sources.push(snapshot.source);
              return snapshot;
            });
      const officialPromise =
        input.symbol === "NVDA"
          ? fetchNvdaOfficialSnapshot()
          : fetchUsCompanyEvidence(input.symbol);
      const crossCheckPromise =
        input.dataMode === "LOCAL_RESEARCH"
          ? probeVibeCompanyEvidence(input.symbol, "US")
          : Promise.resolve<SourceRecord>({
              name: "vibe_trading_dev0 financial cross-check",
              provider: "SSH tunnel + HTTP MCP",
              status: "restricted",
              asOf: new Date().toISOString(),
              tier: "LOCAL",
              note: "公开部署不访问本机 SSH 隧道；切换本机实施链路后启用财务交叉验证。",
            });
      const [consensusResult, marketResult, officialResult, crossCheckResult] =
        await Promise.allSettled([
          fetchNasdaqConsensus(input.symbol),
          marketPromise,
          officialPromise,
          crossCheckPromise,
        ]);
      if (crossCheckResult.status === "fulfilled") {
        sources.push(crossCheckResult.value);
      }
      if (consensusResult.status === "fulfilled") {
        consensus = consensusResult.value;
        sources.push(consensus.source);
      } else {
        sources.push({
          name: "Analyst EPS consensus",
          provider: "Nasdaq analyst forecast API",
          status: "missing",
          asOf: new Date().toISOString(),
          tier: "A",
          note:
            consensusResult.reason instanceof Error
              ? consensusResult.reason.message
              : "一致预期连接失败",
        });
      }
      if (marketResult.status === "fulfilled") {
        marketSnapshot = marketResult.value;
        if (input.dataMode === "LOCAL_RESEARCH") {
          vibe.status = "connected";
          vibe.asOf = marketSnapshot.asOf;
          vibe.note = `已验证 ${marketSnapshot.bars} 条只读日线行情。`;
        }
      } else {
        vibe.note = `${
          vibe.status === "connected" ? "MCP 基础连接正常；" : ""
        }行情快照失败：${
          marketResult.reason instanceof Error
            ? marketResult.reason.message
            : "未知错误"
        }`;
      }
      if (officialResult.status === "fulfilled") {
        if (input.symbol === "NVDA") {
          officialSnapshot = officialResult.value as NvdaOfficialSnapshot;
          sources.push(officialSnapshot.source);
        } else {
          companyEvidence = officialResult.value as UsCompanyEvidence;
          sources.push(companyEvidence.source);
        }
      } else {
        sources.push({
          name: `${input.symbol} reported results & outlook`,
          provider: "SEC EDGAR earnings exhibit · global-stock-data",
          status: "missing",
          asOf: new Date().toISOString(),
          tier: "S",
          note:
            officialResult.reason instanceof Error
              ? officialResult.reason.message
              : "SEC 公司事实连接失败",
        });
      }
      if (marketSnapshot) {
        positioning =
          input.symbol === "NVDA"
            ? await fetchNvdaPositioning(
                input.symbol,
                marketSnapshot.lastClose,
              )
            : await fetchUsPositioning(
                input.symbol,
                marketSnapshot.lastClose,
                companyEvidence?.estimatedNextEarningsDate,
              );
        sources.push(...positioning.sources);
      }
    }

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

  if (input.symbol === "NVDA" && input.dataMode === "DEMO") {
    const report = makeNvdaDemoReport(input, sources);
    report.meta.market = market === "US" ? "NASDAQ" : market;
    reportProgress({
      stage: "evidence",
      status: "done",
      message: "已载入明确标记的演示证据",
      detail: "所有数值保持非实时标识，不用于交易。",
    });
    reportProgress({
      stage: "scenarios",
      status: "done",
      message: "已生成演示情景与仓位规则",
      detail: "Bull / Base / Bear 概率合计 100%。",
    });
    return report;
  }

  if (
    input.symbol === "NVDA" &&
    input.dataMode !== "DEMO" &&
    consensus &&
    marketSnapshot &&
    officialSnapshot
  ) {
    const coreGaps = positioning?.gaps.length ?? 1;
    reportProgress({
      stage: "evidence",
      status: coreGaps > 0 ? "warning" : "done",
      message: "公司事实、行情、EPS 一致预期与定位信号已冻结",
      detail:
        "SEC 已补齐收入、数据中心 KPI 与 GAAP/非 GAAP 毛利率；收入卖方一致预期和借券数据保持许可受限标记。",
    });
    reportProgress({
      stage: "scenarios",
      status: "done",
      message: "已生成可审计的 Bull / Base / Bear 情景估值",
      detail:
        "目标价由远期 EPS 一致预期与显式市盈率假设计算；不把期权隐含波动当作方向。",
    });
    return makeNvdaLiveScreenReport(
      input,
      consensus,
      marketSnapshot,
      officialSnapshot,
      positioning,
      sources,
    );
  }

  if (
    market === "US" &&
    input.symbol !== "NVDA" &&
    input.dataMode !== "DEMO" &&
    consensus &&
    marketSnapshot &&
    companyEvidence
  ) {
    reportProgress({
      stage: "evidence",
      status: companyEvidence.guidance ? "done" : "warning",
      message: `${input.symbol} 的 SEC 单季财务、一致预期与行情已冻结`,
      detail: `${companyEvidence.periods.length} 个单季事实已去重；${
        companyEvidence.guidance
          ? `${companyEvidence.guidance.period} 公司指引已提取`
          : "公司指引未结构化，历史实际值与 EPS 一致预期仍可用于建模"
      }。`,
    });
    reportProgress({
      stage: "scenarios",
      status: "done",
      message: "已完成 KPI、毛利率争议与 Bull / Base / Bear 情景",
      detail:
        "目标价由远期 EPS、一致预期修正和显式倍数假设计算；缺口单列，不再返回空报告。",
    });
    return makeGenericUsLiveReport(
      input,
      consensus,
      marketSnapshot,
      companyEvidence,
      positioning,
      sources,
    );
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
