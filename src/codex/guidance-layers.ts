import { homedir } from "node:os"
import { join, resolve } from "node:path"

export type StackStyleLayer = "org" | "repo" | "personal" | "app"

export function personalGuidanceRoot(): string {
  const configured = process.env.STACK_PERSONAL_GUIDANCE_DIR?.trim()
  return resolve(configured && configured.length > 0 ? configured : join(homedir(), ".stack", "guidance"))
}

export function repoStyleDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".stack", "guidance", "style", "repo")
}

export function workspaceStyleFile(workspaceRoot: string): string {
  return join(workspaceRoot, "STYLE.md")
}

export function jstackRoots(workspaceRoot: string): string[] {
  return [
    join(workspaceRoot, "Jstack", ".jstack"),
    join(workspaceRoot, ".jstack"),
  ]
}

export function orgStyleDirs(workspaceRoot: string): string[] {
  return [
    join(workspaceRoot, ".stack", "guidance", "style", "org"),
    ...jstackRoots(workspaceRoot).flatMap((root) => [
      join(root, "style"),
      join(root, "anger", "standards"),
      join(root, "tanha", "standards"),
    ]),
  ]
}

export function orgSynthStyleFiles(workspaceRoot: string): string[] {
  return [
    join(workspaceRoot, "backend", "specifications", "tanha", "references", "synthstyle.md"),
    join(workspaceRoot, "specifications", "old", "tanha", "references", "synthstyle.md"),
  ]
}
