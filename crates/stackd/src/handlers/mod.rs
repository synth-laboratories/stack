pub mod export;
pub mod health;
pub mod logs;
pub mod mcp;
pub mod meta_threads;
pub mod runtime;
pub mod skills;
pub mod telemetry;
pub mod threads;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use stack_core::events::EventLogError;
use stack_core::session::SessionError;

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

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

impl From<EventLogError> for ApiError {
    fn from(error: EventLogError) -> Self {
        match error {
            EventLogError::InvalidThreadId(_) => Self {
                status: StatusCode::BAD_REQUEST,
                message: error.to_string(),
            },
            _ => Self::internal(error.to_string()),
        }
    }
}

impl From<stack_core::meta_thread::MetaThreadError> for ApiError {
    fn from(error: stack_core::meta_thread::MetaThreadError) -> Self {
        match error {
            stack_core::meta_thread::MetaThreadError::NotFound(_)
            | stack_core::meta_thread::MetaThreadError::HandoffNotFound(_) => Self {
                status: StatusCode::NOT_FOUND,
                message: error.to_string(),
            },
            stack_core::meta_thread::MetaThreadError::InvalidPathSegment(_) => Self {
                status: StatusCode::BAD_REQUEST,
                message: error.to_string(),
            },
            _ => Self::internal(error.to_string()),
        }
    }
}

impl From<stack_core::skills::SkillError> for ApiError {
    fn from(error: stack_core::skills::SkillError) -> Self {
        match error {
            stack_core::skills::SkillError::NotFound(_) => Self {
                status: StatusCode::NOT_FOUND,
                message: error.to_string(),
            },
            stack_core::skills::SkillError::InvalidId(_)
            | stack_core::skills::SkillError::MissingContent
            | stack_core::skills::SkillError::InvalidSourcePath(_) => Self {
                status: StatusCode::BAD_REQUEST,
                message: error.to_string(),
            },
            stack_core::skills::SkillError::AlreadyExists(_) => Self {
                status: StatusCode::CONFLICT,
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
