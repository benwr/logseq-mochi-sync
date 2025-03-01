import { Mldoc } from "mldoc"; // For parsing org-mode
import { Card } from "./Card";
import { CARDTAG_REGEX, PROPERTY_REGEX } from "./constants";
import { path } from "@logseq/libs/dist/helpers";

function formatContent(content) {
  // remove #card tag
  // fix syntax for mochi:
  //  1. Template fields
  //  2. Conditional rendering
  //  3. Various XML-ish tags (input, draw, furigana, pinyin)
  //  4. Cloze syntax including deletion groups
  //  5. Attachment references
}

async function getMarkdownWithProperties(
  block: any,
): Promise<[string, [string, string][]]> {
  let result: string;
  if (block.format !== "org") {
    result = block.content;
  } else {
    const options = {
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

    let doc = Mldoc.parse(block.content, options);

    let markdownContent: string[] = [];
    const markdownExporter = Mldoc.Exporters.find("markdown");
    markdownExporter.export({ refs: null }, options, doc, {
      write: (chunk: string) => markdownContent.push(chunk),
      end: () => {},
    });
    result = markdownContent.join("");
  }
  let propertyPairs: [string, string][] = [];
  for (const match of result.matchAll(PROPERTY_REGEX)) {
    propertyPairs.push([match[1], match[2]]);
  }
  result = result.replace(CARDTAG_REGEX, "");
  result = result.replace(PROPERTY_REGEX, "");

  return [result, propertyPairs];
}

async function getAncestors(block: any): Promise<any[]> {
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

  const parent = result[0][0];
  const ancestors = await getAncestors(parent);
  return [...ancestors, parent];
}

async function renderWithDescendants(
  block: any,
  level: number = 0,
): Promise<string> {
  const [content, _] = await getMarkdownWithProperties(block);
  const currentBlockContent =
    level === 0 ? content + "\n" : "  ".repeat(level - 1) + "- " + content;
  if (!block.children || block.children.length === 0) {
    return currentBlockContent;
  }
  const childrenContent = await Promise.all(
    block.children.map((child: any) => renderWithDescendants(child, level + 1)),
  );
  return [currentBlockContent, ...childrenContent].join("\n");
}

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

async function buildCard(block: any) {
  let cardChunks: string[] = [];
  let properties = {};

  if (logseq.settings?.includePageTitle) {
    const pageTitle = await getPageTitle(block.id);
    if (pageTitle) cardChunks.push(pageTitle);
  }

  if (logseq.settings?.includeAncestorBlocks) {
    const ancestors = await Promise.all(
      (await getAncestors(block))
        .filter((a) => a.content)
        .map((a) => getMarkdownWithProperties(a)),
    );
    for (let ancestor of ancestors) {
      cardChunks.push(ancestor[0]);
      for (const [key, value] of ancestor[1]) {
        properties[key] = value;
      }
    }
  }

  const [content, props] = await getMarkdownWithProperties(block);
  cardChunks.push(content);
  for (const [key, value] of props) {
    properties[key] = value;
  }

  if (block.children?.length > 0) {
    for (let child of block.children) {
      cardChunks.push("---");
      let content = await renderWithDescendants(child, 0);
      cardChunks.push(content);
    }
  }
  console.log(cardChunks.join("\n\n"));
  console.log(properties);
}

export class MochiSync {
  async sync(): Promise<void> {
    // Implementation of sync logic
    let graphName = (await logseq.App.getCurrentGraph())?.name || "Default";
    let cards: Card[] = [];
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

    for (const [block] of cardBlocks) {
      let expandedBlock = await logseq.Editor.getBlock(block.id, {
        includeChildren: true,
      });
      cards.push(await buildCard(expandedBlock));
    }
  }
}
