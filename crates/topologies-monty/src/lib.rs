use std::io::Write;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use topologies_core::{BudgetEnvelope, SpawnRequest, WorkflowScript};

#[derive(Debug, Error)]
pub enum MontyError {
    #[error("Monty runner only supports MontyPython scripts")]
    UnsupportedScript,
    #[error("python process failed: {0}")]
    Process(#[from] std::io::Error),
    #[error("python exited with status {status}: {stderr}")]
    PythonFailed { status: i32, stderr: String },
    #[error("python output was not valid Monty JSON: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("host function {function:?} is not allowed by this contract")]
    DisallowedHostFunction { function: HostFunction },
}

pub type Result<T> = std::result::Result<T, MontyError>;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostFunction {
    Spawn,
    Parallel,
    Pipeline,
    Merge,
    Budget,
    Log,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HostCall {
    pub function: HostFunction,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RecordedHostCall {
    pub call_id: String,
    pub function: HostFunction,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MontyExecution {
    pub result: Value,
    #[serde(default)]
    pub host_calls: Vec<RecordedHostCall>,
    #[serde(default)]
    pub logs: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MontyHostContract {
    pub script: WorkflowScript,
    pub allowed_functions: Vec<HostFunction>,
    pub budget: BudgetEnvelope,
}

impl MontyHostContract {
    pub fn default_for_script(script: WorkflowScript, budget: BudgetEnvelope) -> Self {
        Self {
            script,
            allowed_functions: vec![
                HostFunction::Spawn,
                HostFunction::Parallel,
                HostFunction::Pipeline,
                HostFunction::Merge,
                HostFunction::Budget,
                HostFunction::Log,
            ],
            budget,
        }
    }

    pub fn spawn_call(actor: Value, inputs: Value, isolation: Option<String>) -> HostCall {
        HostCall {
            function: HostFunction::Spawn,
            payload: serde_json::to_value(SpawnRequest {
                actor,
                inputs,
                isolation,
                output_schema: None,
            })
            .expect("SpawnRequest serializes"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MontyPythonRunner {
    python_bin: String,
}

impl MontyPythonRunner {
    pub fn new(python_bin: impl Into<String>) -> Self {
        Self {
            python_bin: python_bin.into(),
        }
    }

    pub fn execute(&self, contract: &MontyHostContract, args: Value) -> Result<MontyExecution> {
        let WorkflowScript::MontyPython { source } = &contract.script else {
            return Err(MontyError::UnsupportedScript);
        };
        let request = PythonBootstrapRequest { source, args };
        let request_json = serde_json::to_vec(&request)?;
        let mut child = Command::new(&self.python_bin)
            .arg("-c")
            .arg(PYTHON_BOOTSTRAP)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let mut stdin = child.stdin.take().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::BrokenPipe, "python stdin unavailable")
        })?;
        stdin.write_all(&request_json)?;
        drop(stdin);

        let output = child.wait_with_output()?;
        if !output.status.success() {
            return Err(MontyError::PythonFailed {
                status: output.status.code().unwrap_or(-1),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            });
        }

        let execution: MontyExecution = serde_json::from_slice(&output.stdout)?;
        for call in &execution.host_calls {
            if !contract.allowed_functions.contains(&call.function) {
                return Err(MontyError::DisallowedHostFunction {
                    function: call.function,
                });
            }
        }
        Ok(execution)
    }
}

impl Default for MontyPythonRunner {
    fn default() -> Self {
        Self::new("python3")
    }
}

#[derive(Serialize)]
struct PythonBootstrapRequest<'a> {
    source: &'a str,
    args: Value,
}

const PYTHON_BOOTSTRAP: &str = r#"
import asyncio
import inspect
import json
import sys
import traceback


class Host:
    def __init__(self):
        self.calls = []
        self.logs = []

    def _record(self, function, payload):
        call_id = f"{function}:{len(self.calls)}"
        self.calls.append({
            "call_id": call_id,
            "function": function,
            "payload": payload,
        })
        return {"topologies_ref": call_id}

    def spawn(self, actor, inputs, isolation=None, output_schema=None):
        return self._record("spawn", {
            "actor": actor,
            "inputs": inputs,
            "isolation": isolation,
            "output_schema": output_schema,
        })

    def parallel(self, requests):
        return self._record("parallel", {"requests": requests})

    def pipeline(self, steps):
        return self._record("pipeline", {"steps": steps})

    def merge(self, items):
        return self._record("merge", {"items": items})

    def budget(self, request):
        return self._record("budget", request)

    def log(self, message, data=None):
        entry = {"message": str(message), "data": data}
        self.logs.append(entry)
        self._record("log", entry)
        return entry


def main():
    envelope = json.load(sys.stdin)
    namespace = {"__name__": "__topologies_monty__"}
    exec(envelope["source"], namespace)
    run = namespace.get("run")
    if run is None:
        raise RuntimeError("Monty workflow must define run(args, host)")
    host = Host()
    result = run(envelope.get("args"), host)
    if inspect.isawaitable(result):
        result = asyncio.run(result)
    sys.stdout.write(json.dumps({
        "result": result,
        "host_calls": host.calls,
        "logs": host.logs,
    }, separators=(",", ":")))


try:
    main()
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
"#;
