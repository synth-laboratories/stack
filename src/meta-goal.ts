/**
 * A meta goal is a short, human-memorable label derived from a thread's goal
 * objective — e.g. "migrate the billing service to the new schema, backfill
 * historical rows, then prove parity against the old read path" → "Migrate
 * Billing Service Schema". Purely derived (no LLM call, no persistence): recomputed from
 * the objective text whenever it's needed.
 */

export type MetaGoal = {
  objective: string
  name: string
}

const META_GOAL_STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "in", "on", "at", "by", "with", "and", "or",
  "but", "to", "that", "this", "these", "those", "is", "are", "was", "were",
  "be", "been", "being", "get", "gets", "getting", "got", "find", "finding",
  "found", "then", "until", "we", "i", "you", "your", "our", "it", "its",
  "one", "so", "from", "into", "onto", "as", "what's", "that's", "lets",
  "let's",
])

function stripPunctuation(word: string): string {
  return word.replace(/^[^\w]+|[^\w]+$/g, "")
}

function capitalizeFirst(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
}

export function deriveMetaGoalName(objective: string, maxWords = 5): string {
  const words = objective
    .trim()
    .split(/\s+/)
    .map(stripPunctuation)
    .filter(Boolean)
  const meaningful = words.filter((word) => !META_GOAL_STOPWORDS.has(word.toLowerCase()))
  const picked = (meaningful.length >= 2 ? meaningful : words).slice(0, maxWords)
  return picked.map(capitalizeFirst).join(" ")
}

export function deriveMetaGoal(objective: string): MetaGoal | undefined {
  const trimmed = objective.trim()
  if (!trimmed) return undefined
  return { objective: trimmed, name: deriveMetaGoalName(trimmed) }
}
