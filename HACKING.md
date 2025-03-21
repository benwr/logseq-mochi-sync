# The basic algorithm

## Card construction

First, we find all LogSeq blocks that reference `card`. Each of these blocks is
going to correspond to a single Mochi card.

Next, we examine the Logseq properties that apply to this card.

The most important one is `mochi-id`. If `mochi-id` is present, it means that an
earlier sync has already uploaded this card to Mochi, and it was given this id.
Thus we need to perform an *update* rather than a *creation*.

For other properties (`mochi-deck`, `mochi-template`, `mochi-tags`,
`mochi-field-*`, `mochi-include-page-title`, `mochi-include-ancestors`), their
values "cascade" from plugin settings when relevant, to page properties, to
ancestor properties, to card properties, with later values superseding earlier
values.

Properties are embedded in the block content, and so need to be extracted. We
start by converting the content to Markdown if necessary (using the same library
used by Logseq to parse org mode). Then we use a simple regex to find the
properties.

When converting a card's content from Logseq format into Mochi format, there are
several steps:

1. Bring the included content together (this includes the block itself, as well
as its descendants, and might include the page title and/or ancestors).
2. Remove `#card` tag and `[[card]]` references; these aren't relevant to the
actual content.
3. Replace `{{cloze ...}}` with `{{...}}`
4. Find media references and convert them to content-hash-based references.

Once we've constructed all of our cards, it's time to actually do the sync.

## Sync

Once we have the cards constructed, it's time to sync. First we grab the card
list from Mochi, filtered by the `#logseq` tag (all cards we create are tagged
with #logseq in mochi). We also get the list of decks and create a map from deck
name to deck ID, and do the same for templates.

For each local card, we:

1. Check to see if it has a mochi id. If it does, check for an upstream card. If
there is no upstream card of no mochi id, create the card.
2. If the card has an upstream counterpart, look at the content, tags, deck, and
attachments of the upstream card. If they match the local card, we don't need to
do anything. If they don't match, we need to update the remote card.

Creating or updating a card will typically involve:
1. Calling the relevant method
2. Uploading any attachments that aren't yet uploaded (which you can tell by
examining the filename, which will be different if the content is different).


For each remote card, if there is no local card with the corresponding ID, we should delete it.

We compare the content of the cards in this list,
against the constructed cards. If a card that is in both Logseq and Mochi has
differing content, we update it in Mochi. If a card that is in Logseq is not in
Mochi, we create it newly. If a card that is in Mochi is not in Logseq, we
delete it in Mochi.
