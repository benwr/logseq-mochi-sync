# Logseq → Mochi Sync

 One-way synchronization of flashcards from Logseq to Mochi

 ## Features

 - Syncs Logseq blocks tagged `#card` to Mochi
 - Converts Logseq clozes (`{{cloze}}`) to Mochi format
 - Supports`mochi-deck` property to specify a custom deck (or fall back to default deck)
 - Optionally:
   - Include page titles in cards
   - Include ancestor block context
   - Delete orphaned Mochi cards

 ## Installation (Manual)

 ⚠️ Not yet available in Logseq Marketplace. Install manually:
 1. Clone repo
 2. `pnpm install && pnpm build`
 3. Load plugin in Logseq via "Load unpacked plugin"
