import type {
  CnCompanyEvidence,
  CnFinancialPeriod,
  CnForecastPeriod,
} from "./providers/cn-company-evidence";
import type {
  AnalysisRequest,
  DecisionSide,
  ResearchReport,
  SourceRecord,
} from "./types";

function valueOrDash(
  value: number | null | undefined,
  formatter: (number: number) => string,
): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : formatter(value);
}

function moneyB(value: number | null | undefined): string {
  return valueOrDash(value, (number) => `¥${number.toFixed(2)}B`);
}

function cny(value: number | null | undefined): string {
  return valueOrDash(value, (number) => `¥${number.toFixed(2)}`);
}

function pct(value: number | null | undefined): string {
  return valueOrDash(value, (number) => `${number.toFixed(1)}%`);
}

function signedPct(value: number | null | undefined): string {
  return valueOrDash(
    value,
    (number) => `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`,
  );
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

function periodFor(
  periods: CnFinancialPeriod[],
  end: string,
): CnFinancialPeriod | undefined {
  return periods.find((period) => period.end === end);
}

function sameQuarter(
  periods: CnFinancialPeriod[],
  latest: CnFinancialPeriod | undefined,
  yearsBack: number,
): CnFinancialPeriod | undefined {
  if (!latest) return undefined;
  const year = Number(latest.end.slice(0, 4)) - yearsBack;
  return periodFor(periods, `${year}${latest.end.slice(4)}`);
}

function forecastValue(
  period: CnForecastPeriod | undefined,
  field: "eps" | "profit",
): string {
  if (!period) return "缺失";
  if (field === "eps") {
    return `${period.year}E ${cny(period.meanEps)}`;
  }
  return `${period.year}E ${moneyB(period.meanNetProfitB)}`;
}

function sourceLedger(
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
        "用于一致预期、KPI、毛利率、情景、催化剂、管理层问题、仓位与证据门槛；不是行情源。",
    },
    {
      name: "a-stock-data workflow",
      provider: "Tencent / Sina / THS / exchange routes",
      status: "connected",
      asOf: generatedAt,
      tier: "LOCAL",
      note: "按输入代码现场取数并归一化；不依赖预先写入的个股模板。",
    },
    {
      name: "global-stock-data adapter",
      provider: "Global public-market routes",
      status: "restricted",
      asOf: generatedAt,
      tier: "LOCAL",
      note: "参与统一市场路由与报告 schema；本次为 A 股，不调用 SEC / Nasdaq 数据。",
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

function decisionScore(
  evidence: CnCompanyEvidence,
  latest: CnFinancialPeriod | undefined,
  previousYear: CnFinancialPeriod | undefined,
  valuationForecast: CnForecastPeriod | undefined,
  previousForecast: CnForecastPeriod | undefined,
): {
  score: number;
  revenueYoy: number | null;
  marginDelta: number | null;
  epsGrowth: number | null;
  forwardPe: number | null;
} {
  const revenueYoy = changePct(latest?.revenueB, previousYear?.revenueB);
  const marginDelta =
    latest?.grossMarginPct !== null &&
    latest?.grossMarginPct !== undefined &&
    previousYear?.grossMarginPct !== null &&
    previousYear?.grossMarginPct !== undefined
      ? latest.grossMarginPct - previousYear.grossMarginPct
      : null;
  const epsGrowth = changePct(
    valuationForecast?.meanEps,
    previousForecast?.meanEps,
  );
  const forwardPe =
    evidence.market &&
    valuationForecast &&
    valuationForecast.meanEps > 0
      ? evidence.market.price / valuationForecast.meanEps
      : null;
  let score = 0;
  if (revenueYoy !== null) {
    score += revenueYoy > 20 ? 2 : revenueYoy > 0 ? 1 : revenueYoy < -10 ? -2 : -1;
  }
  if (epsGrowth !== null) {
    score += epsGrowth > 20 ? 2 : epsGrowth > 0 ? 1 : epsGrowth < -10 ? -2 : -1;
  }
  if (forwardPe !== null) {
    score += forwardPe <= 30 ? 1 : forwardPe >= 60 ? -1 : 0;
  }
  if (marginDelta !== null) {
    score += marginDelta >= 1 ? 1 : marginDelta <= -2 ? -1 : 0;
  }
  if (evidence.market?.periodReturnPct !== null && evidence.market) {
    score +=
      evidence.market.periodReturnPct >= 10
        ? 1
        : evidence.market.periodReturnPct <= -15
          ? -1
          : 0;
  }
  return { score, revenueYoy, marginDelta, epsGrowth, forwardPe };
}

function positionGuidance(
  input: AnalysisRequest,
  side: DecisionSide,
): string {
  const weight = Math.max(0, Math.min(100, input.positionWeight || 0));
  if (input.positionSide === "NONE") {
    if (side === "LONG") {
      const starter =
        input.riskTolerance === "HIGH"
          ? "2.5%"
          : input.riskTolerance === "MEDIUM"
            ? "1.5%"
            : "0.5–1.0%";
      return `只建立不超过 ${starter} 的观察仓；预约披露日前不一次性打满事件仓位`;
    }
    return side === "SHORT"
      ? "不追空 A 股个股；等待反弹失败或用合规指数/行业工具表达对冲"
      : "保持空仓或观察仓，等待财报门槛与价格确认";
  }
  if (input.positionSide === "SHORT") {
    return side === "LONG"
      ? "基本面证据与空头方向冲突，优先降低空头而非逆势加码"
      : "不扩大裸空；先核验融券可借量、成本与强平规则";
  }
  if (weight >= 12 || input.riskTolerance === "LOW") {
    return `当前 ${weight.toFixed(0)}% 多头仓位的财报跳空风险偏高，预约披露日前降至个人事件损失预算内`;
  }
  return side === "LONG"
    ? `当前 ${weight.toFixed(0)}% 多头可保留核心仓，但不在报告日前追涨`
    : `当前 ${weight.toFixed(0)}% 多头不再加仓；按失效条件分段减仓`;
}

export function makeCnLiveReport(
  input: AnalysisRequest,
  evidence: CnCompanyEvidence,
  extraSources: SourceRecord[],
): ResearchReport {
  const generatedAt = new Date().toISOString();
  const periods = evidence.financials?.periods || [];
  const latest = periods[0];
  const previousQuarter = periods[1];
  const previousYear = sameQuarter(periods, latest, 1);
  const twoYearsAgo = sameQuarter(periods, latest, 2);
  const forecasts = evidence.consensus?.periods || [];
  const currentForecast = forecasts[0];
  const valuationForecast = forecasts[1] || forecasts[0];
  const longForecast = forecasts[2];
  const previousForecast = forecasts[0] === valuationForecast
    ? undefined
    : forecasts[0];
  const metrics = decisionScore(
    evidence,
    latest,
    previousYear,
    valuationForecast,
    previousForecast,
  );
  const coreComplete = Boolean(
    evidence.market && evidence.financials && evidence.consensus,
  );
  const evidenceReadiness = coreComplete
    ? "complete"
    : [evidence.market, evidence.financials, evidence.consensus].filter(Boolean)
          .length >= 1
      ? "partial"
      : "insufficient";
  const side: DecisionSide = !coreComplete
    ? "WAIT"
    : metrics.score >= 4
      ? "LONG"
      : metrics.score <= -4
        ? "SHORT"
        : "WAIT";
  const confidence = coreComplete
    ? Math.min(78, 56 + Math.abs(metrics.score) * 3)
    : 44;
  const currentPrice = evidence.market?.price ?? null;
  const baseMultiple = metrics.forwardPe;
  const bullTarget =
    valuationForecast && baseMultiple
      ? valuationForecast.meanEps * 1.1 * baseMultiple * 1.15
      : null;
  const baseTarget =
    valuationForecast && baseMultiple
      ? valuationForecast.meanEps * baseMultiple
      : null;
  const bearTarget =
    valuationForecast && baseMultiple
      ? valuationForecast.meanEps * 0.8 * baseMultiple * 0.8
      : null;
  const returnFor = (target: number | null) =>
    target !== null && currentPrice
      ? Math.round((target / currentPrice - 1) * 100)
      : 0;
  const probabilities =
    side === "LONG"
      ? [35, 45, 20]
      : side === "SHORT"
        ? [20, 45, 35]
        : [25, 50, 25];
  const netMargin =
    latest?.netIncomeB !== null &&
    latest?.netIncomeB !== undefined &&
    latest?.revenueB
      ? (latest.netIncomeB / latest.revenueB) * 100
      : null;
  const nextReportDate = evidence.events?.nextReportDate;
  const latestEarningsEvent = evidence.events?.latestEarningsEvent;
  const sourceCount = [
    evidence.market,
    evidence.financials,
    evidence.consensus,
    evidence.events,
  ].filter(Boolean).length;

  return {
    meta: {
      symbol: evidence.symbol,
      company: input.companyName?.trim() || evidence.company,
      market: evidence.exchange,
      asOf: [
        evidence.market?.quoteTime
          ? `行情 ${evidence.market.quoteTime.slice(0, 19)} 北京`
          : null,
        evidence.consensus?.asOf
          ? `预期 ${evidence.consensus.asOf}`
          : null,
        evidence.financials?.latestFilingDate
          ? `财务 ${evidence.financials.latestFilingDate}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      generatedAt,
      freezeTime: generatedAt,
      dataMode: input.dataMode,
      workflow: [
        "Public Equity Investing",
        "a-stock-data live collection",
        "Earnings Preview",
        "Scenario & Sensitivity",
        "Portfolio Risk",
      ],
      expectationPeriodLabels: [
        "近期 / FY1",
        "次期 / FY2",
        "同比 / FY3",
        "基准 / FY0",
      ],
      isDemo: false,
      liveDataReady: sourceCount > 0,
      evidenceReadiness,
      dataDisclosure:
        evidenceReadiness === "complete"
          ? `已按 ${evidence.symbol} 现场完成腾讯行情、新浪财务与同花顺机构预期采集；不是预置个股模板。方向为条件化研究结论，仍受公告日期、融券与买方门槛缺口约束。`
          : `已按 ${evidence.symbol} 现场采集并保留可用真实数据；核心源仅完成 ${sourceCount}/4，方向限制为 WAIT，缺失字段没有用演示值回填。`,
    },
    decision: {
      side,
      confidence,
      actionability:
        side === "SHORT"
          ? "screen-grade"
          : coreComplete
            ? "conditional"
            : "screen-grade",
      oneLine:
        side === "LONG"
          ? "盈利增速与远期估值同时通过初筛，但财报前只适合条件化偏多，不适合追涨或满仓赌事件。"
          : side === "SHORT"
            ? "盈利与利润率证据偏弱，研究方向转空；A 股融券约束未核验前只能用于减仓/对冲决策。"
            : "真实数据已完成分析，但增长、估值和价格信号尚未形成足够一致的方向优势。",
      pricedIn:
        evidence.market && valuationForecast && metrics.forwardPe
          ? `现价 ${cny(evidence.market.price)} 对应 ${valuationForecast.year}E EPS ${cny(
              valuationForecast.meanEps,
            )} 的 ${metrics.forwardPe.toFixed(1)}× P/E；20 日前复权回报 ${signedPct(
              evidence.market.periodReturnPct,
            )}。`
          : "行情与远期 EPS 尚未同时取得，不能可靠量化市场已计价程度。",
      variantView:
        latest
          ? `${latest.label} 单季收入 ${moneyB(latest.revenueB)}、同比 ${signedPct(
              metrics.revenueYoy,
            )}，毛利率 ${pct(latest.grossMarginPct)}、同比变化 ${
              metrics.marginDelta === null
                ? "—"
                : `${metrics.marginDelta >= 0 ? "+" : ""}${metrics.marginDelta.toFixed(
                    1,
                  )}pct`
            }；与 ${valuationForecast?.year || "远期"}E EPS 增速 ${signedPct(
              metrics.epsGrowth,
            )} 共同决定方向。`
          : "公司财务历史未取得，差异化观点只能停留在机构预期与价格层。",
      sizing: positionGuidance(input, side),
      invalidation:
        side === "LONG"
          ? `若下一份定期报告的收入增速低于 20%、毛利率同比下滑超过 2pct，或 ${valuationForecast?.year || "远期"} EPS 一致预期下修超过 10%，偏多框架失效。`
          : side === "SHORT"
            ? "若毛利率转升且远期 EPS 一致预期上修超过 10%，转空框架失效。"
            : "若收入、毛利率与远期 EPS 修正三项中至少两项同向改善/恶化，必须重跑并重新判定方向。",
    },
    tape: [
      {
        label: "最新价",
        value: evidence.market ? cny(evidence.market.price) : "未取得",
        change: evidence.market
          ? `${evidence.market.lastTradingDate} · 日内 ${signedPct(
              evidence.market.changePct,
            )}`
          : "腾讯行情未返回",
        tone:
          evidence.market && evidence.market.changePct > 0
            ? "positive"
            : evidence.market && evidence.market.changePct < 0
              ? "negative"
              : "neutral",
      },
      {
        label: `${valuationForecast?.year || "远期"}E P/E`,
        value:
          metrics.forwardPe === null
            ? "未计算"
            : `${metrics.forwardPe.toFixed(1)}×`,
        change: valuationForecast
          ? `${valuationForecast.estimates} 家机构 · EPS ${cny(
              valuationForecast.meanEps,
            )}`
          : "一致预期未取得",
        tone:
          metrics.forwardPe !== null && metrics.forwardPe <= 30
            ? "positive"
            : "neutral",
      },
      {
        label: "最新单季收入",
        value: latest ? moneyB(latest.revenueB) : "未取得",
        change: latest
          ? `${latest.label} · 同比 ${signedPct(metrics.revenueYoy)}`
          : "公开利润表未取得",
        tone:
          metrics.revenueYoy !== null && metrics.revenueYoy > 0
            ? "positive"
            : metrics.revenueYoy !== null && metrics.revenueYoy < 0
              ? "negative"
              : "neutral",
      },
      {
        label: "20 日价格回报",
        value: evidence.market
          ? signedPct(evidence.market.periodReturnPct)
          : "未取得",
        change: evidence.market
          ? `60 日 ${signedPct(evidence.market.sixtyDayReturnPct)}`
          : "K 线未取得",
        tone:
          evidence.market &&
          evidence.market.periodReturnPct !== null &&
          evidence.market.periodReturnPct > 0
            ? "positive"
            : evidence.market &&
                evidence.market.periodReturnPct !== null &&
                evidence.market.periodReturnPct < 0
              ? "negative"
              : "neutral",
      },
    ],
    expectations: [
      {
        metric: "机构 EPS 一致预期",
        t: forecastValue(currentForecast, "eps"),
        t1: forecastValue(valuationForecast, "eps"),
        t4: forecastValue(longForecast, "eps"),
        t8: latest
          ? `${latest.label}A ${cny(latest.dilutedEps)}`
          : "缺失",
        evidence: currentForecast ? "consensus" : "missing",
        debate: currentForecast
          ? `${currentForecast.estimates} 家机构，${currentForecast.year}E 区间 ${cny(
              currentForecast.lowEps,
            )}–${cny(currentForecast.highEps)}；需关注预测离散度。`
          : "没有机构覆盖时，不用单家研报预测冒充一致预期。",
      },
      {
        metric: "机构归母净利润预期",
        t: forecastValue(currentForecast, "profit"),
        t1: forecastValue(valuationForecast, "profit"),
        t4: forecastValue(longForecast, "profit"),
        t8: latest
          ? `${latest.label}A ${moneyB(latest.netIncomeB)}`
          : "缺失",
        evidence: currentForecast?.meanNetProfitB ? "consensus" : "missing",
        debate: "机构汇总值用于估值门槛；公司业绩预告与正式财报仍需单独核对。",
      },
      {
        metric: "单季营业收入",
        t: latest ? `${latest.label} ${moneyB(latest.revenueB)}` : "缺失",
        t1: previousQuarter
          ? `${previousQuarter.label} ${moneyB(previousQuarter.revenueB)}`
          : "缺失",
        t4: previousYear
          ? `${previousYear.label} ${moneyB(previousYear.revenueB)}`
          : "缺失",
        t8: twoYearsAgo
          ? `${twoYearsAgo.label} ${moneyB(twoYearsAgo.revenueB)}`
          : "缺失",
        evidence: latest ? "verified" : "missing",
        debate: latest?.derivedQuarter
          ? "最新值由累计利润表相减推导；正式报告期累计值与单季值不可混用。"
          : "公司实际值已冻结；下一报告期收入卖方一致预期仍是缺口。",
      },
      {
        metric: "单季毛利率",
        t: latest ? `${latest.label} ${pct(latest.grossMarginPct)}` : "缺失",
        t1: previousQuarter
          ? `${previousQuarter.label} ${pct(previousQuarter.grossMarginPct)}`
          : "缺失",
        t4: previousYear
          ? `${previousYear.label} ${pct(previousYear.grossMarginPct)}`
          : "缺失",
        t8: twoYearsAgo
          ? `${twoYearsAgo.label} ${pct(twoYearsAgo.grossMarginPct)}`
          : "缺失",
        evidence:
          latest?.grossMarginPct !== null &&
          latest?.grossMarginPct !== undefined
            ? "verified"
            : "missing",
        debate: "价格、产品组合、成本、良率、汇率与库存减值需要管理层逐项桥接。",
      },
    ],
    kpis: [
      {
        name: "收入增长与订单兑现",
        current: latest
          ? `${latest.label} ${moneyB(latest.revenueB)} · 同比 ${signedPct(
              metrics.revenueYoy,
            )}`
          : "财务历史待补",
        bar: "收入增速保持且订单/产能/交付口径一致",
        trend:
          metrics.revenueYoy !== null && metrics.revenueYoy > 0
            ? "up"
            : metrics.revenueYoy !== null && metrics.revenueYoy < 0
              ? "down"
              : "flat",
        weight: 28,
        readThrough: "决定当前高增长是否来自持续需求，而不是一次性确认或低基数。",
      },
      {
        name: "机构 EPS 修正与离散度",
        current: valuationForecast
          ? `${valuationForecast.year}E ${cny(
              valuationForecast.meanEps,
            )} · ${valuationForecast.estimates} 家`
          : "一致预期待补",
        bar: "财报后 FY1/FY2 EPS 上修且预测区间收窄",
        trend:
          metrics.epsGrowth !== null && metrics.epsGrowth > 0
            ? "up"
            : metrics.epsGrowth !== null && metrics.epsGrowth < 0
              ? "down"
              : "flat",
        weight: 24,
        readThrough: "远期盈利上修比单季 headline beat 更能支撑估值。",
      },
      {
        name: "毛利率桥接",
        current: latest
          ? `${pct(latest.grossMarginPct)} · 同比 ${
              metrics.marginDelta === null
                ? "—"
                : `${metrics.marginDelta >= 0 ? "+" : ""}${metrics.marginDelta.toFixed(
                    1,
                  )}pct`
            }`
          : "毛利率待补",
        bar: "产品组合与成本改善足以抵消价格、汇率和供应链压力",
        trend:
          metrics.marginDelta !== null && metrics.marginDelta > 0
            ? "up"
            : metrics.marginDelta !== null && metrics.marginDelta < 0
              ? "down"
              : "flat",
        weight: 22,
        readThrough: "区分高质量增长与收入增长但增量利润率恶化。",
      },
      {
        name: "净利率与非经营扰动",
        current: netMargin === null ? "待验证" : `${pct(netMargin)} 单季净利率`,
        bar: "汇兑、减值与税率不吞噬主营利润改善",
        trend: netMargin !== null && netMargin >= 15 ? "up" : "flat",
        weight: 14,
        readThrough: "A 股出口型公司常受汇率、减值与补贴扰动，需与主营利润分开。",
      },
      {
        name: "估值与事件风险",
        current:
          metrics.forwardPe === null
            ? "估值待补"
            : `${metrics.forwardPe.toFixed(1)}× ${
                valuationForecast?.year || "远期"
              } P/E · 20 日 ${signedPct(evidence.market?.periodReturnPct)}`,
        bar: nextReportDate
          ? `${nextReportDate} 预约披露日前不承担超预算跳空风险`
          : "先确认预约披露日与事件风险",
        trend:
          evidence.market?.periodReturnPct !== null &&
          evidence.market?.periodReturnPct !== undefined &&
          evidence.market.periodReturnPct > 0
            ? "up"
            : evidence.market?.periodReturnPct !== null &&
                evidence.market?.periodReturnPct !== undefined &&
                evidence.market.periodReturnPct < 0
              ? "down"
              : "flat",
        weight: 12,
        readThrough: "估值便宜不等于短期安全；财报跳空与流动性必须纳入仓位。",
      },
    ],
    marginDebate: {
      bull: [
        latest
          ? `最新单季毛利率 ${pct(latest.grossMarginPct)}，同比 ${
              metrics.marginDelta === null
                ? "—"
                : `${metrics.marginDelta >= 0 ? "+" : ""}${metrics.marginDelta.toFixed(
                    1,
                  )}pct`
            }。`
          : "若高毛利产品组合提升，收入增长可继续穿透到利润。",
        "规模、良率和采购成本改善可能抵消供应链与扩产初期费用。",
        "远期 EPS 一致预期若在财报后继续上修，当前估值可由盈利增长消化。",
      ],
      bear: [
        "快速扩产、关键物料短缺或降价竞争可能使毛利率恢复慢于收入。",
        "汇率、存货减值与海外经营成本可能令净利润弱于主营趋势。",
        "机构预测区间较宽时，均值容易掩盖买方真实高端门槛。",
      ],
      watch: [
        "售价 / 销量 / 产品组合 / 单位成本桥接",
        "汇兑损益、存货减值、政府补助与税率",
        "存货、预付款、合同负债与经营现金流",
        "财报后 FY1/FY2 EPS 预测数量、均值与区间变化",
      ],
    },
    scenarios: [
      {
        name: "Bull",
        probability: probabilities[0],
        revenue: "收入越过机构高端门槛，订单与交付指引同步上修",
        grossMargin: "同比/环比改善至少 1pct",
        eps: `${valuationForecast?.year || "远期"} EPS +10%`,
        multiple: baseMultiple
          ? `${(baseMultiple * 1.15).toFixed(1)}×`
          : "待估值基准",
        target: bullTarget === null ? "待补数据" : cny(bullTarget),
        returnPct: returnFor(bullTarget),
        trigger: "收入、毛利率、远期 EPS 三项同时上修。",
      },
      {
        name: "Base",
        probability: probabilities[1],
        revenue: "符合当前增长路径",
        grossMargin: "维持最近单季区间",
        eps: `${valuationForecast?.year || "远期"} EPS 持平`,
        multiple: baseMultiple ? `${baseMultiple.toFixed(1)}×` : "待估值基准",
        target: baseTarget === null ? "待补数据" : cny(baseTarget),
        returnPct: returnFor(baseTarget),
        trigger: "基本面兑现，但远期修正与估值均无明显变化。",
      },
      {
        name: "Bear",
        probability: probabilities[2],
        revenue: "交付/需求低于高端门槛",
        grossMargin: "同比下滑超过 2pct",
        eps: `${valuationForecast?.year || "远期"} EPS -20%`,
        multiple: baseMultiple
          ? `${(baseMultiple * 0.8).toFixed(1)}×`
          : "待估值基准",
        target: bearTarget === null ? "待补数据" : cny(bearTarget),
        returnPct: returnFor(bearTarget),
        trigger: "收入、毛利率与远期 EPS 至少两项下修。",
      },
    ],
    catalysts: [
      {
        timing: latestEarningsEvent
          ? `${latestEarningsEvent.date}（已发布）`
          : "最近一期（待公告）",
        event: latestEarningsEvent?.type || "业绩预告 / 业绩快报",
        impact: "two-sided",
        watch:
          latestEarningsEvent?.content ||
          "核对预告区间、一次性项目和正式财报差异。",
      },
      {
        timing: nextReportDate
          ? `${nextReportDate}（交易所预约披露日）`
          : "待公司/交易所确认",
        event: evidence.events?.nextReportLabel || `${evidence.symbol} 定期报告`,
        impact: "two-sided",
        watch: "收入、毛利率、现金流、库存/预付款与下一期经营展望。",
      },
      {
        timing: nextReportDate
          ? `${addDays(nextReportDate, 1)} 至 ${addDays(nextReportDate, 3)}`
          : "财报后 1–3 个交易日",
        event: "卖方模型与机构预期重置",
        impact: "two-sided",
        watch: "FY1/FY2 EPS 均值、覆盖数、预测区间与目标倍数变化。",
      },
      {
        timing: nextReportDate
          ? `${addDays(nextReportDate, 7)} 至 ${addDays(nextReportDate, 35)}`
          : "财报后 1–5 周",
        event: "订单、交付与产能兑现验证",
        impact: "two-sided",
        watch: "机构调研、公司公告、上下游读数与价格/库存变化。",
      },
    ],
    managementQuestions: [
      {
        topic: "收入与订单质量",
        question:
          "请拆分本期收入增长中价格、销量、产品组合与一次性交付的贡献，并说明在手订单覆盖到哪个季度。",
        whyItMatters: "判断增长是结构性需求还是确认节奏/低基数驱动。",
      },
      {
        topic: "毛利率桥接",
        question:
          "请量化售价、产品组合、原材料、良率、扩产爬坡和汇率分别对本期及下一期毛利率的影响。",
        whyItMatters: "区分可持续的主营改善与暂时性利润波动。",
      },
      {
        topic: "产能与供应链",
        question:
          "当前交付瓶颈来自哪些关键物料或工序，新增产能何时达到稳定良率，客户是否存在延期或取消？",
        whyItMatters: "把订单强度转换成可兑现的收入与利润节奏。",
      },
      {
        topic: "现金流与库存",
        question:
          "存货和预付款变化分别对应哪些需求与物料假设；经营现金流何时与利润增速重新匹配？",
        whyItMatters: "识别积极备货、供应链锁定与潜在库存风险。",
      },
      {
        topic: "竞争与客户集中",
        question:
          "前五大客户集中度、主要产品份额与价格竞争如何变化；海外政策与汇率风险有哪些可量化缓释措施？",
        whyItMatters: "判断增长持续性、议价权和单一客户/地区风险。",
      },
    ],
    actionPlan: {
      preEvent:
        side === "LONG"
          ? "偏多但不追涨：只保留核心/观察仓，预约披露日前按最大跳空损失反推仓位。"
          : side === "SHORT"
            ? "以减仓或合规对冲表达看空，不在未核验融券条件下扩大裸空。"
            : "保持观察仓；收入、毛利率、远期 EPS 至少两项转绿后再提高风险。",
      beat:
        "正式财报收入/毛利率越过高端门槛且 FY1/FY2 EPS 上修后，等待首日波动收敛再分批增加 0.25×。",
      inline:
        "若 headline 符合预期但远期 EPS 不上修，维持原仓位，不把一次性超预期外推。",
      miss:
        "若收入与毛利率同时失守，或一致预期下修超过 10%，按预设失效条件减仓；不以长期叙事覆盖短期证伪。",
      riskControls: [
        "A 股个股通常不能像美股一样自由裸空；SHORT 首先解释为减仓/规避或合规对冲研究方向。",
        "单一财报事件的组合最大损失预算应在建仓前确定，不能用目标价替代止损。",
        "预约披露日可能变更；每次运行都现场刷新，不把旧日期长期缓存。",
        "同花顺机构汇总是卖方预测口径；公司实际、业绩预告和分析假设分层展示，不相互冒充。",
      ],
    },
    sources: sourceLedger(generatedAt, [...extraSources, ...evidence.sources]),
    evidenceGaps: [...new Set(evidence.gaps)],
    disclaimer:
      "研究辅助，不构成个性化投资建议或自动交易指令。任何操作应结合实时价格、流动性、税务、交易权限与个人风险承受能力复核。",
  };
}
