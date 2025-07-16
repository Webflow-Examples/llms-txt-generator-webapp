export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import { createWebflowClient } from "../../utils/webflow/client";
import { delay, withRateLimit } from "../../utils/webflow/client";
import { fetchAllPages } from "../../utils/webflow/pages";
import { processWebflowPage } from "../../services/webflow-content";
import type { ProcessedPage } from "../../types";
import { updateLLMSSection } from "../../utils/kv-helpers";

export const GET: APIRoute = async ({ url, locals }) => {
  const siteId = import.meta.env.PROD
    ? (locals as any).runtime.env.WEBFLOW_SITE_ID
    : import.meta.env.WEBFLOW_SITE_ID;
  const accessToken = import.meta.env.PROD
    ? (locals as any).runtime.env.WEBFLOW_SITE_API_TOKEN
    : import.meta.env.WEBFLOW_SITE_API_TOKEN;
  if (!siteId) throw new Error("WEBFLOW_SITE_ID is not defined");
  if (!accessToken) throw new Error("WEBFLOW_SITE_API_TOKEN is not defined");

  const webflowClient = createWebflowClient(accessToken);
  const webflowContent = (locals as any).webflowContent;
  const exposureSettings = (locals as any).exposureSettings;
  const domain = import.meta.env.PROD
    ? (locals as any).runtime.env.DOMAIN
    : import.meta.env.DOMAIN;
  const basePath = import.meta.env.BASE_URL;

  try {
    // Get Sites
    console.log("Getting sites");
    const sites = await withRateLimit(() => webflowClient.sites.list());
    const site = sites?.sites?.find((s: any) => s.id === siteId);
    console.log("Site found:", site);

    if (!site) {
      return new Response(JSON.stringify({ error: "Site not found", siteId }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get all pages
    console.log("Getting pages");
    const pages = await fetchAllPages(webflowClient, site.id);
    console.log("Pages found:", pages);

    // Load exposure settings
    const settings = await exposureSettings.get("settings");
    console.log("Settings found:", settings);
    const pageSettings = settings ? JSON.parse(settings).pages || {} : {};
    console.log("Page settings found:", pageSettings);

    // Filter to only exposed pages
    console.log("Filtering pages");
    const exposedPages = pages.filter((page: any) => {
      const pageConfig = pageSettings[page.id];
      return pageConfig?.isVisible === true;
    });
    console.log("Exposed pages found:", exposedPages);

    if (!exposedPages.length) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pages are configured for exposure",
          pages: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Process Pages
    const processedPages: ProcessedPage[] = [];
    const mainPages: string[] = [];
    const optionalPages: string[] = [];
    const pagesContent: string[] = [
      "The following pages are available in the Webflow site:",
      "",
    ];

    for (const page of exposedPages) {
      console.log("Processing page:", page.id, page.title || page.slug);
      try {
        const processedPage = await processWebflowPage(page.id, locals);
        processedPages.push(processedPage);

        const pageConfig = pageSettings[page.id];
        const title =
          pageConfig?.displayName ||
          processedPage.metadata?.title ||
          page.title ||
          "Untitled";
        const description =
          pageConfig?.description ||
          processedPage.metadata?.description ||
          page.seo?.description ||
          page.openGraph?.description ||
          "";
        const pageEntry = `- [${title}](https://${domain}/${basePath}/docs/${
          processedPage.fileName
        })${description ? ": " + description : ""}`;

        if (pageConfig?.isOptional) {
          optionalPages.push(pageEntry);
        } else {
          mainPages.push(pageEntry);
        }
        console.log("Finished processing page:", page.id);
      } catch (error) {
        console.error(`Error processing page ${page.id}:`, error);
        continue;
      }
      await delay(500);
      console.log("Delay complete for page:", page.id);
    }

    pagesContent.push(...mainPages, "");
    if (optionalPages.length > 0) {
      pagesContent.push("## Optional Pages", "", ...optionalPages, "");
    }

    await updateLLMSSection(webflowContent, "Pages", pagesContent);

    return new Response(JSON.stringify(processedPages), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to fetch page data",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
