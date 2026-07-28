import { probeVibeMcp } from "../../../lib/providers/vibe-mcp";

export const runtime = "edge";

export async function GET() {
  const vibe = process.env.VIBE_MCP_URL
    ? await probeVibeMcp()
    : {
        name: "vibe_trading_dev0",
        provider: "SSH tunnel + HTTP MCP",
        status: "missing" as const,
        asOf: new Date().toISOString(),
        tier: "LOCAL" as const,
        note: "VIBE_MCP_URL 未配置",
      };

  const consensusConfigured = Boolean(process.env.CONSENSUS_PROVIDER_URL);
  const vibeConnected = vibe.status === "connected";
  const liveAnalysisImplemented = false;
  const liveReady =
    liveAnalysisImplemented && consensusConfigured && vibeConnected;

  return Response.json({
    ok: true,
    service: "equity-research-cockpit",
    dataMode: process.env.DATA_MODE || "DEMO",
    vibe,
    capabilities: {
      reportEngine: true,
      officialSourceProbe: true,
      vibeConnected,
      consensusConfigured,
      liveAnalysisImplemented,
      liveReady,
    },
    disclosure: liveReady
      ? "实时数据链路已就绪；仍会按证据门槛决定是否输出方向。"
      : "当前版本尚未完成实时一致预期的生产接入；即使官方源或 dev0 MCP 可达，也只会显示连接证据，不会冒充实时分析。",
  });
}
