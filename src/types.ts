export interface PropertyPair {
  key: string;
  value: string;
}

export interface MediaAttachment {
  hash: string;
  originalPath: string;
  filename: string;
  contentType: string;
  content: Blob;
}

export interface Card {
  content: string;
  properties: Record<string, string>;
  deckname?: string;
  tags?: string[];
  mochiId?: string;
  attachments?: MediaAttachment[];
  templateId?: string;
  fields?: Record<string, { id: string; value: string }>;
}

export interface MochiDeck {
  id: string;
  name: string;
  "parent-id"?: string;
  sort?: number;
}

export interface MldocOptions {
  toc: boolean;
  heading_number: boolean;
  keep_line_break: boolean;
  format: string;
  heading_to_list: boolean;
  exporting_keep_properties: boolean;
  inline_type_with_pos: boolean;
  parse_outline_only: boolean;
  export_md_remove_options: any[];
  hiccup_in_block: boolean;
}

export interface MldocExporter {
  export: (
    refs: any,
    options: MldocOptions,
    doc: any,
    writer: {
      write: (chunk: string) => void;
      end: () => void;
    },
  ) => void;
}

/**
 * Interface for Mochi API card responses
 */
export interface MochiCard {
  id: string;
  content: string;
  attachments?: { string: { size: string; type: string } };
  "deck-id": string;
  "manual-tags"?: string[];
  "trashed?"?: string;
  "archived?"?: boolean;
  "template-id"?: string;
  fields?: Record<string, { id: string; value: string }>;
}

/**
 * Interface for Mochi API response with pagination
 */
export interface MochiApiResponse {
  docs: MochiCard[];
  bookmark?: string;
}

/**
 * Interface for Mochi template
 */
export interface MochiTemplate {
  id: string;
  name: string;
  content?: string;
  pos?: string;
  fields: {
    [fieldId: string]: {
      id: string;
      name: string;
      pos?: string;
      options?: Record<string, boolean>;
    };
  };
}
