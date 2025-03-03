import "@logseq/libs";
import { Mldoc } from "mldoc"; // For parsing org-mode
import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user";
import {
  CARDTAG_REGEX,
  CLOZE_REGEX,
  PROPERTY_REGEX,
  SYNC_MSG_KEY,
} from "./constants";
import {
  Card,
  MldocOptions,
  MochiApiResponse,
  MochiCard,
  MochiDeck,
  PropertyPair,
} from "./types";

// TODO:
// During sync, we should maybe try to add attachments.
// This will likely be quite annoying to do properly, since it will involve:
// 1. Identifying media to attach
// 2. Ensuring that that media is <5MiB in size
// 3. Creating the card with placeholder content, since we can't predict the uploaded content URI
// 4. Uploading the media as an attachment
// 5. Updating the card with the real attachment URL
// 6. Somehow reconciling content differences, in order to avoid updates on every sync.
// I think this is actually not possible, since the mochi API provides no way of knowing whether the media has changed since uploading.

/**
 * Extracts markdown content and properties from a block
 *
 * @param block - The block to process
 * @returns A tuple of [content, properties]
 */
async function getMarkdownWithProperties(
  block: BlockEntity,
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

  return [result.trim(), propertyPairs];
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
  level: number = 0,
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
    }),
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

async function getPageProperties(
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
  const pageProperties = await getPageProperties(block.id);

  // Add page properties if enabled in settings
  if (logseq.settings?.includePageProperties) {
    for (const { key, value } of pageProperties) {
      properties[key] = value;
    }
  }

  // Add ancestor blocks if enabled in settings
  const ancestors = await getAncestors(block);
  const ancestorContents = await Promise.all(
    ancestors.filter((a) => a.content).map((a) => getMarkdownWithProperties(a)),
  );

  for (const [content, props] of ancestorContents) {
    for (const { key, value } of props) {
      properties[key] = value;
    }
    if (logseq.settings?.includeAncestorBlocks) {
      if (content.trim().length > 0) cardChunks.push(content);
    }
  }

  // Add the main block content
  const [content, props] = await getMarkdownWithProperties(block);
  cardChunks.push(content);
  for (const { key, value } of props) {
    properties[key] = value;
  }

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
      const childContent = await renderWithDescendants(childBlock, 0);
      cardChunks.push(childContent);
    }
  }

  // Extract Mochi-specific properties
  const deckname = properties["mochi-deck"] || undefined;
  const tags = properties["tags"]
    ? properties["tags"].split(",").map((t) => t.trim())
    : undefined;
  const mochiId = block.properties?.["mochi-id"];

  return {
    content: cardChunks.join("\n\n"),
    properties,
    deckname,
    tags,
    mochiId,
  };
}

/**
 * Main class for syncing Logseq cards with Mochi
 */
export class MochiSync {
  /**
   * Fetches all cards from Mochi API that have the 'logseq' tag
   *
   * @returns Array of Mochi cards
   * @throws Error if API key is not configured or API request fails
   */
  private async fetchMochiCards(): Promise<MochiCard[]> {
    const apiKey = logseq.settings?.mochiApiKey;
    if (!apiKey) throw new Error("Mochi API key not configured");

    const mochiCards: MochiCard[] = [];
    let bookmark: string | null = null;

    do {
      const url = new URL("https://app.mochi.cards/api/cards");
      if (bookmark) url.searchParams.set("bookmark", bookmark);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${btoa(apiKey + ":")}`,
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
    const apiKey = logseq.settings?.mochiApiKey;
    if (!apiKey) throw new Error("Mochi API key not configured");

    const decks: MochiDeck[] = [];
    let bookmark: string | null = null;

    do {
      const url = new URL("https://app.mochi.cards/api/decks");
      if (bookmark) url.searchParams.set("bookmark", bookmark);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${btoa(apiKey + ":")}`,
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
   * Creates a deck with the specified name
   *
   * @param name - The name of the deck to create
   * @returns The ID of the created deck
   * @throws Error if API key is not configured or API request fails
   */
  private async createDeck(name: string): Promise<string> {
    const apiKey = logseq.settings?.mochiApiKey;
    if (!apiKey) throw new Error("Mochi API key not configured");

    const response = await fetch("https://app.mochi.cards/api/decks", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(apiKey + ":")}`,
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
    const apiKey = logseq.settings?.mochiApiKey;
    if (!apiKey) throw new Error("Mochi API key not configured");

    // Resolve deck ID from pre-built map
    let deckId: string | undefined;

    if (card.deckname && deckMap.has(card.deckname)) {
      deckId = deckMap.get(card.deckname);
    } else {
      const defaultDeckname: string | undefined =
        logseq.settings?.["Default Deck"];
      if (defaultDeckname && deckMap.has(defaultDeckname)) {
        deckId = deckMap.get(defaultDeckname);
      }
    }

    if (!deckId) {
      throw new Error("No valid deck ID found for card");
    }

    // Prepare tags (always include 'logseq' tag)
    const tags = [...(card.tags || []), "logseq"];

    const response = await fetch("https://app.mochi.cards/api/cards", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(apiKey + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: card.content,
        "deck-id": deckId,
        "manual-tags": tags,
      }),
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
    const apiKey = logseq.settings?.mochiApiKey;
    if (!apiKey) throw new Error("Mochi API key not configured");

    // Resolve deck ID from pre-built map
    let deckId: string | undefined;
    if (card.deckname && deckMap.has(card.deckname)) {
      deckId = deckMap.get(card.deckname);
    } else {
      const defaultDeckname: string | undefined =
        logseq.settings?.["Default Deck"];
      if (defaultDeckname && deckMap.has(defaultDeckname)) {
        deckId = deckMap.get(defaultDeckname);
      }
    }

    if (!deckId) {
      throw new Error("No valid deck ID found for card update");
    }

    // Prepare tags (always include 'logseq' tag)
    const tags = [...(card.tags || []), "logseq"];

    const response = await fetch(`https://app.mochi.cards/api/cards/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(apiKey + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: card.content,
        "deck-id": deckId, // Include deck-id in the update
        "manual-tags": tags,
      }),
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
    const apiKey = logseq.settings?.mochiApiKey;
    if (!apiKey) throw new Error("Mochi API key not configured");

    const response = await fetch(`https://app.mochi.cards/api/cards/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${btoa(apiKey + ":")}`,
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
   * Syncs cards from Logseq to Mochi
   */
  async sync(): Promise<void> {
    // Check for API key
    if (!logseq.settings?.mochiApiKey) {
      logseq.UI.showMsg(
        "Mochi API key not configured. Please add it in plugin settings.",
        "error",
      );
      return;
    }

    try {
      // Show sync starting message
      await logseq.UI.showMsg("Syncing with Mochi...", "info", {
        key: SYNC_MSG_KEY,
        timeout: 100000,
      });

      // Fetch cards from Mochi, and find all blocks with #card tag
      const [mochiCards, cardBlocks] = await Promise.all([
        this.fetchMochiCards(),
        logseq.DB.datascriptQuery(`
          [:find (pull ?b [*])
           :where [?t :block/name "card"] [?b :block/refs ?t]]
        `),
      ]);

      // Phase 1: Get existing decks
      const existingDecks = await this.fetchDecks();
      const deckMap = new Map<string, string>(
        existingDecks.map((d) => [d.name, d.id]),
      );

      // Phase 2: Collect all required deck names
      const deckNames = new Set<string>();
      const defaultDeckname: string | undefined =
        logseq.settings?.["Default Deck"];
      if (defaultDeckname) deckNames.add(defaultDeckname);

      // Process cards to collect deck names from properties
      for (const [block] of cardBlocks) {
        const expandedBlock = await logseq.Editor.getBlock(block.id, {
          includeChildren: true,
        });
        if (!expandedBlock) continue;

        const card = await buildCard(expandedBlock);
        if (card.deckname) {
          deckNames.add(card.deckname);
        }
      }

      // Phase 3: Create missing decks
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

      // Phase 4: Delete cards with no corresponding logseq block
      let orphanedCards = 0;
      if (logseq.settings?.syncDeletedCards) {
        // Get all mochi IDs from Logseq blocks
        const logseqMochiIds = new Set(
          cardBlocks
            .map(([block]) => block.properties?.["mochi-id"])
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
      }

      // Phase 5: Create/Recreate cards that need to exist in Mochi
      let createdCards = 0;
      const mochiCardIds = new Set(mochiCards.map((card) => card.id));

      for (const [block] of cardBlocks) {
        const existingMochiId = block.properties?.["mochi-id"];

        // Skip blocks where ID exists in both systems (handled in Phase 6)
        if (existingMochiId && mochiCardIds.has(existingMochiId)) continue;

        try {
          // Expand block with children content
          const expandedBlock = await logseq.Editor.getBlock(block.id, {
            includeChildren: true,
          });
          if (!expandedBlock) continue;

          // Build card content and properties
          const card = await buildCard(expandedBlock);

          // Create card in Mochi and get new ID
          const newId = await this.createMochiCard(card, deckMap);

          // Update mochi-id property regardless of previous value
          await logseq.Editor.upsertBlockProperty(
            block.uuid,
            "mochi-id",
            newId,
          );

          createdCards++;
        } catch (error) {
          console.error(
            `Failed to create card for block ${block.uuid}:`,
            error,
          );
        }
      }

      // Phase 6: Update existing cards that need changes
      let updatedCards = 0;

      // Re-fetch card blocks to get latest mochi-ids after Phase 5
      const updatedCardBlocks = await logseq.DB.datascriptQuery(`
        [:find (pull ?b [*])
         :where [?t :block/name "card"] [?b :block/refs ?t]]
      `);

      // Create map of Mochi card IDs to their data
      const mochiCardMap = new Map<string, MochiCard>();
      mochiCards.forEach((card) => mochiCardMap.set(card.id, card));

      // Process each updated card block
      for (const [block] of updatedCardBlocks) {
        const mochiId = block.properties?.["mochi-id"];
        if (!mochiId || !mochiCardMap.has(mochiId)) continue;

        try {
          // Get current card state from Logseq
          const expandedBlock = await logseq.Editor.getBlock(block.id, {
            includeChildren: true,
          });
          if (!expandedBlock) continue;

          const currentCard = await buildCard(expandedBlock);
          const existingMochiCard = mochiCardMap.get(mochiId)!;

          // Resolve intended deck ID from current configuration
          let intendedDeckId: string | undefined;
          if (currentCard.deckname) {
            intendedDeckId = deckMap.get(currentCard.deckname);
          } else {
            const defaultDeck = logseq.settings?.["Default Deck"];
            intendedDeckId = defaultDeck ? deckMap.get(defaultDeck) : undefined;
          }

          // Compare content, deck, and tags
          const contentChanged =
            currentCard.content !== existingMochiCard.content;
          const deckChanged = intendedDeckId !== existingMochiCard["deck-id"];

          // Check tags (include 'logseq' in comparison)
          const expectedTags = [...(currentCard.tags || []), "logseq"];
          const actualTags = existingMochiCard["manual-tags"] || [];
          const tagsChanged =
            expectedTags.length !== actualTags.length ||
            !expectedTags.every((tag) => actualTags.includes(tag));

          if (contentChanged || deckChanged || tagsChanged) {
            await this.updateMochiCard(mochiId, currentCard, deckMap);
            updatedCards++;
          }
        } catch (error) {
          console.error(`Failed to update card ${mochiId}:`, error);
        }
      }

      logseq.UI.closeMsg(SYNC_MSG_KEY);
      // Show success message
      logseq.UI.showMsg(
        `Sync complete: ${createdCards} created, ${updatedCards} updated, ${orphanedCards} deleted`,
        "success",
      );

      console.log(
        `Sync complete: ${createdCards} created, ${updatedCards} updated, ${orphanedCards} deleted`,
      );
    } catch (error) {
      console.error("Sync error:", error);
      logseq.UI.showMsg(`Sync failed: ${error.message}`, "error");
    }
  }
}
