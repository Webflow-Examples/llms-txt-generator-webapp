import type { APIRoute } from "astro";
import { GET as getCollections } from "./collections";
import { GET as getPages } from "./pages";
import { createWebflowClient } from "../../utils/webflow/client";
import { loadExposureSettings } from "../../utils/collection-exposure";

function progressKey() {
  return `llms-progress:${Date.now()}`;
}

async function regenerateLLMS(locals: any, request: Request) {
  // Get bindings and env from locals
  const webflowContent = locals.runtime.env.WEBFLOW_CONTENT;
  const exposureSettings = locals.runtime.env.EXPOSURE_SETTINGS;
  const env = locals.runtime?.env || {};
  try {
    // Set initial state
    await webflowContent.put("llms-regenerating", "true");
    await webflowContent.put(progressKey(), "Initializing...");

    // Load exposure settings
    await loadExposureSettings(exposureSettings);

    // Get site ID and access token
    const siteId = env.WEBFLOW_SITE_ID;
    const accessToken = env.WEBFLOW_SITE_API_TOKEN;
    const webflow = createWebflowClient(accessToken);

    // Get site and initial content
    const sites = await webflow.sites.list();
    const site = sites?.sites?.find((s: any) => s.id === siteId);
    const initialContent = [
      `# ${site?.displayName || "Webflow Documentation"}`,
      "",
      `> This is the documentation for ${
        site?.displayName || "our Webflow site"
      }, providing information about our pages and content.`,
      "",
      "## Important Notes",
      "",
      "- All content is automatically generated from our Webflow site",
      "- Each page and collection has a clean markdown version available at the same URL with .md appended",
      "- Content is updated whenever changes are published in Webflow",
      "",
    ].join("\n");
    await webflowContent.put("llms.txt", initialContent);

    // Fetch collections
    await webflowContent.put(progressKey(), "Fetching collections...");
    const collectionsResponse = await getCollections({
      locals,
      request,
      url: new URL(request.url),
    } as any);
    if (!collectionsResponse.ok) throw new Error("Collections endpoint failed");

    // Fetch pages
    await webflowContent.put(progressKey(), "Fetching pages...");
    const pagesResponse = await getPages({
      locals,
      request,
      url: new URL(request.url),
    } as any);
    if (!pagesResponse.ok) throw new Error("Pages endpoint failed");

    // Finalize
    await webflowContent.put(progressKey(), "Finalizing...");
    await webflowContent.put(progressKey(), "done");
    await webflowContent.put("llms-regenerating", "false");

    // Cleanup old progress keys (keep only the most recent 20)
    const progressList = await webflowContent.list({
      prefix: "llms-progress:",
    });
    const sortedKeys = progressList.keys
      .map((k: any) => k.name)
      .sort()
      .reverse(); // Most recent first
    const keysToDelete = sortedKeys.slice(20); // Keep 20 most recent
    for (const key of keysToDelete) {
      await webflowContent.delete(key);
    }
  } catch (error) {
    console.error("regenerateLLMS error:", error);
    await webflowContent.put("llms-regenerating", "false");
    await webflowContent.put(
      progressKey(),
      error instanceof Error
        ? `error: ${error.message}\n${error.stack}`
        : "error: Unknown error"
    );
  }
}

export const POST: APIRoute = async ({ locals, request }: any) => {
  // Access context from Cloudflare Workers

  const context = locals.runtime.ctx;
  if (context && typeof context.waitUntil === "function") {
    // Run in background
    context.waitUntil(
      (async () => {
        try {
          await regenerateLLMS(locals, request);
        } catch (err) {
          console.error("Background task failed:", err);
        }
      })()
    );
  } else {
    console.log("no waitUntil");
    regenerateLLMS(locals, request);
  }
  return new Response(JSON.stringify({ started: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
};
