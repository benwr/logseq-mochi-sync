import "@logseq/libs";
import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user";

// TODO better errors for fields that don't match template

interface MochiApiResponse {
  docs: any[];
  bookmark?: string;
}

interface MochiCard {
  id: string;
  content: string;
  attachments?: Record<string, { size: string; type: string }>;
  "deck-id": string;
  "manual-tags"?: string[];
  "trashed?"?: string;
  "archived?"?: boolean;
  "template-id"?: string;
  fields?: Record<string, { id: string; value: string }>;
}

interface MochiDeck {
  id: string;
  name: string;
  "parent-id"?: string;
  sort?: number;
}

interface MochiTemplate {
  id: string;
  name: string;
  content?: string;
  pos?: string;
  fields: {
    [fieldId: string]: {
      id: string;
      name: string;
      pos?: string;
      options?: { string: boolean };
    };
  };
}

function setEq<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

const requestTimestamps: number[] = [];
const RATE_LIMIT = 10;
const TIME_WINDOW = 10000; // 10 seconds in milliseconds

async function fetchRateLimited(url, mochiApiKey, args) {
  // Remove timestamps older than 10 seconds
  const now = Date.now();
  while (
    requestTimestamps.length > 0 &&
    requestTimestamps[0] < now - TIME_WINDOW
  ) {
    requestTimestamps.shift();
  }

  // If at rate limit, wait until the oldest request expires
  if (requestTimestamps.length >= RATE_LIMIT) {
    const waitTime = requestTimestamps[0] + TIME_WINDOW - now;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    requestTimestamps.shift();
  }

  // Record this request and proceed
  requestTimestamps.push(Date.now());

  args.headers = {
    ...args.headers,
    Authorization: `Basic ${btoa(mochiApiKey + ":")}`,
  };
  return await fetch(url.toString(), args);
}

async function getCardBlockEntities(): Promise<BlockEntity[]> {
  // Example BlockEntity:
  // {
  //     "id": 6648,
  //     "uuid": "67baa4a9-49c3-42fc-a770-c1ccd7c220d1",
  //     "properties": {
  //         "id": "67baa4a9-49c3-42fc-a770-c1ccd7c220d1",
  //         "mochi-id": "bE4yT2pE"
  //     },
  //     "content": "P #card\nid:: 67baa4a9-49c3-42fc-a770-c1ccd7c220d1\nmochi-id:: bE4yT2pE",
  //     "parent": {"id": 6629},
  //     "page": {"id": 1624},
  //     "format": "markdown",
  //      ...
  // }
  const result = await logseq.DB.datascriptQuery(
    `[:find (pull ?b [*]) :where [?t :block/name "card"] [?b :block/refs ?t]]`,
  );
  return result.map(([block]) => block);
}

// Includes page and self
async function getAncestors(block: BlockEntity): Promise<BlockEntity[]> {
  let result: BlockEntity[] = [block];
  let parents = [];
  do {
    parents = await logseq.DB.datascriptQuery(
      `[:find (pull ?p [*]) :in $ ?b :where [?b :block/parent ?p]]`,
      result[result.length - 1].id,
    );
    if (parents && parents[0]) {
      result.push(parents[0][0]);
    }
  } while (parents.length > 0);
  result.reverse();
  return result;
}

async function renderWithAttachments(
  content: string,
): Promise<[string, Attachment[]]> {
  // Split into lines and filter out property lines
  const lines = content.split("\n");
  const keptLines: string[] = [];

  const PROPERTY_REGEX = /^\s*([A-Za-z0-9\?\-]+)::\s*(.*)/;
  const CARDTAG_REGEX = /(#card|\[\[card\]\]) */g;
  const CLOZE_REGEX = /\{\{cloze (.*?)\}\}/gm;
  const MEDIA_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

  for (const line of lines) {
    if (!PROPERTY_REGEX.exec(line)) keptLines.push(line);
  }

  content = keptLines.join("\n");

  // Remove #card tags from remaining content
  content = content.replace(CARDTAG_REGEX, "");

  // Convert Logseq cloze format to Mochi format
  content = content.replace(CLOZE_REGEX, "{{$1}}");

  // Escape double brackets: prevent Mochi from interpreting them as links
  content = content.replace(/(?<!\\)(\[\[|\]\])/g, "\\$1");

  // Process media attachments
  const mediaAttachments: Attachment[] = [];
  let modifiedContent = content;

  let match;
  const mediaRegexCopy = new RegExp(MEDIA_REGEX); // Create a new instance  to reset lastIndex
  while ((match = mediaRegexCopy.exec(content)) !== null) {
    const [fullMatch, altText, path] = match;
    try {
      // Skip URLs - only process local files
      if (path.includes("://") && !path.startsWith("file://")) {
        continue;
      }

      const assetUrl = await logseq.Assets.makeUrl(path);
      if (!assetUrl) continue;
      const attachment = await Attachment.build(assetUrl);

      mediaAttachments.push(attachment);

      // Replace the image reference with the new filename
      modifiedContent = modifiedContent.replace(
        fullMatch,
        `![${altText}](${attachment.filename})`,
      );
    } catch (error) {
      logseq.UI.showMsg(
        `Failed to process media ${path}: ${error.message}`,
        "error",
      );
    }
  }

  return [modifiedContent.trim(), mediaAttachments];
}

async function renderWithDescendants(
  block: BlockEntity,
  level: number = 0,
): Promise<string> {
  // Format current block based on level
  let currentBlockContent =
    level < 2
      ? block.content + "\n"
      : "  ".repeat(level - 2) +
        "- " +
        block.content.replace(/\n/g, "\n  ".repeat(level - 1));
  if (level === 1) {
    currentBlockContent = "\n---\n\n" + currentBlockContent;
  }

  // Return early if no children
  if (!block.children || block.children.length === 0) {
    return currentBlockContent;
  }

  // Process children recursively
  const childrenContent: string[] = await Promise.all(
    block.children.map(async (child) => {
      // If child is a UUID tuple, fetch the actual block
      const childBlock = Array.isArray(child)
        ? await logseq.Editor.getBlock(child[0])
        : child;

      if (!childBlock) return "";
      return renderWithDescendants(childBlock, level + 1);
    }),
  );

  let resultContent: string[] = [currentBlockContent];
  for (const childContent of childrenContent) {
    resultContent.push(childContent);
  }

  // Combine current block with children
  return resultContent.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function createDeck(
  mochiApiKey: string,
  name: string,
): Promise<MochiDeck> {
  const response = await fetchRateLimited(
    "https://app.mochi.cards/api/decks",
    mochiApiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to create deck: ${await response.text()}`);
  }

  return await response.json();
}

class Attachment {
  blob?: Blob;
  filename?: string;

  static async build(url: string): Promise<Attachment> {
    let result = new Attachment();
    const MOCHI_MAX_ATTACHMENT_SIZE = 5 * 1000 * 1000; // 5MB
    const assetUrl = url.replace("assets://", "file://");
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`Failed to fetch ${assetUrl}`);

    result.blob = await response.blob();

    // Skip files larger than 5MB (Mochi's limit)
    if (result.blob.size > MOCHI_MAX_ATTACHMENT_SIZE) {
      throw new Error(`File too large: ${assetUrl}`);
    }

    // Generate hash for the file content
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      await result.blob.arrayBuffer(),
    );
    const hash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
      .replace(/\+/g, "A")
      .replace(/\//g, "B")
      .replace(/=+$/, "");

    // Create a filename based on the hash and original extension
    const ext = (url.split("/").pop() || "").split(".").pop() || "";
    const newFilename = `${hash.slice(0, 12)}.${ext}`;
    result.filename = newFilename;
    return result;
  }

  async upload(mochiApiKey: string, cardId: string) {
    const url = `https://app.mochi.cards/api/cards/${cardId}/attachments/${this.filename}`;
    const check = await fetchRateLimited(url, mochiApiKey, { method: "HEAD" });

    // Only upload if attachment doesn't exist (404)
    if (this.blob && check.status === 404) {
      const form = new FormData();
      form.append("file", this.blob, this.filename);

      const response = await fetchRateLimited(url, mochiApiKey, {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logseq.UI.showMsg(`Failed to upload attachment: ${errorText}`, "error");
      }
    }
  }
}

class Card {
  uuid: string;
  deck: string;
  template: string | null;
  properties: Record<string, string>;
  content: string;
  attachments: Attachment[];

  static async collectProperties(
    block: BlockEntity,
  ): Promise<Record<string, string>> {
    let props = {};
    // Get ancestor, page, and block properties
    const ancestors = await getAncestors(block);
    for (const ancestor of ancestors) {
      let tags = props["mochi-tags"] || [];
      if (ancestor.properties?.["mochi-tags"]) {
        tags = [...tags, ...ancestor.properties["mochi-tags"]];
      }
      props = { ...props, ...ancestor.properties };
      props["mochi-tags"] = tags;
    }

    return props;
  }

  static async build(
    block: BlockEntity,
    opts: {
      defaultDeckName: string;
      includeAncestorBlocks?: boolean;
      includePageTitle?: boolean;
    },
  ): Promise<Card> {
    let card = new Card();
    const props = await Card.collectProperties(block);
    card.uuid = block.uuid;
    card.properties = props;
    card.deck = props["mochi-deck"] || opts.defaultDeckName || "Logseq";
    card.template = props["mochi-template"] || null;

    const [page, ...ancestors] = (await getAncestors(block)).slice(0, -1);

    let chunks: string[] = [];
    let includePageTitle = false;
    if (typeof card.properties["mochi-include-page-title"] === "boolean") {
      includePageTitle = card.properties["mochi-include-page-title"];
    } else if (opts.includePageTitle) {
      includePageTitle = true;
    }

    if (includePageTitle && typeof page["original-name"] === "string") {
      chunks.push(page["original-name"]);
    }

    let includeAncestorBlocks = false;
    if (typeof card.properties["mochi-include-ancestor-blocks"] === "boolean") {
      includeAncestorBlocks = card.properties["mochi-include-ancestor-blocks"];
    } else if (opts.includeAncestorBlocks) {
      includeAncestorBlocks = true;
    }

    if (includeAncestorBlocks) {
      for (const ancestor of ancestors) chunks.push(ancestor.content);
    }
    const expandedBlock = await logseq.Editor.getBlock(block.id, {
      includeChildren: true,
    });

    if (expandedBlock) chunks.push(await renderWithDescendants(expandedBlock));

    let content = chunks.join("\n\n");
    let [finalContent, attachments] = await renderWithAttachments(content);

    card.content = finalContent;
    card.attachments = attachments;

    return card;
  }

  fields(templates: Map<string, MochiTemplate>): Record<string, string> {
    // This is tricky because Logseq messes with the capitalization of property
    // names. We should normalize each field based on the template in the
    // template map, if it exists.
    let pairs = Object.keys(this.properties)
      .filter((p) => p.startsWith("mochi-field-"))
      .map((p) => [p.replace("mochi-field-", ""), this.properties[p]]);

    const myTemplate = templates.get(this.template || "");
    const templateFields = Object.keys(myTemplate?.fields || {});
    const normalizedFields = Object.fromEntries(
      templateFields.map((field) => [field.toLowerCase(), field]),
    );
    if (templateFields) {
      let newPairs: [string, string][] = [];
      for (const [key, value] of pairs) {
        if (normalizedFields[key.toLowerCase()]) {
          newPairs.push([normalizedFields[key.toLowerCase()], value]);
        } else {
          newPairs.push([key, value]);
        }
      }
      pairs = newPairs;
    }
    return Object.fromEntries(pairs);
  }

  tags(): Set<string> {
    let tags = new Set(this.properties["mochi-tags"]);
    tags.add("logseq");
    return tags;
  }

  matches(
    card: MochiCard,
    decks: Map<string, MochiDeck>,
    templates: Map<string, MochiTemplate>,
  ): boolean {
    const contentMatch = card.content === this.content;

    const attMatch = setEq(
      new Set(this.attachments.map((attachment) => attachment.filename)),
      new Set(Object.keys(card.attachments || {})),
    );

    const deckMatch = decks.get(this.deck)?.id === card["deck-id"];

    const tagMatch = setEq(this.tags(), new Set(card["manual-tags"] || []));

    const templateMatch =
      (!this.template && !card["template-id"]) ||
      templates.get(this.template || "")?.id === card["template-id"];

    let myFields = this.fields(templates);
    let fieldMatch = true;
    for (const fieldName of new Set(
      Object.keys(myFields).concat(Object.keys(card.fields || {})),
    )) {
      // Field has to exist in both cards, and the value must match.
      if (
        !card.fields ||
        !card.fields[fieldName] ||
        myFields[fieldName] !== card.fields[fieldName].value
      ) {
        fieldMatch = false;
        break;
      }
    }

    return (
      contentMatch &&
      attMatch &&
      deckMatch &&
      templateMatch &&
      fieldMatch &&
      tagMatch
    );
  }

  async sendToMochi(
    mochiApiKey: string,
    mochiUrl: string,
    mochiDecks: Map<string, MochiDeck>,
    mochiTemplates: Map<string, MochiTemplate>,
  ): Promise<Response> {
    const deckId = mochiDecks.get(this.deck)?.id;

    if (!deckId) {
      throw new Error(`No valid deck ID found for deck ${this.deck}`);
    }

    // Prepare request body with optional template and fields
    const body: any = {
      content: this.content,
      "deck-id": deckId,
      "manual-tags": Array.from(this.tags()),
    };

    // Add template ID if present
    let templateId = mochiTemplates.get(this.template || "")?.id;
    if (templateId) body["template-id"] = templateId;

    // Add fields if present
    const fields = this.fields(mochiTemplates);
    if (fields) {
      body.fields = {};
      for (const [key, value] of Object.entries(fields)) {
        body.fields[key] = { id: key, value };
      }
    }

    const response = await fetchRateLimited(mochiUrl, mochiApiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create card (${response.status}): ${await response.text()}`,
      );
    }

    return response;
  }

  async updateInMochi(
    mochiApiKey: string,
    mochiDecks: Map<string, MochiDeck>,
    mochiTemplates: Map<string, MochiTemplate>,
  ) {
    await this.sendToMochi(
      mochiApiKey,
      `https://app.mochi.cards/api/cards/${this.properties["mochi-id"]}`,
      mochiDecks,
      mochiTemplates,
    );
  }

  // Note: We assume that the deck exists in the map already.
  async uploadToMochi(
    mochiApiKey: string,
    mochiDecks: Map<string, MochiDeck>,
    mochiTemplates: Map<string, MochiTemplate>,
  ) {
    const response = await this.sendToMochi(
      mochiApiKey,
      `https://app.mochi.cards/api/cards`,
      mochiDecks,
      mochiTemplates,
    );
    let json_result = await response.json();
    const mochiId = json_result.id;
    await logseq.Editor.upsertBlockProperty(this.uuid, "mochi-id", mochiId);

    this.properties["mochi-id"] = mochiId;
  }

  async ensureUploaded(
    mochiApiKey: string,
    mochiCards: Map<string, MochiCard>,
    mochiDecks: Map<string, MochiDeck>,
    mochiTemplates: Map<string, MochiTemplate>,
  ): Promise<boolean> {
    const mochiCard = mochiCards.get(this.properties["mochi-id"]);
    let wasCreated = false;
    if (this.properties["mochi-id"] && mochiCard) {
      if (!this.matches(mochiCard, mochiDecks, mochiTemplates)) {
        await this.updateInMochi(mochiApiKey, mochiDecks, mochiTemplates);
      }
    } else {
      await this.uploadToMochi(mochiApiKey, mochiDecks, mochiTemplates);
      wasCreated = true;
    }

    let existingAttachments: Set<string> = new Set();
    if (mochiCard && mochiCard.attachments) {
      existingAttachments = new Set(Object.keys(mochiCard.attachments));
    }
    for (const att of this.attachments) {
      if (!existingAttachments.has(att.filename || "")) {
        await att.upload(mochiApiKey, this.properties["mochi-id"]);
      }
    }

    return wasCreated;
  }
}

async function fetchMochi(
  mochiApiKey: string,
  endpoint: string,
): Promise<any[]> {
  let bookmark: string | null = null;
  let result: any[] = [];
  do {
    const url = new URL(endpoint);
    if (bookmark) url.searchParams.set("bookmark", bookmark);

    const response = await fetchRateLimited(url.toString(), mochiApiKey, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mochi API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as MochiApiResponse;
    if (!data || !data.docs || data.docs.length === 0) {
      break;
    }

    result.push(...data.docs);

    bookmark = data.bookmark || null;
  } while (bookmark);
  return result;
}

async function fetchMochiCards(apiKey: string): Promise<MochiCard[]> {
  const mochiCards: MochiCard[] = await fetchMochi(
    apiKey,
    "https://app.mochi.cards/api/cards",
  );

  return mochiCards.filter((card) => card["manual-tags"]?.includes("logseq"));
}

async function fetchMochiDecks(apiKey: string): Promise<MochiDeck[]> {
  return await fetchMochi(apiKey, "https://app.mochi.cards/api/decks");
}

async function fetchMochiTemplates(apiKey: string): Promise<MochiTemplate[]> {
  return await fetchMochi(apiKey, "https://app.mochi.cards/api/templates");
}

async function fetchMochiData(apiKey: string): Promise<{
  cardMap: Map<string, MochiCard>;
  deckMap: Map<string, MochiDeck>;
  templateMap: Map<string, MochiTemplate>;
}> {
  const cards = await fetchMochiCards(apiKey);
  const cardMap = new Map<string, MochiCard>();
  cards.forEach((card) => cardMap.set(card.id, card));
  const decks = await fetchMochiDecks(apiKey);
  const deckMap = new Map<string, MochiDeck>();
  decks.forEach((deck) => deckMap.set(deck.name, deck));
  const templates = await fetchMochiTemplates(apiKey);
  const templateMap = new Map<string, MochiTemplate>();
  templates.forEach((template) => templateMap.set(template.name, template));

  return { cardMap, deckMap, templateMap };
}

async function deleteMochiCard(mochiApiKey: string, id: string): Promise<void> {
  const response = await fetchRateLimited(
    `https://app.mochi.cards/api/cards/${id}`,
    mochiApiKey,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to delete card (${response.status}): ${await response.text()}`,
    );
  }
}

export async function sync(
  mochiApiKey: string,
  defaultDeckName: string,
  includeAncestorBlocks: boolean,
  includePageTitle: boolean,
) {
  const SYNC_MSG_KEY = "syncing-with-mochi";
  logseq.UI.showMsg("Parsing Logseq cards to sync with Mochi...", "info", {
    key: SYNC_MSG_KEY,
    timeout: 100000,
  });
  try {
    const cardBlockEntities = await getCardBlockEntities();
    let cards: Card[] = [];
    let neededDecks: Set<string> = new Set();
    let knownMochiIds: Set<string> = new Set();
    for (const cbe of cardBlockEntities) {
      const card = await Card.build(cbe, {
        defaultDeckName,
        includeAncestorBlocks,
        includePageTitle,
      });
      neededDecks.add(card.deck);
      knownMochiIds.add(card.properties["mochi-id"]);
      cards.push(card);
    }
    logseq.UI.showMsg("Getting card data from Mochi...", "info", {
      key: SYNC_MSG_KEY,
      timeout: 100000,
    });
    let mochiData = await fetchMochiData(mochiApiKey);
    logseq.UI.showMsg(
      "Ensuring required decks are present in Mochi...",
      "info",
      {
        key: SYNC_MSG_KEY,
        timeout: 100000,
      },
    );
    for (const deck of neededDecks) {
      if (!mochiData.deckMap.has(deck)) {
        mochiData.deckMap.set(deck, await createDeck(mochiApiKey, deck));
      }
    }
    let processed = 0;
    let numCreated = 0;
    for (const card of cards) {
      processed += 1;
      logseq.UI.showMsg(
        `Updating card ${processed} of ${cards.length}`,
        "info",
        {
          key: SYNC_MSG_KEY,
          timeout: 100000,
        },
      );
      const created = await card.ensureUploaded(
        mochiApiKey,
        mochiData.cardMap,
        mochiData.deckMap,
        mochiData.templateMap,
      );
      if (created) {
        numCreated += 1;
      }
    }

    logseq.UI.showMsg("Deleting cards not present in Logseq", "info", {
      key: SYNC_MSG_KEY,
      timeout: 100000,
    });

    let numDeleted = 0;

    for (const mochiCard of mochiData.cardMap.keys()) {
      if (!knownMochiIds.has(mochiCard)) {
        numDeleted += 1;
        processed += 1;
        await deleteMochiCard(mochiApiKey, mochiCard);
      }
    }
    logseq.UI.showMsg(
      `Created ${numCreated} new cards, deleted ${numDeleted} cards.`,
      "info",
      {
        timeout: 10000,
      },
    );
  } catch (error) {
    console.error(error);
    logseq.UI.showMsg(`Error syncing with Mochi: ${error.message}`, "error", {
      timeout: 10000,
    });
  }
  logseq.UI.closeMsg(SYNC_MSG_KEY);
}
