/* eslint-disable @typescript-eslint/no-empty-interface */
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

import { MockKVNamespace } from "./utils/mock-kv";
import type { MinimalKV } from "./types";

// Define your environment variable types for Cloudflare Workers
export interface EnvType {
  WEBFLOW_CONTENT: KVNamespace;
  EXPOSURE_SETTINGS: KVNamespace;
  WEBFLOW_SITE_ID?: string;
  WEBFLOW_SITE_API_TOKEN?: string;
}

/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    runtime: {
      env: {
        WEBFLOW_CONTENT: KVNamespace;
        EXPOSURE_SETTINGS: KVNamespace;
        WEBFLOW_SITE_ID?: string;
        WEBFLOW_SITE_API_TOKEN?: string;
        // Add other env vars as needed
      };
    };
    progressCallback?: (step: string) => void;
    webflowContent: KVNamespace | MinimalKV;
    exposureSettings: KVNamespace | MinimalKV;
  }
}

/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface ImportMetaEnv {
  readonly WEBFLOW_SITE_ID: string;
  readonly WEBFLOW_SITE_API_TOKEN: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
