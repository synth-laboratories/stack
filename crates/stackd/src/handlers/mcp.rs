use crate::server::AppState;
use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::sync::Arc;

pub async fn well_known_mcp(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({
        "mcpServers": {
            "stack-live-ops": {
                "type": "streamable-http",
                "url": format!("{}/mcp", state.public_base_url.trim_end_matches('/'))
            }
        }
    }))
}

pub async fn proxy_mcp(State(state): State<Arc<AppState>>, req: Request<Body>) -> Response {
    let Some(sidecar) = state.mcp_sidecar.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Stack MCP HTTP sidecar is unavailable. Set STACKD_MCP=0 to disable or ensure bun is installed."
            })),
        )
            .into_response();
    };

    let path = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/mcp");
    let url = format!("{}{}", sidecar.base_url.trim_end_matches('/'), path);

    let (parts, body) = req.into_parts();
    let body_bytes = match to_bytes(body, 16 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };

    let mut builder = state.http_client.request(parts.method.clone(), &url);
    for (name, value) in parts.headers.iter() {
        if name == axum::http::header::HOST {
            continue;
        }
        builder = builder.header(name, value);
    }
    builder = builder.body(body_bytes);

    let upstream = match builder.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("stackd MCP proxy failed for {url}: {error}");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    let status = upstream.status();
    let headers = upstream.headers().clone();
    let bytes = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };

    let mut response = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if name == axum::http::header::TRANSFER_ENCODING {
            continue;
        }
        response = response.header(name, value);
    }
    match response.body(Body::from(bytes)) {
        Ok(response) => response,
        Err(_) => StatusCode::BAD_GATEWAY.into_response(),
    }
}
