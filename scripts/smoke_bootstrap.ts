#!/usr/bin/env bun

import { join } from "node:path"
import { loadConfig } from "../src/config.ts"
import {
  shouldAutoStartDevSlot,
  shouldAutoStartLocalOptimizer,
} from "../src/local/bootstrap.ts"
import { emptyLocalBootstrapSnapshot } from "../src/local/dev-stack.ts"

if (shouldAutoStartLocalOptimizer({ environmentName: "dev" } as never) !== true) {
  console.error("expected auto-start local optimizer on dev")
  process.exit(1)
}

process.env.STACK_AUTO_START_LOCAL_OPTIMIZER = "0"
if (shouldAutoStartLocalOptimizer({ environmentName: "dev" } as never) !== false) {
  console.error("expected local optimizer auto-start disabled via env")
  process.exit(1)
}

delete process.env.STACK_AUTO_START_LOCAL_OPTIMIZER
if (shouldAutoStartDevSlot({ environmentName: "dev" } as never) !== true) {
  console.error("expected auto-start dev slot on dev")
  process.exit(1)
}

process.env.STACK_AUTO_START_DEV_SLOT = "0"
if (shouldAutoStartDevSlot({ environmentName: "dev" } as never) !== false) {
  console.error("expected dev slot auto-start disabled via env")
  process.exit(1)
}

process.env.STACK_AUTO_START = "0"
if (
  shouldAutoStartDevSlot({ environmentName: "dev" } as never) !== false ||
  shouldAutoStartLocalOptimizer({ environmentName: "dev" } as never) !== false
) {
  console.error("expected master STACK_AUTO_START=0 disables all")
  process.exit(1)
}

if (shouldAutoStartDevSlot({ environmentName: "staging" } as never) !== false) {
  console.error("expected dev slot auto-start off on staging")
  process.exit(1)
}

const stackRoot = join(import.meta.dir, "..")
const config = await loadConfig(stackRoot)
const empty = emptyLocalBootstrapSnapshot(config)
if (empty.devSlotInstance !== "slot1") {
  console.error("expected default slot1 instance")
  process.exit(1)
}

console.log("stack_bootstrap_smoke_ok")
