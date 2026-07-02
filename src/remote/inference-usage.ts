import type { StackConfig } from "../config.js"
import {
  readRemoteUsageSnapshot,
  type RemoteStackAuxBudget,
  type RemoteStackInferenceBudget,
  type RemoteUsageBreakdownRow,
} from "./usage.js"

export type RemoteInferenceUsageSnapshot = {
  status: "ready" | "missing-auth" | "offline"
  environmentName: string
  apiBaseUrl: string
  checkedAt: string
  message?: string
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
  const inferenceType = usage.usageBreakdown?.byType.find((row) => row.label.toLowerCase() === "inference")
  return {
    status: usage.status,
    environmentName: usage.environmentName,
    apiBaseUrl: usage.apiBaseUrl,
    checkedAt: usage.checkedAt,
    message: usage.message,
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
    topActors: usage.usageBreakdown?.byActor ?? [],
  }
}
