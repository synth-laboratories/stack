import type { StackConfig } from "./config.js"
import { readRemoteInferenceCatalog, type RemoteInferenceCatalogSnapshot } from "./remote/inference.js"

export async function runInferenceCli(config: StackConfig, argv: string[]): Promise<number> {
  const [, action] = argv
  if (action !== "list" && action !== "status") {
    console.error("usage: stack inference list [--json]")
    return 2
  }

  const snapshot = await readRemoteInferenceCatalog(config)
  if (argv.includes("--json")) {
    console.log(JSON.stringify(snapshot, null, 2))
  } else {
    printInferenceCatalog(snapshot)
  }

  return snapshot.status === "offline" ? 1 : 0
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
