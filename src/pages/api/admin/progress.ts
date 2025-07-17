import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ locals }) => {
  const encoder = new TextEncoder();
  const webflowContent = (locals as any).runtime.env.WEBFLOW_CONTENT;

  const stream = new ReadableStream({
    async start(controller) {
      let lastProgress = null;
      let first = true;
      try {
        while (true) {
          // List all progress keys
          const list = await webflowContent.list({ prefix: "llms-progress:" });
          const latestKey = list.keys
            .map((k: any) => k.name)
            .sort()
            .reverse()[0]; // Most recent timestamp
          const progress = latestKey
            ? await webflowContent.get(latestKey)
            : null;
          if (progress !== lastProgress || first) {
            const message = `data: ${JSON.stringify({
              message: progress,
            })}\n\n`;
            controller.enqueue(encoder.encode(message));
            lastProgress = progress;
            first = false;
          }
          if (
            progress === "done" ||
            (typeof progress === "string" && progress.startsWith("error:"))
          ) {
            break;
          }
          await new Promise((res) => setTimeout(res, 5000));
        }
      } catch (err) {
        const errorMsg = `data: ${JSON.stringify({
          message: `error: ${err instanceof Error ? err.message : String(err)}`,
        })}\n\n`;
        controller.enqueue(encoder.encode(errorMsg));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
