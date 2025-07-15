export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import {
  fetchCollections,
  fetchAllCollectionItems,
  fetchCollectionSchema,
} from "../../utils/webflow/collections";
import type { WebflowCollection, WebflowCollectionField } from "../../types";
import { NodeHtmlMarkdown } from "node-html-markdown";
import {
  isCollectionExposed,
  filterExposedFields,
  filterExposedItemData,
  getCollectionConfig,
  loadExposureSettings,
} from "../../utils/collection-exposure";
import { updateLLMSSection } from "../../utils/kv-helpers";
import { createWebflowClient } from "../../utils/webflow/client";

// Initialize NodeHtmlMarkdown with GitHub-flavored Markdown options
const nhm = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  useInlineLinks: true,
  // Additional options for better formatting
  keepDataImages: true,
  codeFence: "```",
  textReplace: [
    // Clean up common HTML entities
    [/&nbsp;/g, " "],
    [/&amp;/g, "&"],
    [/&lt;/g, "<"],
    [/&gt;/g, ">"],
    [/&quot;/g, '"'],
    [/&#39;/g, "'"],
  ],
});

// Cache for collection references
let collectionRefsCache: Record<string, string> = {};

/**
 * Resolves a collection reference ID to its name
 */
async function resolveCollectionRef(
  webflowClient: any,
  collectionId: string
): Promise<string> {
  if (!collectionRefsCache[collectionId]) {
    try {
      const schema = await fetchCollectionSchema(webflowClient, collectionId);
      collectionRefsCache[collectionId] = schema.name;
    } catch (error) {
      console.error(`Error resolving collection ref ${collectionId}:`, error);
      return collectionId; // Fallback to ID if resolution fails
    }
  }
  return collectionRefsCache[collectionId];
}

/**
 * Gets a display name from resolved field data
 */
function getDisplayNameFromResolved(resolved: Record<string, any>): string {
  const nameFields = ["name", "title", "displayName", "heading", "label"];
  for (const field of nameFields) {
    if (resolved[field]) {
      return resolved[field];
    }
  }
  return "Untitled Item";
}

/**
 * Gets the option name from its ID using the field validations
 */
function getOptionName(
  optionId: string,
  validations: Record<string, any>
): string {
  if (!validations?.options) return optionId;

  const option = validations.options.find((opt: any) => opt.id === optionId);
  return option?.name || optionId;
}

/**
 * Formats a field value based on its type for better readability
 */
async function formatFieldValue(
  value: any,
  fieldType: string,
  field?: WebflowCollectionField
): Promise<string> {
  if (value === null || value === undefined) return "_Not set_";

  switch (fieldType) {
    case "PlainText":
      return typeof value === "string" ? value : `\`${JSON.stringify(value)}\``;
    case "RichText":
      return typeof value === "string"
        ? nhm.translate(value)
        : `\`${JSON.stringify(value)}\``;
    case "Date":
      try {
        const date = new Date(value);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
      } catch {
        return String(value);
      }
    case "Image":
      if (!value.url) return "_No image_";
      const caption = value.alt ? `\n\n*${value.alt}*` : "";
      return `![${value.alt || "Image"}](${value.url})${caption}`;
    case "Link":
      if (!value.url) return "_No link_";
      const linkText = value.text || value.url;
      return value.url.startsWith("http")
        ? `[${linkText}](${value.url})`
        : `\`${value.url}\``;
    case "Boolean":
      return value ? "✓ Yes" : "✗ No";
    case "Option":
    case "Select":
      if (!value) return "_None selected_";
      if (Array.isArray(value)) {
        // Multi-select field
        return value.length
          ? value
              .map(
                (v) => `- ${field ? getOptionName(v, field.validations) : v}`
              )
              .join("\n")
          : "_No options selected_";
      }
      // Single-select field
      return field ? getOptionName(value, field.validations) : value;
    case "Reference":
      if (!value) return "_No reference_";
      if (value.resolved) {
        return getDisplayNameFromResolved(value.resolved);
      }
      return `\`${JSON.stringify(value)}\``;
    case "MultiReference":
      if (!value || !Array.isArray(value)) return "_No references_";
      return (
        value
          .filter((ref) => ref && ref.resolved)
          .map((ref) => `- ${getDisplayNameFromResolved(ref.resolved)}`)
          .join("\n") || "_No valid references_"
      );
    case "Color":
      if (!value) return "_No color_";
      return `\`${value}\` <span style="display:inline-block;width:1em;height:1em;background:${value};border:1px solid #ccc;"></span>`;
    case "Number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    default:
      const stringValue = JSON.stringify(value, null, 2);
      return stringValue === "{}"
        ? "_Empty_"
        : `\`\`\`json\n${stringValue}\n\`\`\``;
  }
}

/**
 * Gets a meaningful title for an item based on its fields
 */
function getItemTitle(
  item: any,
  fieldMap: Map<string, WebflowCollectionField>
): string {
  // Common field names that might contain a title
  const titleFields = ["name", "title", "heading", "label", "postTitle"];

  if (item.fieldData) {
    // First try to find any of the common title fields
    for (const [key, value] of Object.entries(item.fieldData)) {
      const field = fieldMap.get(key);
      if (
        field &&
        titleFields.includes(field.displayName.toLowerCase()) &&
        value
      ) {
        return String(value);
      }
    }

    // If no title field found, try to find any text field that might contain a title
    for (const [key, value] of Object.entries(item.fieldData)) {
      const field = fieldMap.get(key);
      if (
        field &&
        (field.type === "PlainText" || field.type === "RichText") &&
        value &&
        !key.toLowerCase().includes("description")
      ) {
        return String(value);
      }
    }
  }

  // Fallback to ID if no suitable field found
  return `Item ${item.id}`;
}

// Add a helper function to format collection URLs
function formatCollectionUrl(name: string): string {
  // Replace spaces with hyphens and remove any special characters
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

export const GET: APIRoute = async ({ locals }) => {
  const domain = import.meta.env.DOMAIN;
  const basePath = import.meta.env.BASE_URL;
  const siteId = import.meta.env.PROD
    ? (locals as any).runtime.env.WEBFLOW_SITE_ID
    : import.meta.env.PUBLIC_WEBFLOW_SITE_ID;
  const accessToken = import.meta.env.PROD
    ? (locals as any).runtime.env.WEBFLOW_SITE_API_TOKEN
    : import.meta.env.WEBFLOW_SITE_API_TOKEN;
  if (!siteId) throw new Error("WEBFLOW_SITE_ID is not defined");
  if (!accessToken) throw new Error("WEBFLOW_API_TOKEN is not defined");

  const webflowClient = createWebflowClient(accessToken);
  const webflowContent = (locals as any).webflowContent;
  const exposureSettings = (locals as any).exposureSettings;

  try {
    console.log("Starting collections endpoint");

    // Load exposure settings from KV
    await loadExposureSettings(exposureSettings);

    // Fetch all collections
    console.log("Fetching collections for site:", siteId);
    const collections = await fetchCollections(webflowClient, siteId);
    console.log(`Found ${collections.length} collections`);

    // Filter to only exposed collections
    const exposedCollections = collections.filter((c) =>
      isCollectionExposed(c.id)
    );
    console.log(
      `${exposedCollections.length} collections are configured for exposure`
    );

    // If no collections are exposed, return early
    if (exposedCollections.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No collections are configured for exposure",
          collections: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Prepare collections content for llms.txt
    const collectionsContent = [
      "The following collections are available in the Webflow site:",
      "",
    ];

    // Process collections sequentially to avoid rate limits
    for (const collection of exposedCollections) {
      try {
        console.log(`\nProcessing collection: ${collection.displayName}`);
        // No progressCallback on locals, skip

        // Get collection config
        const config = getCollectionConfig(collection.id);
        if (!config) {
          console.log(
            `No config found for collection ${collection.id}, skipping`
          );
          continue;
        }

        // Skip if collection is not visible
        if (!config.isVisible) {
          console.log(`Collection ${collection.id} is not visible, skipping`);
          continue;
        }

        // Format the collection URL
        const collectionUrl = formatCollectionUrl(collection.name);

        // Fetch collection schema
        console.log(`Fetching schema for collection ${collection.id}`);
        const schema = await fetchCollectionSchema(
          webflowClient,
          collection.id
        );
        console.log("Got schema:", schema.name);

        // Create a map of field slugs to field definitions and filter exposed fields
        const fieldMap = new Map<string, WebflowCollectionField>(
          schema.fields.map((f: WebflowCollectionField) => [f.name, f])
        );
        const exposedFieldMap = filterExposedFields(collection.id, fieldMap);

        // Skip if no fields are exposed
        if (!exposedFieldMap.size) {
          console.log(
            `No exposed fields in collection ${collection.id}, skipping`
          );
          continue;
        }

        // Fetch items
        console.log(`Fetching items for collection ${collection.id}`);
        const items = await fetchAllCollectionItems(
          webflowClient,
          collection.id
        );
        console.log(`Found ${items.length} items`);

        // Add collection to llms.txt content with formatted URL
        collectionsContent.push(
          `- [${
            config.displayName || collection.displayName
          }](https://${domain}/${basePath}/collections/${collectionUrl}.md): ${
            config.description || `Collection with ${items.length} items`
          }`
        );

        // Create markdown content with the same formatted URL
        const markdownContent = [
          "---",
          `title: ${config.displayName || collection.displayName}`,
          `slug: ${collectionUrl}`,
          `type: collection`,
          `singular_name: ${collection.name}`,
          `last_updated: ${new Date().toISOString()}`,
          `total_items: ${items.length}`,
          "---",
          "",
          `# ${config.displayName || collection.displayName}`,
          "",
          config.description
            ? `> ${config.description}`
            : `> This collection contains ${items.length} ${
                items.length === 1 ? collection.name : collection.name
              }.`,
          "",
          ...(await Promise.all(
            items.map(async (item, index) => {
              const title = getItemTitle(item, exposedFieldMap);
              const lines = [
                "---",
                "",
                `## ${title}`,
                "",
                `*Item ${index + 1} of ${items.length}*`,
                "",
              ];

              if (item.fieldData) {
                // Filter to only exposed fields
                const exposedData = filterExposedItemData(
                  collection.id,
                  item.fieldData
                );

                const richTextFields: string[] = [];
                const tableFields: {
                  basic: string[];
                  media: string[];
                  metadata: string[];
                  references: string[];
                } = {
                  basic: [],
                  media: [],
                  metadata: [],
                  references: [],
                };

                // Process exposed fields
                for (const [key, value] of Object.entries(exposedData)) {
                  const field = exposedFieldMap.get(key);
                  if (field) {
                    const formattedValue = await formatFieldValue(
                      value,
                      field.type,
                      field
                    );

                    if (field.type === "RichText") {
                      richTextFields.push(
                        `### ${field.displayName}\n\n${formattedValue}\n`
                      );
                    } else {
                      const row = `| ${
                        field.displayName
                      } | ${formattedValue.replace(/\n/g, "<br>")} |`;
                      switch (field.type) {
                        case "Image":
                        case "Video":
                          tableFields.media.push(row);
                          break;
                        case "Reference":
                        case "MultiReference":
                          tableFields.references.push(row);
                          break;
                        case "Date":
                        case "CreatedOn":
                        case "ModifiedOn":
                          tableFields.metadata.push(row);
                          break;
                        default:
                          tableFields.basic.push(row);
                      }
                    }
                  }
                }

                // Add tables for each group
                if (tableFields.basic.length) {
                  lines.push(
                    "### Basic Information",
                    "",
                    "| Field | Value |",
                    "|-------|--------|",
                    ...tableFields.basic,
                    ""
                  );
                }

                if (tableFields.media.length) {
                  lines.push(
                    "### Media",
                    "",
                    "| Field | Content |",
                    "|-------|---------|",
                    ...tableFields.media,
                    ""
                  );
                }

                if (tableFields.references.length) {
                  lines.push(
                    "### Related Items",
                    "",
                    "| Field | Reference |",
                    "|-------|-----------|",
                    ...tableFields.references,
                    ""
                  );
                }

                if (tableFields.metadata.length) {
                  lines.push(
                    "### Metadata",
                    "",
                    "| Field | Value |",
                    "|-------|--------|",
                    ...tableFields.metadata,
                    ""
                  );
                }

                // Add rich text content last
                if (richTextFields.length) {
                  lines.push("### Content", "", ...richTextFields);
                }
              }

              lines.push("\n---\n");
              return lines.join("\n");
            })
          )),
        ].join("\n");

        // Store with both URLs
        const baseKey = `collections/${collectionUrl}`;
        await webflowContent.put(baseKey, markdownContent);
        await webflowContent.put(`${baseKey}.md`, markdownContent);
      } catch (collectionError) {
        console.error(
          `Error processing collection ${collection.id}:`,
          collectionError instanceof Error
            ? collectionError.message
            : String(collectionError)
        );
        continue;
      }
    }

    // Update Collections section in llms.txt
    console.log("Updating Collections section in llms.txt");
    await updateLLMSSection(webflowContent, "Collections", collectionsContent);
    console.log("Successfully updated Collections section");

    // Verify KV contents after processing
    const keys = await webflowContent.list();
    console.log("Final KV store contents:", keys);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${exposedCollections.length} collections`,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "List collections endpoint error:",
      error instanceof Error ? error.message : String(error)
    );
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
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
