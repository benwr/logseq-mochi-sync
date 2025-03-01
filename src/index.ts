import "@logseq/libs";
import { LSPluginBaseInfo } from "@logseq/libs/dist/LSPlugin";
import { MochiSync } from "./MochiSync";
import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { MOCHI_LOGO } from "./constants";

const syncWithMochi = async function () {
  console.log("Syncing");
  await new MochiSync().sync();
};

function main(baseInfo: LSPluginBaseInfo) {
  logseq.provideModel({
    syncWithMochi: syncWithMochi,
  });
  logseq.App.registerCommandPalette(
    {
      key: `logseq-mochi-sync-${baseInfo.id}`,
      label: `Sync to Mochi`,
      keybinding: { mode: "global", binding: "" },
    },
    syncWithMochi,
  );

  logseq.App.registerUIItem("toolbar", {
    key: baseInfo.id,
    template: `
      <a title="Mochi Sync" class="button relative" data-on-click="syncWithMochi" class="button">
        <span class="ui__icon ti" style="font-size: 18px;">${MOCHI_LOGO}</span>
      </a>
    `,
  });

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
      default: "Logseq",
      title: "Default Deck",
      description: "The default deck name to use for the card.",
    },
  ];
  logseq.useSettingsSchema(settingsTemplate);
}

logseq.ready(main).catch(console.error);
