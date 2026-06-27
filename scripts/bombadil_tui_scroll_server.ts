import { writeFile } from "node:fs/promises"

const port = Number.parseInt(process.env.STACK_BOMBADIL_PORT ?? "8987", 10)
const proofPath = process.env.STACK_BOMBADIL_PROOF ?? "/tmp/stack-bombadil-tui-scroll-proof.json"

let active: Promise<Response> | undefined

const server = Bun.serve({
  port,
  idleTimeout: 120,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/") return htmlResponse()
    if (url.pathname === "/run") {
      active ??= runScrollSmoke().finally(() => {
        active = undefined
      })
      return await active
    }
    if (url.pathname === "/health") return Response.json({ ok: true })
    return new Response("not found", { status: 404 })
  },
})

console.log(`stack_bombadil_scroll_server http://127.0.0.1:${server.port}`)

function htmlResponse(): Response {
  return new Response(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Stack TUI Scroll Bombadil Probe</title>
  </head>
  <body>
    <main>
      <h1>Stack TUI Scroll Bombadil Probe</h1>
      <p id="status">STACK_TUI_SCROLL_PENDING</p>
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
        status.textContent = "STACK_TUI_SCROLL_RUNNING";
        try {
          const response = await fetch("/run", { method: "POST" });
          const payload = await response.json();
          status.textContent = payload.ok ? "STACK_TUI_SCROLL_PASS" : "STACK_TUI_SCROLL_FAIL";
          details.textContent = JSON.stringify(payload, null, 2);
        } catch (error) {
          status.textContent = "STACK_TUI_SCROLL_FAIL";
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

async function runScrollSmoke(): Promise<Response> {
  const proc = Bun.spawn(["expect", "scripts/smoke_tui_scroll.expect"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const ok = exitCode === 0 && stdout.includes("stack_tui_scroll_smoke_ok")
  const payload = {
    ok,
    exitCode,
    message: ok ? "stack_tui_scroll_smoke_ok" : "stack_tui_scroll_smoke_failed",
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  }
  await writeFile(proofPath, JSON.stringify(payload, null, 2))
  return Response.json(payload, { status: ok ? 200 : 500 })
}

function tail(value: string): string {
  return value.split("\n").slice(-30).join("\n")
}
