import type { StackConfig } from "../config.js"
import { readCodexAccountsRegistry } from "./accounts-registry.js"
import {
  activateCodexAccount,
  formatCodexAuthStatusLines,
  readCodexAuthStatus,
  runCodexLogin,
  runCodexLogout,
  scanCodexAccounts,
  syncCodexAuthToIsolatedHome,
} from "./auth-sync.js"

function wantsJson(argv: string[]): boolean {
  return argv.includes("--json")
}

function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h")
}

function parseFlagString(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]?.trim()
  return value || undefined
}

export async function runCodexAuthCli(config: StackConfig, argv: string[]): Promise<number> {
  const [, action, subaction] = argv
  const json = wantsJson(argv)
  const help = wantsHelp(argv)
  const topHelp = !action || action === "help" || action === "--help" || action === "-h"

  if (topHelp || help) {
    printCodexAuthUsage()
    return topHelp || help ? 0 : 2
  }

  if (action === "status") {
    const status = await readCodexAuthStatus(config, !argv.includes("--no-probe"))
    if (json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      for (const line of formatCodexAuthStatusLines(status)) console.log(line)
    }
    return status.healthy ? 0 : 1
  }

  if (action === "login") {
    const code = runCodexLogin(config, argv.includes("--no-browser"))
    if (code !== 0) return code
    const status = await readCodexAuthStatus(config)
    if (json) {
      console.log(JSON.stringify({ ok: true, status }, null, 2))
    } else {
      console.log(`codex login ok · ${status.isolated.email ?? status.isolated.authMode}`)
    }
    return status.healthy ? 0 : 1
  }

  if (action === "logout") {
    const code = runCodexLogout(config)
    if (json) {
      console.log(JSON.stringify({ ok: code === 0 }, null, 2))
    } else if (code === 0) {
      console.log("codex logout ok")
    }
    return code
  }

  if (action === "sync") {
    try {
      const profile = parseFlagString(argv, "--profile")
      const result = syncCodexAuthToIsolatedHome({
        config,
        force: argv.includes("--force"),
        ...(profile ? { profileSlug: profile } : {}),
      })
      if (json) {
        console.log(JSON.stringify(result, null, 2))
      } else if (result.copied) {
        console.log(`synced · ${result.account.email ?? result.account.authMode} · ${result.reason}`)
        console.log(result.target_path)
      } else {
        console.log(`already up to date · ${result.account.email ?? result.account.authMode}`)
      }
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (action === "accounts") {
    if (subaction === "scan") {
      const registry = await scanCodexAccounts(config)
      if (json) {
        console.log(JSON.stringify(registry, null, 2))
      } else {
        console.log(`accounts ${registry.accounts.length}`)
        for (const account of registry.accounts) {
          const active = registry.active_account_id === account.account_id ? " *" : ""
          console.log(
            `  ${account.email ?? account.account_id}${active} · ${account.status} · ${account.sources.join(",")}`,
          )
        }
      }
      return 0
    }
    if (subaction === "use") {
      const selector = argv[3] ?? parseFlagString(argv, "--account")
      if (!selector) {
        console.error("usage: stack codex accounts use <email|account_id|profile> [--json]")
        return 2
      }
      try {
        const result = await activateCodexAccount(config, selector)
        if (json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(`active · ${result.email ?? result.account_id}`)
          console.log(result.target_path)
        }
        return 0
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        return 1
      }
    }
    if (subaction === "list" || !subaction) {
      const registry = readCodexAccountsRegistry(config.stackDataRoot)
      if (json) {
        console.log(JSON.stringify(registry, null, 2))
      } else if (registry.accounts.length === 0) {
        console.log("no codex accounts recorded yet · run stack codex accounts scan")
      } else {
        console.log(`accounts ${registry.accounts.length}`)
        for (const account of registry.accounts) {
          const active = registry.active_account_id === account.account_id ? " *" : ""
          const profile = account.profile_slug ? ` · profile ${account.profile_slug}` : ""
          console.log(
            `  ${account.email ?? account.account_id}${active} · ${account.status}${profile}`,
          )
        }
      }
      return 0
    }
    console.error("usage: stack codex accounts list|scan|use <selector>")
    return 2
  }

  printCodexAuthUsage()
  return 2
}

function printCodexAuthUsage(): void {
  console.log("Usage:")
  console.log("  stack codex status [--no-probe] [--json]")
  console.log("  stack codex login [--no-browser] [--json]")
  console.log("  stack codex logout [--json]")
  console.log("  stack codex sync [--force] [--profile <slug>] [--json]")
  console.log("  stack codex accounts list [--json]")
  console.log("  stack codex accounts scan [--json]")
  console.log("  stack codex accounts use <email|account_id|profile> [--json]")
}
