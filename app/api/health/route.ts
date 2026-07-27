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

  return Response.json({
    ok: true,
    service: "equity-research-cockpit",
    dataMode: process.env.DATA_MODE || "DEMO",
    vibe,
  });
}

