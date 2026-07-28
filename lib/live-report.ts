import { makeNvdaDemoReport } from "./demo-report";
import type { ConsensusSnapshot } from "./providers/nasdaq-consensus";
import type { MarketSnapshot } from "./providers/vibe-mcp";
import type { AnalysisRequest, ResearchReport, SourceRecord } from "./types";

function eps(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `$${value.toFixed(2)}`;
}

function range(low: number | null, high: number | null): string {
  if (
    low === null ||
    high === null ||
    !Number.isFinite(low) ||
    !Number.isFinite(high)
  ) {
    return "高低值未提供";
  }
  return `${eps(low)}–${eps(high)}`;
}

function revisionText(up: number | null, down: number | null): string {
  return `近端修正：上调 ${up ?? "—"} / 下调 ${down ?? "—"}`;
}

export function makeNvdaLiveScreenReport(
  input: AnalysisRequest,
  consensus: ConsensusSnapshot,
  market: MarketSnapshot,
  sources: SourceRecord[],
): ResearchReport {
  const report = makeNvdaDemoReport(input, sources);
  const [currentQuarter, nextQuarter] = consensus.quarterly;
  const [fy1, fy2] = consensus.yearly;
  const frozenAt = new Date(consensus.asOf).toISOString();
  const positiveRevisions =
    (currentQuarter.up ?? 0) > (currentQuarter.down ?? 0);

  report.meta = {
    ...report.meta,
    asOf: `行情 ${market.asOf.slice(0, 10)} · 一致预期 ${frozenAt.slice(
      0,
      10,
    )}`,
    freezeTime: frozenAt,
    isDemo: false,
    liveDataReady: true,
    dataDisclosure:
      "实时实施链路已连接：行情来自 dev0 只读 MCP，EPS 一致预期来自 Nasdaq。收入一致预期、公司 KPI 与毛利率门槛尚未补齐，因此方向强制为 WAIT。",
  };
  report.decision = {
    side: "WAIT",
    confidence: 58,
    actionability: "screen-grade",
    oneLine:
      "行情与 EPS 一致预期已冻结，但缺少收入、数据中心 KPI 和毛利率指引门槛，暂不生成 LONG / SHORT。",
    pricedIn:
      "EPS 修正可观察，但仅凭 EPS 与近月价格无法区分收入兑现、产品组合和估值压缩。",
    variantView: positiveRevisions
      ? "近期 EPS 上调多于下调，属于偏正面的跟踪信号；需要收入与毛利率证据确认。"
      : "近期 EPS 修正未形成明确正向斜率；等待公司 KPI 与指引证据。",
    sizing:
      input.positionSide === "NONE"
        ? "保持空仓；收入一致预期与毛利率门槛补齐前不建立事件仓位"
        : "不新增事件风险；现有仓位按预设财报损失预算管理",
    invalidation:
      "这是证据完整性判断，不是对 NVIDIA 基本面或股价方向的否定。",
  };
  report.tape = [
    {
      label: "最新收盘",
      value: `$${market.lastClose.toFixed(2)}`,
      change: `${market.asOf.slice(0, 10)} · dev0`,
      tone: "neutral",
    },
    {
      label: "近月走势",
      value: `${market.periodReturnPct >= 0 ? "+" : ""}${market.periodReturnPct.toFixed(1)}%`,
      change: `${market.bars} 个交易日`,
      tone: market.periodReturnPct >= 0 ? "positive" : "negative",
    },
    {
      label: `${currentQuarter.fiscalEnd} EPS`,
      value: eps(currentQuarter.consensusEPSForecast),
      change: revisionText(currentQuarter.up, currentQuarter.down),
      tone: positiveRevisions ? "positive" : "neutral",
    },
    {
      label: "证据门槛",
      value: "WAIT",
      change: "收入 / 毛利率待补",
      tone: "negative",
    },
  ];
  report.expectations = [
    {
      metric: "EPS 一致预期",
      t: eps(currentQuarter.consensusEPSForecast),
      t1: eps(nextQuarter.consensusEPSForecast),
      t4: fy1 ? eps(fy1.consensusEPSForecast) : "—",
      t8: fy2 ? eps(fy2.consensusEPSForecast) : "—",
      evidence: "consensus",
      debate: `${currentQuarter.fiscalEnd} 区间 ${range(
        currentQuarter.lowEPSForecast,
        currentQuarter.highEPSForecast,
      )}；${currentQuarter.noOfEstimates ?? "—"} 份预测。`,
    },
    {
      metric: "预测修正（上 / 下）",
      t: `${currentQuarter.up ?? "—"} / ${currentQuarter.down ?? "—"}`,
      t1: `${nextQuarter.up ?? "—"} / ${nextQuarter.down ?? "—"}`,
      t4: fy1 ? `${fy1.up ?? "—"} / ${fy1.down ?? "—"}` : "—",
      t8: fy2 ? `${fy2.up ?? "—"} / ${fy2.down ?? "—"}` : "—",
      evidence: "consensus",
      debate: "修正方向是先行信号，但不能替代收入结构与指引验证。",
    },
    {
      metric: "总收入一致预期",
      t: "待接入",
      t1: "待接入",
      t4: "待接入",
      t8: "待接入",
      evidence: "missing",
      debate: "缺少收入高端门槛，无法判断 headline beat 的质量。",
    },
    {
      metric: "非 GAAP 毛利率",
      t: "待验证",
      t1: "待验证",
      t4: "待验证",
      t8: "待验证",
      evidence: "missing",
      debate: "新品爬坡成本与产品组合仍是方向判断的核心缺口。",
    },
  ];
  report.scenarios = report.scenarios.map((scenario) => ({
    ...scenario,
    revenue: "数据缺口：不计算",
    grossMargin: "数据缺口：不计算",
    eps:
      scenario.name === "Bull"
        ? `高于 ${eps(currentQuarter.highEPSForecast)}`
        : scenario.name === "Bear"
          ? `低于 ${eps(currentQuarter.lowEPSForecast)}`
          : `接近 ${eps(currentQuarter.consensusEPSForecast)}`,
    multiple: "估值基准未冻结",
    target: "不计算",
    returnPct: 0,
    trigger:
      scenario.name === "Bull"
        ? "EPS 超过高端且收入、毛利率证据同步转绿。"
        : scenario.name === "Bear"
          ? "EPS 低于低端且收入或毛利率指引下修。"
          : "EPS 贴近一致预期，等待收入结构和毛利率解释。",
  }));
  report.actionPlan = {
    ...report.actionPlan,
    preEvent:
      input.positionSide === "NONE"
        ? "保持空仓；关键证据补齐前不建立事件仓位。"
        : "不增加事件敞口；按既定损失预算管理现有仓位。",
    beat:
      "只有 EPS、收入门槛和毛利率指引同时通过，才进入财报后做多复核；当前系统不自动下单。",
    inline:
      "若仅 EPS 符合预期，维持 WAIT，等待电话会和卖方模型更新。",
    miss:
      "若 EPS 低于低端，同时收入或毛利率下修，优先减小已有风险并重新评估。",
  };
  report.evidenceGaps = [
    "尚未接入收入一致预期及买方高端门槛。",
    "数据中心、网络、平台出货等公司特定 KPI 缺少同一冻结时间的历史序列。",
    "GAAP / 非 GAAP 毛利率桥接与下一季指引区间尚未验证。",
    "覆盖财报的期权隐含波动、借券成本与拥挤度尚未形成同一快照。",
  ];
  return report;
}
