use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::{Result, TopologyError};

pub const GRAPH_IR_SCHEMA_VERSION: &str = "topologies.graph_ir.v1";
pub const ENVELOPE_SCHEMA_VERSION: &str = "topologies.envelope.v1";
pub const JOURNAL_SCHEMA_VERSION: &str = "topologies.graph_journal.v1";

pub type NodeId = String;
pub type ActorId = String;
pub type RunId = String;
pub type CheckerId = String;

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Actor {
    pub id: ActorId,
    pub signature: Signature,
    pub prompt: PromptSurface,
    pub provider: ProviderConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct ProviderConfig {
    pub model: String,
    pub endpoint: String,
    pub isolation: IsolationTier,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IsolationTier {
    None,
    Shared,
    Worktree,
    Container,
    Native,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Signature {
    pub input: Value,
    pub output: Value,
}

impl Signature {
    pub fn validate_input(&self, value: &Value) -> Result<()> {
        validate_json_schema(&self.input, value, "$")
    }

    pub fn validate_output(&self, value: &Value) -> Result<()> {
        validate_json_schema(&self.output, value, "$")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct PromptSurface {
    pub system: String,
    pub template: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Topology {
    pub id: String,
    pub nodes: Vec<Node>,
    pub actors: Vec<Actor>,
    pub state: StateChannel,
}

impl Topology {
    pub fn actor(&self, actor_id: &str) -> Result<&Actor> {
        self.actors
            .iter()
            .find(|actor| actor.id == actor_id)
            .ok_or_else(|| TopologyError::Validation(format!("actor not found: {actor_id}")))
    }

    pub fn node(&self, node_id: &str) -> Result<&Node> {
        self.nodes
            .iter()
            .find(|node| node.id == node_id)
            .ok_or_else(|| TopologyError::Validation(format!("node not found: {node_id}")))
    }

    pub fn validate(&self) -> Result<()> {
        require_non_empty("topology.id", &self.id)?;
        let mut node_ids = BTreeSet::new();
        for node in &self.nodes {
            require_non_empty("node.id", &node.id)?;
            if !node_ids.insert(node.id.clone()) {
                return Err(TopologyError::Validation(format!(
                    "duplicate node id: {}",
                    node.id
                )));
            }
        }
        let mut actor_ids = BTreeSet::new();
        for actor in &self.actors {
            require_non_empty("actor.id", &actor.id)?;
            if !actor_ids.insert(actor.id.clone()) {
                return Err(TopologyError::Validation(format!(
                    "duplicate actor id: {}",
                    actor.id
                )));
            }
            require_non_empty("actor.provider.model", &actor.provider.model)?;
            require_non_empty("actor.prompt.system", &actor.prompt.system)?;
        }
        for node in &self.nodes {
            match &node.op {
                Operator::Source { .. } => {}
                Operator::Actor { actor, input }
                | Operator::Map { actor, over: input }
                | Operator::Reduce { actor, over: input } => {
                    if !actor_ids.contains(actor) {
                        return Err(TopologyError::Validation(format!(
                            "node {} references missing actor {}",
                            node.id, actor
                        )));
                    }
                    validate_edge_ref(input, &node_ids)?;
                }
                Operator::Check { over, checker } => {
                    require_non_empty("checker", checker)?;
                    validate_edge_ref(over, &node_ids)?;
                }
                Operator::Branch { on, arms } => {
                    validate_edge_ref(on, &node_ids)?;
                    for (_, target) in arms {
                        if !node_ids.contains(target) {
                            return Err(TopologyError::Validation(format!(
                                "branch references missing node {target}"
                            )));
                        }
                    }
                }
                Operator::Loop { body, .. } => body.validate()?,
                Operator::Call { input, .. } => validate_edge_ref(input, &node_ids)?,
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct StateChannel {
    #[serde(default)]
    pub payload: Value,
}

impl Default for StateChannel {
    fn default() -> Self {
        Self {
            payload: Value::Object(Map::new()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Node {
    pub id: NodeId,
    pub op: Operator,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(tag = "operator", rename_all = "snake_case")]
pub enum Operator {
    Source {
        kind: SourceKind,
    },
    Actor {
        actor: ActorId,
        input: EdgeRef,
    },
    Map {
        over: EdgeRef,
        actor: ActorId,
    },
    Reduce {
        over: EdgeRef,
        actor: ActorId,
    },
    Check {
        over: EdgeRef,
        checker: CheckerId,
    },
    Branch {
        on: EdgeRef,
        arms: Vec<(Predicate, NodeId)>,
    },
    Loop {
        body: Box<Topology>,
        until: Predicate,
    },
    Call {
        topology: String,
        input: EdgeRef,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EdgeRef {
    Node { node_id: NodeId },
    Field { node_id: NodeId, field: String },
    Join { refs: Vec<EdgeRef> },
}

impl EdgeRef {
    pub fn node(node_id: impl Into<NodeId>) -> Self {
        Self::Node {
            node_id: node_id.into(),
        }
    }

    pub fn field(node_id: impl Into<NodeId>, field: impl Into<String>) -> Self {
        Self::Field {
            node_id: node_id.into(),
            field: field.into(),
        }
    }

    pub fn join(refs: Vec<EdgeRef>) -> Self {
        Self::Join { refs }
    }

    pub fn label(&self) -> String {
        match self {
            Self::Node { node_id } => node_id.clone(),
            Self::Field { node_id, field } => format!("{node_id}.{field}"),
            Self::Join { .. } => "join".to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(tag = "source_kind", content = "config", rename_all = "snake_case")]
pub enum SourceKind {
    SqliteTraceReader(TraceReaderCfg),
    Inline { payload: Value },
}

impl SourceKind {
    pub fn registry_key(&self) -> &'static str {
        match self {
            Self::SqliteTraceReader(_) => "sqlite_trace_reader",
            Self::Inline { .. } => "inline",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TraceReaderCfg {
    pub glob: String,
    #[serde(default = "default_split_answer_key")]
    pub split_answer_key: bool,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(transparent)]
pub struct Predicate(pub String);

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Envelope {
    pub node_id: NodeId,
    pub schema_version: String,
    pub payload: Value,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    #[serde(default)]
    pub cost: Cost,
    pub status: NodeStatus,
}

impl Envelope {
    pub fn ok(node_id: impl Into<NodeId>, payload: Value, cost: Cost) -> Self {
        Self::ok_with_artifacts(node_id, payload, cost, Vec::new())
    }

    pub fn ok_with_artifacts(
        node_id: impl Into<NodeId>,
        payload: Value,
        cost: Cost,
        artifacts: Vec<ArtifactRef>,
    ) -> Self {
        Self {
            node_id: node_id.into(),
            schema_version: ENVELOPE_SCHEMA_VERSION.to_string(),
            payload,
            artifacts,
            cost,
            status: NodeStatus::Ok,
        }
    }

    pub fn failed(
        node_id: impl Into<NodeId>,
        class: ErrorClass,
        message: impl Into<String>,
    ) -> Self {
        Self::failed_with_metadata(node_id, class, message, Cost::default(), Vec::new())
    }

    pub fn failed_with_metadata(
        node_id: impl Into<NodeId>,
        class: ErrorClass,
        message: impl Into<String>,
        cost: Cost,
        artifacts: Vec<ArtifactRef>,
    ) -> Self {
        Self {
            node_id: node_id.into(),
            schema_version: ENVELOPE_SCHEMA_VERSION.to_string(),
            payload: serde_json::json!({ "error": message.into() }),
            artifacts,
            cost,
            status: NodeStatus::Failed(class),
        }
    }

    pub fn skipped(node_id: impl Into<NodeId>, message: impl Into<String>) -> Self {
        Self {
            node_id: node_id.into(),
            schema_version: ENVELOPE_SCHEMA_VERSION.to_string(),
            payload: serde_json::json!({ "skipped": message.into() }),
            artifacts: Vec::new(),
            cost: Cost::default(),
            status: NodeStatus::Skipped,
        }
    }

    pub fn is_ok(&self) -> bool {
        self.status == NodeStatus::Ok
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Ok,
    Skipped,
    Failed(ErrorClass),
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorClass {
    Authoring,
    Worker,
    Budget,
    Checker,
    Infra,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Cost {
    pub tokens: u64,
    pub usd: f64,
    pub seconds: f64,
}

impl Cost {
    pub fn zero() -> Self {
        Self::default()
    }

    pub fn plus(self, other: Cost) -> Self {
        Self {
            tokens: self.tokens.saturating_add(other.tokens),
            usd: self.usd + other.usd,
            seconds: self.seconds + other.seconds,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(transparent)]
pub struct ArtifactRef(pub String);

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
pub struct GraphJournalKey {
    pub node_id: NodeId,
    pub call_ordinal: u64,
    pub input_hash: String,
}

impl GraphJournalKey {
    pub fn new(node_id: impl Into<NodeId>, call_ordinal: u64, input: &Value) -> Result<Self> {
        Ok(Self {
            node_id: node_id.into(),
            call_ordinal,
            input_hash: input_hash(input)?,
        })
    }

    pub fn as_string(&self) -> String {
        format!("{}:{}:{}", self.node_id, self.call_ordinal, self.input_hash)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct JournalEntry {
    pub node_id: NodeId,
    pub call_ordinal: u64,
    pub input_hash: String,
    pub result: Envelope,
}

impl JournalEntry {
    pub fn key(&self) -> GraphJournalKey {
        GraphJournalKey {
            node_id: self.node_id.clone(),
            call_ordinal: self.call_ordinal,
            input_hash: self.input_hash.clone(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct TopologyBuilder {
    id: String,
    actors: Vec<Actor>,
    nodes: Vec<Node>,
    state: StateChannel,
}

pub fn topo(id: impl Into<String>) -> TopologyBuilder {
    TopologyBuilder::new(id)
}

impl TopologyBuilder {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            actors: Vec::new(),
            nodes: Vec::new(),
            state: StateChannel::default(),
        }
    }

    pub fn actor(mut self, actor: Actor) -> Self {
        self.actors.push(actor);
        self
    }

    pub fn source(mut self, id: impl Into<NodeId>, kind: SourceKind) -> Self {
        self.nodes.push(Node {
            id: id.into(),
            op: Operator::Source { kind },
        });
        self
    }

    pub fn call_actor(
        mut self,
        id: impl Into<NodeId>,
        actor: impl Into<ActorId>,
        input: EdgeRef,
    ) -> Self {
        self.nodes.push(Node {
            id: id.into(),
            op: Operator::Actor {
                actor: actor.into(),
                input,
            },
        });
        self
    }

    pub fn map(mut self, id: impl Into<NodeId>, over: EdgeRef, actor: impl Into<ActorId>) -> Self {
        self.nodes.push(Node {
            id: id.into(),
            op: Operator::Map {
                over,
                actor: actor.into(),
            },
        });
        self
    }

    pub fn reduce(
        mut self,
        id: impl Into<NodeId>,
        over: EdgeRef,
        actor: impl Into<ActorId>,
    ) -> Self {
        self.nodes.push(Node {
            id: id.into(),
            op: Operator::Reduce {
                over,
                actor: actor.into(),
            },
        });
        self
    }

    pub fn check(
        mut self,
        id: impl Into<NodeId>,
        over: EdgeRef,
        checker: impl Into<CheckerId>,
    ) -> Self {
        self.nodes.push(Node {
            id: id.into(),
            op: Operator::Check {
                over,
                checker: checker.into(),
            },
        });
        self
    }

    pub fn build(self) -> Result<Topology> {
        let topology = Topology {
            id: self.id,
            nodes: self.nodes,
            actors: self.actors,
            state: self.state,
        };
        topology.validate()?;
        Ok(topology)
    }
}

pub fn input_hash(value: &Value) -> Result<String> {
    let stable = canonical_value(value);
    let bytes = serde_json::to_vec(&stable)?;
    let mut digest = Sha256::new();
    digest.update(bytes);
    Ok(format!("{:x}", digest.finalize()))
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical_value).collect()),
        Value::Object(object) => {
            let ordered = object
                .iter()
                .map(|(key, value)| (key.clone(), canonical_value(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(ordered.into_iter().collect())
        }
        other => other.clone(),
    }
}

fn validate_edge_ref(edge: &EdgeRef, node_ids: &BTreeSet<NodeId>) -> Result<()> {
    match edge {
        EdgeRef::Node { node_id } | EdgeRef::Field { node_id, .. } => {
            if !node_ids.contains(node_id) {
                return Err(TopologyError::Validation(format!(
                    "edge references missing node {node_id}"
                )));
            }
        }
        EdgeRef::Join { refs } => {
            if refs.is_empty() {
                return Err(TopologyError::Validation(
                    "join edge must contain at least one ref".to_string(),
                ));
            }
            for edge in refs {
                validate_edge_ref(edge, node_ids)?;
            }
        }
    }
    Ok(())
}

fn validate_json_schema(schema: &Value, value: &Value, path: &str) -> Result<()> {
    if schema.is_null() || schema == &serde_json::json!({}) {
        return Ok(());
    }
    if let Some(schema_type) = schema.get("type") {
        validate_type(schema_type, value, path)?;
    }
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        let object = value.as_object().ok_or_else(|| {
            TopologyError::Validation(format!("{path} must be object for required fields"))
        })?;
        for field in required {
            let field = field.as_str().ok_or_else(|| {
                TopologyError::Validation(format!("{path}.required contains non-string field"))
            })?;
            if !object.contains_key(field) {
                return Err(TopologyError::Validation(format!(
                    "{path}.{field} is required"
                )));
            }
        }
    }
    if let Some(enum_values) = schema.get("enum").and_then(Value::as_array) {
        if !enum_values.iter().any(|candidate| candidate == value) {
            return Err(TopologyError::Validation(format!(
                "{path} did not match any enum value"
            )));
        }
    }
    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        if let Some(object) = value.as_object() {
            for (field, field_schema) in properties {
                if let Some(field_value) = object.get(field) {
                    validate_json_schema(field_schema, field_value, &format!("{path}.{field}"))?;
                }
            }
            if schema.get("additionalProperties").and_then(Value::as_bool) == Some(false) {
                for field in object.keys() {
                    if !properties.contains_key(field) {
                        return Err(TopologyError::Validation(format!(
                            "{path}.{field} is not allowed by schema"
                        )));
                    }
                }
            }
        }
    }
    if let Some(item_schema) = schema.get("items") {
        if let Some(items) = value.as_array() {
            if let Some(min_items) = schema.get("minItems").and_then(Value::as_u64) {
                if (items.len() as u64) < min_items {
                    return Err(TopologyError::Validation(format!(
                        "{path} expected at least {min_items} items"
                    )));
                }
            }
            if let Some(max_items) = schema.get("maxItems").and_then(Value::as_u64) {
                if (items.len() as u64) > max_items {
                    return Err(TopologyError::Validation(format!(
                        "{path} expected at most {max_items} items"
                    )));
                }
            }
            for (index, item) in items.iter().enumerate() {
                validate_json_schema(item_schema, item, &format!("{path}[{index}]"))?;
            }
        }
    }
    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|actual| actual < minimum) {
            return Err(TopologyError::Validation(format!(
                "{path} expected value >= {minimum}"
            )));
        }
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|actual| actual > maximum) {
            return Err(TopologyError::Validation(format!(
                "{path} expected value <= {maximum}"
            )));
        }
    }
    Ok(())
}

fn validate_type(schema_type: &Value, value: &Value, path: &str) -> Result<()> {
    match schema_type {
        Value::String(kind) => {
            if value_matches_type(value, kind) {
                Ok(())
            } else {
                Err(TopologyError::Validation(format!(
                    "{path} expected JSON type {kind}, got {}",
                    json_type_name(value)
                )))
            }
        }
        Value::Array(kinds) => {
            let matched = kinds
                .iter()
                .filter_map(Value::as_str)
                .any(|kind| kind == "null" && value.is_null() || value_matches_type(value, kind));
            if matched {
                Ok(())
            } else {
                Err(TopologyError::Validation(format!(
                    "{path} did not match any allowed JSON type"
                )))
            }
        }
        _ => Err(TopologyError::Validation(format!(
            "{path}.type must be string or array"
        ))),
    }
}

fn value_matches_type(value: &Value, kind: &str) -> bool {
    match kind {
        "array" => value.is_array(),
        "boolean" => value.is_boolean(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "object" => value.is_object(),
        "string" => value.is_string(),
        "null" => value.is_null(),
        _ => false,
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Array(_) => "array",
        Value::Bool(_) => "boolean",
        Value::Null => "null",
        Value::Number(_) => "number",
        Value::Object(_) => "object",
        Value::String(_) => "string",
    }
}

fn require_non_empty(field: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(TopologyError::Validation(format!(
            "{field} must be non-empty"
        )))
    } else {
        Ok(())
    }
}

fn default_split_answer_key() -> bool {
    true
}
