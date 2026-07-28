import { probeNasdaqConsensus } from "../../../lib/providers/nasdaq-consensus";
import {
  fetchNasdaqMarketSnapshot,
  fetchNvdaOfficialSnapshot,
} from "../../../lib/providers/nvda-evidence";
import { probeVibeMcp } from "../../../lib/providers/vibe-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [vibe, consensus, officialResult, marketResult] = await Promise.all([
    process.env.VIBE_MCP_URL
      ? probeVibeMcp()
      : Promise.resolve({
          name: "vibe_trading_dev0",
          provider: "SSH tunnel + HTTP MCP",
          status: "missing" as const,
          asOf: new Date().toISOString(),
          tier: "LOCAL" as const,
          note: "VIBE_MCP_URL 未配置",
        }),
    probeNasdaqConsensus(),
    fetchNvdaOfficialSnapshot().then(
      (snapshot) => snapshot.source,
      (error) => ({
        name: "NVIDIA reported results & outlook",
        provider: "SEC EDGAR earnings exhibit · global-stock-data",
        status: "missing" as const,
        asOf: new Date().toISOString(),
        tier: "S" as const,
        note: error instanceof Error ? error.message : "SEC 公司事实连接失败",
      }),
    ),
    fetchNasdaqMarketSnapshot("NVDA").then(
      (snapshot) => snapshot.source,
      (error) => ({
        name: "NASDAQ market snapshot",
        provider: "Nasdaq historical quote API · global-stock-data",
        status: "missing" as const,
        asOf: new Date().toISOString(),
        tier: "A" as const,
        note: error instanceof Error ? error.message : "行情连接失败",
      }),
    ),
  ]);

  const consensusConfigured = true;
  const vibeConnected = vibe.status === "connected";
  const consensusConnected = consensus.status === "connected";
  const officialEvidenceConnected = officialResult.status === "connected";
  const marketConnected = marketResult.status === "connected";
  const liveAnalysisImplemented = true;
  const publicResearchReady =
    liveAnalysisImplemented &&
    consensusConnected &&
    officialEvidenceConnected &&
    marketConnected;
  const privateEnrichmentReady = publicResearchReady && vibeConnected;
  const liveReady = publicResearchReady;

  return Response.json({
    ok: true,
    service: "equity-research-cockpit",
    dataMode: process.env.DATA_MODE || "OFFICIAL",
    vibe,
    consensus,
    official: officialResult,
    market: marketResult,
    capabilities: {
      reportEngine: true,
      officialSourceProbe: true,
      vibeConnected,
      consensusConfigured,
      consensusConnected,
      officialEvidenceConnected,
      marketConnected,
      publicResearchReady,
      privateEnrichmentReady,
      liveAnalysisImplemented,
      cnLiveAnalysisImplemented: true,
      liveReady,
    },
    disclosure: privateEnrichmentReady
      ? "公开证据链与 dev0 私有增强链均已就绪；系统仍会按数据许可和证据门槛决定 actionability。"
      : publicResearchReady
        ? "公开实施链路已就绪：SEC 公司事实、Nasdaq 行情/EPS 一致预期可达；dev0 私有 MCP 为可选增强项。"
      : "实施链路尚未全部就绪；缺失的连接会在数据源账本中显示，分析将安全降级为 WAIT。",
  });
}
