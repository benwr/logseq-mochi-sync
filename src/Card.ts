/**
 * Represents a flashcard to be synced with Mochi
 */
export interface Card {
  content: string;
  properties: Record<string, string>;
  deckId?: string;
  tags?: string[];
  mochiId?: string;
}
