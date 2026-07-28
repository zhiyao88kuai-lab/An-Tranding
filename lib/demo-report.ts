import { makeCatalystCalendar } from "./catalyst-calendar";
import type { AnalysisRequest, ResearchReport } from "./types";

function positionGuidance(input: AnalysisRequest): string {
  const weight = Math.max(0, Math.min(100, input.positionWeight || 0));
  if (input.positionSide === "NONE") {
    return input.riskTolerance === "HIGH"
      ? "仅在关键证据转绿后分两笔建立 0.25× 事件仓位"
      : "财报前保持空仓，优先等待指引与毛利率证据";
  }
  if (input.positionSide === "SHORT") {
    return "不建议在缺少实时借券与期权拥挤度时扩大裸空；用明确止损约束风险";
  }
  if (weight >= 12 || input.riskTolerance === "LOW") {
    return `当前 ${weight.toFixed(1)}% 多头仓位偏集中，事件前考虑降至风险预算内`;
  }
  return `当前 ${weight.toFixed(1)}% 多头仓位可保留核心仓，事件敞口不再追加`;
}

export function makeNvdaDemoReport(
  input: AnalysisRequest,
  extraSources: ResearchReport["sources"] = [],
): ResearchReport {
  const generatedAt = new Date().toISOString();
  const catalystCalendar = makeCatalystCalendar();

  return {
    meta: {
      symbol: "NVDA",
      company: input.companyName?.trim() || "NVIDIA",
      market: "NASDAQ",
      asOf: "示例快照 · 非实时数据",
      generatedAt,
      freezeTime: "演示一致预期已冻结；连接数据源后替换",
      dataMode: input.dataMode,
      workflow: [
        "Public Equity Investing",
        "Earnings Preview",
        "Long / Short Pitch",
        "Scenario & Sensitivity",
        "Portfolio Risk",
      ],
      isDemo: true,
      liveDataReady: false,
      evidenceReadiness: "insufficient",
      dataDisclosure:
        "演示报告：未获取实时股价、实时一致预期、期权或借券数据。",
    },
    decision: {
      side: "LONG",
      confidence: 68,
      actionability: "conditional",
      oneLine:
        "基本面仍偏多，但回报取决于数据中心增速与毛利率指引能否同时越过高预期。",
      pricedIn:
        "市场已计入强劲加速与供应改善，单纯收入小幅超预期可能不足以推动估值继续扩张。",
      variantView:
        "分歧不在需求是否强，而在增量收入的兑现斜率、产品切换成本与毛利率谷底深度。",
      sizing: positionGuidance(input),
      invalidation:
        "若下一季数据中心指引低于高端预期且非 GAAP 毛利率下修，偏多框架失效。",
    },
    tape: [
      {
        label: "收入预期",
        value: "100.0",
        change: "指数化基准",
        tone: "neutral",
      },
      {
        label: "买方门槛",
        value: "103–105",
        change: "需明显超越",
        tone: "negative",
      },
      {
        label: "毛利率",
        value: "73–74%",
        change: "争议核心",
        tone: "neutral",
      },
      {
        label: "情景偏度",
        value: "+11%",
        change: "概率加权示例",
        tone: "positive",
      },
    ],
    expectations: [
      {
        metric: "总收入",
        t: "100.0",
        t1: "93.4",
        t4: "70.8",
        t8: "44.6",
        evidence: "consensus",
        debate: "同比仍强，但市场更关心相对高端买方门槛。",
      },
      {
        metric: "数据中心收入",
        t: "100.0",
        t1: "91.8",
        t4: "66.5",
        t8: "37.2",
        evidence: "consensus",
        debate: "云厂商拉货、网络业务与新平台放量节奏。",
      },
      {
        metric: "非 GAAP 毛利率",
        t: "73–74%",
        t1: "72–73%",
        t4: "74–76%",
        t8: "75–77%",
        evidence: "inference",
        debate: "新品爬坡成本与组合改善谁先占上风。",
      },
      {
        metric: "非 GAAP EPS",
        t: "100.0",
        t1: "91.0",
        t4: "64.2",
        t8: "38.9",
        evidence: "consensus",
        debate: "收入超预期能否穿透至增量利润率。",
      },
    ],
    kpis: [
      {
        name: "数据中心收入",
        current: "核心引擎",
        bar: "高端预期以上",
        trend: "up",
        weight: 30,
        readThrough: "决定需求强度是否足以抵消高估值门槛。",
      },
      {
        name: "Blackwell / 新平台爬坡",
        current: "放量期",
        bar: "供给与良率同步改善",
        trend: "up",
        weight: 22,
        readThrough: "验证收入兑现、交付节奏和客户部署效率。",
      },
      {
        name: "非 GAAP 毛利率指引",
        current: "承压区",
        bar: "不低于市场谷底假设",
        trend: "down",
        weight: 20,
        readThrough: "决定盈利质量以及市场是否愿意看穿产品切换成本。",
      },
      {
        name: "网络与系统业务",
        current: "增量支柱",
        bar: "继续快于公司整体",
        trend: "up",
        weight: 13,
        readThrough: "反映全栈平台渗透，而非仅售卖 GPU。",
      },
      {
        name: "客户集中度 / 回报率",
        current: "需验证",
        bar: "Capex 与变现叙事一致",
        trend: "flat",
        weight: 15,
        readThrough: "决定需求持续性与估值周期长度。",
      },
    ],
    marginDebate: {
      bull: [
        "高价新品与系统级产品占比提升，规模效应可在爬坡后释放。",
        "网络、软件与服务组合改善，长期毛利率中枢未被破坏。",
        "供给瓶颈缓解后，加急成本与低良率影响逐步消退。",
      ],
      bear: [
        "产品切换、复杂系统交付与代工成本使谷底更深、持续更久。",
        "大型客户议价、定制芯片与竞争加剧压缩增量利润率。",
        "若收入靠低毛利系统拉动，headline beat 的质量会被折价。",
      ],
      watch: [
        "GAAP 与非 GAAP 口径差异",
        "库存与预付款变化",
        "下一季毛利率区间及恢复路径",
        "系统收入占比与保修/交付成本",
      ],
    },
    scenarios: [
      {
        name: "Bull",
        probability: 30,
        revenue: "高端门槛之上 4%+",
        grossMargin: "企稳并给出清晰回升路径",
        eps: "上修 6–9%",
        multiple: "估值维持 / 小幅扩张",
        target: "现价 × 1.24",
        returnPct: 24,
        trigger: "数据中心、网络与毛利率三项同时超预期。",
      },
      {
        name: "Base",
        probability: 50,
        revenue: "接近买方门槛",
        grossMargin: "处于预期区间",
        eps: "上修 2–4%",
        multiple: "估值小幅压缩",
        target: "现价 × 1.07",
        returnPct: 7,
        trigger: "收入强，但毛利率恢复仍需等待。",
      },
      {
        name: "Bear",
        probability: 20,
        revenue: "低于高端门槛",
        grossMargin: "指引下修 / 谷底后移",
        eps: "下修 5–8%",
        multiple: "估值去风险",
        target: "现价 × 0.76",
        returnPct: -24,
        trigger: "交付节奏、客户消化或成本端出现双重压力。",
      },
    ],
    catalysts: [
      {
        timing: catalystCalendar.preEventWindow,
        event: "云厂商 Capex 与供应链读数",
        impact: "two-sided",
        watch: "订单斜率、交付周期、网络配套与机架部署。",
      },
      {
        timing: catalystCalendar.earningsCall,
        event: "财报与下一季指引",
        impact: "two-sided",
        watch: "数据中心收入、毛利率区间、产品切换与需求可见度。",
      },
      {
        timing: catalystCalendar.modelResetWindow,
        event: "电话会与卖方模型重置",
        impact: "two-sided",
        watch: "高端预期是否上移，以及 FY2 EPS 上修幅度。",
      },
      {
        timing: catalystCalendar.deliveryWindow,
        event: "平台交付与客户产品发布",
        impact: "positive",
        watch: "兑现节奏是否支持财报后的估值消化。",
      },
    ],
    managementQuestions: [
      {
        topic: "毛利率",
        question:
          "能否量化新品爬坡、系统组合、加急成本分别对毛利率的影响，并给出恢复到中枢的时间条件？",
        whyItMatters: "区分暂时性成本与结构性利润率下移。",
      },
      {
        topic: "需求质量",
        question:
          "过去一个季度的增量订单中，训练、推理与主权 AI 各自贡献如何？取消或延期率是否变化？",
        whyItMatters: "验证增长来源的广度和可持续性。",
      },
      {
        topic: "客户回报",
        question:
          "客户部署从采购到收入变现的周期是否缩短，哪些工作负载最先达到可接受回报？",
        whyItMatters: "连接云厂商 Capex 与终端变现能力。",
      },
      {
        topic: "竞争",
        question:
          "定制加速器在什么工作负载最有替代性，公司如何衡量全栈方案相对总拥有成本优势？",
        whyItMatters: "测试护城河是否来自芯片性能还是生态锁定。",
      },
      {
        topic: "供给",
        question:
          "当前限制来自晶圆、先进封装、HBM 还是系统集成？未来两个季度瓶颈如何迁移？",
        whyItMatters: "判断收入天花板和库存风险。",
      },
    ],
    actionPlan: {
      preEvent: positionGuidance(input),
      beat:
        "若收入越过高端门槛、毛利率指引不降且电话会确认需求广度，可在开盘波动收敛后增加 0.25×；不追逐首个跳空。",
      inline:
        "若仅 headline beat、但毛利率或下一季指引平淡，维持核心仓并等待两日卖方修正，不加事件仓。",
      miss:
        "若收入和毛利率同时低于门槛，优先执行止损/减仓；不要用长期叙事覆盖已发生的短期证伪。",
      riskControls: [
        "单一财报事件损失预算不超过组合净值的 35–60bp（按风险偏好调整）。",
        "不使用未验证的期权隐含波动作为目标价；必须匹配覆盖财报的到期日。",
        "空头在借券费率、利用率和挤压风险未验证前不得标记为 implementation-ready。",
        "所有一致预期、股价、期权和持仓数据必须显示冻结时间。",
      ],
    },
    sources: [
      {
        name: "Public Equity Investing workflow",
        provider: "OpenAI curated skill",
        status: "connected",
        asOf: generatedAt,
        tier: "LOCAL",
        note: "结构化研究框架，不是行情数据源。",
      },
      {
        name: "global-stock-data adapter",
        provider: "SEC / market-data routes",
        status: input.dataMode === "DEMO" ? "fallback" : "connected",
        asOf: generatedAt,
        tier: "S",
        note: "官方源优先；需许可的数据仅限本地个人研究。",
      },
      {
        name: "a-stock-data adapter",
        provider: "CNINFO / local research routes",
        status: "restricted",
        asOf: generatedAt,
        tier: "LOCAL",
        note: "用于 A 股路由；当前 NVDA 分析不调用。",
      },
      ...extraSources,
    ],
    evidenceGaps: [
      "当前是首屏结构样例；页面健康检查通过后会自动运行公开实施链路分析并替换本报告。",
      "实施链路使用 SEC 公司事实、Nasdaq 行情/EPS/期权摘要与 FINRA 短成交量；dev0 MCP 是本机可选增强项。",
      "收入一致预期与借券费率需要具备再分发权限的数据源；接入前会显示为受限项，不使用替代指标冒充。",
    ],
    disclaimer:
      "研究辅助，不构成个性化投资建议或自动交易指令。任何操作应结合实时价格、流动性、税务与个人风险承受能力复核。",
  };
}

export function makeConditionalReport(
  input: AnalysisRequest,
  sources: ResearchReport["sources"],
  gaps: string[],
  resolvedMarket: Exclude<AnalysisRequest["market"], "AUTO">,
): ResearchReport {
  const symbol = input.symbol.trim().toUpperCase();
  const report = makeNvdaDemoReport(
    { ...input, companyName: input.companyName || symbol },
    sources,
  );

  report.meta.symbol = symbol;
  report.meta.company = input.companyName?.trim() || symbol;
  report.meta.market =
    resolvedMarket === "US"
      ? "US"
      : resolvedMarket === "HK"
        ? "HK"
        : "A 股";
  report.meta.isDemo = false;
  report.meta.liveDataReady = false;
  report.meta.evidenceReadiness = "insufficient";
  report.meta.dataDisclosure =
    "已尝试连接数据源，但关键实时证据不完整；系统已强制降级为 WAIT。";
  report.meta.asOf = "连接结果 · 证据不完整";
  report.decision = {
    side: "WAIT",
    confidence: 35,
    actionability: "screen-grade",
    oneLine: "关键证据不足，系统拒绝生成可执行 LONG / SHORT 信号。",
    pricedIn: "缺少带冻结时间的一致预期与买方门槛，无法可靠判断市场计价。",
    variantView: "先补齐一致预期、核心 KPI 历史序列与事件期权数据。",
    sizing:
      input.positionSide === "NONE"
        ? "保持空仓，待证据门槛满足后再评估"
        : "不新增风险；现有仓位按预设事件损失预算管理",
    invalidation: "此为数据门槛判断，不代表基本面结论。",
  };
  report.tape = [
    {
      label: "一致预期",
      value: "缺失",
      change: "方向门槛未通过",
      tone: "negative",
    },
    {
      label: "核心 KPI",
      value: "待验证",
      change: "需历史序列",
      tone: "neutral",
    },
    {
      label: "估值",
      value: "待重建",
      change: "不可输出目标价",
      tone: "neutral",
    },
    {
      label: "操作",
      value: "WAIT",
      change: "屏幕级结果",
      tone: "negative",
    },
  ];
  report.expectations = report.expectations.map((row) => ({
    ...row,
    t: "待接入",
    t1: "待接入",
    t4: "待接入",
    t8: "待接入",
    evidence: "missing",
  }));
  report.scenarios = report.scenarios.map((scenario) => ({
    ...scenario,
    revenue: "待一致预期",
    grossMargin: "待公司指引",
    eps: "待模型",
    multiple: "待估值基准",
    target: "不可计算",
    returnPct: 0,
  }));
  report.evidenceGaps = gaps;
  return report;
}
