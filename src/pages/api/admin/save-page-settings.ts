export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";

interface PageConfig {
  isVisible: boolean;
  displayName?: string;
  description?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const pageSettings = (await request.json()) as Record<string, PageConfig>;
    console.log("Incoming pageSettings:", pageSettings);

    const env = (locals as any).runtime.env;
    const exposureSettings = env.EXPOSURE_SETTINGS;

    // Load existing settings
    const existingSettings = await exposureSettings.get("settings");
    const settings = existingSettings
      ? JSON.parse(existingSettings)
      : { collections: {}, pages: {} };

    // Update pages only
    settings.pages = pageSettings;
    console.log("Final settings to save:", settings);

    // Save merged settings
    await exposureSettings.put("settings", JSON.stringify(settings));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error saving page settings:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to save page settings",
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
