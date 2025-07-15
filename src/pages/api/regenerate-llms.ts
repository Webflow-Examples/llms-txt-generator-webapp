import type { APIRoute } from "astro";
import { GET as getCollections } from "./collections";
import { GET as getPages } from "./pages";
import { createWebflowClient } from "../../utils/webflow/client";
import type { ProcessedPage } from "../../types";
import { loadExposureSettings } from "../../utils/collection-exposure";

export const POST: APIRoute = async ({ locals, request }) => {
  try {
    // Set a flag to indicate regeneration is in progress
    await (locals as any).webflowContent.put("llms-regenerating", "true");
    // Start the regeneration process synchronously
    await loadExposureSettings((locals as any).exposureSettings);
    await (locals as any).webflowContent.put(
      "llms-progress",
      "Initializing..."
    );
    // Create initial content
    const siteId = import.meta.env.PROD
      ? (locals as any).runtime.env.WEBFLOW_SITE_ID
      : import.meta.env.PUBLIC_WEBFLOW_SITE_ID;
    const accessToken = import.meta.env.PROD
      ? (locals as any).runtime.env.WEBFLOW_SITE_API_TOKEN
      : import.meta.env.WEBFLOW_SITE_API_TOKEN;
    const webflow = createWebflowClient(accessToken);
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
    await (locals as any).webflowContent.put("llms.txt", initialContent);
    await (locals as any).webflowContent.put(
      "llms-progress",
      "Fetching collections..."
    );
    const collectionsResponse = await getCollections({
      locals,
      request,
      url: new URL(request.url),
    } as any);
    if (!collectionsResponse.ok) throw new Error("Collections endpoint failed");
    await (locals as any).webflowContent.put(
      "llms-progress",
      "Fetching pages..."
    );
    const pagesResponse = await getPages({
      locals,
      request,
      url: new URL(request.url),
    } as any);
    if (!pagesResponse.ok) throw new Error("Pages endpoint failed");
    await (locals as any).webflowContent.put("llms-progress", "Finalizing...");
    await (locals as any).webflowContent.put("llms-progress", "done");
    await (locals as any).webflowContent.put("llms-regenerating", "false");
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
