// Astro middleware to attach KV namespaces to context.locals (Cloudflare in prod, in-memory mock in dev)
import type { MiddlewareHandler } from "astro";
import { defineMiddleware } from "astro/middleware";
import { MockKVNamespace } from "./utils/mock-kv";

// Create shared instances at the module level for dev
const devWebflowContent = new MockKVNamespace();
const devExposureSettings = new MockKVNamespace();

export const onRequest: MiddlewareHandler = defineMiddleware(
  async (context, next) => {
    // Log asset requests in production
    if (import.meta.env.PROD) {
      const url = context.request.url;
      if (
        url.includes("/_astro/") ||
        url.match(/\.(css|js|svg|png|jpg|jpeg|woff2?)($|\?)/)
      ) {
        console.log("[PROD ASSET REQUEST]", url);
      }
    }

    const locals = context.locals as any;
    if (import.meta.env.DEV) {
      locals.webflowContent = locals.runtime.env.WEBFLOW_CONTENT;
      locals.exposureSettings = locals.runtime.env.EXPOSURE_SETTINGS;
    } else {
      locals.webflowContent = locals.runtime.env.WEBFLOW_CONTENT;
      locals.exposureSettings = locals.runtime.env.EXPOSURE_SETTINGS;
    }
    return next();
  }
);
