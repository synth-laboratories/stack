import { spawnSync } from "node:child_process"
import type { StackConfig } from "../config.js"
import {
  ensureDevStackBootstrap,
  refreshLocalBootstrapSnapshot,
  type LocalBootstrapSnapshot,
} from "./dev-stack.js"
import { readOptimizerSnapshot, startOptimizerService, type OptimizerSnapshot } from "./optimizers.js"

export type { LocalBootstrapSnapshot } from "./dev-stack.js"
export {
  ensureDevStackBootstrap,
  isDockerAvailable,
  probeDevApiReachable,
  refreshLocalBootstrapSnapshot,
  shouldAutoStartDevSlot,
} from "./dev-stack.js"

export function isOptimizerCliAvailable(command: string): boolean {
  try {
    const result = spawnSync(command, ["--help"], { stdio: "ignore" })
    return result.status === 0 || result.error === undefined
  } catch {
    return false
  }
}

export function shouldAutoStartLocalOptimizer(config: StackConfig): boolean {
  const master = process.env.STACK_AUTO_START?.trim().toLowerCase()
  if (master === "0" || master === "false" || master === "no") return false
  const flag = process.env.STACK_AUTO_START_LOCAL_OPTIMIZER?.trim().toLowerCase()
  if (flag === "0" || flag === "false" || flag === "no") return false
  if (flag === "1" || flag === "true" || flag === "yes") return true
  return config.environmentName === "dev"
}

export async function ensureLocalOptimizerService(config: StackConfig): Promise<OptimizerSnapshot | undefined> {
  if (!shouldAutoStartLocalOptimizer(config)) return undefined
  if (!isOptimizerCliAvailable(config.optimizerCommand)) return undefined
  const current = await readOptimizerSnapshot(config)
  if (current.status === "running") return current
  return startOptimizerService(config)
}

export type LocalStackBootstrapResult = {
  bootstrap: LocalBootstrapSnapshot
  optimizer?: OptimizerSnapshot
}

export async function ensureLocalStackBootstrap(config: StackConfig): Promise<LocalStackBootstrapResult> {
  const bootstrap = await ensureDevStackBootstrap(config)
  const optimizer = await ensureLocalOptimizerService(config)
  return { bootstrap, optimizer }
}
