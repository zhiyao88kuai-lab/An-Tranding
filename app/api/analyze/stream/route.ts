import { analyzeEquity, validateRequest } from "../../../../lib/analyze";
import type { AnalysisProgressUpdate } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type StreamEvent =
  | { type: "progress"; update: AnalysisProgressUpdate }
  | { type: "complete"; report: Awaited<ReturnType<typeof analyzeEquity>> }
  | { type: "error"; message: string };

export async function POST(request: Request) {
  let input;
  try {
    input = validateRequest(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "请求体格式错误" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({
          type: "progress",
          update: {
            stage: "request",
            status: "done",
            message: "请求已校验",
            detail: `${input.symbol} · ${input.dataMode}`,
          },
        });
        const report = await analyzeEquity(input, (update) =>
          send({ type: "progress", update }),
        );
        send({
          type: "progress",
          update: {
            stage: "complete",
            status: "done",
            message: "报告已完成",
            detail: report.meta.dataDisclosure,
          },
        });
        send({ type: "complete", report });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "分析任务失败",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
