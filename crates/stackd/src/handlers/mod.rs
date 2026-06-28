pub mod export;
pub mod health;
pub mod threads;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use stack_core::session::SessionError;

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl From<SessionError> for ApiError {
    fn from(error: SessionError) -> Self {
        match error {
            SessionError::NotFound(_) => Self {
                status: StatusCode::NOT_FOUND,
                message: error.to_string(),
            },
            SessionError::InvalidId(_) => Self {
                status: StatusCode::BAD_REQUEST,
                message: error.to_string(),
            },
            _ => Self::internal(error.to_string()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, axum::Json(json!({ "error": self.message }))).into_response()
    }
}
