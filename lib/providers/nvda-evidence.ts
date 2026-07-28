import type { SourceRecord } from "../types";
import type { MarketSnapshot } from "./vibe-mcp";

const NASDAQ_API = "https://api.nasdaq.com/api";
const SEC_SUBMISSIONS =
  "https://data.sec.gov/submissions/CIK0001045810.json";
const SEC_ARCHIVES =
  "https://www.sec.gov/Archives/edgar/data/1045810";

const browserHeaders = {
  accept: "application/json",
  "user-agent":
    process.env.CONSENSUS_USER_AGENT ||
    "Mozilla/5.0 (compatible; SignalForge/0.1; equity research)",
};

function secHeaders(accept = "application/json") {
  return {
    accept,
    "user-agent":
      process.env.SEC_USER_AGENT ||
      "SignalForge equity research https://github.com/zhiyao88kuai-lab/An-Tranding",
  };
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseNasdaqDate(value: string): Date {
  const numeric = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    return new Date(
      Date.UTC(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2])),
    );
  }
  const named = value.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (named) {
    const month = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].indexOf(
      named[1].slice(0, 1).toUpperCase() +
        named[1].slice(1, 3).toLowerCase(),
    );
    if (month >= 0) {
      return new Date(Date.UTC(Number(named[3]), month, Number(named[2])));
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Nasdaq date: ${value}`);
  }
  return parsed;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value === "--" || value === "N/A") {
    return null;
  }
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSecText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#822[01];|&ldquo;|&rdquo;/g, '"')
    .replace(/&#821[12];|&ndash;|&mdash;/g, "-")
    .replace(/&#58;/g, ":")
    .replace(/&#47;/g, "/")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredMatch(
  text: string,
  expression: RegExp,
  label: string,
): RegExpMatchArray {
  const match = text.match(expression);
  if (!match) throw new Error(`SEC earnings release missing ${label}`);
  return match;
}

export type NvdaOfficialSnapshot = {
  filingDate: string;
  sourceUrl: string;
  actualPeriod: string;
  actualRevenueB: number;
  priorQuarterRevenueB: number;
  priorYearRevenueB: number;
  dataCenterRevenueB: number;
  dataCenterQoqPct: number;
  dataCenterYoyPct: number;
  actualGaapGrossMarginPct: number;
  actualNonGaapGrossMarginPct: number;
  priorQuarterGaapGrossMarginPct: number;
  priorQuarterNonGaapGrossMarginPct: number;
  priorYearGaapGrossMarginPct: number;
  priorYearNonGaapGrossMarginPct: number;
  actualGaapEps: number;
  actualNonGaapEps: number;
  outlookPeriod: string;
  outlookRevenueB: number;
  outlookRevenueRangePct: number;
  outlookGaapGrossMarginPct: number;
  outlookNonGaapGrossMarginPct: number;
  outlookGrossMarginRangeBps: number;
  excludesChinaDataCenterCompute: boolean;
  source: SourceRecord;
};

type SecRecentFilings = {
  filings?: {
    recent?: {
      form?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
      items?: string[];
    };
  };
};

async function findLatestNvdaEarningsRelease(): Promise<{
  filingDate: string;
  url: string;
}> {
  const response = await fetch(SEC_SUBMISSIONS, {
    headers: secHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`SEC submissions HTTP ${response.status}`);
  const payload = (await response.json()) as SecRecentFilings;
  const recent = payload.filings?.recent;
  const index =
    recent?.form?.findIndex(
      (form, row) =>
        form === "8-K" && String(recent.items?.[row] || "").includes("2.02"),
    ) ?? -1;
  if (index < 0) throw new Error("SEC earnings 8-K was not found");

  const accession = recent?.accessionNumber?.[index];
  const filingDate = recent?.filingDate?.[index];
  if (!accession || !filingDate) {
    throw new Error("SEC earnings 8-K metadata is incomplete");
  }
  const accessionPath = accession.replace(/-/g, "");
  const directoryUrl = `${SEC_ARCHIVES}/${accessionPath}/index.json`;
  const directoryResponse = await fetch(directoryUrl, {
    headers: secHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!directoryResponse.ok) {
    throw new Error(`SEC filing directory HTTP ${directoryResponse.status}`);
  }
  const directory = (await directoryResponse.json()) as {
    directory?: { item?: Array<{ name?: string }> };
  };
  const releaseName = directory.directory?.item
    ?.map((item) => item.name || "")
    .find((name) => /q\d+fy\d+pr\.htm$/i.test(name));
  if (!releaseName) throw new Error("SEC earnings exhibit was not found");
  return {
    filingDate,
    url: `${SEC_ARCHIVES}/${accessionPath}/${releaseName}`,
  };
}

export async function fetchNvdaOfficialSnapshot(): Promise<NvdaOfficialSnapshot> {
  const release = await findLatestNvdaEarningsRelease();
  const response = await fetch(release.url, {
    headers: secHeaders("text/html"),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`SEC earnings exhibit HTTP ${response.status}`);
  const text = formatSecText(await response.text());

  const period = requiredMatch(
    text,
    /Financial Results for ([A-Za-z]+) Quarter Fiscal (\d{4})/i,
    "reported period",
  );
  const summary = requiredMatch(
    text,
    /Q\d Fiscal \d{4} Summary GAAP[\s\S]*?Revenue \$([\d,]+) \$([\d,]+) \$([\d,]+)[\s\S]*?Gross margin ([\d.]+) % ([\d.]+) % ([\d.]+) %[\s\S]*?Diluted earnings per share \$([\d.]+)[\s\S]*?Non-GAAP[\s\S]*?Revenue \$[\d,]+ \$[\d,]+ \$[\d,]+[\s\S]*?Gross margin ([\d.]+) % ([\d.]+) % ([\d.]+) %[\s\S]*?Diluted earnings per share \$([\d.]+)/i,
    "summary table",
  );
  const dataCenter = requiredMatch(
    text,
    /Data Center[\s\S]{0,160}?First-quarter revenue was a record \$([\d.]+) billion, up ([\d.]+)% from the previous quarter and up ([\d.]+)% from a year ago/i,
    "Data Center KPI",
  );
  const outlookPeriod = requiredMatch(
    text,
    /outlook for the ([a-z]+) quarter of fiscal (\d{4})/i,
    "outlook period",
  );
  const outlookRevenue = requiredMatch(
    text,
    /Revenue is expected to be \$([\d.]+) billion, plus or minus ([\d.]+)%/i,
    "revenue outlook",
  );
  const outlookMargin = requiredMatch(
    text,
    /GAAP and non-GAAP gross margins are expected to be ([\d.]+)% and ([\d.]+)%, respectively, plus or minus ([\d.]+) basis points/i,
    "gross-margin outlook",
  );

  const value = (raw: string) => Number(raw.replace(/,/g, ""));
  const ordinal = (raw: string) =>
    ({ first: "Q1", second: "Q2", third: "Q3", fourth: "Q4" })[
      raw.toLowerCase() as "first" | "second" | "third" | "fourth"
    ] || raw;
  const source: SourceRecord = {
    name: "NVIDIA reported results & outlook",
    provider: "SEC EDGAR earnings exhibit · global-stock-data",
    status: "connected",
    asOf: release.filingDate,
    tier: "S",
    note:
      "自动定位最新 Item 2.02 8-K 附件；收入、数据中心 KPI 与 GAAP/非 GAAP 毛利率已验证。",
  };

  return {
    filingDate: release.filingDate,
    sourceUrl: release.url,
    actualPeriod: `${ordinal(period[1])} FY${period[2].slice(-2)}`,
    actualRevenueB: value(summary[1]) / 1_000,
    priorQuarterRevenueB: value(summary[2]) / 1_000,
    priorYearRevenueB: value(summary[3]) / 1_000,
    actualGaapGrossMarginPct: value(summary[4]),
    priorQuarterGaapGrossMarginPct: value(summary[5]),
    priorYearGaapGrossMarginPct: value(summary[6]),
    actualGaapEps: value(summary[7]),
    actualNonGaapGrossMarginPct: value(summary[8]),
    priorQuarterNonGaapGrossMarginPct: value(summary[9]),
    priorYearNonGaapGrossMarginPct: value(summary[10]),
    actualNonGaapEps: value(summary[11]),
    dataCenterRevenueB: value(dataCenter[1]),
    dataCenterQoqPct: value(dataCenter[2]),
    dataCenterYoyPct: value(dataCenter[3]),
    outlookPeriod: `${ordinal(outlookPeriod[1])} FY${outlookPeriod[2].slice(
      -2,
    )}`,
    outlookRevenueB: value(outlookRevenue[1]),
    outlookRevenueRangePct: value(outlookRevenue[2]),
    outlookGaapGrossMarginPct: value(outlookMargin[1]),
    outlookNonGaapGrossMarginPct: value(outlookMargin[2]),
    outlookGrossMarginRangeBps: value(outlookMargin[3]),
    excludesChinaDataCenterCompute: /not assuming any Data Center compute revenue from China/i.test(
      text,
    ),
    source,
  };
}

export type NasdaqMarketSnapshot = MarketSnapshot & {
  dayChangePct: number;
  previousClose: number;
  source: SourceRecord;
};

export async function fetchNasdaqMarketSnapshot(
  symbol: string,
): Promise<NasdaqMarketSnapshot> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 55);
  const url = `${NASDAQ_API}/quote/${encodeURIComponent(
    symbol,
  )}/historical?assetclass=stocks&fromdate=${dateOnly(
    start,
  )}&todate=${dateOnly(end)}&limit=50`;
  const response = await fetch(url, {
    headers: browserHeaders,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Nasdaq market HTTP ${response.status}`);
  const payload = (await response.json()) as {
    data?: {
      tradesTable?: {
        rows?: Array<{
          date?: string;
          close?: string;
          volume?: string;
        }>;
      };
    };
  };
  const rows = payload.data?.tradesTable?.rows || [];
  if (rows.length < 2) throw new Error("Nasdaq market history is incomplete");
  const latest = rows[0];
  const previous = rows[1];
  const oldest = rows.at(-1);
  const lastClose = parseNumber(latest.close);
  const previousClose = parseNumber(previous.close);
  const firstClose = parseNumber(oldest?.close);
  const lastVolume = parseNumber(latest.volume);
  if (
    lastClose === null ||
    previousClose === null ||
    firstClose === null ||
    lastVolume === null
  ) {
    throw new Error("Nasdaq market history contains invalid values");
  }
  const asOf = parseNasdaqDate(String(latest.date)).toISOString();
  return {
    symbol: symbol.toUpperCase(),
    asOf,
    firstClose,
    lastClose,
    lastVolume,
    periodReturnPct: (lastClose / firstClose - 1) * 100,
    bars: rows.length,
    previousClose,
    dayChangePct: (lastClose / previousClose - 1) * 100,
    source: {
      name: "NASDAQ market snapshot",
      provider: "Nasdaq historical quote API · global-stock-data",
      status: "connected",
      asOf,
      tier: "A",
      note: `${rows.length} 个交易日，只读冻结快照；最新收盘 $${lastClose.toFixed(
        2,
      )}。`,
    },
  };
}

export type EventOptionsSnapshot = {
  asOf: string;
  eventDate: string;
  expiry: string;
  strike: number;
  straddleMid: number;
  impliedMovePct: number;
  callOpenInterest: number | null;
  putOpenInterest: number | null;
  eventIsolated: boolean;
  source: SourceRecord;
};

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export async function fetchNasdaqEventOptions(
  symbol: string,
  spot: number,
  eventDate = process.env.NVDA_NEXT_EARNINGS_DATE || "2026-08-26",
): Promise<EventOptionsSnapshot> {
  const event = new Date(`${eventDate}T21:00:00Z`);
  if (Date.now() > addDays(event, 2).getTime()) {
    throw new Error("Configured earnings date is stale");
  }
  const from = dateOnly(addDays(event, 1));
  const to = dateOnly(addDays(event, 10));
  const url = `${NASDAQ_API}/quote/${encodeURIComponent(
    symbol,
  )}/option-chain?assetclass=stocks&fromdate=${from}&todate=${to}&limit=5000`;
  const response = await fetch(url, {
    headers: browserHeaders,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Nasdaq options HTTP ${response.status}`);
  const payload = (await response.json()) as {
    data?: {
      lastTrade?: string;
      table?: {
        rows?: Array<Record<string, string | boolean | null>>;
      };
    };
  };
  const rows = payload.data?.table?.rows || [];
  let expiry = "";
  const firstExpiryRows: Array<Record<string, string | boolean | null>> = [];
  for (const row of rows) {
    if (typeof row.expirygroup === "string" && row.expirygroup) {
      if (expiry) break;
      expiry = row.expirygroup;
      continue;
    }
    if (expiry && row.strike) firstExpiryRows.push(row);
  }
  const atm = firstExpiryRows
    .map((row) => ({ row, strike: parseNumber(row.strike) }))
    .filter(
      (
        item,
      ): item is {
        row: Record<string, string | boolean | null>;
        strike: number;
      } => item.strike !== null,
    )
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
  if (!expiry || !atm) throw new Error("Event options expiry is incomplete");
  const callBid = parseNumber(atm.row.c_Bid);
  const callAsk = parseNumber(atm.row.c_Ask);
  const putBid = parseNumber(atm.row.p_Bid);
  const putAsk = parseNumber(atm.row.p_Ask);
  if (
    callBid === null ||
    callAsk === null ||
    putBid === null ||
    putAsk === null
  ) {
    throw new Error("ATM event option quotes are incomplete");
  }
  const straddleMid = (callBid + callAsk + putBid + putAsk) / 2;
  const asOfMatch = payload.data?.lastTrade?.match(/AS OF ([A-Z]{3} \d+, \d{4})/i);
  const asOf = asOfMatch
    ? parseNasdaqDate(asOfMatch[1]).toISOString()
    : new Date().toISOString();
  return {
    asOf,
    eventDate,
    expiry,
    strike: atm.strike,
    straddleMid,
    impliedMovePct: (straddleMid / spot) * 100,
    callOpenInterest: parseNumber(atm.row.c_Openinterest),
    putOpenInterest: parseNumber(atm.row.p_Openinterest),
    eventIsolated: new Date(expiry).getTime() > event.getTime(),
    source: {
      name: "Event-isolating options snapshot",
      provider: "Nasdaq option chain · global-stock-data",
      status: "connected",
      asOf,
      tier: "C",
      note: `仅返回覆盖财报的首个到期日与 ATM 跨式摘要，不回传完整期权链；使用前应核对数据许可。`,
    },
  };
}

export type FinraShortVolumeSnapshot = {
  asOf: string;
  observations: number;
  averageShortVolumeRatioPct: number;
  latestShortVolumeRatioPct: number;
  source: SourceRecord;
};

export async function fetchFinraShortVolume(
  symbol: string,
): Promise<FinraShortVolumeSnapshot> {
  const dates = Array.from({ length: 12 }, (_, index) =>
    addDays(new Date(), -(index + 1)),
  ).filter((date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6);
  const observations = (
    await Promise.all(
      dates.map(async (date) => {
        const stamp = dateOnly(date).replace(/-/g, "");
        const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${stamp}.txt`;
        try {
          const response = await fetch(url, {
            cache: "no-store",
            signal: AbortSignal.timeout(6_000),
          });
          if (!response.ok) return null;
          const line = (await response.text())
            .split(/\r?\n/)
            .find((row) => row.split("|")[1] === symbol.toUpperCase());
          if (!line) return null;
          const [rawDate, , rawShort, , rawTotal] = line.split("|");
          const shortVolume = Number(rawShort);
          const totalVolume = Number(rawTotal);
          if (
            !Number.isFinite(shortVolume) ||
            !Number.isFinite(totalVolume) ||
            totalVolume <= 0
          ) {
            return null;
          }
          return {
            date: `${rawDate.slice(0, 4)}-${rawDate.slice(
              4,
              6,
            )}-${rawDate.slice(6, 8)}`,
            ratioPct: (shortVolume / totalVolume) * 100,
          };
        } catch {
          return null;
        }
      }),
    )
  )
    .filter(
      (
        row,
      ): row is {
        date: string;
        ratioPct: number;
      } => row !== null,
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  if (observations.length < 3) {
    throw new Error("FINRA short-volume history is incomplete");
  }
  const average =
    observations.reduce((sum, row) => sum + row.ratioPct, 0) /
    observations.length;
  return {
    asOf: observations[0].date,
    observations: observations.length,
    averageShortVolumeRatioPct: average,
    latestShortVolumeRatioPct: observations[0].ratioPct,
    source: {
      name: "FINRA daily short volume",
      provider: "FINRA Reg SHO · global-stock-data",
      status: "connected",
      asOf: observations[0].date,
      tier: "B",
      note:
        `${observations.length} 日派生比率；这是短成交量，不是空头持仓、借券费率、利用率或拥挤度。`,
    },
  };
}

export type NvdaPositioningSnapshot = {
  options?: EventOptionsSnapshot;
  shortVolume?: FinraShortVolumeSnapshot;
  sources: SourceRecord[];
  gaps: string[];
};

export type UsPositioningSnapshot = NvdaPositioningSnapshot;

export async function fetchUsPositioning(
  symbol: string,
  spot: number,
  eventDate?: string,
): Promise<NvdaPositioningSnapshot> {
  const [options, shortVolume] = await Promise.allSettled([
    fetchNasdaqEventOptions(symbol, spot, eventDate),
    fetchFinraShortVolume(symbol),
  ]);
  const sources: SourceRecord[] = [];
  const gaps: string[] = [];
  if (options.status === "fulfilled") {
    sources.push(options.value.source);
  } else {
    gaps.push(
      `覆盖财报的期权快照未验证：${
        options.reason instanceof Error ? options.reason.message : "连接失败"
      }`,
    );
  }
  if (shortVolume.status === "fulfilled") {
    sources.push(shortVolume.value.source);
  } else {
    gaps.push(
      `FINRA 短成交量未验证：${
        shortVolume.reason instanceof Error
          ? shortVolume.reason.message
          : "连接失败"
      }`,
    );
  }
  sources.push({
    name: "Borrow cost & utilization",
    provider: "Licensed broker / securities-lending feed",
    status: "restricted",
    asOf: new Date().toISOString(),
    tier: "C",
    note:
      "未配置具备再分发权限的借券费率、利用率与可借量数据；做空不得标记为 implementation-ready。",
  });
  gaps.push(
    "借券费率、利用率与可借量属于经纪商/证券借贷受限数据；接入已授权数据源前，SHORT 仅可作为研究情景。",
  );
  return {
    options: options.status === "fulfilled" ? options.value : undefined,
    shortVolume:
      shortVolume.status === "fulfilled" ? shortVolume.value : undefined,
    sources,
    gaps,
  };
}

export async function fetchNvdaPositioning(
  symbol: string,
  spot: number,
): Promise<NvdaPositioningSnapshot> {
  return fetchUsPositioning(
    symbol,
    spot,
    process.env.NVDA_NEXT_EARNINGS_DATE || "2026-08-26",
  );
}
