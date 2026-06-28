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
                    "responses": { "200": { "description": "stackd is healthy" } }
                }
            },
            "/status": {
                "get": {
                    "summary": "Return stackd process, runtime, and latest session status",
                    "responses": { "200": { "description": "stackd status snapshot" } }
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
                    "summary": "Return Stack/Codex trace pointers and turn summaries",
                    "parameters": [{ "name": "stackSessionId", "in": "path", "required": true }],
                    "responses": { "200": { "description": "trace response" }, "404": { "description": "missing session" } }
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
