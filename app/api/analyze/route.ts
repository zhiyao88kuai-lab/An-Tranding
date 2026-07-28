import { analyzeEquity, validateRequest } from "../../../lib/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = validateRequest(await request.json());
    const report = await analyzeEquity(input);
    return Response.json(report, {
      headers: {
        "cache-control": "no-store",
        "x-research-mode": report.meta.dataMode,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "分析任务失败",
      },
      { status: 400 },
    );
  }
}
