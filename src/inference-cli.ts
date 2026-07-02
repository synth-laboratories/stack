import type { StackConfig } from "./config.js"
import { readRemoteInferenceCatalog, type RemoteInferenceCatalogSnapshot } from "./remote/inference.js"
import { readRemoteInferenceUsage, type RemoteInferenceUsageSnapshot } from "./remote/inference-usage.js"

export async function runInferenceCli(config: StackConfig, argv: string[]): Promise<number> {
  const [, action] = argv
  if (action !== "list" && action !== "status" && action !== "usage") {
    console.error("usage: stack inference <list|usage> [--json]")
    return 2
  }

  if (action === "usage") {
    const usage = await readRemoteInferenceUsage(config)
    if (argv.includes("--json")) {
      console.log(JSON.stringify(usage, null, 2))
    } else {
      printInferenceUsage(usage)
    }
    return usage.status === "offline" ? 1 : 0
  }

  const snapshot = await readRemoteInferenceCatalog(config)
  if (argv.includes("--json")) {
    console.log(JSON.stringify(snapshot, null, 2))
  } else {
    printInferenceCatalog(snapshot)
  }

  return snapshot.status === "offline" ? 1 : 0
}

function printInferenceUsage(snapshot: RemoteInferenceUsageSnapshot): void {
  console.log(`Stack inference usage - ${snapshot.environmentName} - ${snapshot.status}`)
  console.log("worker: Codex/BYOK by default; Synth inference requires explicit profile opt-in")
  if (snapshot.message) console.log(`status: ${snapshot.message}`)
  if (snapshot.status === "missing-auth") {
    console.log("connect: stack auth open signin")
    return
  }
  if (snapshot.status === "offline") return

  if (snapshot.inference7dUsd !== undefined) {
    console.log(`inference 7d: ${formatUsd(snapshot.inference7dUsd)}`)
  }
  const spend: string[] = []
  if (snapshot.spendTodayUsd !== undefined) spend.push(`today ${formatUsd(snapshot.spendTodayUsd)}`)
  if (snapshot.spend7dUsd !== undefined) spend.push(`7d charged ${formatUsd(snapshot.spend7dUsd)}`)
  if (snapshot.spend30dUsd !== undefined) spend.push(`30d charged ${formatUsd(snapshot.spend30dUsd)}`)
  if (spend.length > 0) console.log(`account spend: ${spend.join(" | ")}`)

  const aux = snapshot.stackAuxBudget
  if (aux) {
    console.log(
      `free aux ${aux.model ?? "aux"}: global ${formatUsd(aux.synthWide.remainingUsd)} / ${formatUsd(aux.synthWide.capUsd)} left; org today ${formatUsd(aux.orgDaily.remainingUsd)} / ${formatUsd(aux.orgDaily.capUsd)} left`,
    )
  }

  if (snapshot.topProjects.length > 0) {
    console.log("top projects:")
    for (const row of snapshot.topProjects.slice(0, 3)) {
      console.log(`  ${row.label}: ${formatUsd(row.costUsd)}`)
    }
  }
  if (snapshot.topActors.length > 0) {
    console.log("top actors:")
    for (const row of snapshot.topActors.slice(0, 3)) {
      console.log(`  ${row.label}: ${formatUsd(row.costUsd)}`)
    }
  }
}

function printInferenceCatalog(snapshot: RemoteInferenceCatalogSnapshot): void {
  console.log(`Stack inference - ${snapshot.environmentName} - ${snapshot.status}`)
  console.log("worker: Codex/BYOK by default; Synth inference requires explicit profile opt-in")
  if (snapshot.message) console.log(`status: ${snapshot.message}`)
  if (snapshot.status === "missing-auth") {
    console.log("connect: stack auth open signin")
  }
  for (const model of snapshot.models) {
    const status = model.availability === "available" ? "available" : model.availability.replace("_", "-")
    const aliases = model.aliases.length > 0 ? ` aliases=${model.aliases.join(",")}` : ""
    console.log(`${model.id} - ${model.billingTier} - ${status}`)
    console.log(`  ${model.displayName}; route=${model.route}; roles=${model.actorRoles.join(",")}${aliases}`)
    if (model.blockedActorRoles.some((role) => ["worker", "primary", "codex", "cursor"].includes(role))) {
      console.log("  primary worker is blocked on this lane")
    } else if (model.workerOptInRequired) {
      console.log("  worker requires explicit Synth inference profile; default worker remains Codex/BYOK")
    }
  }
  if (snapshot.errors.length > 0) {
    console.log("catalog errors:")
    for (const error of snapshot.errors) console.log(`  ${error}`)
  }
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00"
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}
