import type { SourceRecord } from "../types";

const SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS = "https://data.sec.gov/submissions";
const SEC_FACTS = "https://data.sec.gov/api/xbrl/companyfacts";
const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

type SecTickerRow = {
  cik_str?: number;
  ticker?: string;
  title?: string;
};

type SecFact = {
  start?: string;
  end?: string;
  val?: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
};

type SecCompanyFacts = {
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<
      string,
      {
        label?: string;
        units?: Record<string, SecFact[]>;
      }
    >;
  };
};

type SecSubmissions = {
  name?: string;
  sicDescription?: string;
  exchanges?: string[];
  filings?: {
    recent?: {
      form?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
      items?: string[];
    };
  };
};

export type UsFundamentalPeriod = {
  end: string;
  frame: string;
  filingDate: string;
  revenueB: number;
  grossProfitB: number | null;
  grossMarginPct: number | null;
  operatingIncomeB: number | null;
  operatingMarginPct: number | null;
  netIncomeB: number | null;
  dilutedEps: number | null;
};

export type CompanyGuidance = {
  period: string;
  revenueB: number;
  revenueRangeB: number | null;
  revenueRangePct: number | null;
  grossMarginPct: number | null;
  grossMarginRangeBps: number | null;
  dilutedEps: number | null;
};

export type UsCompanyEvidence = {
  symbol: string;
  company: string;
  cik: string;
  exchange: string;
  industry: string;
  latestEarningsFilingDate: string;
  latestEarningsReportDate: string;
  earningsReleaseUrl: string | null;
  estimatedNextEarningsDate: string;
  periods: UsFundamentalPeriod[];
  guidance: CompanyGuidance | null;
  source: SourceRecord;
};

let tickerMapPromise: Promise<Map<string, SecTickerRow>> | undefined;

function secHeaders(accept = "application/json") {
  return {
    accept,
    "user-agent":
      process.env.SEC_USER_AGENT ||
      "SignalForge equity research https://github.com/zhiyao88kuai-lab/An-Tranding",
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: secHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function loadTickerMap(): Promise<Map<string, SecTickerRow>> {
  if (!tickerMapPromise) {
    tickerMapPromise = fetchJson<Record<string, SecTickerRow>>(SEC_TICKERS).then(
      (payload) =>
        new Map(
          Object.values(payload)
            .filter((row) => row.ticker)
            .map((row) => [String(row.ticker).toUpperCase(), row]),
        ),
    );
  }
  return tickerMapPromise;
}

function conceptFacts(
  payload: SecCompanyFacts,
  concepts: string[],
  unit: string,
): SecFact[] {
  for (const concept of concepts) {
    const facts = payload.facts?.["us-gaap"]?.[concept]?.units?.[unit];
    if (Array.isArray(facts) && facts.length > 0) return facts;
  }
  return [];
}

function durationDays(fact: SecFact): number {
  if (!fact.start || !fact.end) return Number.POSITIVE_INFINITY;
  return (
    (new Date(`${fact.end}T00:00:00Z`).getTime() -
      new Date(`${fact.start}T00:00:00Z`).getTime()) /
    86_400_000
  );
}

function quarterlyByEnd(facts: SecFact[]): Map<string, SecFact> {
  const selected = new Map<string, SecFact>();
  for (const fact of facts) {
    if (
      fact.form !== "10-Q" ||
      !fact.end ||
      !Number.isFinite(fact.val) ||
      !/^CY\d{4}Q[1-4]$/.test(fact.frame || "")
    ) {
      continue;
    }
    const days = durationDays(fact);
    if (days < 65 || days > 120) continue;
    const previous = selected.get(fact.end);
    if (!previous || String(fact.filed) > String(previous.filed)) {
      selected.set(fact.end, fact);
    }
  }
  return selected;
}

function numberForEnd(
  facts: Map<string, SecFact>,
  end: string,
): number | null {
  const value = facts.get(end)?.val;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildPeriods(payload: SecCompanyFacts): UsFundamentalPeriod[] {
  const revenue = quarterlyByEnd(
    conceptFacts(
      payload,
      [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
      ],
      "USD",
    ),
  );
  const grossProfit = quarterlyByEnd(
    conceptFacts(payload, ["GrossProfit"], "USD"),
  );
  const operatingIncome = quarterlyByEnd(
    conceptFacts(payload, ["OperatingIncomeLoss"], "USD"),
  );
  const netIncome = quarterlyByEnd(
    conceptFacts(
      payload,
      ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
      "USD",
    ),
  );
  const dilutedEps = quarterlyByEnd(
    conceptFacts(
      payload,
      ["EarningsPerShareDiluted", "EarningsPerShareDilutedIncludingExtraordinaryItems"],
      "USD/shares",
    ),
  );

  return [...revenue.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 16)
    .map(([end, revenueFact]) => {
      const revenueValue = Number(revenueFact.val);
      const grossProfitValue = numberForEnd(grossProfit, end);
      const operatingIncomeValue = numberForEnd(operatingIncome, end);
      const netIncomeValue = numberForEnd(netIncome, end);
      return {
        end,
        frame: revenueFact.frame || "",
        filingDate: revenueFact.filed || end,
        revenueB: revenueValue / 1_000_000_000,
        grossProfitB:
          grossProfitValue === null
            ? null
            : grossProfitValue / 1_000_000_000,
        grossMarginPct:
          grossProfitValue === null
            ? null
            : (grossProfitValue / revenueValue) * 100,
        operatingIncomeB:
          operatingIncomeValue === null
            ? null
            : operatingIncomeValue / 1_000_000_000,
        operatingMarginPct:
          operatingIncomeValue === null
            ? null
            : (operatingIncomeValue / revenueValue) * 100,
        netIncomeB:
          netIncomeValue === null ? null : netIncomeValue / 1_000_000_000,
        dilutedEps: numberForEnd(dilutedEps, end),
      };
    });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#822[01];|&ldquo;|&rdquo;/g, '"')
    .replace(/&#821[12];|&ndash;|&mdash;/g, "-")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toBillions(value: string, unit: string): number {
  const parsed = Number(value.replace(/,/g, ""));
  return unit.toLowerCase().startsWith("m") ? parsed / 1_000 : parsed;
}

function parseGuidance(text: string): CompanyGuidance | null {
  const outlookIndex = text.search(/business outlook|outlook for|guidance for/i);
  const outlook =
    outlookIndex >= 0 ? text.slice(outlookIndex, outlookIndex + 8_000) : text;
  const revenue = outlook.match(
    /Revenue\s+(?:is expected to be\s+)?\$?\s*([\d,.]+)\s*(billion|million)[\s\S]{0,100}?(?:plus or minus|±|\+\/-|\$)\s*\$?\s*([\d,.]+)\s*(billion|million|%)/i,
  );
  if (!revenue) return null;
  const revenueIndex = revenue.index || 0;
  const afterRevenue = outlook.slice(revenueIndex, revenueIndex + 2_500);
  const beforeRevenue = outlook.slice(
    Math.max(0, revenueIndex - 500),
    revenueIndex,
  );
  const grossMargin = afterRevenue.match(
    /Gross margins?\s+(?:are expected to be\s+)?(?:approximately\s*)?([\d.]+)\s*%[\s\S]{0,80}?(?:(?:plus or minus|±|\+\/-)\s*([\d.]+)\s*basis points)?/i,
  );
  const dilutedEps = afterRevenue.match(
    /(?:Diluted earnings per share|Diluted EPS|EPS)\s+\$?\s*([\d.]+)/i,
  );
  const fqMatches = [...beforeRevenue.matchAll(/\bFQ([1-4])[-\s]?(\d{2})\b/gi)];
  const ordinalMatches = [
    ...beforeRevenue.matchAll(
    /\b(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(?:fiscal\s+)?(\d{4})/gi,
    ),
  ];
  const fq = fqMatches.at(-1);
  const ordinal = ordinalMatches.at(-1);
  const quarterMap: Record<string, string> = {
    first: "Q1",
    second: "Q2",
    third: "Q3",
    fourth: "Q4",
  };
  const rangeUnit = revenue[4].toLowerCase();
  const rangeValue =
    rangeUnit === "%"
      ? null
      : toBillions(revenue[3], rangeUnit);
  const rangePct =
    rangeUnit === "%"
      ? Number(revenue[3])
      : (Number(rangeValue) / toBillions(revenue[1], revenue[2])) * 100;

  return {
    period: fq
      ? `Q${fq[1]} FY${fq[2]}`
      : ordinal
        ? `${quarterMap[ordinal[1].toLowerCase()]} FY${ordinal[2].slice(-2)}`
        : "下一季",
    revenueB: toBillions(revenue[1], revenue[2]),
    revenueRangeB: rangeValue,
    revenueRangePct: Number.isFinite(rangePct) ? rangePct : null,
    grossMarginPct: grossMargin ? Number(grossMargin[1]) : null,
    grossMarginRangeBps:
      grossMargin?.[2] && Number.isFinite(Number(grossMargin[2]))
        ? Number(grossMargin[2])
        : null,
    dilutedEps: dilutedEps ? Number(dilutedEps[1]) : null,
  };
}

function estimateNextEarningsDate(filingDate: string): string {
  const value = new Date(`${filingDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 91);
  if (value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1);
  if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function findEarningsRelease(
  cik: string,
  submissions: SecSubmissions,
): Promise<{
  filingDate: string;
  reportDate: string;
  releaseUrl: string | null;
  guidance: CompanyGuidance | null;
}> {
  const recent = submissions.filings?.recent;
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
  const cikPath = String(Number(cik));
  const directoryUrl = `${SEC_ARCHIVES}/${cikPath}/${accessionPath}/index.json`;
  const directory = await fetchJson<{
    directory?: { item?: Array<{ name?: string; size?: string }> };
  }>(directoryUrl);
  const names =
    directory.directory?.item
      ?.map((item) => item.name || "")
      .filter((name) => /\.html?$/i.test(name)) || [];
  const releaseName =
    names.find((name) => /(ex(?:hibit)?[-_]?99|press.?release|earnings?|results?)/i.test(name)) ||
    names.find(
      (name) =>
        !/index|headers|filingsummary|^r\d+\.htm/i.test(name) &&
        name !== recent?.primaryDocument?.[index],
    );
  if (!releaseName) {
    return {
      filingDate,
      reportDate: recent?.reportDate?.[index] || filingDate,
      releaseUrl: null,
      guidance: null,
    };
  }
  const releaseUrl = `${SEC_ARCHIVES}/${cikPath}/${accessionPath}/${releaseName}`;
  const response = await fetch(releaseUrl, {
    headers: secHeaders("text/html"),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return {
      filingDate,
      reportDate: recent?.reportDate?.[index] || filingDate,
      releaseUrl,
      guidance: null,
    };
  }
  return {
    filingDate,
    reportDate: recent?.reportDate?.[index] || filingDate,
    releaseUrl,
    guidance: parseGuidance(htmlToText(await response.text())),
  };
}

export async function fetchUsCompanyEvidence(
  symbol: string,
): Promise<UsCompanyEvidence> {
  const normalized = symbol.replace(/\.US$/i, "").toUpperCase();
  const tickerMap = await loadTickerMap();
  const ticker = tickerMap.get(normalized);
  if (!ticker?.cik_str) throw new Error(`SEC ticker mapping missing for ${normalized}`);
  const cik = String(ticker.cik_str).padStart(10, "0");
  const [submissions, facts] = await Promise.all([
    fetchJson<SecSubmissions>(`${SEC_SUBMISSIONS}/CIK${cik}.json`),
    fetchJson<SecCompanyFacts>(`${SEC_FACTS}/CIK${cik}.json`),
  ]);
  const periods = buildPeriods(facts);
  if (periods.length < 3) {
    throw new Error("SEC quarterly fundamentals are incomplete");
  }
  const release = await findEarningsRelease(cik, submissions);
  return {
    symbol: normalized,
    company: facts.entityName || submissions.name || ticker.title || normalized,
    cik,
    exchange: submissions.exchanges?.[0] || "US",
    industry: submissions.sicDescription || "Public company",
    latestEarningsFilingDate: release.filingDate,
    latestEarningsReportDate: release.reportDate,
    earningsReleaseUrl: release.releaseUrl,
    estimatedNextEarningsDate: estimateNextEarningsDate(release.filingDate),
    periods,
    guidance: release.guidance,
    source: {
      name: `${normalized} reported fundamentals & outlook`,
      provider: "SEC EDGAR submissions + companyfacts · global-stock-data",
      status: "connected",
      asOf: release.filingDate,
      tier: "S",
      note: `已去除累计口径和重复比较期，保留 ${periods.length} 个单季 SEC 事实；下一财报日按申报节奏估算并明确标记。`,
    },
  };
}
