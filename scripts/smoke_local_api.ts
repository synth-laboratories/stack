import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  stackdBaseUrl,
  stackdExport,
  stackdHealth,
  stackdLogsQuery,
  stackdStatus,
  stackdTrace,
  stackdThreads,
} from "../src/client/stackd.js"

const baseUrl = stackdBaseUrl()

const health = await stackdHealth(baseUrl)
assert(health.ok === true, "health did not return ok=true")
console.log(`health ok: ${health.stackd_version} (${health.session_log_dir})`)

const threads = await stackdThreads(baseUrl)
assert(Array.isArray(threads), "/threads did not return an array")
console.log(`threads: ${threads.length}`)

const status = await stackdStatus(baseUrl)
assert(status.ok === true, "status did not return ok=true")
assert(status.session_count === threads.length, "status session_count did not match /threads")
console.log(`status ok: sessions=${status.session_count}`)

const logs = await stackdLogsQuery({ query: "*", limit: 1, minutes: 60 }, baseUrl)
assert(logs.ok === true, "/logs/query did not return ok=true")
assert(Array.isArray(logs.result.records), "/logs/query missing records array")
console.log(`logs ok: records=${logs.result.records.length}`)

const newest = threads[0]
if (!newest) {
  console.log("no sessions found; run one ./bin/stack turn for trace/export coverage")
  process.exit(0)
}

const trace = await stackdTrace(newest.id, baseUrl)
assert(trace.stack_session_id === newest.id, "trace session id mismatch")
assert(typeof trace.stack_session_path === "string" && trace.stack_session_path.length > 0, "trace missing session path")
console.log(`trace ok: ${trace.stack_session_id} turns=${trace.turn_count}`)

const exported = await stackdExport(newest.id, baseUrl)
const manifest = join(exported.export_dir, "manifest.json")
const session = join(exported.export_dir, "session.json")
const metadata = join(exported.export_dir, "metadata.json")
assert(existsSync(manifest), `missing ${manifest}`)
assert(existsSync(session), `missing ${session}`)
assert(existsSync(metadata), `missing ${metadata}`)
console.log(`export ok: ${exported.export_dir}`)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}
