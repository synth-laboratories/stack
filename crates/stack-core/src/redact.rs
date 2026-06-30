use serde_json::Value;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionReport {
    pub redacted_fields: usize,
    pub rules: Vec<&'static str>,
}

pub fn redact_for_export(value: &mut Value) -> RedactionReport {
    let mut count = 0;
    redact_value(value, None, &mut count);
    RedactionReport {
        redacted_fields: count,
        rules: vec![
            "SYNTH_*",
            "*API_KEY*",
            "*SECRET*",
            "Authorization",
            "Bearer",
            "password",
            "token",
            "common secret string patterns",
        ],
    }
}

fn redact_value(value: &mut Value, key: Option<&str>, count: &mut usize) {
    if key.map(is_secret_key).unwrap_or(false) || is_secret_string(value) {
        *value = Value::String("[REDACTED]".to_string());
        *count += 1;
        return;
    }

    match value {
        Value::Object(map) => {
            for (child_key, child_value) in map.iter_mut() {
                redact_value(child_value, Some(child_key), count);
            }
        }
        Value::Array(items) => {
            for item in items {
                redact_value(item, None, count);
            }
        }
        _ => {}
    }
}

fn is_secret_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    upper.starts_with("SYNTH_")
        || upper.contains("API_KEY")
        || upper.contains("SECRET")
        || upper == "AUTHORIZATION"
        || upper.contains("PASSWORD")
        || upper == "BEARER"
        || upper.contains("TOKEN")
}

fn is_secret_string(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    let lower = text.to_ascii_lowercase();
    lower.contains("authorization: bearer ")
        || lower.contains("\"authorization\":\"bearer ")
        || lower.starts_with("bearer ")
        || lower.contains("api_key=")
        || lower.contains("apikey=")
        || lower.contains("secret=")
        || lower.contains("token=")
        || lower.contains("password=")
        || text.contains("sk-")
        || text.contains("synth_")
}
