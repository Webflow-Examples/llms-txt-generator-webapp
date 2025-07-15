import type { APIRoute } from "astro";
import { createWebflowClient } from "../../../utils/webflow/client";
import { fetchCollectionSchema } from "../../../utils/webflow/collections";

export const GET: APIRoute = async ({ request, locals }) => {
  const accessToken = import.meta.env.PROD
    ? (locals as any).runtime.env.WEBFLOW_SITE_API_TOKEN
    : import.meta.env.WEBFLOW_SITE_API_TOKEN;
  if (!accessToken) {
    return new Response("Missing Webflow API token", { status: 500 });
  }

  const url = new URL(request.url);
  const collectionId = url.searchParams.get("id");
  if (!collectionId) {
    return new Response("Collection ID is required", { status: 400 });
  }

  const webflowClient = createWebflowClient(accessToken);
  const schema = await fetchCollectionSchema(webflowClient, collectionId);
  return new Response(JSON.stringify(schema), {
    headers: { "Content-Type": "application/json" },
  });
};
