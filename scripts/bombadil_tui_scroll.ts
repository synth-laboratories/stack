import { always, eventually, extract } from "@antithesishq/bombadil"
export * from "@antithesishq/bombadil/defaults"

const statusText = extract((state) => state.document.querySelector("#status")?.textContent ?? "")

export const stack_tui_scroll_e2e_passes = eventually(() => statusText.current.includes("STACK_TUI_SCROLL_PASS"))

export const stack_tui_scroll_e2e_never_fails = always(() => !statusText.current.includes("STACK_TUI_SCROLL_FAIL"))
