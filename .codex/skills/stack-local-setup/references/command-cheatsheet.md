# Stack local setup — command cheatsheet

Paths assume `~/Documents/GitHub/{stack,synth-dev,synth-ai}`. Adjust if your checkout differs.

## Stack

```bash
make -C ~/Documents/GitHub/stack install   # stack, stack-mcp, Codex skills
stack                                       # launch TUI
cd ~/Documents/GitHub/stack && bun run check
```

## Auth

```bash
# Dev (from stack.config.json authEnvFile)
grep -q '^SYNTH_API_KEY=' ~/Documents/GitHub/synth-ai/.env && echo "SYNTH_API_KEY set"

# Quick load for shell commands (do not print the value)
export SYNTH_API_KEY="$(awk -F= '/^SYNTH_API_KEY=/{print $2; exit}' ~/Documents/GitHub/synth-ai/.env)"
```

Keys: https://usesynth.ai/keys

## Docker

```bash
docker info
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

macOS: OrbStack is the expected local Docker runtime.

## synth-dev slot

```bash
cd ~/Documents/GitHub/synth-dev
./scripts/local.sh up slot1
./scripts/local.sh status slot1
./scripts/local.sh down slot1
./scripts/local.sh restart slot1 backend-api   # single service when needed
```

Slot lock / ownership on shared machines:

```bash
cd ~/Documents/GitHub/synth-dev
./scripts/runtime.py status
```

## Eval / container smoke

```bash
cd ~/Documents/GitHub/synth-dev
./scripts/eval.sh run smr/suites/readme_smoke_docker_codex.toml \
  --target local-dockerized \
  --instance slot1
```

## synth-ai (containers API)

```bash
pip install synth-ai
synth-ai containers list
python -c "from synth_ai import SynthClient; print(SynthClient().containers.list())"
```

## synth-optimizers (local GEPA)

```bash
pip install synth-optimizers
synth-optimizers gepa service \
  --db ~/Documents/GitHub/stack/.stack/optimizers/gepa-service.sqlite \
  --bind 127.0.0.1:8879

curl -s http://127.0.0.1:8879/health
curl -s http://127.0.0.1:8879/runs | head
```

## Stack auto-start env vars

```bash
export STACK_AUTO_START=1                      # master (default on dev)
export STACK_AUTO_START_DEV_SLOT=1             # local.sh up when API offline
export STACK_AUTO_START_LOCAL_OPTIMIZER=1      # GEPA service when down
export STACK_AUTO_START=0                      # disable all
export STACK_AUTO_START_DEV_SLOT=0
export STACK_AUTO_START_LOCAL_OPTIMIZER=0
export STACK_SYNTH_DEV_ROOT=~/Documents/GitHub/synth-dev
export STACK_README_SMOKE_INSTANCE=slot1
```

## Bootstrap logs

```bash
tail -f ~/Documents/GitHub/stack/.stack/bootstrap/dev-slot.log
tail -f ~/Documents/GitHub/stack/.stack/optimizers/gepa-service.log
```

## Codex skills install (manual)

Stack symlinks on `make install` and every launch. Manual repair:

```bash
mkdir -p ~/.codex/skills
for skill in stack-local-setup synth-via-stack stack-agent-bridge; do
  ln -sf ~/Documents/GitHub/stack/.codex/skills/"$skill" ~/.codex/skills/"$skill"
done
```

## Claude Code skills install (manual)

```bash
mkdir -p ~/.claude/skills
for skill in stack-local-setup synth-via-stack stack-agent-bridge; do
  ln -sf ~/Documents/GitHub/stack/.codex/skills/"$skill" ~/.claude/skills/"$skill"
done
```
