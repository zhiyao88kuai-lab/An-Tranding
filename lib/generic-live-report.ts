import { makeNvdaDemoReport } from "./demo-report";
import type {
  UsCompanyEvidence,
  UsFundamentalPeriod,
} from "./providers/us-company-evidence";
import type {
  UsPositioningSnapshot,
} from "./providers/nvda-evidence";
import type { ConsensusSnapshot } from "./providers/nasdaq-consensus";
import type { MarketSnapshot } from "./providers/vibe-mcp";
import type {
  AnalysisRequest,
  DecisionSide,
  ResearchReport,
  SourceRecord,
} from "./types";

function eps(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `$${value.toFixed(2)}`;
}

function moneyB(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `$${value.toFixed(1)}B`;
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(1)}%`;
}

function signedPct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function price(value: number): string {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function changePct(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }
  return (current / previous - 1) * 100;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function nearestPeriod(
  periods: UsFundamentalPeriod[],
  latestDate: string,
  daysBack: number,
): UsFundamentalPeriod | undefined {
  const target =
    new Date(`${latestDate}T00:00:00Z`).getTime() - daysBack * 86_400_000;
  return periods
    .map((period) => ({
      period,
      distance: Math.abs(
        new Date(`${period.end}T00:00:00Z`).getTime() - target,
      ),
    }))
    .filter((row) => row.distance <= 75 * 86_400_000)
    .sort((a, b) => a.distance - b.distance)[0]?.period;
}

function revisionText(up: number | null, down: number | null): string {
  return `近 4 周上调 ${up ?? "—"} / 下调 ${down ?? "—"}`;
}

function sourceLedger(
  symbol: string,
  generatedAt: string,
  sources: SourceRecord[],
): SourceRecord[] {
  const base: SourceRecord[] = [
    {
      name: "Public Equity Investing workflow",
      provider: "OpenAI curated skill",
      status: "connected",
      asOf: generatedAt,
      tier: "LOCAL",
      note:
        "用于一致预期、KPI、毛利率、情景、催化剂、管理层问题与证据门槛；不是行情源。",
    },
    {
      name: "global-stock-data adapter",
      provider: "SEC / Nasdaq / FINRA public routes",
      status: "connected",
      asOf: generatedAt,
      tier: "S",
      note: `${symbol} 走美股官方源优先路由；受许可限制的数据不会用替代指标冒充。`,
    },
    {
      name: "a-stock-data adapter",
      provider: "Tencent / CNINFO / local CN routes",
      status: "restricted",
      asOf: generatedAt,
      tier: "LOCAL",
      note: "已配置为 A 股代码路由；本次为美股，不调用 A 股端点。",
    },
  ];
  const seen = new Set<string>();
  return [...base, ...sources].filter((source) => {
    const key = `${source.name}|${source.provider}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function semiconductorQuestions(): ResearchReport["managementQuestions"] {
  return [
    {
      topic: "需求与产品组合",
      question:
        "请量化数据中心、HBM/高带宽产品与传统客户端需求对下一季收入增量的贡献，并说明订单取消或延期是否变化。",
      whyItMatters: "区分结构性 AI 需求与传统存储周期反弹。",
    },
    {
      topic: "毛利率桥接",
      question:
        "下一季毛利率相对本季的变化，分别有多少来自售价、产品组合、成本下降、良率和库存会计？",
      whyItMatters: "判断利润率改善是否可持续，而非仅由周期峰值推动。",
    },
    {
      topic: "供给纪律",
      question:
        "DRAM、NAND 与高端封装的产能和资本开支如何分配？行业新增供给何时可能追上需求？",
      whyItMatters: "决定上行周期的持续时间和估值应使用峰值还是中周期盈利。",
    },
    {
      topic: "价格与库存",
      question:
        "DRAM/NAND ASP、bit shipment 和客户库存天数的最新变化是什么，当前订单可见度覆盖到哪个季度？",
      whyItMatters: "把收入增长拆成价格、数量与库存补库三个驱动。",
    },
    {
      topic: "长期合同与客户集中",
      question:
        "高价值产品的长期协议包含哪些价格重置和数量承诺，前五大客户集中度是否上升？",
      whyItMatters: "评估需求可见度、议价权与潜在单一客户风险。",
    },
  ];
}

export function makeGenericUsLiveReport(
  input: AnalysisRequest,
  consensus: ConsensusSnapshot,
  market: MarketSnapshot,
  official: UsCompanyEvidence,
  positioning: UsPositioningSnapshot | undefined,
  sources: SourceRecord[],
): ResearchReport {
  const report = makeNvdaDemoReport(input, []);
  const generatedAt = new Date().toISOString();
  const [currentQuarter, nextQuarter] = consensus.quarterly;
  const [fy1, fy2] = consensus.yearly;
  const latest = official.periods[0];
  const previousQuarter = nearestPeriod(official.periods, latest.end, 91);
  const previousYear = nearestPeriod(official.periods, latest.end, 365);
  const twoYearsAgo = nearestPeriod(official.periods, latest.end, 730);
  const revenueYoy = changePct(latest.revenueB, previousYear?.revenueB);
  const revenueQoq = changePct(latest.revenueB, previousQuarter?.revenueB);
  const marginQoq =
    latest.grossMarginPct !== null &&
    previousQuarter?.grossMarginPct !== null &&
    previousQuarter?.grossMarginPct !== undefined
      ? latest.grossMarginPct - previousQuarter.grossMarginPct
      : null;
  const marginYoy =
    latest.grossMarginPct !== null &&
    previousYear?.grossMarginPct !== null &&
    previousYear?.grossMarginPct !== undefined
      ? latest.grossMarginPct - previousYear.grossMarginPct
      : null;
  const currentRevision = (currentQuarter.up ?? 0) - (currentQuarter.down ?? 0);
  const fyRevision = (fy1?.up ?? 0) - (fy1?.down ?? 0);
  const forwardEps =
    fy2?.consensusEPSForecast ?? fy1?.consensusEPSForecast ?? null;
  const forwardPe =
    forwardEps && forwardEps > 0 ? market.lastClose / forwardEps : null;
  const evidenceScore =
    (currentRevision > 0 ? 1 : currentRevision < 0 ? -1 : 0) +
    (fyRevision > 0 ? 1 : fyRevision < 0 ? -1 : 0) +
    (revenueYoy !== null && revenueYoy > 5
      ? 1
      : revenueYoy !== null && revenueYoy < -5
        ? -1
        : 0) +
    (marginYoy !== null && marginYoy > 1
      ? 1
      : marginYoy !== null && marginYoy < -1
        ? -1
        : 0) +
    (market.periodReturnPct > 5
      ? 1
      : market.periodReturnPct < -5
        ? -1
        : 0);
  const probabilities =
    evidenceScore >= 3
      ? { bull: 45, base: 40, bear: 15 }
      : evidenceScore <= -2
        ? { bull: 15, base: 45, bear: 40 }
        : { bull: 30, base: 50, bear: 20 };
  const bullTarget =
    forwardEps && forwardPe
      ? forwardEps * 1.12 * forwardPe * 1.18
      : market.lastClose * 1.32;
  const baseTarget =
    forwardEps && forwardPe
      ? forwardEps * 1.02 * forwardPe * 0.98
      : market.lastClose;
  const bearTarget =
    forwardEps && forwardPe
      ? forwardEps * 0.8 * forwardPe * 0.75
      : market.lastClose * 0.6;
  const scenarioReturn = (target: number) =>
    Math.round((target / market.lastClose - 1) * 100);
  const weightedReturn =
    (probabilities.bull * scenarioReturn(bullTarget) +
      probabilities.base * scenarioReturn(baseTarget) +
      probabilities.bear * scenarioReturn(bearTarget)) /
    100;
  const decisionSide: DecisionSide =
    weightedReturn >= 8 ? "LONG" : weightedReturn <= -8 ? "SHORT" : "WAIT";
  const guidance = official.guidance;
  const guideLow = guidance
    ? guidance.revenueB -
      (guidance.revenueRangeB ??
        (guidance.revenueB * (guidance.revenueRangePct || 0)) / 100)
    : null;
  const guideHigh = guidance
    ? guidance.revenueB +
      (guidance.revenueRangeB ??
        (guidance.revenueB * (guidance.revenueRangePct || 0)) / 100)
    : null;
  const marginLow =
    guidance?.grossMarginPct !== null &&
    guidance?.grossMarginPct !== undefined
      ? guidance.grossMarginPct -
        (guidance.grossMarginRangeBps || 0) / 100
      : latest.grossMarginPct;
  const marginHigh =
    guidance?.grossMarginPct !== null &&
    guidance?.grossMarginPct !== undefined
      ? guidance.grossMarginPct +
        (guidance.grossMarginRangeBps || 0) / 100
      : latest.grossMarginPct;
  const eventDate = official.estimatedNextEarningsDate;
  const hasOptions = Boolean(positioning?.options?.eventIsolated);
  const revisionsPositive = currentRevision > 0 || fyRevision > 0;
  const semiconductors = /semiconductor/i.test(official.industry);

  report.meta = {
    ...report.meta,
    symbol: official.symbol,
    company: input.companyName?.trim() || official.company,
    market: official.exchange,
    asOf: `行情 ${market.asOf.slice(0, 10)} · EPS ${consensus.asOf.slice(
      0,
      10,
    )} · SEC ${official.latestEarningsFilingDate}`,
    generatedAt,
    freezeTime: new Date(
      Math.max(
        new Date(market.asOf).getTime(),
        new Date(consensus.asOf).getTime(),
        new Date(`${official.latestEarningsFilingDate}T00:00:00Z`).getTime(),
      ),
    ).toISOString(),
    expectationPeriodLabels: [
      "本季 EPS / 最新实际",
      "下季 EPS / 上季实际",
      "FY1 / 去年同期",
      "FY2 / 两年前同期",
    ],
    isDemo: false,
    liveDataReady: true,
    dataDisclosure:
      "实时分析已完成：SEC 单季财务、一致预期、行情与定位信号已冻结；缺少的收入卖方一致预期、正式财报日期或借券数据会单独标记，不再清空整份报告。",
  };
  report.decision = {
    side: decisionSide,
    confidence: Math.min(
      82,
      58 +
        (guidance ? 6 : 0) +
        (hasOptions ? 5 : 0) +
        (official.periods.length >= 8 ? 5 : 2) +
        (positioning?.shortVolume ? 3 : 0),
    ),
    actionability: decisionSide === "SHORT" ? "conditional" : "conditional",
    oneLine:
      decisionSide === "LONG"
        ? "基本面、盈利修正和概率加权回报同时通过偏多门槛；建议小仓分批参与，不以财报跳空追价。"
        : decisionSide === "SHORT"
          ? "盈利修正与经营趋势偏弱，情景偏度为负；仅建议限定最大损失的看空表达，借券未验证前不扩大裸空。"
          : "经营趋势与一致预期已有真实数据，但财报前的上行和周期回撤并不形成足够赔率；建议等待或仅保留核心仓。",
    pricedIn: forwardPe
      ? `现价约为 ${forwardPe.toFixed(1)}× ${
          fy2?.fiscalEnd || fy1?.fiscalEnd || "远期"
        } EPS；${market.bars} 日价格回报 ${signedPct(
          market.periodReturnPct,
        )}，情景概率加权回报 ${signedPct(weightedReturn)}。`
      : `远期 EPS 为负或缺失，未使用无意义的 P/E；${market.bars} 日价格回报 ${signedPct(
          market.periodReturnPct,
        )}。`,
    variantView: `最新单季收入 ${moneyB(
      latest.revenueB,
    )}，同比 ${signedPct(revenueYoy)}、环比 ${signedPct(
      revenueQoq,
    )}；GAAP 毛利率 ${pct(latest.grossMarginPct)}，同比变化 ${
      marginYoy === null ? "—" : `${marginYoy >= 0 ? "+" : ""}${marginYoy.toFixed(1)}pct`
    }。`,
    sizing:
      input.positionSide === "NONE"
        ? decisionSide === "LONG"
          ? "财报前最多先建计划仓位的 0.25×；其余等待收入、毛利率和电话会确认后再分批"
          : "保持空仓或观察仓，等待财报门槛触发"
        : input.positionSide === "LONG"
          ? `当前 ${input.positionWeight.toFixed(
              0,
            )}% 多头仓位不再增加事件风险；按组合净值 35–60bp 设定最大财报损失`
          : "不扩大裸空；若需要表达看空，只使用预先限定最大损失的结构",
    invalidation:
      decisionSide === "LONG"
        ? `若收入低于 ${moneyB(guideLow ?? latest.revenueB)}、毛利率低于 ${pct(
            marginLow,
          )}，或 FY1/FY2 EPS 财报后转为净下修，偏多框架失效。`
        : decisionSide === "SHORT"
          ? `若收入越过 ${moneyB(guideHigh ?? latest.revenueB * 1.05)}、毛利率高于 ${pct(
              marginHigh,
            )} 且远期 EPS 继续上修，看空框架失效。`
          : "若收入、毛利率和远期 EPS 修正三项同时转绿，WAIT 可升级为 LONG；两项同时转红则转为防守。",
  };
  report.tape = [
    {
      label: "最新收盘",
      value: `$${market.lastClose.toFixed(2)}`,
      change: `${market.asOf.slice(0, 10)} · ${signedPct(
        market.periodReturnPct,
      )} / ${market.bars} 日`,
      tone: market.periodReturnPct >= 0 ? "positive" : "negative",
    },
    {
      label: "最新单季收入",
      value: moneyB(latest.revenueB),
      change: `同比 ${signedPct(revenueYoy)} · 环比 ${signedPct(revenueQoq)}`,
      tone:
        revenueYoy !== null && revenueYoy > 0
          ? "positive"
          : revenueYoy !== null && revenueYoy < 0
            ? "negative"
            : "neutral",
    },
    {
      label: `${currentQuarter.fiscalEnd} EPS`,
      value: eps(currentQuarter.consensusEPSForecast),
      change: revisionText(currentQuarter.up, currentQuarter.down),
      tone: currentRevision > 0 ? "positive" : currentRevision < 0 ? "negative" : "neutral",
    },
    {
      label: "财报隐含波动",
      value: positioning?.options
        ? `±${positioning.options.impliedMovePct.toFixed(1)}%`
        : "未验证",
      change: positioning?.options
        ? `${positioning.options.expiry} · ATM ${price(
            positioning.options.strike,
          )}`
        : "不用于目标价",
      tone: hasOptions ? "neutral" : "negative",
    },
  ];
  report.expectations = [
    {
      metric: "EPS 一致预期",
      t: eps(currentQuarter.consensusEPSForecast),
      t1: eps(nextQuarter?.consensusEPSForecast),
      t4: eps(fy1?.consensusEPSForecast),
      t8: eps(fy2?.consensusEPSForecast),
      evidence: "consensus",
      debate: `${currentQuarter.noOfEstimates ?? "—"} 份预测；区间 ${eps(
        currentQuarter.lowEPSForecast,
      )}–${eps(currentQuarter.highEPSForecast)}；${revisionText(
        currentQuarter.up,
        currentQuarter.down,
      )}。`,
    },
    {
      metric: "GAAP 收入",
      t: moneyB(latest.revenueB),
      t1: moneyB(previousQuarter?.revenueB),
      t4: moneyB(previousYear?.revenueB),
      t8: moneyB(twoYearsAgo?.revenueB),
      evidence: "verified",
      debate: guidance
        ? `${guidance.period} 公司指引 ${moneyB(guideLow)}–${moneyB(
            guideHigh,
          )}；不是卖方收入一致预期。`
        : "最新公司指引未能从 SEC 附件结构化提取；实际历史不受影响。",
    },
    {
      metric: "GAAP 毛利率",
      t: pct(latest.grossMarginPct),
      t1: pct(previousQuarter?.grossMarginPct),
      t4: pct(previousYear?.grossMarginPct),
      t8: pct(twoYearsAgo?.grossMarginPct),
      evidence: "verified",
      debate:
        guidance?.grossMarginPct !== null &&
        guidance?.grossMarginPct !== undefined
          ? `${guidance.period} 公司指引 ${pct(marginLow)}–${pct(
              marginHigh,
            )}；需拆解价格、组合、成本与良率。`
          : "下一季毛利率指引未结构化，重点追问价格、组合、成本与良率桥接。",
    },
    {
      metric: "GAAP 稀释 EPS",
      t: eps(latest.dilutedEps),
      t1: eps(previousQuarter?.dilutedEps),
      t4: eps(previousYear?.dilutedEps),
      t8: eps(twoYearsAgo?.dilutedEps),
      evidence: "verified",
      debate: "历史为 SEC GAAP 实际值；上方一致预期口径可能为市场调整后 EPS，不能直接混同比。",
    },
  ];
  report.kpis = [
    {
      name: "收入增长与需求广度",
      current: `${moneyB(latest.revenueB)} · 同比 ${signedPct(revenueYoy)}`,
      bar: guidance
        ? `至少达到 ${moneyB(guideHigh)} 公司指引高端`
        : `至少维持同比 ${signedPct(revenueYoy)}`,
      trend: revenueYoy !== null && revenueYoy > 0 ? "up" : "down",
      weight: 26,
      readThrough: semiconductors
        ? "必须区分 HBM/数据中心、DRAM/NAND 价格与传统终端补库。"
        : "验证增长是来自销量、价格、组合还是一次性项目。",
    },
    {
      name: "GAAP 毛利率",
      current: `${pct(latest.grossMarginPct)} · 环比 ${
        marginQoq === null
          ? "—"
          : `${marginQoq >= 0 ? "+" : ""}${marginQoq.toFixed(1)}pct`
      }`,
      bar: `不低于 ${pct(marginLow)}，并给出可审计的下一季桥接`,
      trend:
        marginQoq !== null && marginQoq > 0
          ? "up"
          : marginQoq !== null && marginQoq < 0
            ? "down"
            : "flat",
      weight: 24,
      readThrough: "价格、产品组合、成本下降、良率与库存会计需要分别量化。",
    },
    {
      name: "GAAP 营业利润率",
      current: pct(latest.operatingMarginPct),
      bar: "收入增量需继续穿透至营业利润，而非被费用扩张吞噬",
      trend:
        latest.operatingMarginPct !== null &&
        previousQuarter?.operatingMarginPct !== null &&
        previousQuarter?.operatingMarginPct !== undefined &&
        latest.operatingMarginPct > previousQuarter.operatingMarginPct
          ? "up"
          : "flat",
      weight: 18,
      readThrough: "检验增量利润率、研发投入与周期高点盈利质量。",
    },
    {
      name: "EPS 修正广度",
      current: `${currentRevision >= 0 ? "+" : ""}${currentRevision} 本季净修正 · ${
        fyRevision >= 0 ? "+" : ""
      }${fyRevision} FY1`,
      bar: `${fy2?.fiscalEnd || fy1?.fiscalEnd || "远期"} EPS 财报后不下修`,
      trend: revisionsPositive ? "up" : currentRevision < 0 ? "down" : "flat",
      weight: 18,
      readThrough: "单季 beat 只有在远期 EPS 上修时才具有估值意义。",
    },
    {
      name: semiconductors ? "周期供给 / HBM 组合" : "事件定位与拥挤度",
      current: `${hasOptions ? "事件期权已隔离" : "期权未验证"} · ${
        positioning?.shortVolume ? "FINRA 已冻结" : "FINRA 未验证"
      }`,
      bar: semiconductors
        ? "量化产能、资本开支、ASP/bit shipment 与高价值产品占比"
        : "借券和事件期权形成同一冻结快照",
      trend: "flat",
      weight: 14,
      readThrough: positioning?.shortVolume
        ? `FINRA ${positioning.shortVolume.observations} 日短成交量均值 ${positioning.shortVolume.averageShortVolumeRatioPct.toFixed(
            1,
          )}%；不等于空头持仓或借券拥挤度。`
        : "缺少事件定位数据时，系统降低操作置信度。",
    },
  ];
  report.marginDebate = {
    bull: [
      `最新 GAAP 毛利率 ${pct(latest.grossMarginPct)}，环比变化 ${
        marginQoq === null
          ? "—"
          : `${marginQoq >= 0 ? "+" : ""}${marginQoq.toFixed(1)}pct`
      }。`,
      semiconductors
        ? "高价值内存/HBM 与数据中心组合提升，加上成本下降和良率改善，可推高增量利润率。"
        : "收入增长、产品组合和规模效应若同步改善，利润率可继续扩张。",
      "若收入越过高端门槛且远期 EPS 上修，市场可能愿意看穿短期波动。",
    ],
    bear: [
      "强劲历史增速可能已反映周期低基数，不能直接外推到下一财年。",
      semiconductors
        ? "竞争对手扩产、客户库存回升或价格见顶会使利润率在高位快速均值回归。"
        : "价格、促销、投入和交付成本可能使收入增长无法穿透到利润。",
      "若公司仅达到自身指引而低于买方高端门槛，headline beat 仍可能触发估值压缩。",
    ],
    watch: [
      `GAAP 毛利率从 ${pct(previousQuarter?.grossMarginPct)} 到 ${pct(
        latest.grossMarginPct,
      )} 的逐项桥接`,
      "GAAP 与非 GAAP 调整项、股权激励、税率和一次性收益",
      semiconductors
        ? "DRAM/NAND ASP、bit shipment、库存天数、资本开支与 HBM 组合"
        : "价格、销量、产品组合、客户集中度与订单可见度",
      "财报后 FY1/FY2 EPS 修正幅度，而非只看当季 beat/miss",
    ],
  };
  report.scenarios = [
    {
      name: "Bull",
      probability: probabilities.bull,
      revenue: guidance
        ? `>${moneyB(guideHigh)}，并确认需求广度`
        : `最新同比基础上再加速 5pct+`,
      grossMargin: `>${pct(marginHigh)} 或给出继续扩张路径`,
      eps: `本季 >${eps(currentQuarter.highEPSForecast)}；远期 +12%`,
      multiple: forwardPe ? `${(forwardPe * 1.18).toFixed(1)}× FY2E EPS` : "现价 × 1.32",
      target: price(bullTarget),
      returnPct: scenarioReturn(bullTarget),
      trigger: "收入、毛利率和远期 EPS 修正三项同时转绿。",
    },
    {
      name: "Base",
      probability: probabilities.base,
      revenue: guidance
        ? `${moneyB(guideLow)}–${moneyB(guideHigh)}`
        : "增长符合当前运行速度",
      grossMargin: `${pct(marginLow)}–${pct(marginHigh)}`,
      eps: `接近 ${eps(currentQuarter.consensusEPSForecast)}；远期 +2%`,
      multiple: forwardPe ? `${(forwardPe * 0.98).toFixed(1)}× FY2E EPS` : "现价附近",
      target: price(baseTarget),
      returnPct: scenarioReturn(baseTarget),
      trigger: "执行符合预期，但不足以继续上移市场门槛。",
    },
    {
      name: "Bear",
      probability: probabilities.bear,
      revenue: guidance
        ? `<${moneyB(guideLow)} 或下一季指引放缓`
        : "收入增速明显低于当前趋势",
      grossMargin: `<${pct(marginLow)} 或峰值后快速回落`,
      eps: `本季 <${eps(currentQuarter.lowEPSForecast)}；远期 -20%`,
      multiple: forwardPe ? `${(forwardPe * 0.75).toFixed(1)}× FY2E EPS` : "现价 × 0.60",
      target: price(bearTarget),
      returnPct: scenarioReturn(bearTarget),
      trigger: "收入、毛利率或需求持续性至少两项证伪。",
    },
  ];
  report.catalysts = [
    {
      timing: `${addDays(eventDate, -14)} 至 ${addDays(eventDate, -3)}（预计）`,
      event: semiconductors
        ? "行业价格、云厂商 Capex 与供应链读数"
        : "同业财报、行业需求与供应链读数",
      impact: "two-sided",
      watch: semiconductors
        ? "HBM/DRAM/NAND 价格、客户库存、资本开支与竞争供给。"
        : "订单斜率、价格、库存、客户预算和同业指引。",
    },
    {
      timing: `${eventDate}（SEC 申报节奏估算，未官宣）`,
      event: `${official.symbol} 财报与下一季指引`,
      impact: "two-sided",
      watch: `收入相对 ${moneyB(
        guideHigh ?? latest.revenueB,
      )} 门槛、毛利率、需求持续性与 FY1/FY2 EPS。`,
    },
    {
      timing: `${addDays(eventDate, 1)} 至 ${addDays(eventDate, 2)}（预计）`,
      event: "电话会与卖方模型重置",
      impact: "two-sided",
      watch: `${fy2?.fiscalEnd || "远期"} EPS 修正、目标倍数与高端买方门槛变化。`,
    },
    {
      timing: `${addDays(eventDate, 28)} 至 ${addDays(eventDate, 56)}（预计）`,
      event: semiconductors
        ? "产品交付、行业价格与资本开支更新"
        : "产品交付与经营指标验证",
      impact: "positive",
      watch: "财报后的实际兑现能否支撑情景估值。",
    },
  ];
  report.managementQuestions = semiconductors
    ? semiconductorQuestions()
    : [
        {
          topic: "收入质量",
          question: "下一季收入增长分别来自销量、价格、产品组合和并购/汇率的多少？",
          whyItMatters: "判断增长是否可持续且可重复。",
        },
        {
          topic: "毛利率桥接",
          question: "请量化价格、组合、投入、供应链与效率对下一季毛利率的影响。",
          whyItMatters: "区分短期成本与结构性利润率变化。",
        },
        {
          topic: "订单可见度",
          question: "当前订单、取消/延期率与客户库存覆盖到哪个季度？",
          whyItMatters: "检验下一季指引与需求持续性。",
        },
        {
          topic: "资本配置",
          question: "增长投入、回购、债务和并购的优先级如何，回报门槛是多少？",
          whyItMatters: "连接自由现金流与每股价值。",
        },
        {
          topic: "竞争",
          question: "过去一个季度赢单/丢单的主要原因是什么，定价和份额有何变化？",
          whyItMatters: "测试护城河和长期利润率中枢。",
        },
      ];
  report.actionPlan = {
    preEvent:
      input.positionSide === "NONE"
        ? decisionSide === "LONG"
          ? "最多先建计划仓位的 0.25×，不追逐财报前加速；其余等待门槛确认。"
          : "不建立完整事件仓；等待财报或仅保留观察仓。"
        : input.positionSide === "LONG"
          ? `维持核心仓，不追加事件仓；若 ${input.positionWeight.toFixed(
              0,
            )}% 仓位乘以财报波动超过组合净值 35–60bp 风险预算，则提前减仓。`
          : "不扩大裸空；优先用最大损失预先确定的结构。",
    beat: `收入 >${moneyB(
      guideHigh ?? latest.revenueB * 1.05,
    )}、毛利率 >${pct(
      marginHigh,
    )} 且远期 EPS 上修：等待首日波动收敛后再增加 0.25×。`,
    inline: `收入和毛利率落在基准区间：维持 ${
      decisionSide === "LONG" ? "核心仓" : "WAIT"
    }，不因 headline beat 追价。`,
    miss: `收入 <${moneyB(
      guideLow ?? latest.revenueB * 0.95,
    )} 或毛利率 <${pct(
      marginLow,
    )}：优先降低已有风险；两项同时失守则执行预设止损并重建模型。`,
    riskControls: [
      "收入卖方一致预期和买方高端门槛未授权接入；公司指引与 SEC 实际值不冒充市场一致预期。",
      `下一财报日 ${eventDate} 为按最新 Item 2.02 申报节奏估算，正式公告后必须更新。`,
      `覆盖财报的 ATM 跨式${
        positioning?.options
          ? `隐含约 ±${positioning.options.impliedMovePct.toFixed(1)}%`
          : "未验证"
      }；只用于风险预算，不直接作为方向或目标价。`,
      "FINRA 每日短成交量不是空头持仓、借券费率或利用率；借券未接入前 SHORT 仅为条件信号。",
    ],
  };
  report.sources = sourceLedger(official.symbol, generatedAt, sources);
  report.evidenceGaps = [
    "缺少具备再分发许可的收入卖方一致预期与买方高端门槛；公司指引单独标注，不冒充一致预期。",
    `下一财报日 ${eventDate} 为 SEC 申报节奏估算，正式 IR 公告后需替换为确切日期与电话会时间。`,
    ...(guidance
      ? []
      : ["最新 SEC 附件存在，但公司收入/毛利率指引未能可靠结构化；情景以历史运行率作为替代基准。"]),
    ...(positioning?.gaps || [
      "事件期权、FINRA 短成交量与借券数据未形成同一冻结快照。",
    ]),
  ];
  return report;
}
