import {
  fetchComponents,
  getComponentMetadata,
  fetchComponentContentWithCache,
  fetchAllAssetsWithCache,
  getAssetUrl,
} from "../utils/webflow/components";
import {
  createWebflowClient,
  delay,
  withRateLimit,
} from "../utils/webflow/client";
import { fetchAllPageContent } from "../utils/webflow/pages";
import { createMarkdownConverter, mergeAttributes } from "../utils/markdown";
import type {
  WebflowNode,
  ComponentData,
  PageMetadata,
  ProcessedPage,
} from "../types";
import { NodeHtmlMarkdown } from "node-html-markdown";

const nhm = new NodeHtmlMarkdown();

/**
 * Applies property overrides from a component instance to its content nodes
 * @param content - Array of nodes from the component content
 * @param overrides - Array of property overrides to apply
 * @returns Array of nodes with overrides applied
 */
const applyPropertyOverrides = (
  content: WebflowNode[],
  overrides: WebflowNode["propertyOverrides"] = []
): WebflowNode[] => {
  return content.map((node) => {
    const override = overrides.find((o: any) => o.propertyId === node.id);
    if (!override) return node;

    switch (override.type) {
      case "Plain Text":
      case "Rich Text":
        return {
          ...node,
          text: override.text,
        };
      default:
        return node;
    }
  });
};

/**
 * Checks if a component is a navigation or footer component based on its metadata and content
 * @param componentId - The component ID
 * @param nodes - Array of nodes from the component
 * @param components - Components list from API
 * @returns Promise resolving to boolean indicating if this is a nav/footer component
 */
const isNavigationOrFooterComponent = async (
  componentId: string,
  nodes: WebflowNode[],
  components: any
): Promise<boolean> => {
  console.log(
    `\nChecking component ${componentId} for navigation/footer content`
  );

  // First check component metadata
  const metadata = components?.components?.find(
    (c: any) => c.id === componentId
  );
  console.log("Component metadata:", JSON.stringify(metadata, null, 2));

  if (metadata) {
    const name = (metadata.name || "").toLowerCase();
    console.log("Component name:", name);

    // Check component name for navigation patterns
    const navNamePatterns = [
      "nav",
      "navigation",
      "header",
      "menu",
      "footer",
      "navbar",
      "mega-menu",
      "dropdown",
      "topbar",
      "menubar",
    ];

    for (const pattern of navNamePatterns) {
      if (name.includes(pattern)) {
        console.log(
          `Component ${componentId} identified as nav/footer by name pattern: ${pattern}`
        );
        return true;
      }
    }
  }

  // Then check content
  let navigationCount = 0;
  let totalNodes = 0;

  console.log(`\nAnalyzing ${nodes.length} nodes for navigation content:`);

  // Navigation-related class patterns
  const navClassPatterns = [
    'class="nav',
    'class="w-nav',
    'class="mega-nav',
    'class="footer',
    'class="menu',
    'class="navbar',
    'class="header',
    'class="top-bar',
    "nav-link",
    "nav-menu",
    "nav-bar",
    "navbar",
    "navigation",
    "mega-menu",
    "dropdown-menu",
    "menu-item",
  ];

  // Navigation-related element patterns
  const navElementPatterns = [
    "<nav",
    "<header",
    "<footer",
    'role="navigation"',
    'role="menubar"',
    'role="menu"',
  ];

  for (const node of nodes) {
    totalNodes++;

    // Check text content for navigation-related terms
    if (node.type === "text" && node.text?.html) {
      const html = node.text.html.toLowerCase();
      let isNavNode = false;

      // Check for navigation-related classes
      for (const pattern of navClassPatterns) {
        if (html.includes(pattern)) {
          navigationCount++;
          isNavNode = true;
          console.log("\nFound navigation class pattern in HTML:", pattern);
          console.log("In node:", html);
          break;
        }
      }

      // Check for navigation-related elements
      if (!isNavNode) {
        for (const pattern of navElementPatterns) {
          if (html.includes(pattern)) {
            navigationCount++;
            isNavNode = true;
            console.log("\nFound navigation element pattern in HTML:", pattern);
            console.log("In node:", html);
            break;
          }
        }
      }

      // Check for common navigation link text patterns
      if (
        !isNavNode &&
        (html.includes("home") ||
          html.includes("about") ||
          html.includes("contact") ||
          html.includes("menu") ||
          (html.includes("sign") &&
            (html.includes("in") || html.includes("up"))) ||
          html.includes("login") ||
          html.includes("register"))
      ) {
        navigationCount += 0.5; // Count these as partial matches
        console.log("\nFound common navigation text in HTML:", html);
      }
    }
  }

  console.log(`\nNavigation analysis results:
  - Total nodes: ${totalNodes}
  - Navigation nodes: ${navigationCount}
  - Ratio: ${navigationCount / totalNodes}
  `);

  // If more than 20% of nodes have navigation elements, consider it a nav component
  const isNavByContent =
    navigationCount > 0 && navigationCount / totalNodes > 0.2;
  if (isNavByContent) {
    console.log(
      `Component ${componentId} identified as nav/footer by content analysis`
    );
  } else {
    console.log(
      `Component ${componentId} NOT identified as navigation (${navigationCount} nav nodes out of ${totalNodes} total)`
    );
  }
  return isNavByContent;
};

/**
 * Process a single Webflow page
 */
export const processWebflowPage = async (
  pageId: string,
  locals: any // Accept any, or type as { runtime: { env: ... } }
): Promise<ProcessedPage> => {
  // Get env and create client
  const siteId = import.meta.env.PROD
    ? (locals as any).runtime.env.WEBFLOW_SITE_ID
    : import.meta.env.WEBFLOW_SITE_ID;
  const accessToken = import.meta.env.PROD
    ? (locals as any).runtime.env.WEBFLOW_SITE_API_TOKEN
    : import.meta.env.WEBFLOW_SITE_API_TOKEN;
  const webflowClient = createWebflowClient(accessToken);
  const webflowContent = (locals as any).webflowContent;
  const basePath = import.meta.env.BASE_URL;

  if (!siteId) throw new Error("WEBFLOW_SITE_ID is not defined");
  if (!accessToken) throw new Error("WEBFLOW_SITE_API_TOKEN is not defined");

  // Get components list from cache
  const components = await fetchComponents(webflowClient, siteId, {
    webflowContent,
  });
  if (!components) throw new Error("Components list not found in cache");

  // Get page content from cache
  const content = await fetchAllPageContent(
    webflowClient,
    webflowContent,
    pageId
  );

  // Get page metadata
  const page = (await withRateLimit(() =>
    webflowClient.pages.list(siteId)
  )) as { pages?: any[] };
  const pageData = page?.pages?.find((p: any) => p.id === pageId);
  if (!pageData) throw new Error(`Page ${pageId} not found`);

  // Use 'index' for root page, otherwise use the slug
  const slug =
    !pageData.slug || pageData.slug === "/" ? "index" : pageData.slug;

  // Clean content
  const cleanedContent = await cleanContent(content, components, undefined, {
    webflowClient,
    webflowContent,
  });

  // Create markdown content
  const markdownContent = [
    "---",
    `title: ${pageData.title || "Untitled"}`,
    `slug: ${slug}`,
    `description: ${
      pageData.seo?.description || pageData.openGraph?.description || ""
    }`,
    `last_updated: ${new Date().toISOString()}`,
    "---",
    "",
    ...cleanedContent,
  ].join("\n");

  // Store with both URLs
  const baseKey = `docs/${slug}`;
  await webflowContent.put(baseKey, markdownContent);
  await webflowContent.put(`${baseKey}.md`, markdownContent);

  return {
    id: pageId,
    metadata: {
      id: pageId,
      title: pageData.title || "Untitled",
      slug: slug,
      description:
        pageData.seo?.description || pageData.openGraph?.description || "",
      last_updated: new Date().toISOString(),
    },
    fileName: `${slug}.md`,
    content: cleanedContent,
  };
};

/**
 * Recursively cleans and processes Webflow nodes into Markdown strings
 * Handles different node types including nested component instances
 * @param content - Array of Webflow nodes to process
 * @param components - Components list from API
 * @param componentId - Optional ID of the current component being processed
 * @param locals - App locals containing KV instance for caching
 * @returns Promise resolving to array of Markdown strings
 */
const cleanContent = async (
  content: WebflowNode[],
  components: any,
  componentId?: string,
  locals?: { webflowClient: any; webflowContent: any }
): Promise<string[]> => {
  if (!content) return [];

  const cleanedNodes = await Promise.all(
    content.map(async (node): Promise<string> => {
      let htmlContent = "";

      switch (node.type) {
        case "text":
          htmlContent = mergeAttributes(node.text?.html || "", node.attributes);
          break;

        // Image Node
        case "image":
          const assetId = node.image?.assetId;
          if (!assetId) {
            if (import.meta.env.DEV)
              console.debug("Skipping image without assetId");
            break;
          }

          const url = getAssetUrl(assetId);
          if (url) {
            const altText = node.image?.alt || "";
            htmlContent = mergeAttributes(
              `<img src="${url}" alt="${altText}">`,
              node.attributes
            );
          } else {
            console.warn(`Warning: Image asset ${assetId} not found in cache`);
          }
          break;

        // Select Node
        case "select":
          const options =
            node.choices
              ?.map(
                (choice: any) =>
                  `<option value="${choice.value}">${choice.text}</option>`
              )
              .join("") || "";
          htmlContent = mergeAttributes(
            `<select>${options}</select>`,
            node.attributes
          );
          break;

        // Text Input Node
        case "text-input":
          htmlContent = mergeAttributes(
            `<input type="text" placeholder="${node.placeholder || ""}">`,
            node.attributes
          );
          break;

        // Submit Button Node
        case "submit-button":
          htmlContent = mergeAttributes(
            `<button type="submit" data-waiting="${node.waitingText || ""}">${
              node.value || "Submit"
            }</button>`,
            node.attributes
          );
          break;

        // Component Instance Node
        case "component-instance":
          if (!node.componentId) {
            if (import.meta.env.DEV)
              console.debug("Skipping component without ID");
            return "";
          }

          try {
            // Get component info from the cached components list
            const componentInfo = components?.components?.find(
              (c: any) => c.id === node.componentId
            );

            if (!componentInfo) {
              if (import.meta.env.DEV)
                console.debug(
                  `Component ${node.componentId} not found in components list, skipping`
                );
              return "";
            }

            // Skip navigation/footer components early based on name
            const name = (componentInfo.name || "").toLowerCase();
            const navPatterns = [
              "nav",
              "navigation",
              "header",
              "menu",
              "footer",
              "navbar",
              "mega-menu",
              "dropdown",
              "topbar",
              "menubar",
            ];
            if (navPatterns.some((pattern) => name.includes(pattern))) {
              if (import.meta.env.DEV)
                console.debug(
                  `Skipping navigation component ${node.componentId} based on name: ${name}`
                );
              return "";
            }

            // Use the cached component content
            const siteId = (locals as any)?.webflowClient
              ? (locals as any).webflowClient.siteId
              : undefined;
            const webflowClient = (locals as any)?.webflowClient;
            const webflowContent = (locals as any)?.webflowContent;
            const componentNodes = await fetchComponentContentWithCache(
              webflowClient,
              siteId,
              node.componentId,
              { webflowContent }
            );

            if (!componentNodes?.length) {
              if (import.meta.env.DEV)
                console.debug(
                  `No content found for component ${node.componentId}`
                );
              return "";
            }

            // Apply any property overrides
            const overriddenContent = applyPropertyOverrides(
              componentNodes,
              node.propertyOverrides
            );

            // Process the component content recursively
            const cleanedComponentContent = await cleanContent(
              overriddenContent,
              components,
              node.componentId,
              { webflowClient, webflowContent }
            );

            return cleanedComponentContent.join("");
          } catch (error) {
            console.warn(
              `Error processing component ${node.componentId}, skipping:`,
              error instanceof Error ? error.message : String(error)
            );
            return "";
          }
          break;

        default:
          return "";
      }

      // Convert HTML to Markdown and clean up
      let markdown = nhm.translate(htmlContent);

      // Clean up extra whitespace and line breaks
      markdown = markdown.replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");

      return markdown;
    })
  );

  return cleanedNodes.filter(Boolean);
};
