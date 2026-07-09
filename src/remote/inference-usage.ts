import type { StackConfig } from "../config.js"
import {
  readRemoteUsageSnapshot,
  type RemoteBillingAllowanceWindow,
  type RemoteBillingNextAction,
  type RemoteBillingResetBank,
  type RemoteStackAuxBudget,
  type RemoteStackInferenceBudget,
  type RemoteUsageBreakdownRow,
  type RemoteUsageSnapshot,
} from "./usage.js"

export type RemoteInferenceUsageSnapshot = {
  status: "ready" | "missing-auth" | "offline"
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  schemaVersion?: string
  message?: string
  planTier?: string
  planDisplayName?: string
  billingMode?: string
  walletUsd?: number
  walletExpiresAt?: string
  resetBank?: RemoteBillingResetBank
  activePromotions?: string[]
  claimablePromotions?: string[]
  blocked?: boolean
  blockedReason?: string
  blockedMessage?: string
  nextActions?: RemoteBillingNextAction[]
  allowanceWindows: RemoteBillingAllowanceWindow[]
  localOnlySupported: boolean
  workerDefault: "codex_byok"
  workerSynthInference: string
  workerSynthInferenceEligible?: boolean
  workerSynthInferenceMessage?: string
  stackAuxBudget?: RemoteStackAuxBudget
  stackInferenceBudget?: RemoteStackInferenceBudget
  inference7dUsd?: number
  spendTodayUsd?: number
  spend7dUsd?: number
  spend30dUsd?: number
  topProjects: RemoteUsageBreakdownRow[]
  topActors: RemoteUsageBreakdownRow[]
}

export async function readRemoteInferenceUsage(config: StackConfig): Promise<RemoteInferenceUsageSnapshot> {
  const usage = await readRemoteUsageSnapshot(config)
  return remoteInferenceUsageFromRemoteUsageSnapshot(usage)
}

export function remoteInferenceUsageFromRemoteUsageSnapshot(
  usage: RemoteUsageSnapshot,
): RemoteInferenceUsageSnapshot {
  const inferenceType = usage.usageBreakdown?.byType.find((row) => row.label.toLowerCase() === "inference")
  return {
    status: usage.status,
    environmentName: usage.environmentName,
    apiBaseUrl: usage.apiBaseUrl,
    checkedAt: usage.checkedAt,
    schemaVersion: usage.schemaVersion,
    message: usage.message,
    planTier: usage.planTier,
    planDisplayName: usage.planDisplayName,
    billingMode: usage.billingMode,
    walletUsd: usage.walletUsd,
    walletExpiresAt: usage.walletExpiresAt,
    resetBank: usage.resetBank,
    activePromotions: usage.activePromotions,
    claimablePromotions: usage.claimablePromotions,
    blocked: usage.blocked,
    blockedReason: usage.blockedReason,
    blockedMessage: usage.blockedMessage,
    nextActions: usage.nextActions,
    allowanceWindows: usage.allowanceWindows,
    localOnlySupported: true,
    workerDefault: "codex_byok",
    workerSynthInference: usage.workerSynthInference ?? "explicit_profile_only",
    workerSynthInferenceEligible: usage.workerSynthInferenceEligible,
    workerSynthInferenceMessage: usage.workerSynthInferenceMessage,
    stackAuxBudget: usage.stackAuxBudget,
    stackInferenceBudget: usage.stackInferenceBudget,
    inference7dUsd: usage.stackInferenceBudget?.spend7d.spentUsd ?? inferenceType?.costUsd ?? usage.usage7dUsd,
    spendTodayUsd: usage.spendTodayUsd,
    spend7dUsd: usage.spend7dUsd,
    spend30dUsd: usage.spend30dUsd,
    topProjects: usage.usageBreakdown?.byProject ?? [],
    topActors: usage.stackInferenceBudget?.spend7d.byActor ?? usage.usageBreakdown?.byActor ?? [],
  }
}
