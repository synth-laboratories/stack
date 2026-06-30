import { homedir } from "node:os"
import { join, resolve } from "node:path"

export function defaultStackGlobalDir(): string {
  const fromEnv = process.env.STACK_GLOBAL_DIR?.trim()
  if (fromEnv) return resolve(fromEnv)
  return join(homedir(), ".stack")
}

export function stackGlobalSkillsRoot(): string {
  return join(defaultStackGlobalDir(), "skills")
}
