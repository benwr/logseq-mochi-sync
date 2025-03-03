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
  if (typeof logseq.settings?.mochiApiKey !== "string") {
    logseq.UI.showMsg("Mochi API key is not set", "error");
    return;
  }
  if (typeof logseq.settings?.defaultDeckName !== "string") {
    logseq.UI.showMsg("Default deck name is not set", "error");
    return;
  }
  if (typeof logseq.settings?.syncDeletedCards !== "boolean") {
    logseq.UI.showMsg("Sync deleted cards is not set", "error");
    return;
  }
  if (typeof logseq.settings?.includeAncestorBlocks !== "boolean") {
    logseq.UI.showMsg("Include ancestor blocks is not set", "error");
    return;
  }
  if (typeof logseq.settings?.includePageTitle !== "boolean") {
    logseq.UI.showMsg("Include page title is not set", "error");
    return;
  }
  if (typeof logseq.settings?.includePageProperties !== "boolean") {
    logseq.UI.showMsg("Include page properties is not set", "error");
    return;
  }
  await new MochiSync(
    logseq.settings?.mochiApiKey,
    logseq.settings?.defaultDeckName,
    logseq.settings?.syncDeletedCards,
    logseq.settings?.includeAncestorBlocks,
    logseq.settings?.includePageTitle,
    logseq.settings?.includePageProperties,
  ).sync();
};

/**
 * Main plugin initialization function
 *
 * @param baseInfo - Plugin base information
 */
function main(baseInfo: LSPluginBaseInfo): void {
  // Add CSS to hide mochi-id property in UI
  logseq.provideStyle(`
    div:has(> div > a.page-property-key[data-ref="mochi-id"]) {
      display: none;
    }
    div:has(> div:only-child > div > a.page-property-key[data-ref="mochi-id"]) {
      display: none;
    }
  `);

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
      key: "includePageProperties",
      type: "boolean",
      default: true,
      title: "Include Page Properties",
      description: "Card properties inherit from page properties.",
    },
    {
      key: "includeAncestorBlocks",
      type: "boolean",
      default: true,
      title: "Include Ancestors",
      description: "Include ancestor blocks in the card.",
    },
    {
      key: "defaultDeckName",
      type: "string",
      default: "",
      title: "Default Deck Name",
      description:
        "Name of default Mochi deck (will be created if it doesn't exist)",
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
