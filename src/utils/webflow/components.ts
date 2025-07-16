export const runtime = "edge";

import type { WebflowNode, WebflowPageContentResponse } from "../../types";
import { withRateLimit, delay } from "./client";
import type { MinimalKV } from "../../types";

const CACHE_TTL = 3600; // 1 hour cache TTL
const FETCH_TIMEOUT = 10000; // 10 second timeout for component fetching
const MAX_RETRIES = 3; // Maximum number of retries for component fetching

interface LocalsWithKV {
  webflowContent: MinimalKV;
}

interface CachedData {
  data: any;
  timestamp: number;
}

// Site-wide components cache
let componentsCache: Record<string, any> = {};

// Cache for component content
let componentContentCache: Record<
  string,
  { data: WebflowNode[]; timestamp: number }
> = {};

// Cache for image assets
let imageAssetsCache: Record<string, { url: string; timestamp: number }> = {};

// Types for assets API response
interface WebflowAsset {
  id: string;
  hostedUrl: string;
}

interface WebflowAssetsResponse {
  items: WebflowAsset[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

// Cache for all assets
let assetsCache: Record<string, { url: string; timestamp: number }> = {};

/**
 * Validates cached component data
 */
function isValidCache(data: any): data is CachedData {
  return (
    data &&
    typeof data === "object" &&
    "data" in data &&
    "timestamp" in data &&
    typeof data.timestamp === "number" &&
    data.data &&
    typeof data.data === "object"
  );
}

/**
 * Initialize site-wide components cache and component content cache
 * Should be called once at startup
 */
export const initializeComponentsCache = async (
  webflowClient: any,
  siteId: string,
  locals?: LocalsWithKV
) => {
  try {
    console.log("\nInitializing site-wide components cache");
    const response = await fetchComponentsWithRetry(webflowClient, siteId);
    componentsCache[siteId] = response;

    const env = (locals as any).runtime.env;
    const webflowContent = env.WEBFLOW_CONTENT;

    // Store in persistent cache if available
    if (webflowContent) {
      const cacheKey = `components:${siteId}`;
      const cacheData = {
        data: response,
        timestamp: Date.now(),
      };
      await webflowContent.put(cacheKey, JSON.stringify(cacheData));
      console.log("Successfully stored components in persistent cache");

      // Initialize component content cache
      console.log("Initializing component content cache");
      const components = response?.components || [];
      for (const component of components) {
        const contentCacheKey = `component-content:${siteId}:${component.id}`;
        const cachedContent = await webflowContent.get(contentCacheKey);
        if (cachedContent) {
          const parsedCache = JSON.parse(cachedContent);
          if (isValidCache(parsedCache)) {
            componentContentCache[component.id] = {
              data: parsedCache.data,
              timestamp: parsedCache.timestamp,
            };
          }
        }
      }
      console.log("Successfully initialized component content cache");
    }

    return response;
  } catch (error) {
    console.error("Error initializing components cache:", error);
    throw error;
  }
};

/**
 * Fetches components list from cache first
 */
export const fetchComponents = async (
  webflowClient: any,
  siteId: string,
  webflowContent: MinimalKV,
  locals?: LocalsWithKV
) => {
  if (import.meta.env.DEV)
    console.log("[Components] Debug Info:", {
      siteId,
      hasLocals: !!locals?,
      hasWebflowContent: !!webflowContent,
      webflowContentType: webflowContent ? typeof webflowContent : "undefined",
      hasMemoryCache: !!componentsCache[siteId],
    });
  console.log("Checked environment variables");

  // Check memory cache first
  if (componentsCache[siteId]) {
    console.log("[Components] Returning from memory cache");
    return componentsCache[siteId];
  }

  // Check persistent cache
  if (webflowContent) {
    const cacheKey = `components:${siteId}`;
    try {
      console.log("[Components] Checking persistent cache:", { cacheKey });
      const cached = await webflowContent.get(cacheKey);
      console.log("[Components] Persistent cache result:", {
        hasCached: !!cached,
        cachedType: typeof cached,
      });

      if (cached) {
        const parsedCache = JSON.parse(cached);
        if (isValidCache(parsedCache)) {
          console.log("[Components] Valid cache found, storing in memory");
          componentsCache[siteId] = parsedCache.data;
          return parsedCache.data;
        }
      }
    } catch (error) {
      console.error("[Components] Error reading from persistent cache:", {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  // Initialize cache if not found
  console.log("[Components] No cache found, initializing components cache");
  return initializeComponentsCache(webflowClient, siteId, locals);
};

/**
 * Gets component content from cache or fetches it
 */
export const fetchComponentContentWithCache = async (
  webflowClient: any,
  siteId: string,
  componentId: string,
  locals?: LocalsWithKV
): Promise<WebflowNode[]> => {
  const env = (locals as any).runtime.env;
  const webflowContent = env.WEBFLOW_CONTENT;

  // Check memory cache first
  const cached = componentContentCache[componentId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL * 1000) {
    console.log(`Using memory cache for component ${componentId}`);
    return cached.data;
  }

  if (!webflowContent) {
    throw new Error("KV storage required for component caching");
  }

  const cacheKey = `component-content:${siteId}:${componentId}`;

  try {
    // Try to get from KV cache
    const kvCached = await webflowContent.get(cacheKey);
    if (kvCached) {
      const parsedCache = JSON.parse(kvCached);
      if (isValidCache(parsedCache)) {
        // Update memory cache
        componentContentCache[componentId] = {
          data: parsedCache.data,
          timestamp: parsedCache.timestamp,
        };
        console.log(`Using KV cache for component ${componentId}`);
        return parsedCache.data;
      }
    }

    // Cache miss, fetch and store
    console.log(`Cache miss for component ${componentId}, fetching from API`);
    const content = await fetchAllComponentContent(
      webflowClient,
      siteId,
      componentId
    );

    // Store in both memory and KV cache
    const timestamp = Date.now();
    componentContentCache[componentId] = {
      data: content,
      timestamp,
    };

    const cacheData = {
      data: content,
      timestamp,
    };
    await webflowContent.put(cacheKey, JSON.stringify(cacheData));
    console.log(`Cached component ${componentId} content`);

    return content;
  } catch (error) {
    console.error(
      `Error fetching content for component ${componentId}:`,
      error
    );
    throw error;
  }
};

/**
 * Fetches components with retries and proper error handling
 */
async function fetchComponentsWithRetry(
  webflowClient: any,
  siteId: string,
  retryCount = 0
): Promise<any> {
  try {
    await delay(500); // Initial delay to respect rate limits
    return await withRateLimit(() => webflowClient.components.list(siteId));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      error.statusCode === 429 &&
      retryCount < MAX_RETRIES
    ) {
      // If we hit rate limits, wait longer before retrying
      const backoffDelay = Math.min(5000, 1000 * Math.pow(2, retryCount));
      console.warn(
        `Rate limit hit fetching components, retrying in ${backoffDelay}ms (attempt ${
          retryCount + 1
        }/${MAX_RETRIES})`
      );
      await delay(backoffDelay);
      return fetchComponentsWithRetry(webflowClient, siteId, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Gets component metadata by ID
 * @param webflowClient - The Webflow client
 * @param siteId - The site ID
 * @param componentId - The component ID to look up
 * @returns Component metadata if found
 */
export const getComponentMetadata = async (
  webflowClient: any,
  siteId: string,
  componentId: string
) => {
  console.log(`\nLooking up metadata for component: ${componentId}`);
  const components = await fetchComponents(webflowClient, siteId);
  const component = components?.components?.find(
    (c: any) => c.id === componentId
  );
  if (!component) {
    console.log(`No metadata found for component: ${componentId}`);
  } else {
    console.log(
      `Found component metadata:`,
      JSON.stringify(component, null, 2)
    );
  }
  return component;
};

/**
 * Fetches all content for a component using pagination
 * @param webflowClient - The Webflow client
 * @param siteId - The Webflow site ID
 * @param componentId - The component ID
 * @param pageSize - Number of items per page (default: 100, max: 100)
 * @returns Promise resolving to array of all component nodes
 */
export const fetchAllComponentContent = async (
  webflowClient: any,
  siteId: string,
  componentId: string,
  pageSize = 100
): Promise<WebflowNode[]> => {
  let allNodes: WebflowNode[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    if (offset > 0) {
      await delay(500);
    }
    const response = (await withRateLimit(() =>
      webflowClient.components.getContent(siteId, componentId, {
        limit: pageSize,
        offset: offset,
      })
    )) as WebflowPageContentResponse;
    if (!response?.nodes?.length) {
      break;
    }
    allNodes = [...allNodes, ...response.nodes];
    const pagination = response.pagination;
    if (!pagination) {
      break;
    }
    const { total, limit } = pagination;
    offset += limit;
    hasMore = offset < total;
  }
  return allNodes;
};

/**
 * Fetches an image asset with caching
 */
export const fetchImageAssetWithCache = async (
  webflowClient: any,
  assetId: string,
  locals?: { webflowContent: MinimalKV }
): Promise<string | null> => {
  // Get the Webflow content KV from the locals
  const env = (locals as any).runtime.env;
  const webflowContent = env.WEBFLOW_CONTENT;

  // Check memory cache first
  if (imageAssetsCache[assetId]) {
    const cached = imageAssetsCache[assetId];
    // Cache for 1 hour
    if (Date.now() - cached.timestamp < CACHE_TTL * 1000) {
      console.log(
        `[ImageCache] Returning from memory cache for asset ${assetId}`
      );
      return cached.url;
    }
  }

  // Check KV cache
  if (webflowContent) {
    const cacheKey = `image-asset:${assetId}`;
    const cached = await webflowContent.get(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (
        parsedCache &&
        Date.now() - parsedCache.timestamp < CACHE_TTL * 1000
      ) {
        // Update memory cache
        imageAssetsCache[assetId] = parsedCache;
        console.log(
          `[ImageCache] Returning from KV cache for asset ${assetId}`
        );
        return parsedCache.url;
      }
    }
  } else {
    console.warn(
      `[ImageCache] No webflowContent KV provided for asset ${assetId}`
    );
  }

  try {
    // Fetch from API
    await delay(500);
    console.log(`[ImageCache] Fetching asset ${assetId} from API`);
    const asset = (await withRateLimit(() =>
      webflowClient.assets.get(assetId)
    )) as { hostedUrl?: string };
    const url = asset?.hostedUrl;

    if (url) {
      // Store in memory cache
      imageAssetsCache[assetId] = {
        url,
        timestamp: Date.now(),
      };

      // Store in KV cache
      if (webflowContent) {
        const cacheKey = `image-asset:${assetId}`;
        await webflowContent.put(
          cacheKey,
          JSON.stringify(imageAssetsCache[assetId])
        );
        console.log(`[ImageCache] Stored asset ${assetId} in KV cache`);
      }

      return url;
    }
  } catch (error) {
    console.error(`Error fetching image asset ${assetId}:`, error);
  }

  return null;
};

/**
 * Fetches all assets for a site and caches them
 */
export const fetchAllAssetsWithCache = async (
  webflowClient: any,
  siteId: string,
  locals?: { webflowContent: MinimalKV }
): Promise<void> => {
  const env = (locals as any).runtime.env;
  const webflowContent = env.WEBFLOW_CONTENT;

  const cacheKey = `assets:${siteId}`;

  // Check KV cache first
  if (webflowContent) {
    const cached = await webflowContent.get(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (
        parsedCache &&
        Date.now() - parsedCache.timestamp < CACHE_TTL * 1000
      ) {
        assetsCache = parsedCache.assets;
        return;
      }
    }
  }

  try {
    console.log("Fetching all assets for site:", siteId);
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      if (offset > 0) {
        await delay(500);
      }

      const response = (await withRateLimit(() =>
        webflowClient.assets.list(siteId)
      )) as WebflowAssetsResponse;

      if (!response?.items?.length) {
        break;
      }

      // Add to cache
      for (const asset of response.items) {
        if (asset.id && asset.hostedUrl) {
          assetsCache[asset.id] = {
            url: asset.hostedUrl,
            timestamp: Date.now(),
          };
        }
      }

      // Check if we need to fetch more
      const { total, limit } = response.pagination;
      offset += limit;
      hasMore = offset < total;
    }

    // Store in KV cache
    if (webflowContent) {
      await webflowContent.put(
        cacheKey,
        JSON.stringify({
          assets: assetsCache,
          timestamp: Date.now(),
        })
      );
    }

    console.log(`Cached ${Object.keys(assetsCache).length} assets`);
  } catch (error) {
    console.error("Error fetching assets:", error);
    throw error;
  }
};

/**
 * Gets an asset URL from cache
 */
export const getAssetUrl = (assetId: string): string | null => {
  const cached = assetsCache[assetId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL * 1000) {
    return cached.url;
  }
  return null;
};
