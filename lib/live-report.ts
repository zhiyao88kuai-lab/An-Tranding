import { makeCatalystCalendar } from "./catalyst-calendar";
import { makeNvdaDemoReport } from "./demo-report";
import type {
  NvdaOfficialSnapshot,
  NvdaPositioningSnapshot,
} from "./providers/nvda-evidence";
import type { ConsensusSnapshot } from "./providers/nasdaq-consensus";
import type { MarketSnapshot } from "./providers/vibe-mcp";
import type { AnalysisRequest, ResearchReport, SourceRecord } from "./types";

function eps(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `$${value.toFixed(2)}`;
}

function moneyB(value: number): string {
  return `$${value.toFixed(1)}B`;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function price(value: number): string {
  return `$${value.toFixed(0)}`;
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
  return `近 4 周：上调 ${up ?? "—"} / 下调 ${down ?? "—"}`;
}

function targetPrice(forwardEps: number, multiple: number): number {
  return forwardEps * multiple;
}

function returnPct(target: number, spot: number): number {
  return Math.round((target / spot - 1) * 100);
}

export function makeNvdaLiveScreenReport(
  input: AnalysisRequest,
  consensus: ConsensusSnapshot,
  market: MarketSnapshot,
  official: NvdaOfficialSnapshot,
  positioning: NvdaPositioningSnapshot | undefined,
  sources: SourceRecord[],
): ResearchReport {
  const report = makeNvdaDemoReport(input, sources);
  const [currentQuarter, nextQuarter] = consensus.quarterly;
  const [fy1, fy2] = consensus.yearly;
  const frozenAt = new Date(
    Math.max(
      new Date(consensus.asOf).getTime(),
      new Date(market.asOf).getTime(),
    ),
  ).toISOString();
  const positiveRevisions =
    (currentQuarter.up ?? 0) > (currentQuarter.down ?? 0);
  const guideLow =
    official.outlookRevenueB * (1 - official.outlookRevenueRangePct / 100);
  const guideHigh =
    official.outlookRevenueB * (1 + official.outlookRevenueRangePct / 100);
  const gaapMarginLow =
    official.outlookGaapGrossMarginPct -
    official.outlookGrossMarginRangeBps / 100;
  const gaapMarginHigh =
    official.outlookGaapGrossMarginPct +
    official.outlookGrossMarginRangeBps / 100;
  const nonGaapMarginLow =
    official.outlookNonGaapGrossMarginPct -
    official.outlookGrossMarginRangeBps / 100;
  const nonGaapMarginHigh =
    official.outlookNonGaapGrossMarginPct +
    official.outlookGrossMarginRangeBps / 100;
  const forwardEps =
    fy2?.consensusEPSForecast ?? fy1?.consensusEPSForecast ?? null;
  const currentForwardPe =
    forwardEps && forwardEps > 0 ? market.lastClose / forwardEps : null;
  const bullMultiple = currentForwardPe
    ? Math.max(18, currentForwardPe * 1.15)
    : 19;
  const baseMultiple = currentForwardPe
    ? Math.max(15, currentForwardPe * 0.98)
    : 16;
  const bearMultiple = currentForwardPe
    ? Math.max(12, currentForwardPe * 0.8)
    : 13;
  const bullTarget = forwardEps
    ? targetPrice(forwardEps * 1.08, bullMultiple)
    : market.lastClose * 1.2;
  const baseTarget = forwardEps
    ? targetPrice(forwardEps, baseMultiple)
    : market.lastClose;
  const bearTarget = forwardEps
    ? targetPrice(forwardEps * 0.9, bearMultiple)
    : market.lastClose * 0.75;
  const hasEventOptions = Boolean(positioning?.options?.eventIsolated);
  const hasShortVolume = Boolean(positioning?.shortVolume);
  const catalystCalendar = makeCatalystCalendar(
    positioning?.options?.eventDate,
  );
  const revenueConsensusGap =
    "收入卖方一致预期/买方高端门槛仍需授权数据源；当前以公司 $91.0B±2% 指引作为已验证反应基准，不把它冒充一致预期。";

  report.meta = {
    ...report.meta,
    asOf: `行情 ${market.asOf.slice(0, 10)} · EPS ${consensus.asOf.slice(
      0,
      10,
    )} · 公司指引 ${official.filingDate}`,
    freezeTime: frozenAt,
    isDemo: false,
    liveDataReady: true,
    dataDisclosure:
      "公开实施链路已就绪：SEC 公司事实、Nasdaq 行情/EPS 一致预期与 FINRA 定位信号均按时间冻结。收入一致预期和借券数据仍受许可限制，结论保持条件化。",
  };
  report.decision = {
    side: "WAIT",
    confidence: 72,
    actionability: "conditional",
    oneLine:
      "基本面与 EPS 修正偏正面，但当前股价对 FY28 EPS 已计入约束性预期，且缺少收入一致预期高端门槛；财报前建议持有核心仓、不追加事件仓。",
    pricedIn: currentForwardPe
      ? `现价约对应 ${currentForwardPe.toFixed(
          1,
        )}× ${fy2?.fiscalEnd || "远期"} EPS 一致预期；覆盖事件的 ATM 跨式${
          positioning?.options
            ? `隐含约 ±${positioning.options.impliedMovePct.toFixed(1)}%`
            : "未形成可靠快照"
        }。`
      : "远期 EPS 或估值基准不完整，未把静态目标价当成确定结果。",
    variantView: positiveRevisions
      ? `近 4 周本季 EPS 上调 ${currentQuarter.up ?? 0} 次、下调 ${
          currentQuarter.down ?? 0
        } 次；真正分歧在收入能否越过 ${moneyB(
          guideHigh,
        )} 公司指引高端且毛利率不低于 ${pct(nonGaapMarginLow)}。`
      : "EPS 修正未形成正斜率，需等待收入与毛利率同步通过门槛。",
    sizing:
      input.positionSide === "NONE"
        ? "财报前保持空仓；只在收入、毛利率与电话会需求广度同时转绿后分批介入"
        : input.positionSide === "LONG"
          ? `保留核心仓；当前 ${input.positionWeight.toFixed(
              0,
            )}% 仓位不再加码，单一财报事件损失预算控制在组合净值 35–60bp`
          : "不扩大裸空；借券费率/利用率未接入，空头不具备 implementation-ready 条件",
    invalidation:
      `若收入低于 ${moneyB(guideLow)}、非 GAAP 毛利率低于 ${pct(
        nonGaapMarginLow,
      )}，或 FY28 EPS 一致预期在财报后下修，偏多基本面框架失效。`,
  };
  report.tape = [
    {
      label: "最新收盘",
      value: `$${market.lastClose.toFixed(2)}`,
      change: `${market.asOf.slice(0, 10)} · ${
        market.periodReturnPct >= 0 ? "+" : ""
      }${market.periodReturnPct.toFixed(1)}% / ${market.bars} 日`,
      tone: market.periodReturnPct >= 0 ? "positive" : "negative",
    },
    {
      label: `${official.outlookPeriod} 收入指引`,
      value: moneyB(official.outlookRevenueB),
      change: `${moneyB(guideLow)}–${moneyB(guideHigh)}`,
      tone: "neutral",
    },
    {
      label: `${currentQuarter.fiscalEnd} EPS`,
      value: eps(currentQuarter.consensusEPSForecast),
      change: revisionText(currentQuarter.up, currentQuarter.down),
      tone: positiveRevisions ? "positive" : "neutral",
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
      tone: hasEventOptions ? "neutral" : "negative",
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
      metric: "公司收入门槛",
      t: `${moneyB(official.outlookRevenueB)} ±${official.outlookRevenueRangePct.toFixed(
        0,
      )}%`,
      t1: `${moneyB(official.actualRevenueB)} 实际`,
      t4: `${moneyB(official.priorQuarterRevenueB)} 实际`,
      t8: `${moneyB(official.priorYearRevenueB)} 实际`,
      evidence: "verified",
      debate:
        "这是公司指引而非卖方一致预期；高端门槛为 " +
        `${moneyB(guideHigh)}，低端为 ${moneyB(guideLow)}。`,
    },
    {
      metric: "GAAP / 非 GAAP 毛利率",
      t: `${pct(official.outlookGaapGrossMarginPct)} / ${pct(
        official.outlookNonGaapGrossMarginPct,
      )}`,
      t1: `${pct(official.actualGaapGrossMarginPct)} / ${pct(
        official.actualNonGaapGrossMarginPct,
      )}`,
      t4: `${pct(official.priorQuarterGaapGrossMarginPct)} / ${pct(
        official.priorQuarterNonGaapGrossMarginPct,
      )}`,
      t8: `${pct(official.priorYearGaapGrossMarginPct)} / ${pct(
        official.priorYearNonGaapGrossMarginPct,
      )}`,
      evidence: "verified",
      debate: `下一季区间：GAAP ${pct(gaapMarginLow)}–${pct(
        gaapMarginHigh,
      )}；非 GAAP ${pct(nonGaapMarginLow)}–${pct(nonGaapMarginHigh)}。`,
    },
    {
      metric: "数据中心收入",
      t: "公司未给分部指引",
      t1: `${moneyB(official.dataCenterRevenueB)} 实际`,
      t4: `环比 +${official.dataCenterQoqPct.toFixed(0)}%`,
      t8: `同比 +${official.dataCenterYoyPct.toFixed(0)}%`,
      evidence: "verified",
      debate: official.excludesChinaDataCenterCompute
        ? "公司 Q2 指引未假设任何中国数据中心计算收入，是明确的上行/下行解释变量。"
        : "需核对地区组合与平台出货。",
    },
  ];
  report.kpis = [
    {
      name: "数据中心收入",
      current: `${moneyB(official.dataCenterRevenueB)} · 环比 +${official.dataCenterQoqPct.toFixed(
        0,
      )}%`,
      bar: `总收入至少越过 ${moneyB(guideHigh)}，并确认增长广度`,
      trend: "up",
      weight: 30,
      readThrough: `最新同比 +${official.dataCenterYoyPct.toFixed(
        0,
      )}%；下一步重点是 Hyperscale 与 ACIE 的增量结构。`,
    },
    {
      name: "Q2 公司收入指引",
      current: `${moneyB(official.outlookRevenueB)} ±${official.outlookRevenueRangePct.toFixed(
        0,
      )}%`,
      bar: `低端 ${moneyB(guideLow)} / 高端 ${moneyB(guideHigh)}`,
      trend: "up",
      weight: 24,
      readThrough:
        "公司指引已验证；卖方收入一致预期未授权接入，因此不能把“beat 指引”自动等同于“beat 市场”。",
    },
    {
      name: "非 GAAP 毛利率指引",
      current: `${pct(
        official.outlookNonGaapGrossMarginPct,
      )} ±${official.outlookGrossMarginRangeBps}bp`,
      bar: `不低于 ${pct(nonGaapMarginLow)}，最好越过 ${pct(
        nonGaapMarginHigh,
      )}`,
      trend: "flat",
      weight: 22,
      readThrough:
        "验证新品爬坡、系统组合与供应链成本是否仍能维持中 70% 利润率。",
    },
    {
      name: "EPS 修正广度",
      current: `${currentQuarter.up ?? "—"} 上调 / ${
        currentQuarter.down ?? "—"
      } 下调`,
      bar: `财报后 ${fy2?.fiscalEnd || "远期"} EPS 不下修`,
      trend: positiveRevisions ? "up" : "flat",
      weight: 14,
      readThrough:
        "收入质量最终需要穿透到远期 EPS；单季 EPS beat 不是充分条件。",
    },
    {
      name: "事件定位与挤压风险",
      current: `${hasEventOptions ? "期权已隔离" : "期权未验证"} · ${
        hasShortVolume ? "FINRA 已冻结" : "FINRA 未验证"
      }`,
      bar: "借券费率/利用率未接入前禁止输出可执行裸空",
      trend: "flat",
      weight: 10,
      readThrough: positioning?.shortVolume
        ? `FINRA ${positioning.shortVolume.observations} 日短成交量均值 ${positioning.shortVolume.averageShortVolumeRatioPct.toFixed(
            1,
          )}%；该指标不等于空头持仓或借券拥挤度。`
        : "缺少合法可用的借券与拥挤度证据。",
    },
  ];
  report.marginDebate = {
    bull: [
      `Q1 GAAP / 非 GAAP 毛利率已达 ${pct(
        official.actualGaapGrossMarginPct,
      )} / ${pct(official.actualNonGaapGrossMarginPct)}，Q2 中点基本稳定。`,
      "高价系统、网络与软件组合若同步放量，可抵消复杂系统交付与新品爬坡成本。",
      "若收入越过指引高端且毛利率不降，增量利润率将支持 FY28 EPS 继续上修。",
    ],
    bear: [
      "高预期下，收入仅落在公司区间内可能不足以推动估值扩张。",
      "新品切换、系统级交付、HBM/封装与网络配套成本可能压低增量毛利率。",
      "公司指引未计入中国数据中心计算收入；任何政策变化既可能带来上行，也可能增加组合与合规不确定性。",
    ],
    watch: [
      `GAAP 指引 ${pct(gaapMarginLow)}–${pct(
        gaapMarginHigh,
      )} 与非 GAAP ${pct(nonGaapMarginLow)}–${pct(
        nonGaapMarginHigh,
      )} 的桥接`,
      "Hyperscale 与 ACIE 新披露框架下的收入增速、客户集中度与订单可见度",
      "Vera Rubin 时间表、Blackwell 系统出货和供应链瓶颈迁移",
      "股权投资收益、税率和非经常项目对 GAAP EPS 的影响",
    ],
  };
  report.scenarios = [
    {
      name: "Bull",
      probability: 30,
      revenue: `>${moneyB(guideHigh)}，且数据中心增长广度确认`,
      grossMargin: `非 GAAP >${pct(nonGaapMarginHigh)}`,
      eps: `本季 >${eps(currentQuarter.highEPSForecast)}；FY28 +8%`,
      multiple: `${bullMultiple.toFixed(1)}× FY28E EPS`,
      target: price(bullTarget),
      returnPct: returnPct(bullTarget, market.lastClose),
      trigger: "收入、毛利率、远期 EPS 修正三项同时转绿。",
    },
    {
      name: "Base",
      probability: 50,
      revenue: `${moneyB(guideLow)}–${moneyB(guideHigh)}`,
      grossMargin: `${pct(nonGaapMarginLow)}–${pct(nonGaapMarginHigh)}`,
      eps: `接近 ${eps(currentQuarter.consensusEPSForecast)}`,
      multiple: `${baseMultiple.toFixed(1)}× FY28E EPS`,
      target: price(baseTarget),
      returnPct: returnPct(baseTarget, market.lastClose),
      trigger: "公司执行稳健，但不足以明显抬高市场门槛。",
    },
    {
      name: "Bear",
      probability: 20,
      revenue: `<${moneyB(guideLow)} 或下一季增速显著放缓`,
      grossMargin: `非 GAAP <${pct(nonGaapMarginLow)}`,
      eps: `本季 <${eps(currentQuarter.lowEPSForecast)}；FY28 -10%`,
      multiple: `${bearMultiple.toFixed(1)}× FY28E EPS`,
      target: price(bearTarget),
      returnPct: returnPct(bearTarget, market.lastClose),
      trigger: "收入、毛利率或需求持续性出现至少两项证伪。",
    },
  ];
  report.catalysts = [
    {
      timing: catalystCalendar.preEventWindow,
      event: "云厂商 Capex、网络与供应链读数",
      impact: "two-sided",
      watch: "AI 基础设施投入斜率、机架部署速度、HBM/封装与网络配套。",
    },
    {
      timing: catalystCalendar.earningsCall,
      event: `${official.outlookPeriod} 财报与下一季指引`,
      impact: "two-sided",
      watch: `收入相对 ${moneyB(guideHigh)} 高端、数据中心结构、毛利率区间和中国口径。`,
    },
    {
      timing: catalystCalendar.modelResetWindow,
      event: "电话会与卖方模型重置",
      impact: "two-sided",
      watch: `${fy2?.fiscalEnd || "远期"} EPS 修正幅度与目标倍数变化。`,
    },
    {
      timing: catalystCalendar.deliveryWindow,
      event: "平台交付、客户产品发布与 Rubin 时间表",
      impact: "positive",
      watch: "财报后的订单可见度能否支撑估值消化。",
    },
  ];
  report.managementQuestions = [
    {
      topic: "收入门槛",
      question:
        "Q2 指引高端以上的潜在上行分别来自 Hyperscale、ACIE、网络和 Edge Computing 的哪些部分？",
      whyItMatters: "把总收入 beat 拆成可持续的增长来源。",
    },
    {
      topic: "毛利率桥接",
      question:
        "能否量化产品爬坡、系统组合、供应链成本和软件/服务分别对下一季 GAAP 与非 GAAP 毛利率的影响？",
      whyItMatters: "区分暂时性爬坡成本与结构性利润率变化。",
    },
    {
      topic: "中国口径",
      question:
        "当前指引不包含中国数据中心计算收入；若政策或产品组合变化，收入机会、合规成本和毛利率影响分别是多少？",
      whyItMatters: "明确公司指引之外的上行与尾部风险。",
    },
    {
      topic: "需求质量",
      question:
        "Hyperscale 与 ACIE 的订单可见度、取消/延期率和客户部署周期有何差异？",
      whyItMatters: "检验增长广度、客户集中与 Capex 回报周期。",
    },
    {
      topic: "平台切换",
      question:
        "Blackwell 到 Vera Rubin 的供应瓶颈将如何迁移，客户会否因平台切换延后采购？",
      whyItMatters: "判断未来两个季度的收入斜率和库存风险。",
    },
  ];
  report.actionPlan = {
    preEvent:
      input.positionSide === "NONE"
        ? "财报前不追涨；等待收入与毛利率双门槛，并把期权隐含波动纳入风险预算。"
        : input.positionSide === "LONG"
          ? `维持核心仓，不新增事件仓；若 ${input.positionWeight.toFixed(
              0,
            )}% 仓位对应的 ±${
              positioning?.options?.impliedMovePct.toFixed(1) || "未验证"
            }% 波动超出 35–60bp 组合损失预算，则在财报前减仓。`
          : "不扩大裸空；借券与挤压风险未验证，优先使用预先限定最大损失的结构。",
    beat:
      `收入 >${moneyB(guideHigh)} 且非 GAAP 毛利率 >${pct(
        nonGaapMarginHigh,
      )}，同时电话会确认需求广度：待首日波动收敛后再评估增加 0.25×。`,
    inline:
      `收入落在 ${moneyB(guideLow)}–${moneyB(
        guideHigh,
      )} 且毛利率符合区间：维持 WAIT/核心仓，不因 headline beat 追价。`,
    miss:
      `收入 <${moneyB(guideLow)} 或毛利率 <${pct(
        nonGaapMarginLow,
      )}：优先减小已有风险；若两项同时失守，执行预设止损并重建模型。`,
    riskControls: [
      "收入卖方一致预期未授权接入；公司指引只作为反应基准，不能替代市场一致预期。",
      `覆盖财报的 ATM 跨式${
        positioning?.options
          ? `隐含约 ±${positioning.options.impliedMovePct.toFixed(1)}%`
          : "未验证"
      }；只用于事件风险预算，不直接当作方向或目标价。`,
      "FINRA 每日短成交量不是空头持仓、借券费率或利用率。",
      "借券数据未接入前，任何 SHORT 结论最多为条件情景，不能标记为 implementation-ready。",
    ],
  };
  report.evidenceGaps = [
    revenueConsensusGap,
    ...(positioning?.gaps || [
      "事件期权、FINRA 短成交量与借券数据未形成同一冻结快照。",
    ]),
  ];
  return report;
}
