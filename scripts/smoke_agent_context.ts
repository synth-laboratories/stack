#!/usr/bin/env bun

import { homedir } from "node:os"
import { join } from "node:path"
import {
  agentContextRailText,
  discoverAgentsMdPaths,
  discoverAvailableSkills,
  emptyAgentContext,
  mergeAgentContext,
  noteUsedSkillsFromText,
  parseAgentContextFromSessionJsonl,
  readAgentContextFromSession,
  resolveCodexSessionPath,
} from "../src/codex/agent-context.ts"

const jskPath = join(homedir(), ".codex/skills/jsk/SKILL.md")
const featurePath = join(homedir(), ".codex/skills/feature-workflow/SKILL.md")
const browserPath = join(homedir(), ".codex/skills/.system/imagegen/SKILL.md")

const fixture = [
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      content: [
        {
          type: "input_text",
          text: "# AGENTS.md instructions for /Users/example/workspace\n<INSTRUCTIONS>\nhello\n</INSTRUCTIONS>",
        },
      ],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      content: [
        {
          type: "input_text",
          text: `<skills_instructions>
### Available skills
- jsk: Jstack CLI skill (file: ${jskPath})
- feature-workflow: Feature workflow (file: ${featurePath})
- browser:control-in-app-browser: Control the in-app Browser. (file: ${browserPath})
</skills_instructions>`,
        },
      ],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: `{"cmd":"sed -n '1,240p' ${jskPath}"}`,
    },
  }),
].join("\n")

const parsed = parseAgentContextFromSessionJsonl(fixture)
if (parsed.agentsMd.length !== 1 || !parsed.agentsMd[0]?.includes("/Users/example/workspace")) {
  console.error("agent context parse failed for AGENTS.md header")
  process.exit(1)
}
if (parsed.injectedSkills.length !== 3 || parsed.injectedSkills[2]?.name !== "browser:control-in-app-browser") {
  console.error("agent context parse failed for skills catalog", parsed.injectedSkills)
  process.exit(1)
}
if (parsed.usedSkills.length !== 1 || parsed.usedSkills[0]?.name !== "jsk") {
  console.error("agent context parse failed for used skills", parsed.usedSkills)
  process.exit(1)
}

const used = noteUsedSkillsFromText(`sed -n '1,240p' ${jskPath}`, [])
if (used.length !== 1 || used[0]?.name !== "jsk") {
  console.error("agent context failed to track used skill reads")
  process.exit(1)
}

const snapshot = mergeAgentContext(emptyAgentContext(process.cwd()), parsed)
const rail = agentContextRailText(snapshot, process.cwd(), 120)
for (const required of ["context", "agents", "seen", "used", "jsk"]) {
  if (!rail.includes(required)) {
    console.error(`agent context rail missing: ${required}`)
    console.error(rail)
    process.exit(1)
  }
}

const discovered = discoverAgentsMdPaths(join(homedir(), "Documents", "GitHub"))
if (discovered.length === 0) {
  console.error("expected at least one AGENTS.md walking GitHub workspace")
  process.exit(1)
}

const discoveredSkills = discoverAvailableSkills(process.cwd())
if (discoveredSkills.length === 0) {
  console.error("expected Codex skills under ~/.codex/skills")
  process.exit(1)
}

const boot = emptyAgentContext(process.cwd())
if (boot.discoveredSkills.length === 0) {
  console.error("emptyAgentContext should preload discovered skills", boot)
  process.exit(1)
}
const bootRail = agentContextRailText(boot, process.cwd(), 60)
if (!bootRail.includes("on disk")) {
  console.error("boot rail should show disk skills before injection")
  console.error(bootRail)
  process.exit(1)
}

const recentThread = process.env.STACK_AGENT_CONTEXT_THREAD_ID
if (recentThread) {
  const sessionPath = await resolveCodexSessionPath(recentThread)
  if (!sessionPath) {
    console.error(`could not resolve codex session for thread ${recentThread}`)
    process.exit(1)
  }
  const live = await readAgentContextFromSession(recentThread)
  if (!live || live.injectedSkills.length === 0) {
    console.error("live session parse returned no injected skills")
    process.exit(1)
  }
}

console.log("stack_agent_context_smoke_ok")
