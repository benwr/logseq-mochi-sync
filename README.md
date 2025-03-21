# Logseq → Mochi Sync

 One-way synchronization of flashcards from Logseq to Mochi

 ![](./logseq_thermodynamics.png)

 ↓

 ![](./mochi_thermodynamics.png)

 ## Features

 - Syncs Logseq blocks tagged `#card` to Mochi
 - Converts Logseq clozes (`{{cloze}}`) to Mochi format
 - Supports`mochi-deck` and `mochi-template` properties, for specifyng a custom
 deck or template (or falls back to a default deck)
 - Supports media attachments (with a 5MB limit imposed by Mochi)
 - Multi-sided cards (just add extra children to the card block)
 - Optionally:
   - Include page titles in cards
   - Include ancestor block context
   - Delete orphaned Mochi cards

## Property Handling & Configuration

Logseq Mochi Sync uses [Logseq
Properties](https://docs.logseq.com/#/page/properties) to pass structured
information, like deck selection, tags, and template fields, to Mochi.
Properties can be defined on the card itself, or on the card's ancestors, or at
the page level.

### Property Cascade Hierarchy
Properties are merged in this order (later entries override earlier ones):
1. Page properties (if "Include Page Properties" enabled)
2. Ancestor block properties
3. Current block properties (highest priority)
4. Automatically injected `mochi-id` property (don't edit this one; it's used to
ensure that Mochi remembers the card identity and memorization state, even if
the content changes)

### Supported Special Properties

| Property            | Format             | Description                                                                 |
|---------------------|--------------------|-----------------------------------------------------------------------------|
| `mochi-deck`        | Deck name string   | Specifies which Mochi deck to use for the card                              |
| `mochi-tags`        | Comma-separated list | Sets extra tags for the card in Mochi (#tags, other than #card, also work) |
| `mochi-template`    | Template name string | Uses specified Mochi template for the card                                 |
| `mochi-field-*`     | Field values       | Populates template fields (replace * with the field name from your template) |
| `mochi-include-page-title` | true/false | Overrides the global "render page title" setting for this card                |
| `mochi-include-ancestors` | true/false | Overrides the global "render ancestors" setting for this card                  |


### Examples

**Basic usage:**
```org
- Card content
  mochi-deck:: Chemistry 101
  mochi-tags:: important, exam-material
```

**Template usage:**
```org
- What's the capital of France?
  mochi-template:: Capital City
  mochi-field-City:: Paris
  mochi-field-Population:: 2.1 million
```
