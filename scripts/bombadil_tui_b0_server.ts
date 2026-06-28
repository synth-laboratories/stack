import { writeFile } from "node:fs/promises"
import {
  findTuiCrashArtifacts,
  formatTuiCrashArtifactHit,
  primaryCrashFailureClass,
} from "./tui_crash_guard.ts"

const port = Number.parseInt(process.env.STACK_BOMBADIL_PORT ?? "8988", 10)
const proofPath = process.env.STACK_BOMBADIL_PROOF ?? "/tmp/stack-bombadil-b0-proof.json"

type ScenarioName = "scroll" | "focus" | "crash_cleanup"

const scenarios: Record<
  ScenarioName,
  { expectScript: string; passMarker: string; failMarker: string }
> = {
  scroll: {
    expectScript: "scripts/smoke_tui_scroll.expect",
    passMarker: "stack_tui_scroll_smoke_ok",
    failMarker: "stack_tui_scroll_smoke_failed",
  },
  focus: {
    expectScript: "scripts/smoke_tui_focus.expect",
    passMarker: "stack_tui_focus_smoke_ok",
    failMarker: "stack_tui_focus_smoke_failed",
  },
  crash_cleanup: {
    expectScript: "scripts/smoke_tui_crash_cleanup.expect",
    passMarker: "stack_tui_crash_cleanup_smoke_ok",
    failMarker: "stack_tui_crash_cleanup_smoke_failed",
  },
}

let active: Promise<Response> | undefined

const server = Bun.serve({
  port,
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/") return htmlResponse()
    if (url.pathname === "/health") return Response.json({ ok: true })
    if (url.pathname === "/run" && request.method === "POST") {
      active ??= runAllScenarios().finally(() => {
        active = undefined
      })
      return await active
    }
    return new Response("not found", { status: 404 })
  },
})

console.log(`stack_bombadil_b0_server http://127.0.0.1:${server.port}`)

function htmlResponse(): Response {
  return new Response(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Stack TUI B0 Bombadil Probe</title>
  </head>
  <body>
    <main>
      <h1>Stack TUI B0 Bombadil Probe</h1>
      <p id="status">STACK_B0_PENDING</p>
      <pre id="details"></pre>
    </main>
    <script>
      function keepBackInOrigin() {
        const probeUrl = location.pathname + location.search + "#probe";
        history.replaceState({ probe: true }, "", location.pathname + location.search);
        history.pushState({ probe: true }, "", probeUrl);
        window.addEventListener("popstate", () => {
          history.pushState({ probe: true }, "", probeUrl);
        });
      }
      async function run() {
        const status = document.getElementById("status");
        const details = document.getElementById("details");
        status.textContent = "STACK_B0_RUNNING";
        try {
          const response = await fetch("/run", { method: "POST" });
          const payload = await response.json();
          details.textContent = JSON.stringify(payload, null, 2);
          if (!payload.ok) {
            status.textContent = payload.failedScenario ?? "STACK_B0_FAIL";
            return;
          }
          status.textContent = "STACK_B0_ALL_PASS";
        } catch (error) {
          status.textContent = "STACK_B0_FAIL";
          details.textContent = String(error && error.message ? error.message : error);
        }
      }
      keepBackInOrigin();
      run();
    </script>
  </body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

async function runAllScenarios(): Promise<Response> {
  const results: Array<Record<string, unknown>> = []
  const statusMarkers: Record<ScenarioName, string> = {
    scroll: "STACK_B0_SCROLL_PASS",
    focus: "STACK_B0_FOCUS_PASS",
    crash_cleanup: "STACK_B0_CRASH_CLEANUP_PASS",
  }

  for (const [name, config] of Object.entries(scenarios) as Array<[ScenarioName, (typeof scenarios)[ScenarioName]]>) {
    const result = await runExpectScenario(name, config)
    results.push(result)
    if (!result.ok) {
      const crashArtifacts = Array.isArray(result.crashArtifacts)
        ? (result.crashArtifacts as Array<{ id?: string }>)
        : []
      const payload = {
        ok: false,
        failedScenario: statusMarkers[name].replace("_PASS", "_FAIL"),
        scenario: name,
        failureClass:
          crashArtifacts.length > 0
            ? primaryCrashFailureClass(
                findTuiCrashArtifacts(
                  `${String(result.stdoutTail ?? "")}\n${String(result.stderrTail ?? "")}\n${JSON.stringify(crashArtifacts)}`,
                ),
              )
            : "scenario_fail",
        crashArtifacts,
        results,
      }
      await writeFile(proofPath, JSON.stringify(payload, null, 2))
      return Response.json(payload, { status: 500 })
    }
  }

  const payload = {
    ok: true,
    message: "stack_bombadil_b0_ok",
    scenarios: results,
  }
  await writeFile(proofPath, JSON.stringify(payload, null, 2))
  return Response.json(payload)
}

async function runExpectScenario(
  name: ScenarioName,
  config: (typeof scenarios)[ScenarioName],
): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(["expect", config.expectScript], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const combined = `${stdout}\n${stderr}`
  const crashArtifacts = findTuiCrashArtifacts(combined)
  const markerOk = exitCode === 0 && combined.includes(config.passMarker)
  const ok = markerOk && crashArtifacts.length === 0
  return {
    name,
    ok,
    exitCode,
    passMarker: config.passMarker,
    message: ok
      ? config.passMarker
      : crashArtifacts.length > 0
        ? `stack_tui_crash_artifact:${crashArtifacts[0]?.id ?? "unknown"}`
        : config.failMarker,
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
    crashArtifacts: crashArtifacts.map((artifact) => ({
      id: artifact.id,
      label: artifact.label,
    })),
    tuiCrash: crashArtifacts.some((artifact) => artifact.id === "opentui_buffer"),
    mouseLeak: crashArtifacts.some((artifact) => artifact.id === "mouse_sgr_leak"),
    memoryCrash: crashArtifacts.some((artifact) =>
      ["oom", "native_allocator", "core_dump", "heap_corruption"].includes(artifact.id),
    ),
    processCrash: crashArtifacts.some((artifact) =>
      ["segfault", "abort_trap", "bun_crash", "stack_fatal"].includes(artifact.id),
    ),
  }
}

function tail(value: string): string {
  return value.split("\n").slice(-30).join("\n")
}
