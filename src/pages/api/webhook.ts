export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import { POST as regenerateLlms } from "./regenerate-llms";

interface PagesResponse {
  pagesProcessed: number;
}

interface CollectionsResponse {
  success: boolean;
  message: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Use env directly from locals
  // const env = (locals as any).runtime.env;

  try {
    console.log("Received webhook from Webflow");

    const payload = await request.json();
    console.log("Webhook payload:", JSON.stringify(payload, null, 2));

    // Call the regenerate-llms endpoint
    console.log("Triggering llms.txt regeneration...");
    const regenerationResponse = await regenerateLlms({
      locals,
      request,
    } as any);

    if (!regenerationResponse.ok) {
      const errorText = await regenerationResponse.text();
      throw new Error(`Failed to regenerate llms.txt: ${errorText}`);
    }

    // Get the JSON response and return it properly
    const result = await regenerationResponse.json();
    return new Response(JSON.stringify(result), {
      status: regenerationResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook Error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process webhook",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};
