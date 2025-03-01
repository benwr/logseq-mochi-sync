/**
 * Represents a flashcard to be synced with Mochi
 */
export interface Card {
  content: string;
  properties: Record<string, string>;
  // Add more fields as needed for Mochi API integration
}
