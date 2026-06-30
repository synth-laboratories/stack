/**
 * Stack agent roles.
 *
 * **Agent role** is the umbrella term for the three runtime personas in Stack:
 * worker, gardener, and monitor.
 *
 * **Auxiliary agent roles** (gardener, monitor) observe, route, or steer the
 * primary worker. They do not replace it.
 */

export type StackAgentRole = "worker" | "gardener" | "monitor"

export type StackPrimaryAgentRole = "worker"

export type StackAuxiliaryAgentRole = "gardener" | "monitor"

/** Session-scoped roles (monitor is thread-attached, not a session role). */
export type StackSessionAgentRole = Extract<StackAgentRole, "worker" | "gardener">

export const STACK_PRIMARY_AGENT_ROLE: StackPrimaryAgentRole = "worker"

export const STACK_AUXILIARY_AGENT_ROLES: readonly StackAuxiliaryAgentRole[] = ["gardener", "monitor"]

export function isStackAuxiliaryAgentRole(role: StackAgentRole): role is StackAuxiliaryAgentRole {
  return role === "gardener" || role === "monitor"
}

export function isStackPrimaryAgentRole(role: StackAgentRole): role is StackPrimaryAgentRole {
  return role === "worker"
}

export function agentRoleLabel(role: StackAgentRole): string {
  return role
}

export function agentRolePanelTitle(role: StackAgentRole): string {
  const name = role.charAt(0).toUpperCase() + role.slice(1)
  return name
}

/** Worker-style chat pane title: `{thread} · {role}`. */
export function roleChatPanelTitle(threadLabel: string, role: StackAgentRole): string {
  return `${threadLabel} · ${role}`
}
