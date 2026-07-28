import type { SourceRecord } from "../types";

type NasdaqForecastRow = {
  fiscalEnd: string;
  consensusEPSForecast: number | null;
  highEPSForecast: number | null;
  lowEPSForecast: number | null;
  noOfEstimates: number | null;
  up: number | null;
  down: number | null;
};

export type ConsensusSnapshot = {
  symbol: string;
  asOf: string;
  quarterly: NasdaqForecastRow[];
  yearly: NasdaqForecastRow[];
  source: SourceRecord;
};

function forecastUrl(symbol: string): string {
  const configured =
    process.env.CONSENSUS_PROVIDER_URL ||
    "https://api.nasdaq.com/api/analyst";
  if (configured.includes("{symbol}")) {
    return configured.replace("{symbol}", encodeURIComponent(symbol));
  }
  if (configured.endsWith("/earnings-forecast")) return configured;
  return `${configured.replace(/\/+$/, "")}/${encodeURIComponent(
    symbol,
  )}/earnings-forecast`;
}

function validRows(value: unknown): NasdaqForecastRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is NasdaqForecastRow =>
      Boolean(
        row &&
          typeof row === "object" &&
          typeof (row as NasdaqForecastRow).fiscalEnd === "string",
      ),
  );
}

export async function fetchNasdaqConsensus(
  symbol: string,
): Promise<ConsensusSnapshot> {
  const asOf = new Date().toISOString();
  const response = await fetch(forecastUrl(symbol), {
    headers: {
      accept: "application/json",
      "user-agent":
        process.env.CONSENSUS_USER_AGENT ||
        "Mozilla/5.0 (compatible; SignalForge/0.1; equity research)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Nasdaq consensus HTTP ${response.status}`);

  const payload = (await response.json()) as {
    status?: { rCode?: number };
    data?: {
      symbol?: string;
      quarterlyForecast?: { rows?: unknown };
      yearlyForecast?: { rows?: unknown };
    };
  };
  const quarterly = validRows(payload.data?.quarterlyForecast?.rows);
  const yearly = validRows(payload.data?.yearlyForecast?.rows);
  if (payload.status?.rCode !== 200 || quarterly.length < 2) {
    throw new Error("Nasdaq consensus response is incomplete");
  }

  return {
    symbol: payload.data?.symbol?.toUpperCase() || symbol.toUpperCase(),
    asOf,
    quarterly,
    yearly,
    source: {
      name: "Analyst EPS consensus",
      provider: "Nasdaq analyst forecast API",
      status: "connected",
      asOf,
      tier: "A",
      note: `${quarterly[0].fiscalEnd} EPS 含 ${
        quarterly[0].noOfEstimates ?? "—"
      } 份预测；请求时已冻结。`,
    },
  };
}

export async function probeNasdaqConsensus(
  symbol = "NVDA",
): Promise<SourceRecord> {
  const asOf = new Date().toISOString();
  try {
    return (await fetchNasdaqConsensus(symbol)).source;
  } catch (error) {
    return {
      name: "Analyst EPS consensus",
      provider: "Nasdaq analyst forecast API",
      status: "missing",
      asOf,
      tier: "A",
      note: error instanceof Error ? error.message : "一致预期连接失败",
    };
  }
}
