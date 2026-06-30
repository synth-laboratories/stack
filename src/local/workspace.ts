import { basename, join, relative } from "node:path"

export type LocalContextFile = {
  path: string
  selected: boolean
  sizeBytes: number
}

export type WorkspaceInfo = {
  root: string
  repoName: string
  branch: string
  files: LocalContextFile[]
}

export async function detectWorkspace(startDir = process.cwd()): Promise<WorkspaceInfo> {
  const root = await git(["rev-parse", "--show-toplevel"], startDir).catch(() => startDir)
  const branch = await git(["branch", "--show-current"], root).catch(() => "unknown")
  const files = await listCandidateFiles(root)

  return {
    root,
    repoName: basename(root),
    branch: branch.trim() || "detached",
    files,
  }
}

async function listCandidateFiles(root: string): Promise<LocalContextFile[]> {
  const output = await git(["ls-files"], root).catch(() => "")
  const candidates = output
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean)
    .filter((path) => !path.startsWith(".git/"))
    .filter((path) => !path.startsWith("node_modules/"))
    .filter((path) => !path.startsWith(".stack/"))
    .filter((path) => !path.includes("/node_modules/"))
    .slice(0, 30)

  const files: LocalContextFile[] = []
  for (const path of candidates) {
    const absolutePath = join(root, path)
    const file = Bun.file(absolutePath)
    if (!(await file.exists())) continue
    files.push({
      path,
      selected: files.length === 0,
      sizeBytes: file.size,
    })
  }

  return files
}

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${relative(process.cwd(), cwd) || "."}`)
  }
  return stdout.trim()
}
