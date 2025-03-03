import "@logseq/libs";
import { Mldoc } from "mldoc"; // For parsing org-mode
import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user";
import {
  CARDTAG_REGEX,
  CLOZE_REGEX,
  MEDIA_REGEX,
  MOCHI_MAX_ATTACHMENT_SIZE,
  PROPERTY_REGEX,
  SYNC_MSG_KEY,
} from "./constants";
import {
  Card,
  MediaAttachment,
  MldocOptions,
  MochiApiResponse,
  MochiCard,
  MochiDeck,
  PropertyPair,
} from "./types";

// TODO: Add support for template instantiation?

/**
 * Main class for syncing Logseq cards with Mochi
 */
export class MochiSync {
  mochiApiKey: string;
  defaultDeckName: string;
  syncDeletedCards: boolean;
  includeAncestorBlocks: boolean;
  includePageTitle: boolean;
  includePageProperties: boolean;
  templateMap: Map<string, MochiTemplate> = new Map();

  constructor(
    mochiApiKey: string,
    defaultDeckName: string,
    syncDeletedCards: boolean,
    includeAncestorBlocks: boolean,
    includePageTitle: boolean,
    includePageProperties: boolean,
  ) {
    this.mochiApiKey = mochiApiKey;
    this.defaultDeckName = defaultDeckName;
    this.syncDeletedCards = syncDeletedCards;
    this.includeAncestorBlocks = includeAncestorBlocks;
    this.includePageTitle = includePageTitle;
    this.includePageProperties = includePageProperties;
  }

  /**
   * Extracts markdown content, properties, and media attachments from a block
   *
   * @param block - The block to process
   * @returns A tuple of [content, properties, attachments]
   */
  private async getMarkdownWithProperties(
    block: BlockEntity,
  ): Promise<[string, PropertyPair[], MediaAttachment[]]> {
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

    // New approach: Split into lines and filter out property lines
    const lines = result.split("\n");
    const keptLines: string[] = [];
    const propertyPairs: PropertyPair[] = [];

    for (const line of lines) {
      const propMatch = PROPERTY_REGEX.exec(line);
      if (propMatch) {
        // Extract property and skip this line
        const value = propMatch[2] ? propMatch[2].trim() : "";
        propertyPairs.push({
          key: propMatch[1].trim(),
          value,
        });
      } else {
        // Keep non-property lines
        keptLines.push(line);
      }
    }

    result = keptLines.join("\n");

    // Remove #card tags from remaining content
    result = result.replace(CARDTAG_REGEX, "");

    // Convert Logseq cloze format to Mochi format
    result = result.replace(CLOZE_REGEX, "{{$1}}");

    // Escape double square brackets to prevent Mochi from interpreting them as links
    result = result.replace(/(?<!\\)(\[\[|\]\])/g, "\\$1");

    // Process media attachments
    const mediaAttachments: MediaAttachment[] = [];
    let modifiedContent = result;

    let match;
    const mediaRegexCopy = new RegExp(MEDIA_REGEX); // Create a new instance to reset lastIndex
    while ((match = mediaRegexCopy.exec(result)) !== null) {
      const [fullMatch, altText, path] = match;
      try {
        // Skip URLs - only process local files
        if (path.includes("://") && !path.startsWith("file://")) {
          continue;
        }

        const assetUrl = (await logseq.Assets.makeUrl(path)).replace(
          "assets://",
          "file://",
        );
        if (!assetUrl) continue;

        const response = await fetch(assetUrl);
        if (!response.ok) continue;

        const blob = await response.blob();

        // Skip files larger than 5MB (Mochi's limit)
        if (blob.size > MOCHI_MAX_ATTACHMENT_SIZE) {
          console.warn(`Skipping oversized file: ${path} (${blob.size} bytes)`);
          continue;
        }

        // Generate hash for the file content
        const hashBuffer = await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );
        const hash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        // Create a filename based on the hash and original extension
        const filename = path.split("/").pop() || "";
        const ext = filename.split(".").pop() || "";
        const newFilename = `${hash.slice(0, 8)}.${ext}`;

        mediaAttachments.push({
          hash,
          originalPath: path,
          filename: newFilename,
          contentType: blob.type,
          content: blob,
        });

        // Replace the image reference with the new filename
        modifiedContent = modifiedContent.replace(
          fullMatch,
          `![${altText}](${newFilename})`,
        );
      } catch (error) {
        console.warn(`Failed to process media ${path}:`, error);
      }
    }

    return [modifiedContent.trim(), propertyPairs, mediaAttachments];
  }

  /**
   * Retrieves all ancestor blocks of a given block
   *
   * @param block - The block to find ancestors for
   * @returns Array of ancestor blocks
   */
  private async getAncestors(block: BlockEntity): Promise<BlockEntity[]> {
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
    const ancestors = await this.getAncestors(parent);
    return [...ancestors, parent];
  }

  /**
   * Renders a block and all its descendants as markdown
   *
   * @param block - The block to render
   * @param level - Indentation level (0 for top level)
   * @returns Rendered markdown content
   */
  private async renderWithDescendants(
    block: BlockEntity,
    level: number = 0,
  ): Promise<[string, MediaAttachment[]]> {
    const [content, _, attachments] =
      await this.getMarkdownWithProperties(block);

    // Format current block based on level
    const currentBlockContent =
      level === 0 ? content + "\n" : "  ".repeat(level - 1) + "- " + content;

    // Return early if no children
    if (!block.children || block.children.length === 0) {
      return [currentBlockContent, attachments];
    }

    // Process children recursively
    const childrenContent: [string, MediaAttachment[]][] = await Promise.all(
      block.children.map(async (child) => {
        // If child is a UUID tuple, fetch the actual block
        const childBlock = Array.isArray(child)
          ? await logseq.Editor.getBlock(child[0])
          : child;

        if (!childBlock) return ["", []];
        return this.renderWithDescendants(childBlock, level + 1);
      }),
    );

    let resultContent: string[] = [currentBlockContent];
    for (const [childContent, childAttachments] of childrenContent) {
      resultContent.push(childContent);
      attachments.push(...childAttachments);
    }

    // Combine current block with children
    return [resultContent.join("\n"), attachments];
  }

  /**
   * Gets the title of the page containing a block
   *
   * @param blockId - ID of the block
   * @returns Page title or null if not found
   */
  private async getPageTitle(blockId: number): Promise<string | null> {
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

  private async getPageProperties(
    blockId: number,
  ): Promise<{ key: string; value: string }[]> {
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
      const page = result[0][0];
      return page["properties"] || {};
    }

    return [];
  }

  /**
   * Uploads media attachments for a card to Mochi
   *
   * @param cardId - The ID of the card to attach media to
   * @param attachments - Array of media attachments to upload
   */
  private async uploadAttachments(
    cardId: string,
    attachments: MediaAttachment[],
  ): Promise<void> {
    for (const attachment of attachments) {
      try {
        // Check if attachment already exists
        const url = `https://app.mochi.cards/api/cards/${cardId}/attachments/${attachment.filename}`;
        const check = await fetch(url, {
          headers: { Authorization: `Basic ${btoa(this.mochiApiKey + ":")}` },
        });

        // Only upload if attachment doesn't exist (404)
        if (check.status === 404) {
          const form = new FormData();
          form.append("file", attachment.content, attachment.filename);

          const response = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Basic ${btoa(this.mochiApiKey + ":")}` },
            body: form,
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to upload attachment: ${errorText}`);
          }
        }
      } catch (error) {
        console.error(`Failed to upload ${attachment.filename}:`, error);
      }
    }
  }

  /**
   * Builds a card from a block and its context
   *
   * @param block - The block to build a card from
   * @returns A Card object
   */
  private async buildCard(block: BlockEntity): Promise<Card> {
    const cardChunks: string[] = [];
    const properties: Record<string, any> = {};
    const allAttachments: MediaAttachment[] = [];

    // Helper function to check property overrides
    const getOverride = (key: string, defaultVal?: any): boolean => {
      if (key in properties) {
        const val = String(properties[key]).toLowerCase();
        return val !== "false" && val !== "no"; // Consider any value except false/no as true
      }
      return defaultVal ?? false;
    };

    // Get page title and properties
    const pageTitle = await this.getPageTitle(block.id);
    const pageProperties = await this.getPageProperties(block.id);

    // Add page properties if enabled in settings
    if (this.includePageProperties && typeof pageProperties === "object") {
      for (const [key, value] of Object.entries(pageProperties)) {
        properties[key] = value;
      }
    }

    // Add ancestor blocks and their properties
    const ancestors = await this.getAncestors(block);
    const ancestorContents = await Promise.all(
      ancestors
        .filter((a) => a.content)
        .map((a) => this.getMarkdownWithProperties(a)),
    );

    for (const [content, props, attachments] of ancestorContents) {
      for (const { key, value } of props) {
        properties[key] = value;
      }
      allAttachments.push(...attachments);
    }

    // Add the main block content and properties (highest priority)
    const [content, props, attachments] =
      await this.getMarkdownWithProperties(block);
    for (const { key, value } of props) {
      properties[key] = value;
    }
    allAttachments.push(...attachments);

    // Determine inclusion flags after all properties are merged
    const includePageTitle = getOverride(
      "mochi-include-page-title",
      this.includePageTitle,
    );
    const includeAncestorBlocks = getOverride(
      "mochi-include-ancestors",
      this.includeAncestorBlocks,
    );

    // Add page title if enabled
    if (includePageTitle && pageTitle) {
      cardChunks.push(pageTitle);
    }

    // Add ancestor blocks if enabled
    if (includeAncestorBlocks) {
      for (const [ancestorContent, _] of ancestorContents) {
        if (ancestorContent.trim().length > 0) {
          cardChunks.push(ancestorContent);
        }
      }
    }

    // Add the main block content
    cardChunks.push(content);

    const children = block.children || [];

    // Add children blocks if present
    if (children.length || 0 > 0) {
      for (const child of children) {
        // If child is a UUID tuple, fetch the actual block
        const childBlock = Array.isArray(child)
          ? await logseq.Editor.getBlock(child[0])
          : child;

        if (!childBlock) continue;

        cardChunks.push("---");
        const [childContent, childAttachments] =
          await this.renderWithDescendants(childBlock, 0);
        cardChunks.push(childContent);
        allAttachments.push(...childAttachments);
      }
    }

    // Extract Mochi-specific properties
    const deckname = properties["mochi-deck"] || undefined;
    const tags = properties["mochi-tags"]
      ? properties["mochi-tags"].split(",").map((t) => t.trim())
      : undefined;
    const mochiId = block.properties?.["mochi-id"];

    // Create the card object
    const card: Card = {
      content: cardChunks.join("\n\n"),
      properties,
      deckname,
      tags,
      mochiId,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
    };

    // Handle template if specified
    const templateName = properties["mochi-template"];
    if (templateName && typeof templateName === "string" && this.templateMap.size > 0) {
      const template = this.templateMap.get(templateName);
      
      if (template) {
        card.templateId = template.id;
        card.fields = {};
        
        // Process each field in the template
        Object.values(template.fields).forEach(field => {
          // Look for properties with the pattern mochi-field-{fieldName}
          const propKey = `mochi-field-${field.name.toLowerCase()}`;
          
          // Check for case-insensitive match
          const matchingKey = Object.keys(properties).find(
            key => key.toLowerCase() === propKey
          );
          
          if (matchingKey && properties[matchingKey]) {
            card.fields![field.id] = {
              id: field.id,
              value: String(properties[matchingKey])
            };
          }
        });
      } else {
        console.warn(`Template "${templateName}" not found in Mochi`);
      }
    }

    return card;
  }

  /**
   * Determines if a card needs to be updated in Mochi
   *
   * @param currentCard - The card from Logseq
   * @param existingMochiCard - The existing card in Mochi
   * @param deckMap - Map of deck names to deck IDs
   * @returns True if the card needs to be updated
   */
  private cardNeedsUpdate(
    currentCard: Card,
    existingMochiCard: MochiCard,
    deckMap: Map<string, string>,
  ): boolean {
    // Resolve intended deck ID from current configuration
    let intendedDeckId: string | undefined;
    if (currentCard.deckname) {
      intendedDeckId = deckMap.get(currentCard.deckname);
    } else {
      intendedDeckId = deckMap.get(this.defaultDeckName);
    }

    for (const attachment of currentCard.attachments || []) {
      if (
        !existingMochiCard.attachments ||
        !existingMochiCard.attachments[attachment.filename]
      ) {
        return true;
      }
    }

    // Compare content, deck, and tags
    const contentChanged = currentCard.content !== existingMochiCard.content;
    const deckChanged = intendedDeckId !== existingMochiCard["deck-id"];

    // Check tags (include 'logseq' in comparison)
    const expectedTags = [...(currentCard.tags || []), "logseq"];
    const actualTags = existingMochiCard["manual-tags"] || [];
    const tagsChanged =
      expectedTags.length !== actualTags.length ||
      !expectedTags.every((tag) => actualTags.includes(tag));
      
    // Check template and fields
    const templateChanged = currentCard.templateId !== existingMochiCard["template-id"];
    
    // Compare fields by stringifying them
    const fieldsChanged = currentCard.fields 
      ? JSON.stringify(currentCard.fields) !== JSON.stringify(existingMochiCard.fields)
      : existingMochiCard.fields !== undefined;

    return contentChanged || deckChanged || tagsChanged || templateChanged || fieldsChanged;
  }

  /**
   * Fetches all cards from Mochi API that have the 'logseq' tag
   *
   * @returns Array of Mochi cards
   * @throws Error if API key is not configured or API request fails
   */
  private async fetchMochiCards(): Promise<MochiCard[]> {
    const mochiCards: MochiCard[] = [];
    let bookmark: string | null = null;

    do {
      const url = new URL("https://app.mochi.cards/api/cards");
      if (bookmark) url.searchParams.set("bookmark", bookmark);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${btoa(this.mochiApiKey + ":")}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mochi API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as MochiApiResponse;
      if (!data || !data.docs || data.docs.length === 0) {
        break;
      }

      // Filter cards that have the 'logseq' tag
      const logseqCards = data.docs.filter((card) =>
        card["manual-tags"]?.includes("logseq"),
      );

      mochiCards.push(...logseqCards);
      bookmark = data.bookmark || null;
    } while (bookmark);
    console.log(`Received ${mochiCards.length} cards tagged #logseq`);

    return mochiCards;
  }

  /**
   * Fetches all decks from Mochi API
   *
   * @returns Array of Mochi decks
   * @throws Error if API key is not configured or API request fails
   */
  private async fetchDecks(): Promise<MochiDeck[]> {
    const decks: MochiDeck[] = [];
    let bookmark: string | null = null;

    do {
      const url = new URL("https://app.mochi.cards/api/decks");
      if (bookmark) url.searchParams.set("bookmark", bookmark);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${btoa(this.mochiApiKey + ":")}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mochi API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (!data.docs || data.docs.length === 0) break;

      decks.push(...data.docs);
      bookmark = data.bookmark || null;
    } while (bookmark);

    return decks;
  }
  
  /**
   * Fetches all templates from Mochi API
   * 
   * @returns Array of Mochi templates
   * @throws Error if API key is not configured or API request fails
   */
  private async fetchTemplates(): Promise<MochiTemplate[]> {
    const templates: MochiTemplate[] = [];
    let bookmark: string | null = null;

    do {
      const url = new URL("https://app.mochi.cards/api/templates");
      if (bookmark) url.searchParams.set("bookmark", bookmark);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${btoa(this.mochiApiKey + ":")}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mochi API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (!data.docs || data.docs.length === 0) break;

      templates.push(...data.docs);
      bookmark = data.bookmark || null;
    } while (bookmark);

    return templates;
  }
  /**
   * Creates a deck with the specified name
   *
   * @param name - The name of the deck to create
   * @returns The ID of the created deck
   * @throws Error if API key is not configured or API request fails
   */
  private async createDeck(name: string): Promise<string> {
    const response = await fetch("https://app.mochi.cards/api/decks", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(this.mochiApiKey + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create deck: ${errorText}`);
    }

    const newDeck = await response.json();
    return newDeck.id;
  }

  /**
   * Creates a new card in Mochi
   *
   * @param card - The card to create
   * @param deckMap - Map of deck names to deck IDs
   * @returns The ID of the created card
   * @throws Error if API key is not configured or API request fails
   */
  private async createMochiCard(
    card: Card,
    deckMap: Map<string, string>,
  ): Promise<string> {
    // Resolve deck ID from pre-built map
    let deckId: string | undefined;

    if (card.deckname && deckMap.has(card.deckname)) {
      deckId = deckMap.get(card.deckname);
    } else {
      if (deckMap.has(this.defaultDeckName)) {
        deckId = deckMap.get(this.defaultDeckName);
      }
    }

    if (!deckId) {
      throw new Error("No valid deck ID found for card");
    }

    // Prepare tags (always include 'logseq' tag)
    const tags = [...(card.tags || []), "logseq"];

    // Prepare request body with optional template and fields
    const body: any = {
      content: card.content,
      "deck-id": deckId,
      "manual-tags": tags,
    };

    // Add template ID if present
    if (card.templateId) {
      body["template-id"] = card.templateId;
    }

    // Add fields if present
    if (card.fields) {
      body.fields = card.fields;
    }

    const response = await fetch("https://app.mochi.cards/api/cards", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(this.mochiApiKey + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create card (${response.status}): ${errorText}`,
      );
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Updates an existing card in Mochi
   *
   * @param id - The ID of the card to update
   * @param card - The updated card data
   * @param deckMap - Map of deck names to deck IDs
   * @throws Error if API key is not configured or API request fails
   */
  private async updateMochiCard(
    id: string,
    card: Card,
    deckMap: Map<string, string>,
  ): Promise<void> {
    // Resolve deck ID from pre-built map
    let deckId: string | undefined;
    if (card.deckname && deckMap.has(card.deckname)) {
      deckId = deckMap.get(card.deckname);
    } else {
      if (deckMap.has(this.defaultDeckName)) {
        deckId = deckMap.get(this.defaultDeckName);
      }
    }

    if (!deckId) {
      throw new Error("No valid deck ID found for card update");
    }

    // Prepare tags (always include 'logseq' tag)
    const tags = [...(card.tags || []), "logseq"];

    // Prepare request body with optional template and fields
    const body: any = {
      content: card.content,
      "deck-id": deckId,
      "manual-tags": tags,
    };

    // Add template ID if present
    if (card.templateId) {
      body["template-id"] = card.templateId;
    }

    // Add fields if present
    if (card.fields) {
      body.fields = card.fields;
    }

    const response = await fetch(`https://app.mochi.cards/api/cards/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(this.mochiApiKey + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update card (${response.status}): ${errorText}`,
      );
    }
  }

  /**
   * Deletes a card from Mochi
   *
   * @param id - The ID of the card to delete
   * @throws Error if API key is not configured or API request fails
   */
  private async deleteMochiCard(id: string): Promise<void> {
    const response = await fetch(`https://app.mochi.cards/api/cards/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${btoa(this.mochiApiKey + ":")}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to delete card (${response.status}): ${errorText}`,
      );
    }
  }

  /**
   * Fetches all card blocks from Logseq
   *
   * @returns Array of block entities with #card tag
   */
  private async fetchLogseqCardBlocks(): Promise<BlockEntity[]> {
    const result = await logseq.DB.datascriptQuery(`
      [:find (pull ?b [*])
      :where [?t :block/name "card"] [?b :block/refs ?t]]
      `);
    return result.map(([block]) => block);
  }

  /**
   * Manages decks by creating any missing ones
   *
   * @param logseqCards - Array of Logseq card blocks
   * @returns Map of deck names to deck IDs
   */
  private async manageDecks(
    logseqCards: BlockEntity[],
  ): Promise<Map<string, string>> {
    // Get existing decks
    const existingDecks = await this.fetchDecks();
    const deckMap = new Map<string, string>(
      existingDecks.map((d) => [d.name, d.id]),
    );

    // Collect all required deck names
    const deckNames = new Set<string>();

    // Process cards to collect deck names from properties
    for (const block of logseqCards) {
      const card = await this.buildCard(block);
      if (card.deckname) {
        deckNames.add(card.deckname);
      } else {
        deckNames.add(this.defaultDeckName);
      }
    }

    // Create missing decks
    for (const name of deckNames) {
      if (!deckMap.has(name)) {
        try {
          const newId = await this.createDeck(name);
          deckMap.set(name, newId);
        } catch (error) {
          console.error(`Failed to create deck ${name}:`, error);
        }
      }
    }

    return deckMap;
  }

  /**
   * Synchronizes cards between Logseq and Mochi
   *
   * @param mochiCards - Array of cards from Mochi
   * @param logseqCards - Array of card blocks from Logseq
   * @param deckMap - Map of deck names to deck IDs
   * @returns Object with counts of created, updated, and deleted cards
   */
  private async syncCards(
    mochiCards: MochiCard[],
    logseqCards: BlockEntity[],
    deckMap: Map<string, string>,
  ): Promise<{ created: number; updated: number; deleted: number }> {
    let deleted = 0;

    // Delete cards with no corresponding logseq block
    if (this.syncDeletedCards) {
      deleted = await this.deleteOrphanedCards(mochiCards, logseqCards);
    }

    // Create new cards and update existing ones
    const { created, updated } = await this.processLogseqCards(
      mochiCards,
      logseqCards,
      deckMap,
    );

    return { created, updated, deleted };
  }

  /**
   * Deletes cards in Mochi that don't exist in Logseq
   *
   * @param mochiCards - Array of cards from Mochi
   * @param logseqCards - Array of card blocks from Logseq
   * @returns Number of deleted cards
   */
  private async deleteOrphanedCards(
    mochiCards: MochiCard[],
    logseqCards: BlockEntity[],
  ): Promise<number> {
    let orphanedCards = 0;

    // Get all mochi IDs from Logseq blocks
    const logseqMochiIds = new Set(
      logseqCards
        .map((block) => block.properties?.["mochi-id"])
        .filter((id): id is string => Boolean(id)),
    );

    // Find cards in Mochi that don't exist in Logseq
    const orphans = mochiCards.filter(
      (mochiCard) => !logseqMochiIds.has(mochiCard.id),
    );

    // Delete orphaned cards
    for (const card of orphans) {
      try {
        await this.deleteMochiCard(card.id);
        orphanedCards++;
      } catch (error) {
        console.error(`Failed to delete card ${card.id}:`, error);
      }
    }

    return orphanedCards;
  }

  /**
   * Processes Logseq cards to create new ones or update existing ones in Mochi
   *
   * @param mochiCards - Array of cards from Mochi
   * @param logseqCards - Array of card blocks from Logseq
   * @param deckMap - Map of deck names to deck IDs
   * @returns Object with counts of created and updated cards
   */
  private async processLogseqCards(
    mochiCards: MochiCard[],
    logseqCards: BlockEntity[],
    deckMap: Map<string, string>,
  ): Promise<{ created: number; updated: number }> {
    let createdCards = 0;
    let updatedCards = 0;

    // Create map of Mochi card IDs to their data
    const mochiCardMap = new Map<string, MochiCard>();
    mochiCards.forEach((card) => mochiCardMap.set(card.id, card));

    // Process each Logseq card block
    for (const block of logseqCards) {
      const mochiId = block.properties?.["mochi-id"];

      try {
        // Expand block with children content
        const expandedBlock = await logseq.Editor.getBlock(block.id, {
          includeChildren: true,
        });
        if (!expandedBlock) continue;

        // Build card content and properties
        const card = await this.buildCard(expandedBlock);

        // Create new card if it doesn't exist in Mochi
        if (!mochiId || !mochiCardMap.has(mochiId)) {
          // Create card in Mochi and get new ID
          const newId = await this.createMochiCard(card, deckMap);

          // Upload any attachments
          if (card.attachments && card.attachments.length > 0) {
            await this.uploadAttachments(newId, card.attachments);
          }

          // Update mochi-id property
          await logseq.Editor.upsertBlockProperty(
            block.uuid,
            "mochi-id",
            newId,
          );

          createdCards++;
        } else {
          // Update existing card if needed
          const existingMochiCard = mochiCardMap.get(mochiId)!;

          if (this.cardNeedsUpdate(card, existingMochiCard, deckMap)) {
            await this.updateMochiCard(mochiId, card, deckMap);

            // Upload any attachments
            if (card.attachments && card.attachments.length > 0) {
              await this.uploadAttachments(mochiId, card.attachments);
            }

            updatedCards++;
          }
        }
      } catch (error) {
        console.error(`Failed to process card for block ${block.uuid}:`, error);
      }
    }

    return { created: createdCards, updated: updatedCards };
  }

  /**
   * Syncs cards from Logseq to Mochi
   */
  async sync(): Promise<void> {
    logseq.UI.showMsg("Syncing with Mochi...", "info", {
      key: SYNC_MSG_KEY,
      timeout: 100000,
    });

    try {
      // Show sync starting message
      // Phase 1: Initial Data Collection
      console.log("Phase 1: Collecting card data from mochi and logseq");
      const [mochiCards, logseqCards, templates] = await Promise.all([
        this.fetchMochiCards(),
        this.fetchLogseqCardBlocks(),
        this.fetchTemplates(),
      ]);
      
      // Create template map for quick lookup
      this.templateMap = new Map(templates.map(t => [t.name, t]));
      console.log(`Loaded ${templates.length} templates from Mochi`);

      // Phase 2: Deck Management
      console.log("Phase 2: Managing decks");
      const deckMap = await this.manageDecks(logseqCards);

      // Phase 3: Card Synchronization
      console.log("Phase 3: Synchronizing cards");
      const { created, updated, deleted } = await this.syncCards(
        mochiCards,
        logseqCards,
        deckMap,
      );
      // Show success message
      logseq.UI.showMsg(
        `Sync complete: ${created} created, ${updated} updated, ${deleted} deleted`,
        "success",
      );
    } catch (error) {
      console.error("Sync error:", error);
      logseq.UI.showMsg(`Sync failed: ${error.message}`, "error");
    }

    logseq.UI.closeMsg(SYNC_MSG_KEY);
  }
}
