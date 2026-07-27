export type Market = "AUTO" | "US" | "HK" | "CN";
export type PositionSide = "NONE" | "LONG" | "SHORT";
export type RiskTolerance = "LOW" | "MEDIUM" | "HIGH";
export type DataMode = "DEMO" | "OFFICIAL" | "LOCAL_RESEARCH";
export type DecisionSide = "LONG" | "WAIT" | "SHORT";
export type EvidenceStatus =
  | "verified"
  | "consensus"
  | "inference"
  | "assumption"
  | "missing";

export interface AnalysisRequest {
  symbol: string;
  companyName?: string;
  market: Market;
  positionSide: PositionSide;
  positionWeight: number;
  costBasis?: number;
  horizon: "EVENT" | "QUARTER" | "YEAR";
  riskTolerance: RiskTolerance;
  dataMode: DataMode;
  thesis?: string;
}

export interface SourceRecord {
  name: string;
  provider: string;
  status: "connected" | "fallback" | "missing" | "restricted";
  asOf: string;
  tier: "S" | "A" | "B" | "C" | "LOCAL";
  note: string;
}

export interface ExpectationRow {
  metric: string;
  t: string;
  t1: string;
  t4: string;
  t8: string;
  evidence: EvidenceStatus;
  debate: string;
}

export interface KpiItem {
  name: string;
  current: string;
  bar: string;
  trend: "up" | "flat" | "down";
  weight: number;
  readThrough: string;
}

export interface Scenario {
  name: "Bull" | "Base" | "Bear";
  probability: number;
  revenue: string;
  grossMargin: string;
  eps: string;
  multiple: string;
  target: string;
  returnPct: number;
  trigger: string;
}

export interface ResearchReport {
  meta: {
    symbol: string;
    company: string;
    market: string;
    asOf: string;
    generatedAt: string;
    freezeTime: string;
    dataMode: DataMode;
    workflow: string[];
    isDemo: boolean;
  };
  decision: {
    side: DecisionSide;
    confidence: number;
    actionability: "implementation-ready" | "conditional" | "screen-grade";
    oneLine: string;
    pricedIn: string;
    variantView: string;
    sizing: string;
    invalidation: string;
  };
  tape: Array<{
    label: string;
    value: string;
    change: string;
    tone: "positive" | "neutral" | "negative";
  }>;
  expectations: ExpectationRow[];
  kpis: KpiItem[];
  marginDebate: {
    bull: string[];
    bear: string[];
    watch: string[];
  };
  scenarios: Scenario[];
  catalysts: Array<{
    timing: string;
    event: string;
    impact: "positive" | "two-sided" | "negative";
    watch: string;
  }>;
  managementQuestions: Array<{
    topic: string;
    question: string;
    whyItMatters: string;
  }>;
  actionPlan: {
    preEvent: string;
    beat: string;
    inline: string;
    miss: string;
    riskControls: string[];
  };
  sources: SourceRecord[];
  evidenceGaps: string[];
  disclaimer: string;
}

