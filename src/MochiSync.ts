import { Mldoc } from "mldoc"; // For parsing org-mode
import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user";
import { Card } from "./Card";
import { CARDTAG_REGEX, PROPERTY_REGEX } from "./constants";
import { BlockUUIDTuple, MldocOptions, PropertyPair } from "./types";

/**
 * Formats content for Mochi compatibility
 * 
 * @param content - The content to format
 * @returns Formatted content
 */
function formatContent(content: string): string {
  // TODO: Implement content formatting for Mochi
  // - remove #card tag
  // - fix syntax for mochi:
  //   1. Template fields
  //   2. Conditional rendering
  //   3. Various XML-ish tags (input, draw, furigana, pinyin)
  //   4. Cloze syntax including deletion groups
  //   5. Attachment references
  
  // For now, just remove the card tag
  return content.replace(CARDTAG_REGEX, "");
}

/**
 * Extracts markdown content and properties from a block
 * 
 * @param block - The block to process
 * @returns A tuple of [content, properties]
 */
async function getMarkdownWithProperties(
  block: BlockEntity
): Promise<[string, PropertyPair[]]> {
  // Default mldoc options for org-mode parsing
  const options: MldocOptions = {
    toc: false,
    heading_number: false,
    keep_line_break: false,
    format: "Org",
    heading_to_list: false,
    exporting_keep_properties: true,
    inline_type_with_pos: true,
    parse_outline_only: false,
    export_md_remove_options: [],
    hiccup_in_block: true,
  };

  // Convert content based on format
  let result: string;
  if (block.format !== "org") {
    result = block.content;
  } else {
    // Parse org-mode content
    const doc = Mldoc.parse(block.content, options);
    
    // Export to markdown
    const markdownContent: string[] = [];
    const markdownExporter = Mldoc.Exporters.find("markdown");
    markdownExporter.export({ refs: null }, options, doc, {
      write: (chunk: string) => markdownContent.push(chunk),
      end: () => {},
    });
    result = markdownContent.join("");
  }
  
  // Extract properties
  const propertyPairs: PropertyPair[] = [];
  for (const match of result.matchAll(PROPERTY_REGEX)) {
    propertyPairs.push({ key: match[1], value: match[2] });
  }
  
  // Clean up the content
  result = result.replace(CARDTAG_REGEX, "");
  result = result.replace(PROPERTY_REGEX, "");

  return [result, propertyPairs];
}

/**
 * Retrieves all ancestor blocks of a given block
 * 
 * @param block - The block to find ancestors for
 * @returns Array of ancestor blocks
 */
async function getAncestors(block: BlockEntity): Promise<BlockEntity[]> {
  const result = await logseq.DB.datascriptQuery(
    `
    [
    :find
      (pull ?p [*])
    :in
      $ ?b
    :where
      [?b :block/parent ?p]
    ]
    `,
    block.id,
  );

  if (result.length === 0 || result[0].length === 0) {
    return [];
  }

  const parent = result[0][0] as BlockEntity;
  const ancestors = await getAncestors(parent);
  return [...ancestors, parent];
}

/**
 * Renders a block and all its descendants as markdown
 * 
 * @param block - The block to render
 * @param level - Indentation level (0 for top level)
 * @returns Rendered markdown content
 */
async function renderWithDescendants(
  block: BlockEntity,
  level: number = 0
): Promise<string> {
  const [content, _] = await getMarkdownWithProperties(block);
  
  // Format current block based on level
  const currentBlockContent =
    level === 0 ? content + "\n" : "  ".repeat(level - 1) + "- " + content;
  
  // Return early if no children
  if (!block.children || block.children.length === 0) {
    return currentBlockContent;
  }
  
  // Process children recursively
  const childrenContent = await Promise.all(
    block.children.map(async (child) => {
      // If child is a UUID tuple, fetch the actual block
      const childBlock = Array.isArray(child) 
        ? await logseq.Editor.getBlock(child[0])
        : child;
        
      if (!childBlock) return "";
      return renderWithDescendants(childBlock, level + 1);
    })
  );
  
  // Combine current block with children
  return [currentBlockContent, ...childrenContent].join("\n");
}

/**
 * Gets the title of the page containing a block
 * 
 * @param blockId - ID of the block
 * @returns Page title or null if not found
 */
async function getPageTitle(blockId: number): Promise<string | null> {
  const result = await logseq.DB.datascriptQuery(
    `
    [
    :find
      (pull ?p [*])
    :in
      $ ?b
    :where
      [?b :block/page ?p]
    ]
    `,
    blockId,
  );
  
  if (result.length > 0 && result[0].length > 0) {
    return result[0][0]["original-name"];
  }
  
  return null;
}

/**
 * Builds a card from a block and its context
 * 
 * @param block - The block to build a card from
 * @returns A Card object
 */
async function buildCard(block: BlockEntity): Promise<Card> {
  const cardChunks: string[] = [];
  const properties: Record<string, string> = {};

  // Add page title if enabled in settings
  if (logseq.settings?.includePageTitle) {
    const pageTitle = await getPageTitle(block.id);
    if (pageTitle) cardChunks.push(pageTitle);
  }

  // Add ancestor blocks if enabled in settings
  if (logseq.settings?.includeAncestorBlocks) {
    const ancestors = await getAncestors(block);
    const ancestorContents = await Promise.all(
      ancestors
        .filter(a => a.content)
        .map(a => getMarkdownWithProperties(a))
    );
    
    for (const [content, props] of ancestorContents) {
      cardChunks.push(content);
      for (const { key, value } of props) {
        properties[key] = value;
      }
    }
  }

  // Add the main block content
  const [content, props] = await getMarkdownWithProperties(block);
  cardChunks.push(content);
  for (const { key, value } of props) {
    properties[key] = value;
  }

  // Add children blocks if present
  if (block.children?.length > 0) {
    for (const child of block.children) {
      // If child is a UUID tuple, fetch the actual block
      const childBlock = Array.isArray(child) 
        ? await logseq.Editor.getBlock(child[0])
        : child;
        
      if (!childBlock) continue;
      
      cardChunks.push("---");
      const childContent = await renderWithDescendants(childBlock, 0);
      cardChunks.push(childContent);
    }
  }

  // For debugging
  console.log(cardChunks.join("\n\n"));
  console.log(properties);
  
  return {
    content: cardChunks.join("\n\n"),
    properties
  };
}

/**
 * Main class for syncing Logseq cards with Mochi
 */
export class MochiSync {
  /**
   * Syncs cards from Logseq to Mochi
   */
  async sync(): Promise<void> {
    // Get current graph name
    const graphName = (await logseq.App.getCurrentGraph())?.name || "Default";
    const cards: Card[] = [];
    
    // Find all blocks with #card tag
    const cardBlocks = await logseq.DB.datascriptQuery(
      `
      [
      :find
        (pull ?b [*])
      :where
        [?t :block/name "card"]
        [?b :block/refs ?t]
      ]
    `,
    );

    // Process each card block
    for (const [block] of cardBlocks) {
      // Get full block with children
      const expandedBlock = await logseq.Editor.getBlock(block.id, {
        includeChildren: true,
      });
      
      // Build card and add to collection
      const card = await buildCard(expandedBlock);
      cards.push(card);
    }
    
    // TODO: Send cards to Mochi API
    console.log(`Found ${cards.length} cards in graph "${graphName}"`);
  }
}
