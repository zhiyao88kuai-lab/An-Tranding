import { probeNasdaqConsensus } from "../../../lib/providers/nasdaq-consensus";
import { probeVibeMcp } from "../../../lib/providers/vibe-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [vibe, consensus] = await Promise.all([
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
  ]);

  const consensusConfigured = true;
  const vibeConnected = vibe.status === "connected";
  const consensusConnected = consensus.status === "connected";
  const liveAnalysisImplemented = true;
  const liveReady =
    liveAnalysisImplemented && consensusConnected && vibeConnected;

  return Response.json({
    ok: true,
    service: "equity-research-cockpit",
    dataMode: process.env.DATA_MODE || "DEMO",
    vibe,
    consensus,
    capabilities: {
      reportEngine: true,
      officialSourceProbe: true,
      vibeConnected,
      consensusConfigured,
      consensusConnected,
      liveAnalysisImplemented,
      liveReady,
    },
    disclosure: liveReady
      ? "实施链路已就绪：dev0 行情 MCP 与 EPS 一致预期均已连接；系统仍会按证据门槛决定是否输出方向。"
      : "实施链路尚未全部就绪；缺失的连接会在数据源账本中显示，分析将安全降级为 WAIT。",
  });
}
