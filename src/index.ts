import "@logseq/libs";
import { LSPluginBaseInfo } from "@logseq/libs/dist/LSPlugin";
import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { MochiSync } from "./MochiSync";
import { MOCHI_LOGO } from "./constants";

/**
 * Syncs cards from Logseq to Mochi
 */
const syncWithMochi = async (): Promise<void> => {
  console.log("Starting Mochi sync...");
  await new MochiSync().sync();
};

/**
 * Main plugin initialization function
 * 
 * @param baseInfo - Plugin base information
 */
function main(baseInfo: LSPluginBaseInfo): void {
  // Register model for UI interaction
  logseq.provideModel({
    syncWithMochi,
  });
  
  // Register command palette entry
  logseq.App.registerCommandPalette(
    {
      key: `logseq-mochi-sync-${baseInfo.id}`,
      label: `Sync to Mochi`,
      keybinding: { mode: "global", binding: "" },
    },
    syncWithMochi,
  );

  // Register toolbar button
  logseq.App.registerUIItem("toolbar", {
    key: baseInfo.id,
    template: `
      <a title="Mochi Sync" class="button relative" data-on-click="syncWithMochi">
        <span class="ui__icon ti" style="font-size: 18px;">${MOCHI_LOGO}</span>
      </a>
    `,
  });

  // Define plugin settings
  const settingsTemplate: SettingSchemaDesc[] = [
    {
      key: "mochiApiKey",
      type: "string",
      default: "",
      title: "API Key",
      description: "Enter your Mochi API key here.",
    },
    {
      key: "includePageTitle",
      type: "boolean",
      default: true,
      title: "Include Page Title",
      description: "Include page title in the card.",
    },
    {
      key: "includeAncestorBlocks",
      type: "boolean",
      default: true,
      title: "Include Ancestors",
      description: "Include ancestor blocks in the card.",
    },
    {
      key: "deckSelection",
      type: "enum",
      default: "Default Deck",
      title: "Deck Selection",
      description: "How to select which deck to use for the card.",
      enumChoices: [
        "Default Deck",
        "Page Namespace (or default if none)",
        "Page Title",
      ],
      enumPicker: "select",
    },
    {
      key: "Default Deck",
      type: "string",
      default: "",
      title: "Default Deck Name",
      description: "Name of default Mochi deck (will be created if it doesn't exist)",
    },
    {
      key: "syncDeletedCards",
      type: "boolean",
      default: true,
      title: "Delete Orphaned Cards",
      description: "Delete cards from Mochi that no longer exist in Logseq.",
    },
  ];
  
  // Register settings schema
  logseq.useSettingsSchema(settingsTemplate);
}

// Initialize plugin
logseq.ready(main).catch(console.error);
