//! MetaHarness runtime: event-log fold (reducer) + serialized tick + status projection.
//! Contract: append → notify → tick → render. Rust owns liveness (cursors, queues,
//! ticks, snapshots); TS/MCP call verbs and render. See docs/META_HARNESS_RUNTIME.md.

pub mod reducer;
pub mod tick;
