export interface PropertyPair {
  key: string;
  value: string;
}

export interface Card {
  content: string;
  properties: Record<string, string>;
  deckId?: string;
  tags?: string[];
  mochiId?: string;
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
