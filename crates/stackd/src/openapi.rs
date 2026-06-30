use axum::Json;
use serde_json::{json, Value};

pub async fn doc() -> Json<Value> {
    Json(json!({
        "openapi": "3.1.0",
        "info": {
            "title": "stackd L1 API",
            "version": env!("CARGO_PKG_VERSION")
        },
        "servers": [{ "url": "http://127.0.0.1:8792" }],
        "paths": {
            "/health": {
                "get": {
                    "summary": "Health and local path metadata",
                    "responses": { "200": { "description": "stackd is healthy; includes mcp_url when live MCP is enabled" } }
                }
            },
            "/mcp": {
                "get": {
                    "summary": "Stack live MCP streamable HTTP discovery",
                    "responses": { "200": { "description": "MCP server metadata" } }
                },
                "post": {
                    "summary": "Stack live MCP JSON-RPC endpoint",
                    "responses": { "200": { "description": "JSON-RPC response" }, "503": { "description": "MCP sidecar unavailable" } }
                }
            },
            "/.well-known/mcp.json": {
                "get": {
                    "summary": "MCP server discovery document",
                    "responses": { "200": { "description": "Cursor-compatible MCP discovery JSON" } }
                }
            },
            "/status": {
                "get": {
                    "summary": "Return stackd process, runtime, and latest session status",
                    "responses": { "200": { "description": "stackd status snapshot" } }
                }
            },
            "/runtime/factory": {
                "get": {
                    "summary": "Return the latest stackd factory runtime snapshot",
                    "responses": { "200": { "description": "runtime factory snapshot or empty status plus latest events_appended metadata" } }
                }
            },
            "/runtime/events": {
                "get": {
                    "summary": "List durable stackd runtime events",
                    "parameters": [
                        { "name": "after_seq", "in": "query", "required": false },
                        { "name": "limit", "in": "query", "required": false },
                        { "name": "source", "in": "query", "required": false, "description": "Optional source filter; <=160 bytes." }
                    ],
                    "responses": { "200": { "description": "runtime events" }, "400": { "description": "invalid query or query exceeds V1 bounds" } }
                },
                "post": {
                    "summary": "Append a bounded Stack-owned lever event",
                    "requestBody": {
                        "required": true,
                        "description": "lever.* event draft; sensor.* writes are rejected. Limits: event_type/source/subject.kind <=160 bytes, subject.id <=512 bytes, observed_at <=128 bytes, serialized payload <=64 KiB."
                    },
                    "responses": { "200": { "description": "appended event, events_appended count, and updated factory snapshot" }, "400": { "description": "invalid event or event exceeds V1 receipt bounds" } }
                }
            },
            "/runtime/tick": {
                "post": {
                    "summary": "Run one bounded runtime sensor tick",
                    "responses": { "200": { "description": "updated factory snapshot plus events_appended count" } }
                }
            },
            "/threads": {
                "get": {
                    "summary": "List local Stack session summaries",
                    "responses": { "200": { "description": "array of StackSessionSummary" } }
                }
            },
            "/threads/{stackSessionId}": {
                "get": {
                    "summary": "Return raw Stack session JSON",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "responses": { "200": { "description": "StackLocalSession" }, "404": { "description": "missing session" } }
                }
            },
            "/threads/{stackSessionId}/status": {
                "get": {
                    "summary": "Return session mtime/turn status plus matching runtime status",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "responses": { "200": { "description": "merged status" }, "404": { "description": "missing session" } }
                }
            },
            "/threads/{stackSessionId}/trace": {
                "get": {
                    "summary": "Return Stack/Codex trace pointers, turn summaries, and meta-harness events",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "responses": { "200": { "description": "trace response" }, "404": { "description": "missing session" } }
                }
            },
            "/threads/{stackSessionId}/events": {
                "get": {
                    "summary": "Return thread-scoped Stack core agent and meta-harness events",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "responses": { "200": { "description": "array of core/meta events" }, "404": { "description": "missing session" } }
                },
                "post": {
                    "summary": "Append a thread-scoped Stack core agent or meta-harness event",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "requestBody": { "required": true, "description": "Stack event object; stackd fills thread_id, observed_at, event_id, and payload defaults" },
                    "responses": { "200": { "description": "appended event and event log path" }, "400": { "description": "invalid event" } }
                }
            },
            "/events/stream": {
                "get": {
                    "summary": "Server-sent event stream for a thread event log",
                    "parameters": [
                        { "name": "thread_id", "in": "query", "required": true },
                        { "name": "after_event_id", "in": "query", "required": false },
                        { "name": "poll_ms", "in": "query", "required": false }
                    ],
                    "responses": { "200": { "description": "text/event-stream of Stack events" }, "400": { "description": "invalid thread id" } }
                }
            },
            "/logs/query": {
                "get": {
                    "summary": "Query VictoriaLogs via native stackd LogSQL client",
                    "parameters": [
                        { "name": "slot", "in": "query", "required": false },
                        { "name": "query", "in": "query", "required": false },
                        { "name": "event_domain", "in": "query", "required": false },
                        { "name": "service", "in": "query", "required": false },
                        { "name": "run_id", "in": "query", "required": false },
                        { "name": "thread_id", "in": "query", "required": false },
                        { "name": "minutes", "in": "query", "required": false },
                        { "name": "limit", "in": "query", "required": false }
                    ],
                    "responses": { "200": { "description": "VictoriaLogs query result" }, "400": { "description": "invalid query parameter" } }
                }
            },
            "/threads/{stackSessionId}/actors": {
                "get": {
                    "summary": "Return thread-scoped Stack actor checkpoint state",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "responses": { "200": { "description": "array of actor state objects" }, "404": { "description": "missing session" } }
                }
            },
            "/threads/{stackSessionId}/monitors/{monitorId}/pause": {
                "post": {
                    "summary": "Pause a monitor actor and emit monitor.paused",
                    "parameters": [
                        { "name": "stackSessionId", "in": "path", "required": true },
                        { "name": "monitorId", "in": "path", "required": true }
                    ],
                    "responses": { "200": { "description": "updated actor state and event" }, "404": { "description": "missing session" } }
                }
            },
            "/threads/{stackSessionId}/monitors/{monitorId}/resume": {
                "post": {
                    "summary": "Resume a monitor actor and emit monitor.resumed",
                    "parameters": [
                        { "name": "stackSessionId", "in": "path", "required": true },
                        { "name": "monitorId", "in": "path", "required": true }
                    ],
                    "requestBody": { "required": false, "description": "{ strictness?: passive|conservative|aggressive }" },
                    "responses": { "200": { "description": "updated actor state and event" }, "404": { "description": "missing session" } }
                }
            },
            "/threads/{stackSessionId}/monitors/{monitorId}/mode": {
                "post": {
                    "summary": "Set monitor strictness and emit monitor.mode_changed or monitor.paused",
                    "parameters": [
                        { "name": "stackSessionId", "in": "path", "required": true },
                        { "name": "monitorId", "in": "path", "required": true }
                    ],
                    "requestBody": { "required": true, "description": "{ strictness: off|passive|conservative|aggressive }" },
                    "responses": { "200": { "description": "updated actor state and event" }, "400": { "description": "invalid strictness" }, "404": { "description": "missing session" } }
                }
            },
            "/threads/{stackSessionId}/export": {
                "get": {
                    "summary": "Write a redacted StackEval-ready export bundle",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "responses": { "200": { "description": "export directory" }, "404": { "description": "missing session" } }
                }
            },
            "/doc": {
                "get": {
                    "summary": "Return this OpenAPI document",
                    "responses": { "200": { "description": "OpenAPI JSON" } }
                }
            },
            "/openapi.json": {
                "get": {
                    "summary": "Return this OpenAPI document",
                    "responses": { "200": { "description": "OpenAPI JSON" } }
                }
            }
        }
    }))
}
