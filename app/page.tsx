import { ResearchDashboard } from "../components/research-dashboard";
import { makeNvdaDemoReport } from "../lib/demo-report";

export default function Home() {
  const preview = makeNvdaDemoReport({
    symbol: "NVDA",
    market: "US",
    positionSide: "LONG",
    positionWeight: 6,
    horizon: "EVENT",
    riskTolerance: "MEDIUM",
    dataMode: "DEMO",
  });

  return <ResearchDashboard initialReport={preview} />;
}
