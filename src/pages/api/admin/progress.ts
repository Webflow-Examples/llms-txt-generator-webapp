import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ locals }) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastProgress = null;
      while (true) {
        const progress = await (locals as any).webflowContent.get(
          "llms-progress"
        );
        if (progress !== lastProgress) {
          const message = `data: ${JSON.stringify({ message: progress })}\n\n`;
          controller.enqueue(encoder.encode(message));
          lastProgress = progress;
        }
        if (
          progress === "done" ||
          (typeof progress === "string" && progress.startsWith("error:"))
        ) {
          break;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      controller.close();
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
