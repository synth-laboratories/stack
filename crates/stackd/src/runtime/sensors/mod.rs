pub mod local_gepa;
pub mod remote_synth;

use serde_json::Value;
use stack_core::runtime_event::RuntimeEventDraft;

pub struct SensorPoll {
    pub events: Vec<RuntimeEventDraft>,
    pub cursor: Value,
}
