export type ParsedCriterion = {
  done: boolean
  label: string
  raw: string
}

export function parseCriterionEntry(criterion: string): ParsedCriterion {
  const trimmed = criterion.trim()
  const doneMatch = trimmed.match(/^\[(x|X)\]\s*(.*)$/)
  if (doneMatch) {
    return { done: true, label: (doneMatch[2] ?? "").trim(), raw: criterion }
  }
  const todoMatch = trimmed.match(/^\[ \]\s*(.*)$/)
  if (todoMatch) {
    return { done: false, label: (todoMatch[1] ?? "").trim(), raw: criterion }
  }
  return { done: false, label: trimmed, raw: criterion }
}

export function formatCriterionEntry(done: boolean, label: string): string {
  const normalized = label.trim()
  if (!normalized) return done ? "[x]" : "[ ]"
  return `${done ? "[x]" : "[ ]"} ${normalized}`
}

export function toggleCriterionAt(criteria: readonly string[], index: number): string[] {
  if (index < 0 || index >= criteria.length) return [...criteria]
  return criteria.map((entry, entryIndex) => {
    if (entryIndex !== index) return entry
    const parsed = parseCriterionEntry(entry)
    return formatCriterionEntry(!parsed.done, parsed.label)
  })
}

export function addCriterionEntry(criteria: readonly string[], text: string): string[] {
  const normalized = text.trim()
  if (!normalized) return [...criteria]
  return [...criteria, formatCriterionEntry(false, normalized)]
}

export function removeCriterionAt(criteria: readonly string[], index: number): string[] {
  if (index < 0 || index >= criteria.length) return [...criteria]
  return criteria.filter((_, entryIndex) => entryIndex !== index)
}

export function formatCriteriaListFeedback(criteria: readonly string[]): string {
  if (criteria.length === 0) {
    return ["acceptance criteria", "(none)", "next: /goal criteria add <text>"].join("\n")
  }
  const lines = ["acceptance criteria"]
  for (const [index, entry] of criteria.entries()) {
    const parsed = parseCriterionEntry(entry)
    const marker = parsed.done ? "[x]" : "[ ]"
    lines.push(`${index + 1}. ${marker} ${parsed.label}`)
  }
  lines.push("next: /goal criteria add · toggle · remove")
  return lines.join("\n")
}

export function parseCriteriaIndexArg(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const index = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(index) || index < 1) return undefined
  return index - 1
}

export function applyCriteriaMutation(
  criteria: readonly string[],
  mutation: { kind: "add"; text: string } | { kind: "toggle"; index: number } | { kind: "remove"; index: number } | { kind: "clear" },
): string[] {
  switch (mutation.kind) {
    case "add":
      return addCriterionEntry(criteria, mutation.text)
    case "toggle":
      return toggleCriterionAt(criteria, mutation.index)
    case "remove":
      return removeCriterionAt(criteria, mutation.index)
    case "clear":
      return []
  }
}

export function formatCriteriaMutationFeedback(
  action: "add" | "toggle" | "remove" | "clear",
  criteria: readonly string[],
): string {
  if (action === "clear") return "criteria cleared"
  return [
    action === "add" ? "criterion added" : action === "toggle" ? "criterion toggled" : "criterion removed",
    formatCriteriaListFeedback(criteria),
  ].join("\n")
}
