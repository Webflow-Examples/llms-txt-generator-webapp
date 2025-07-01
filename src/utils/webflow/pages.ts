import type {
  WebflowPage,
  WebflowNode,
  WebflowPageContentResponse,
} from "../webflow-types";
import { webflow, withRateLimit, delay } from "./client";

interface CachedData {
  data: any;
  timestamp: number;
}

/**
 * Validates cached data
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
 * Fetches all published pages from Webflow using pagination
 * @param siteId - The Webflow site ID
 * @param pageSize - Number of items per page (default: 100, max: 100)
 * @returns Promise resolving to array of all published pages
 */
export const fetchAllPages = async (
  siteId: string,
  pageSize = 100
): Promise<WebflowPage[]> => {
  let allPages: WebflowPage[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Add delay between paginated requests
    if (offset > 0) {
      await delay(500);
    }

    const response = await withRateLimit(() =>
      webflow.pages.list(siteId, {
        limit: pageSize,
        offset: offset,
      })
    );

    if (!response?.pages?.length) {
      break;
    }

    // Convert API response to our WebflowPage type and filter out draft/archived pages
    const publishedPages = response.pages
      .filter((page) => page && typeof page === "object")
      .map(
        (page) =>
          ({
            id: page.id || "",
            siteId: page.siteId || siteId,
            title: page.title || "",
            slug: page.slug || "",
            draft: Boolean(page.draft),
            archived: Boolean(page.archived),
            lastUpdated:
              page.lastUpdated?.toISOString() || new Date().toISOString(),
            createdOn:
              page.createdOn?.toISOString() || new Date().toISOString(),
            publishedPath: page.publishedPath,
            seo: page.seo
              ? {
                  title: page.seo.title,
                  description: page.seo.description,
                }
              : undefined,
            openGraph: page.openGraph
              ? {
                  title: page.openGraph.title,
                  description: page.openGraph.description,
                }
              : undefined,
          } as WebflowPage)
      )
      .filter(
        (page) =>
          // Filter out draft, archived, and template pages
          !page.draft && !page.archived && !page.slug.startsWith("detail_") // Exclude template pages
      );

    allPages = [...allPages, ...publishedPages];

    // Check if we've fetched all pages
    const total = response.pagination?.total ?? 0;
    const limit = response.pagination?.limit ?? pageSize;
    offset += limit;
    hasMore = offset < total;
  }

  return allPages;
};

/**
 * Gets page content from cache or fetches it
 */
export const fetchAllPageContent = async (
  pageId: string,
  locals?: { webflowContent: App.Locals["webflowContent"] }
): Promise<WebflowNode[]> => {
  if (!locals?.webflowContent) {
    throw new Error("KV storage required for page content caching");
  }

  const cacheKey = `page-content:${pageId}`;

  try {
    // Try to get from cache first
    const cached = await locals.webflowContent.get(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (isValidCache(parsedCache)) {
        return parsedCache.data;
      }
    }

    // Cache miss, fetch with pagination
    let allNodes: WebflowNode[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Add delay between paginated requests
      if (offset > 0) {
        await delay(500);
      }

      const response = (await withRateLimit(() =>
        webflow.pages.getContent(pageId, {
          limit: 100,
          offset: offset,
        })
      )) as WebflowPageContentResponse;

      if (!response?.nodes?.length) {
        break;
      }

      allNodes = [...allNodes, ...response.nodes];

      // Check if we've fetched all content
      const { total, limit } = response.pagination;
      offset += limit;
      hasMore = offset < total;
    }

    // Store in cache
    const cacheData = {
      data: allNodes,
      timestamp: Date.now(),
    };
    await locals.webflowContent.put(cacheKey, JSON.stringify(cacheData));

    return allNodes;
  } catch (error) {
    console.error(`Error fetching content for page ${pageId}:`, error);
    throw error;
  }
};
