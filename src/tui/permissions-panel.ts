import type { StackdTelemetryConfigRequest, StackdTelemetryStatus } from "../client/stackd.js"
import { stackVersion } from "../version.js"

export const PERMISSIONS_REMINDER =
  "Basic counts launches and sessions. Advanced adds coarse adoption metrics — never prompts, code, or paths."

export type AdvancedPermissionId =
  | "session_metrics"
  | "feature_adoption"
  | "support_doctor"
  | "continuity"
  | "optimizer"

export type PermissionsDraft = {
  basicDau: boolean
  advanced: Record<AdvancedPermissionId, boolean>
}

export const ADVANCED_PERMISSION_SPECS: ReadonlyArray<{ id: AdvancedPermissionId; label: string }> = [
  { id: "session_metrics", label: "session length + heartbeats" },
  { id: "feature_adoption", label: "feature adoption" },
  { id: "support_doctor", label: "doctor + support signals" },
  { id: "continuity", label: "meta-threads + handoffs" },
  { id: "optimizer", label: "local optimizer usage" },
]

export type PermissionsPanelRow = {
  id: string
  text: string
  active: boolean
  onSelect: () => void
}

export function permissionsDraftFromTiers(tiers: StackdTelemetryStatus["tiers"] | undefined): PermissionsDraft {
  const basicDau = tiers?.basic_dau !== "off"
  const advancedOn = tiers?.advanced_product === "accepted"
  const advanced = Object.fromEntries(
    ADVANCED_PERMISSION_SPECS.map((spec) => [spec.id, advancedOn]),
  ) as Record<AdvancedPermissionId, boolean>
  return { basicDau, advanced }
}

export function permissionsGrantAll(draft: PermissionsDraft): boolean {
  return draft.basicDau && ADVANCED_PERMISSION_SPECS.every((spec) => draft.advanced[spec.id])
}

export function setPermissionsGrantAll(draft: PermissionsDraft, enabled: boolean): PermissionsDraft {
  return {
    basicDau: enabled,
    advanced: Object.fromEntries(
      ADVANCED_PERMISSION_SPECS.map((spec) => [spec.id, enabled]),
    ) as Record<AdvancedPermissionId, boolean>,
  }
}

export function permissionsNeedsReminder(tiers: StackdTelemetryStatus["tiers"] | undefined): boolean {
  return tiers?.advanced_product === "unset"
}

export function permissionsToStackdConfig(
  draft: PermissionsDraft,
  appRoot?: string,
): StackdTelemetryConfigRequest {
  const anyAdvanced = ADVANCED_PERMISSION_SPECS.some((spec) => draft.advanced[spec.id])
  return {
    basic_dau: draft.basicDau ? "on" : "off",
    advanced_product: anyAdvanced ? "accepted" : "declined",
    asked_version: stackVersion(appRoot),
  }
}

export function checkboxLabel(checked: boolean, label: string): string {
  return `${checked ? "[x]" : "[ ]"} ${label}`
}

export function buildPermissionsPanelRows(
  draft: PermissionsDraft,
  mutate: (next: PermissionsDraft) => void,
): PermissionsPanelRow[] {
  const rows: PermissionsPanelRow[] = [
    {
      id: "grant_all",
      text: checkboxLabel(permissionsGrantAll(draft), "Grant all telemetry"),
      active: permissionsGrantAll(draft),
      onSelect: () => mutate(setPermissionsGrantAll(draft, !permissionsGrantAll(draft))),
    },
    {
      id: "basic_dau",
      text: checkboxLabel(draft.basicDau, "Basic DAU · launch + session counts"),
      active: draft.basicDau,
      onSelect: () => mutate({ ...draft, basicDau: !draft.basicDau }),
    },
  ]
  for (const spec of ADVANCED_PERMISSION_SPECS) {
    rows.push({
      id: spec.id,
      text: checkboxLabel(draft.advanced[spec.id], spec.label),
      active: draft.advanced[spec.id],
      onSelect: () =>
        mutate({
          ...draft,
          advanced: { ...draft.advanced, [spec.id]: !draft.advanced[spec.id] },
        }),
    })
  }
  rows.push({
    id: "decline_all",
    text: checkboxLabel(false, "Decline all product telemetry"),
    active: !draft.basicDau && !ADVANCED_PERMISSION_SPECS.some((spec) => draft.advanced[spec.id]),
    onSelect: () =>
      mutate({
        basicDau: false,
        advanced: Object.fromEntries(
          ADVANCED_PERMISSION_SPECS.map((spec) => [spec.id, false]),
        ) as Record<AdvancedPermissionId, boolean>,
      }),
  })
  return rows
}
