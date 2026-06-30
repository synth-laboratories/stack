import {
  stackdBootstrapSkills,
  stackdListSkills,
  stackdRegisterSkill,
  type StackdSkillRecord,
} from "./client/stackd.js"
import {
  formatSkillSuggestionSteerMessage,
  suggestSkillToThread,
  type SuggestSkillToThreadResult,
} from "./skill-suggest.js"
import { appendThreadMetaEvent, stackEventId } from "./thread-events.js"

export type RegisterSkillInput = {
  skillId: string
  title?: string
  description?: string
  content?: string
  sourcePath?: string
  installedBy?: "gardener" | "operator" | "user" | "stackd"
}

export type RegisterSkillResult = {
  ok: boolean
  skill?: StackdSkillRecord
  error?: string
}

export async function bootstrapStackSkillsViaStackd(): Promise<StackdSkillRecord[]> {
  const response = await stackdBootstrapSkills()
  return response.skills
}

export async function listStackSkillsViaStackd(): Promise<StackdSkillRecord[]> {
  const response = await stackdListSkills()
  return response.skills
}

export async function registerStackSkill(input: RegisterSkillInput): Promise<RegisterSkillResult> {
  try {
    const skill = await stackdRegisterSkill({
      skill_id: input.skillId,
      title: input.title,
      description: input.description,
      content: input.content,
      source_path: input.sourcePath,
      installed_by: input.installedBy ?? "operator",
    })
    return { ok: true, skill }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Gardener always may register skills (not permission-gated). */
export async function executeGardenerSkillRegister(
  stackRoot: string,
  gardenerThreadId: string,
  input: RegisterSkillInput,
): Promise<RegisterSkillResult> {
  const result = await registerStackSkill({ ...input, installedBy: "gardener" })
  if (result.ok && result.skill) {
    appendThreadMetaEvent(stackRoot, {
      event_id: stackEventId("skill_registered"),
      type: "skills.registered",
      thread_id: gardenerThreadId,
      observed_at: new Date().toISOString(),
      actor_id: "gardener",
      actor_role: "system",
      payload: {
        skill_id: result.skill.skill_id,
        title: result.skill.title,
        origin: result.skill.origin,
        source_path: result.skill.source_path,
      },
    })
  }
  return result
}

export type GardenerSkillSuggestInput = {
  workerThreadId: string
  skillId: string
  reason?: string
  workspaceRoot?: string
  steerMessage?: string
}

/** Gardener always may suggest skills to a worker thread (not permission-gated). */
export function executeGardenerSkillSuggest(
  stackRoot: string,
  gardenerThreadId: string,
  input: GardenerSkillSuggestInput,
): SuggestSkillToThreadResult & { steerMessage?: string } {
  const reason = input.reason?.trim() || "gardener suggested this skill for the current worker task"
  const result = suggestSkillToThread({
    stackRoot,
    threadId: input.workerThreadId,
    actorId: "gardener",
    actorRole: "gardener",
    eventType: "gardener.skill_suggest",
    skillId: input.skillId,
    reason,
    workspaceRoot: input.workspaceRoot,
  })
  if (!result.ok) return result

  appendThreadMetaEvent(stackRoot, {
    event_id: stackEventId("gardener_skill_suggest"),
    type: "gardener.skill_suggest",
    thread_id: gardenerThreadId,
    observed_at: new Date().toISOString(),
    actor_id: "gardener",
    actor_role: "system",
    payload: {
      worker_thread_id: input.workerThreadId,
      skill_id: result.skillId,
      reason,
      worker_event_id: result.eventId,
    },
  })

  const steerMessage = formatSkillSuggestionSteerMessage(
    result.skillId ?? input.skillId,
    input.steerMessage ?? result.message ?? reason,
  )
  return { ...result, steerMessage }
}

export type GardenerSkillRegisterIntent = {
  skillId: string
  title?: string
  description?: string
  sourcePath?: string
  content?: string
}

export type GardenerSkillSuggestIntent = {
  skillId: string
  reason?: string
}

/** Parse `skill register <id> from <path>` or `skill register <id> :: <markdown body>`. */
export function parseGardenerSkillRegisterIntent(message: string): GardenerSkillRegisterIntent | undefined {
  const trimmed = message.trim()
  const prefix = "skill register "
  if (!trimmed.toLowerCase().startsWith(prefix)) return undefined
  const body = trimmed.slice(prefix.length).trim()
  if (!body) return undefined

  const fromMatch = /^([a-zA-Z0-9_-]+)\s+from\s+(.+)$/.exec(body)
  if (fromMatch?.[1] && fromMatch[2]) {
    return {
      skillId: fromMatch[1],
      sourcePath: fromMatch[2].trim(),
    }
  }

  const splitMatch = /^([a-zA-Z0-9_-]+)\s+::\s+([\s\S]+)$/.exec(body)
  if (splitMatch?.[1] && splitMatch[2]) {
    const content = splitMatch[2].trim()
    const frontmatter = content.startsWith("---\n") ? content : `---\nname: ${splitMatch[1]}\n---\n\n${content}`
    return {
      skillId: splitMatch[1],
      content: frontmatter,
    }
  }

  return { skillId: body.split(/\s+/)[0] ?? body }
}

/** Parse `skill suggest <id>` or `skill suggest <id> because <reason>`. */
export function parseGardenerSkillSuggestIntent(message: string): GardenerSkillSuggestIntent | undefined {
  const trimmed = message.trim()
  const prefix = "skill suggest "
  if (!trimmed.toLowerCase().startsWith(prefix)) return undefined
  const body = trimmed.slice(prefix.length).trim()
  if (!body) return undefined

  const becauseMatch = /^([a-zA-Z0-9_-]+)\s+(?:because|for|:)\s+([\s\S]+)$/.exec(body)
  if (becauseMatch?.[1] && becauseMatch[2]) {
    return { skillId: becauseMatch[1], reason: becauseMatch[2].trim() }
  }

  return { skillId: body.split(/\s+/)[0] ?? body }
}

export function formatSkillRegisterHelp(): string {
  return [
    "Register a skill via stackd (gardener — always allowed):",
    "  skill register my-skill from /path/to/skill-dir",
    "  skill register my-skill :: ---\\nname: my-skill\\ntitle: My Skill\\n---\\n\\nBody…",
  ].join("\n")
}

export function formatSkillSuggestHelp(): string {
  return [
    "Suggest a skill to the active worker (gardener — always allowed):",
    "  skill suggest oss-gepa",
    "  skill suggest hosted-gepa because the turn mentions usesynth",
  ].join("\n")
}

export function formatGardenerSkillHelp(): string {
  return [formatSkillRegisterHelp(), "", formatSkillSuggestHelp()].join("\n")
}
