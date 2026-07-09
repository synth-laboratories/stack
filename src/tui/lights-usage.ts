import type { RemoteUsageSnapshot } from "../remote/usage.js"

export function lightsUsageEconomicsHeaderParts(usage: RemoteUsageSnapshot): string[] {
  const parts: string[] = []
  if (usage.blocked) parts.push("blocked")
  if (usage.resetBank) parts.push(`${usage.resetBank.availableCount} resets`)
  return parts
}

export function lightsUsageEconomicsLines(usage: RemoteUsageSnapshot, columns: number): string[] {
  const lines: string[] = []
  const blocker = blockerLine(usage, columns)
  if (blocker) lines.push(blocker)
  const nextAction = nextActionLine(usage, columns)
  if (nextAction) lines.push(nextAction)
  const resetBank = resetBankLine(usage, columns)
  if (resetBank) lines.push(resetBank)
  const activePromos = promotionLine("promo active", usage.activePromotions, columns)
  if (activePromos) lines.push(activePromos)
  const claimablePromos = promotionLine("promo claimable", usage.claimablePromotions, columns)
  if (claimablePromos) lines.push(claimablePromos)
  lines.push(...allowanceLines(usage, columns))
  if (usage.message) lines.push(`  ${oneLine(usage.message, Math.max(20, columns - 4))}`)
  return lines
}

function blockerLine(usage: RemoteUsageSnapshot, columns: number): string | undefined {
  if (!usage.blocked) return undefined
  const blocker = usage.blockedMessage ?? usage.blockedReason ?? "usage blocked"
  return `  blocked ${oneLine(blocker, Math.max(16, columns - 12))}`
}

function nextActionLine(usage: RemoteUsageSnapshot, columns: number): string | undefined {
  const action = usage.nextActions?.[0]
  if (!action) return undefined
  const suffix = action.requiresAdmin ? " · admin" : ""
  return `  next ${oneLine(`${action.label}${suffix}`, Math.max(16, columns - 9))}`
}

function resetBankLine(usage: RemoteUsageSnapshot, columns: number): string | undefined {
  const bank = usage.resetBank
  if (!bank) return undefined
  const parts = [`${bank.availableCount} banked`]
  if (bank.expiringCount > 0) parts.push(`${bank.expiringCount} expiring`)
  const grant = bank.grants.find((item) => item.status === "available" && item.reasonLabel)
  if (grant?.reasonLabel) parts.push(grant.reasonLabel)
  return `  resets ${oneLine(parts.join(" · "), Math.max(16, columns - 11))}`
}

function promotionLine(
  label: string,
  promotions: string[] | undefined,
  columns: number,
): string | undefined {
  if (!promotions || promotions.length === 0) return undefined
  return `  ${label} ${oneLine(promotions.slice(0, 2).join(", "), Math.max(16, columns - label.length - 3))}`
}

function allowanceLines(usage: RemoteUsageSnapshot, columns: number): string[] {
  const lines: string[] = []
  for (const modelClass of ["premium", "value"]) {
    const windows = usage.allowanceWindows.filter((item) => item.modelClass === modelClass)
    if (windows.length === 0) continue
    const label = modelClass === "premium" ? "prem" : "value"
    const summary = windows
      .slice(0, 2)
      .map((item) => {
        const windowKind = item.windowKind === "five_hour" ? "5h" : item.windowKind
        const state = item.state && item.state !== "active" ? ` ${item.state}` : ""
        const promo = item.promoCampaignId ? " promo" : ""
        return `${windowKind}${state}${promo} ${formatUsd(item.remainingUsd)}/${formatUsd(item.capUsd)}`
      })
      .join(" · ")
    lines.push(`  ${label} ${oneLine(summary, Math.max(16, columns - label.length - 3))}`)
  }
  return lines
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 10 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "")}`
}

function oneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}
