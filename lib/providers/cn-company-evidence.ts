import type { SourceRecord } from "../types";

const USER_AGENT =
  "Mozilla/5.0 (compatible; SignalForge/0.1; equity research)";

type TencentQuotePayload = {
  name: string;
  price: number;
  previousClose: number;
  changePct: number;
  high: number;
  low: number;
  turnoverPct: number;
  peTtm: number | null;
  pb: number | null;
  floatMarketCapYi: number | null;
  marketCapYi: number | null;
  quoteTime: string;
};

export type CnMarketSnapshot = TencentQuotePayload & {
  symbol: string;
  exchange: string;
  bars: number;
  periodReturnPct: number | null;
  sixtyDayReturnPct: number | null;
  lastTradingDate: string;
  source: SourceRecord;
};

export type CnFinancialPeriod = {
  end: string;
  label: string;
  filingDate: string;
  revenueB: number | null;
  revenueYoyPct: number | null;
  grossProfitB: number | null;
  grossMarginPct: number | null;
  netIncomeB: number | null;
  dilutedEps: number | null;
  derivedQuarter: boolean;
};

export type CnFinancialSnapshot = {
  periods: CnFinancialPeriod[];
  latestFilingDate: string;
  source: SourceRecord;
};

export type CnForecastPeriod = {
  year: string;
  estimates: number;
  lowEps: number | null;
  meanEps: number;
  highEps: number | null;
  meanNetProfitB: number | null;
};

export type CnConsensusSnapshot = {
  asOf: string;
  company: string;
  periods: CnForecastPeriod[];
  source: SourceRecord;
};

export type CnAnnouncement = {
  date: string;
  title: string;
  url: string;
};

export type CnCalendarEvent = {
  date: string;
  type: string;
  content: string;
};

export type CnEventSnapshot = {
  announcements: CnAnnouncement[];
  calendarEvents: CnCalendarEvent[];
  nextReportDate: string | null;
  nextReportLabel: string | null;
  latestEarningsEvent: CnCalendarEvent | null;
  sources: SourceRecord[];
};

export type CnCompanyEvidence = {
  symbol: string;
  company: string;
  exchange: string;
  market: CnMarketSnapshot | null;
  financials: CnFinancialSnapshot | null;
  consensus: CnConsensusSnapshot | null;
  events: CnEventSnapshot | null;
  sources: SourceRecord[];
  gaps: string[];
};

type EvidenceProgress = (message: string, detail: string) => void;

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim() || value.trim() === "-") {
    return null;
  }
  const parsed = Number(value.replace(/[,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanCode(symbol: string): string {
  const value = symbol.trim().toLowerCase();
  const withoutPrefix = value.replace(/^(sh|sz|bj)/, "");
  const withoutSuffix = withoutPrefix.replace(/\.(sh|sz|bj|cn)$/i, "");
  if (!/^\d{6}$/.test(withoutSuffix)) {
    throw new Error(`A 股代码格式无效：${symbol}`);
  }
  return withoutSuffix;
}

export function cnPrefix(symbol: string): "sh" | "sz" | "bj" {
  const input = symbol.trim().toLowerCase();
  if (input.startsWith("sh") || input.endsWith(".sh")) return "sh";
  if (input.startsWith("sz") || input.endsWith(".sz")) return "sz";
  if (input.startsWith("bj") || input.endsWith(".bj")) return "bj";
  const code = cleanCode(symbol);
  if (code.startsWith("92")) return "bj";
  if (code.startsWith("4") || code.startsWith("8")) return "bj";
  if (code.startsWith("5") || code.startsWith("6") || code.startsWith("9")) {
    return "sh";
  }
  return "sz";
}

function exchangeLabel(prefix: "sh" | "sz" | "bj", code: string): string {
  if (prefix === "bj") return "北京证券交易所";
  if (prefix === "sh") {
    return code.startsWith("688") ? "上海证券交易所 · 科创板" : "上海证券交易所";
  }
  return code.startsWith("30") ? "深圳证券交易所 · 创业板" : "深圳证券交易所";
}

function decodeGbk(buffer: ArrayBuffer): string {
  return new TextDecoder("gbk").decode(buffer);
}

function tencentTimestamp(value: string): string {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
  );
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`;
}

export function parseTencentQuote(text: string): TencentQuotePayload {
  const body = text.match(/="([^"]*)"/)?.[1];
  if (!body) throw new Error("腾讯行情返回为空");
  const values = body.split("~");
  if (values.length < 53 || !values[1]) {
    throw new Error("腾讯行情字段不完整");
  }
  const price = parseNumber(values[3]);
  const previousClose = parseNumber(values[4]);
  if (price === null || previousClose === null) {
    throw new Error("腾讯行情缺少有效价格");
  }
  return {
    name: values[1],
    price,
    previousClose,
    changePct: parseNumber(values[32]) ?? 0,
    high: parseNumber(values[33]) ?? price,
    low: parseNumber(values[34]) ?? price,
    turnoverPct: parseNumber(values[38]) ?? 0,
    peTtm: parseNumber(values[39]),
    floatMarketCapYi: parseNumber(values[44]),
    marketCapYi: parseNumber(values[45]),
    pb: parseNumber(values[46]),
    quoteTime: tencentTimestamp(values[30]),
  };
}

type TencentKlinePayload = {
  data?: Record<
    string,
    {
      qfqday?: string[][];
      day?: string[][];
    }
  >;
};

export function parseTencentKlines(
  payload: TencentKlinePayload,
  prefixedSymbol: string,
): {
  bars: number;
  lastTradingDate: string;
  periodReturnPct: number | null;
  sixtyDayReturnPct: number | null;
} {
  const record = payload.data?.[prefixedSymbol];
  const rows = record?.qfqday || record?.day || [];
  if (rows.length < 2) throw new Error("腾讯 K 线历史不足");
  const last = parseNumber(rows.at(-1)?.[2]);
  const closeAt = (index: number) => parseNumber(rows.at(index)?.[2]);
  const returnFrom = (lookback: number) => {
    const base = closeAt(Math.max(0, rows.length - 1 - lookback));
    return last !== null && base !== null && base !== 0
      ? (last / base - 1) * 100
      : null;
  };
  return {
    bars: rows.length,
    lastTradingDate: rows.at(-1)?.[0] || "",
    periodReturnPct: returnFrom(20),
    sixtyDayReturnPct: returnFrom(60),
  };
}

export async function fetchCnMarketSnapshot(
  symbol: string,
): Promise<CnMarketSnapshot> {
  const code = cleanCode(symbol);
  const prefix = cnPrefix(symbol);
  const prefixed = `${prefix}${code}`;
  const [quoteResponse, klineResponse] = await Promise.all([
    fetch(`https://qt.gtimg.cn/q=${prefixed}`, {
      headers: { "user-agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    }),
    fetch(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefixed},day,,,80,qfq`,
      {
        headers: {
          "user-agent": USER_AGENT,
          referer: "https://gu.qq.com/",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    ),
  ]);
  if (!quoteResponse.ok) {
    throw new Error(`腾讯行情 HTTP ${quoteResponse.status}`);
  }
  if (!klineResponse.ok) {
    throw new Error(`腾讯 K 线 HTTP ${klineResponse.status}`);
  }
  const quote = parseTencentQuote(
    decodeGbk(await quoteResponse.arrayBuffer()),
  );
  const kline = parseTencentKlines(
    (await klineResponse.json()) as TencentKlinePayload,
    prefixed,
  );
  return {
    symbol: code,
    exchange: exchangeLabel(prefix, code),
    ...quote,
    ...kline,
    source: {
      name: "A 股实时行情与前复权日线",
      provider: "腾讯财经 · a-stock-data",
      status: "connected",
      asOf: quote.quoteTime || new Date().toISOString(),
      tier: "A",
      note: `已冻结 ${quote.name} 的实时行情、PE/PB/市值与 ${kline.bars} 条前复权日线。`,
    },
  };
}

type SinaFinancialItem = {
  item_field?: string;
  item_value?: string | number | null;
  item_tongbi?: string | number | null;
};

type SinaFinancialReport = {
  publish_date?: string;
  data?: SinaFinancialItem[];
};

type SinaFinancialPayload = {
  result?: {
    data?: {
      report_list?: Record<string, SinaFinancialReport>;
    };
  };
};

type CumulativePeriod = {
  end: string;
  filingDate: string;
  revenue: number | null;
  revenueYoyPct: number | null;
  cost: number | null;
  netIncome: number | null;
  dilutedEps: number | null;
};

function compactDate(value: string | undefined): string {
  if (!value || value.length < 8) return value || "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function quarterNumber(end: string): number {
  const month = Number(end.slice(5, 7));
  return month === 3 ? 1 : month === 6 ? 2 : month === 9 ? 3 : 4;
}

function subtract(
  value: number | null,
  previous: number | null | undefined,
): number | null {
  return value !== null && previous !== null && previous !== undefined
    ? value - previous
    : value;
}

export function parseSinaFinancials(
  payload: SinaFinancialPayload,
): CnFinancialSnapshot {
  const reports = payload.result?.data?.report_list || {};
  const cumulative: CumulativePeriod[] = Object.entries(reports)
    .map(([date, report]) => {
      const items = new Map(
        (report.data || []).map((item) => [item.item_field || "", item]),
      );
      const revenueItem = items.get("BIZINCO") || items.get("BIZTOTINCO");
      return {
        end: compactDate(date),
        filingDate: compactDate(report.publish_date),
        revenue: parseNumber(revenueItem?.item_value),
        revenueYoyPct:
          parseNumber(revenueItem?.item_tongbi) === null
            ? null
            : (parseNumber(revenueItem?.item_tongbi) as number) * 100,
        cost: parseNumber(items.get("BIZCOST")?.item_value),
        netIncome: parseNumber(
          (items.get("PARENETP") || items.get("NETPROFIT"))?.item_value,
        ),
        dilutedEps: parseNumber(
          (items.get("DILUTEDEPS") || items.get("BASICEPS"))?.item_value,
        ),
      };
    })
    .filter((row) => row.end)
    .sort((a, b) => a.end.localeCompare(b.end));
  if (!cumulative.length) throw new Error("新浪利润表没有可用报告期");

  const byEnd = new Map(cumulative.map((period) => [period.end, period]));
  const discrete = cumulative.map((period): CnFinancialPeriod => {
    const year = period.end.slice(0, 4);
    const quarter = quarterNumber(period.end);
    const previousEnd =
      quarter === 2
        ? `${year}-03-31`
        : quarter === 3
          ? `${year}-06-30`
          : quarter === 4
            ? `${year}-09-30`
            : "";
    const previous = previousEnd ? byEnd.get(previousEnd) : undefined;
    const revenue = subtract(period.revenue, previous?.revenue);
    const cost = subtract(period.cost, previous?.cost);
    const grossProfit =
      revenue !== null && cost !== null ? revenue - cost : null;
    const grossMargin =
      grossProfit !== null && revenue !== null && revenue !== 0
        ? (grossProfit / revenue) * 100
        : null;
    const netIncome = subtract(period.netIncome, previous?.netIncome);
    const dilutedEps = subtract(period.dilutedEps, previous?.dilutedEps);
    return {
      end: period.end,
      label: `${year}Q${quarter}`,
      filingDate: period.filingDate,
      revenueB: revenue === null ? null : revenue / 1e9,
      revenueYoyPct:
        quarter === 1 ? period.revenueYoyPct : null,
      grossProfitB: grossProfit === null ? null : grossProfit / 1e9,
      grossMarginPct: grossMargin,
      netIncomeB: netIncome === null ? null : netIncome / 1e9,
      dilutedEps,
      derivedQuarter: quarter !== 1,
    };
  });
  return {
    periods: discrete.sort((a, b) => b.end.localeCompare(a.end)),
    latestFilingDate: discrete
      .map((period) => period.filingDate)
      .filter(Boolean)
      .sort()
      .at(-1) || "",
    source: {
      name: "A 股公司利润表",
      provider: "新浪财经公开财务 API · a-stock-data",
      status: "connected",
      asOf:
        discrete
          .map((period) => period.filingDate)
          .filter(Boolean)
          .sort()
          .at(-1) || new Date().toISOString(),
      tier: "A",
      note: `已读取 ${discrete.length} 个报告期；Q2/Q3/Q4 单季值由累计报表相减推导并明确标记。`,
    },
  };
}

export async function fetchCnFinancials(
  symbol: string,
): Promise<CnFinancialSnapshot> {
  const code = cleanCode(symbol);
  const paperCode = `${cnPrefix(symbol)}${code}`;
  const url = new URL(
    "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022",
  );
  url.searchParams.set("paperCode", paperCode);
  url.searchParams.set("source", "lrb");
  url.searchParams.set("type", "0");
  url.searchParams.set("page", "1");
  url.searchParams.set("num", "16");
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`新浪财务 HTTP ${response.status}`);
  return parseSinaFinancials((await response.json()) as SinaFinancialPayload);
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(section: string): string[][] {
  return [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
      (cell) => stripHtml(cell[1]),
    ),
  );
}

export function parseThsForecast(html: string): CnConsensusSnapshot {
  const forecastBlock =
    html.match(/<div[^>]+id="forecast"[\s\S]*?<!--\s*业绩预测详表\s*-->/i)?.[0] ||
    html;
  const asOf =
    forecastBlock.match(/截至(\d{4}-\d{2}-\d{2})/)?.[1] ||
    new Date().toISOString().slice(0, 10);
  const company =
    forecastBlock.match(/家机构对([^<]+?)的\d{4}年度业绩作出预测/)?.[1]?.trim() ||
    "";
  const epsSection =
    forecastBlock.match(
      /汇总--预测年报每股收益[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i,
    )?.[1] || "";
  const profitSection =
    forecastBlock.match(
      /汇总--预测年报净利润[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i,
    )?.[1] || "";
  const profitByYear = new Map<string, number | null>();
  for (const row of tableRows(profitSection)) {
    if (/^\d{4}$/.test(row[0] || "")) {
      profitByYear.set(row[0], parseNumber(row[3]));
    }
  }
  const periods = tableRows(epsSection)
    .filter((row) => /^\d{4}$/.test(row[0] || ""))
    .map((row): CnForecastPeriod | null => {
      const mean = parseNumber(row[3]);
      if (mean === null) return null;
      return {
        year: row[0],
        estimates: parseNumber(row[1]) ?? 0,
        lowEps: parseNumber(row[2]),
        meanEps: mean,
        highEps: parseNumber(row[4]),
        meanNetProfitB:
          profitByYear.get(row[0]) === null ||
          profitByYear.get(row[0]) === undefined
            ? null
            : (profitByYear.get(row[0]) as number) / 10,
      };
    })
    .filter((row): row is CnForecastPeriod => row !== null);
  if (!periods.length) throw new Error("同花顺页面没有机构 EPS 一致预期");
  return {
    asOf,
    company,
    periods,
    source: {
      name: "A 股机构 EPS 一致预期",
      provider: "同花顺 F10 公开页面 · a-stock-data",
      status: "connected",
      asOf,
      tier: "A",
      note: `6 个月窗口共 ${periods[0].estimates} 家机构；均值、区间与覆盖数按页面原口径保留。`,
    },
  };
}

export async function fetchCnConsensus(
  symbol: string,
): Promise<CnConsensusSnapshot> {
  const code = cleanCode(symbol);
  const response = await fetch(
    `https://basic.10jqka.com.cn/new/${code}/worth.html`,
    {
      headers: {
        "user-agent": USER_AGENT,
        referer: "https://basic.10jqka.com.cn/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`同花顺一致预期 HTTP ${response.status}`);
  return parseThsForecast(decodeGbk(await response.arrayBuffer()));
}

type SzseAnnouncementPayload = {
  data?: Array<{
    title?: string;
    publishTime?: string;
    attachPath?: string;
  }>;
};

export function parseStockCalendar(html: string): CnCalendarEvent[] {
  const match = html.match(
    /var pagedata = (\{[\s\S]*?\});\s*(?:<\/script>|var\s)/,
  );
  if (!match) return [];
  try {
    const payload = JSON.parse(match[1]) as {
      sjyl?: {
        result?: {
          data?: Array<{
            NOTICE_DATE?: string;
            EVENT_TYPE?: string;
            LEVEL1_CONTENT?: string;
          }>;
        };
      };
    };
    return (payload.sjyl?.result?.data || [])
      .map((event) => ({
        date: String(event.NOTICE_DATE || "").slice(0, 10),
        type: String(event.EVENT_TYPE || ""),
        content: String(event.LEVEL1_CONTENT || ""),
      }))
      .filter((event) => event.date && event.type);
  } catch {
    return [];
  }
}

export async function fetchCnEvents(symbol: string): Promise<CnEventSnapshot> {
  const code = cleanCode(symbol);
  const prefix = cnPrefix(symbol);
  const requests: Array<Promise<Response>> = [
    fetch(`https://data.eastmoney.com/stockcalendar/${code}.html`, {
      headers: { "user-agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }),
  ];
  if (prefix === "sz") {
    requests.push(
      fetch("https://www.szse.cn/api/disc/announcement/annList", {
        method: "POST",
        headers: {
          "user-agent": USER_AGENT,
          referer: "https://www.szse.cn/disclosure/listed/notice/index.html",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channelCode: ["listedNotice_disc"],
          pageSize: 12,
          pageNum: 1,
          stock: [code],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }),
    );
  }
  const responses = await Promise.allSettled(requests);
  const calendarResponse =
    responses[0].status === "fulfilled" ? responses[0].value : null;
  const calendarEvents =
    calendarResponse?.ok ? parseStockCalendar(await calendarResponse.text()) : [];
  const now = new Date().toISOString().slice(0, 10);
  const appointment = calendarEvents
    .filter(
      (event) =>
        event.type === "预约披露日" &&
        event.date >= now &&
        /季报|半年报|年报/.test(event.content),
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const latestEarningsEvent =
    calendarEvents.find((event) =>
      /业绩预告|业绩快报|业绩报表/.test(event.type),
    ) || null;

  let announcements: CnAnnouncement[] = [];
  const announcementResponse =
    responses[1]?.status === "fulfilled" ? responses[1].value : null;
  if (announcementResponse?.ok) {
    const payload =
      (await announcementResponse.json()) as SzseAnnouncementPayload;
    announcements = (payload.data || []).map((item) => ({
      date: String(item.publishTime || "").slice(0, 10),
      title: String(item.title || ""),
      url: item.attachPath
        ? `https://disc.static.szse.cn/download${item.attachPath}`
        : "https://www.szse.cn/disclosure/listed/notice/index.html",
    }));
  }

  const sources: SourceRecord[] = [
    {
      name: "A 股公司事件日历",
      provider: "东方财富公开事件日历 · a-stock-data",
      status: calendarEvents.length ? "connected" : "missing",
      asOf: new Date().toISOString(),
      tier: "B",
      note: appointment
        ? `下一次定期报告预约披露日为 ${appointment.date}；预约日可能变更。`
        : "未取得未来定期报告预约披露日。",
    },
  ];
  if (prefix === "sz") {
    sources.push({
      name: "深市公司公告",
      provider: "深圳证券交易所",
      status: announcements.length ? "connected" : "missing",
      asOf: announcements[0]?.date || new Date().toISOString(),
      tier: "S",
      note: announcements.length
        ? `已验证最近 ${announcements.length} 条交易所公告及 PDF 链接。`
        : "深交所公告接口未返回有效记录。",
    });
  } else {
    sources.push({
      name: "交易所公司公告",
      provider: prefix === "sh" ? "上海证券交易所" : "北京证券交易所",
      status: "restricted",
      asOf: new Date().toISOString(),
      tier: "S",
      note: "当前版本先以事件日历验证报告日期；交易所公告正文适配器待补。",
    });
  }
  return {
    announcements,
    calendarEvents,
    nextReportDate: appointment?.date || null,
    nextReportLabel: appointment?.content || null,
    latestEarningsEvent,
    sources,
  };
}

function missingSource(
  name: string,
  provider: string,
  tier: SourceRecord["tier"],
  error: unknown,
): SourceRecord {
  return {
    name,
    provider,
    status: "missing",
    asOf: new Date().toISOString(),
    tier,
    note: error instanceof Error ? error.message : "数据源连接失败",
  };
}

export async function fetchCnCompanyEvidence(
  symbol: string,
  onProgress?: EvidenceProgress,
): Promise<CnCompanyEvidence> {
  const code = cleanCode(symbol);
  onProgress?.(
    "正在抓取腾讯实时行情与前复权日线",
    `${code} · 价格 / PE / PB / 市值 / 20 日与 60 日回报`,
  );
  const marketResult = await Promise.allSettled([
    fetchCnMarketSnapshot(code),
  ]);
  const market =
    marketResult[0].status === "fulfilled" ? marketResult[0].value : null;
  onProgress?.(
    market ? "腾讯行情与 K 线已冻结" : "腾讯行情未取得，继续采集财务证据",
    market
      ? `${market.name} ¥${market.price.toFixed(2)} · ${market.bars} 条日线`
      : "失败会进入证据缺口，不回填演示数据",
  );

  onProgress?.(
    "正在读取公司财务、机构预期与事件日历",
    "新浪利润表 + 同花顺一致预期 + 交易所公告 / 预约披露日",
  );
  const [financialResult, consensusResult, eventsResult] =
    await Promise.allSettled([
      fetchCnFinancials(code),
      fetchCnConsensus(code),
      fetchCnEvents(code),
    ]);
  const financials =
    financialResult.status === "fulfilled" ? financialResult.value : null;
  const consensus =
    consensusResult.status === "fulfilled" ? consensusResult.value : null;
  const events =
    eventsResult.status === "fulfilled" ? eventsResult.value : null;

  const sources: SourceRecord[] = [];
  if (market) {
    sources.push(market.source);
  } else {
    sources.push(
      missingSource(
        "A 股实时行情与前复权日线",
        "腾讯财经 · a-stock-data",
        "A",
        marketResult[0].status === "rejected"
          ? marketResult[0].reason
          : "行情缺失",
      ),
    );
  }
  if (financials) {
    sources.push(financials.source);
  } else {
    sources.push(
      missingSource(
        "A 股公司利润表",
        "新浪财经公开财务 API · a-stock-data",
        "A",
        financialResult.status === "rejected"
          ? financialResult.reason
          : "财务缺失",
      ),
    );
  }
  if (consensus) {
    sources.push(consensus.source);
  } else {
    sources.push(
      missingSource(
        "A 股机构 EPS 一致预期",
        "同花顺 F10 公开页面 · a-stock-data",
        "A",
        consensusResult.status === "rejected"
          ? consensusResult.reason
          : "一致预期缺失",
      ),
    );
  }
  if (events) {
    sources.push(...events.sources);
  } else {
    sources.push(
      missingSource(
        "A 股公司事件与公告",
        "交易所 / 东方财富事件日历 · a-stock-data",
        "B",
        eventsResult.status === "rejected"
          ? eventsResult.reason
          : "事件日历缺失",
      ),
    );
  }

  const gaps = [
    !market ? "腾讯实时行情与前复权日线未取得。" : null,
    !financials ? "公开利润表未取得，无法验证历史 KPI 与毛利率。" : null,
    !consensus ? "同花顺机构 EPS 一致预期未取得或该股票暂无机构覆盖。" : null,
    !events?.nextReportDate
      ? "下一次定期报告预约披露日未取得；催化剂日期不能伪造。"
      : null,
    !events?.announcements.length
      ? "交易所公告列表未取得；事件标题仅由公开日历交叉验证。"
      : null,
    "A 股个股期权、融券可借量与买方高端门槛未形成同一冻结快照。",
  ].filter((item): item is string => Boolean(item));

  return {
    symbol: code,
    company:
      market?.name || consensus?.company || String(events?.announcements[0]?.title || "").split(/[：:]/)[0] || code,
    exchange: market?.exchange || exchangeLabel(cnPrefix(code), code),
    market,
    financials,
    consensus,
    events,
    sources,
    gaps,
  };
}
