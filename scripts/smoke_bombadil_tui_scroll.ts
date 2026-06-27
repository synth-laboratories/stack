import { readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"

const port = Number.parseInt(process.env.STACK_BOMBADIL_PORT ?? "8987", 10)
const proofPath = process.env.STACK_BOMBADIL_PROOF ?? "/tmp/stack-bombadil-tui-scroll-proof.json"
const outputPath = process.env.STACK_BOMBADIL_OUTPUT ?? "/tmp/stack-bombadil-tui-scroll"
const bombadilBin =
  process.env.STACK_BOMBADIL_BIN ??
  resolve(process.cwd(), "../synth-managed-research/tests/property/bombadil")

await rm(proofPath, { force: true })

const server = Bun.spawn(["bun", "run", "scripts/bombadil_tui_scroll_server.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    STACK_BOMBADIL_PORT: String(port),
    STACK_BOMBADIL_PROOF: proofPath,
  },
  stdout: "ignore",
  stderr: "ignore",
})

let bombadil: ReturnType<typeof Bun.spawn> | undefined
let bombadilExitCode: number | undefined

try {
  await waitForHealth(port)

  bombadil = Bun.spawn(
    [
      bombadilBin,
      "test",
      `http://127.0.0.1:${port}`,
      "scripts/bombadil_tui_scroll.ts",
      "--headless",
      "--exit-on-violation",
      "--output-path",
      outputPath,
    ],
    {
      cwd: process.cwd(),
      stdout: "ignore",
      stderr: "ignore",
    },
  )
  void bombadil.exited.then((code) => {
    bombadilExitCode = code
  })

  const proof = await waitForPassingProof()
  await sleep(2500)
  if (bombadilExitCode !== undefined && bombadilExitCode !== 0) {
    throw new Error(`Bombadil exited before stable pass: ${bombadilExitCode}`)
  }

  console.log(`stack_bombadil_tui_scroll_ok ${proof.message}`)
} finally {
  await stopChildren(bombadil, server)
}

async function waitForHealth(serverPort: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/health`)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await sleep(250)
  }
  throw new Error(`Bombadil bridge did not become healthy on port ${serverPort}`)
}

async function waitForPassingProof(): Promise<{ message: string }> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (bombadilExitCode !== undefined && bombadilExitCode !== 0) {
      throw new Error(`Bombadil exited before proof: ${bombadilExitCode}`)
    }

    const proof = await readProof()
    if (proof?.ok) return { message: proof.message ?? "ok" }
    if (proof && !proof.ok) {
      throw new Error(`Bombadil bridge proof failed: ${proof.message ?? "unknown"}`)
    }
    await sleep(500)
  }
  throw new Error("Timed out waiting for Bombadil bridge proof")
}

async function readProof(): Promise<{ ok: boolean; message?: string } | undefined> {
  try {
    const raw = await readFile(proofPath, "utf8")
    const parsed = JSON.parse(raw) as { ok?: unknown; message?: unknown }
    if (typeof parsed.ok !== "boolean") return undefined
    return {
      ok: parsed.ok,
      message: typeof parsed.message === "string" ? parsed.message : undefined,
    }
  } catch {
    return undefined
  }
}

async function stopChildren(...children: Array<ReturnType<typeof Bun.spawn> | undefined>): Promise<void> {
  const running = children.filter((child): child is ReturnType<typeof Bun.spawn> => Boolean(child))
  for (const child of running) {
    try {
      child.kill("SIGINT")
    } catch {
      // The child may already have exited after the passing proof landed.
    }
  }
  await Promise.race([Promise.all(running.map((child) => child.exited.catch(() => 0))), sleep(3000)])
  for (const child of running) {
    try {
      child.kill("SIGKILL")
    } catch {
      // Best-effort cleanup after the graceful stop window.
    }
  }
  await Promise.race([Promise.all(running.map((child) => child.exited.catch(() => 0))), sleep(1000)])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
