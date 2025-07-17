import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ locals }) => {
  const encoder = new TextEncoder();

  // Get KV
  const webflowContent = (locals as any).runtime.env.WEBFLOW_CONTENT;

  // Create a stream to send progress updates
  const stream = new ReadableStream({
    async start(controller) {
      let lastProgress = null;
      let first = true;

      // Loop until we get a done or error message
      try {
        while (true) {
          // List all progress keys
          const list = await webflowContent.list({ prefix: "llms-progress:" });
          const latestKey = list.keys
            .map((k: any) => k.name)
            .sort()
            .reverse()[0]; // Most recent timestamp

          if (!latestKey) {
            // Send debug message if no keys are found
            const debugMsg = `data: ${JSON.stringify({
              message: null,
              debug:
                "No llms-progress keys found in KV. Waiting for progress...",
            })}\n\n`;
            controller.enqueue(encoder.encode(debugMsg));
            await new Promise((res) => setTimeout(res, 5000));
            continue;
          }

          // Get the progress
          const progress = await webflowContent.get(latestKey);

          // Send the progress
          if (progress !== lastProgress || first) {
            const message = `data: ${JSON.stringify({
              message: progress,
            })}\n\n`;
            controller.enqueue(encoder.encode(message));
            lastProgress = progress;
            first = false;
          }

          // If we get a done or error message, break the loop
          if (
            progress === "done" ||
            (typeof progress === "string" && progress.startsWith("error:"))
          ) {
            break;
          }

          //
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
