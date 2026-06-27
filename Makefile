PREFIX ?= $(HOME)/.local
LIBEXEC ?= $(PREFIX)/libexec/stack
STACK_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

RSYNC_EXCLUDES := \
	--exclude node_modules \
	--exclude .stack \
	--exclude .git \
	--exclude .DS_Store

.PHONY: install uninstall install-brew uninstall-brew deps check install-skills version sync-version bump-dev release-promote release-check homebrew-formulas smoke-tui smoke-tui-all smoke-tui-gepa smoke-tui-resilience

deps:
	cd "$(STACK_ROOT)" && bun install

check:
	cd "$(STACK_ROOT)" && bun run check

smoke-tui:
	cd "$(STACK_ROOT)" && bun run smoke:tui

smoke-tui-gepa:
	cd "$(STACK_ROOT)" && bun run smoke:tui:gepa

smoke-tui-resilience:
	cd "$(STACK_ROOT)" && bun run smoke:tui:resilience

smoke-tui-all:
	cd "$(STACK_ROOT)" && bun run smoke:tui:all

version:
	@cd "$(STACK_ROOT)" && bun -e 'import { printStackVersion } from "./src/version.ts"; printStackVersion("stack")'

sync-version:
	cd "$(STACK_ROOT)" && bun run scripts/sync_version.ts

bump-dev:
	cd "$(STACK_ROOT)" && bun run scripts/bump_dev.ts

release-promote:
	@test -n "$(VERSION)" || (echo "VERSION is required, e.g. make release-promote VERSION=0.2.0"; exit 1)
	cd "$(STACK_ROOT)" && bun run scripts/release_promote.ts "$(VERSION)" --reopen-dev

release-check:
	cd "$(STACK_ROOT)" && bun run release-check

homebrew-formulas:
	cd "$(STACK_ROOT)" && bun run scripts/update_homebrew_formula.ts $(if $(FETCH_STABLE),--fetch-stable,)

install-skills:
	@cd "$(STACK_ROOT)" && bun -e 'import { ensureStackCodexSkills } from "./src/codex/install-skills.ts"; console.log("installed:", ensureStackCodexSkills(process.argv[1]).join(", "))' "$(STACK_ROOT)"

install: deps install-skills deps
	install -d "$(PREFIX)/bin"
	printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'exec "$(STACK_ROOT)/bin/stack" "$$@"' > "$(PREFIX)/bin/stack"
	printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'exec "$(STACK_ROOT)/bin/stack-mcp" "$$@"' > "$(PREFIX)/bin/stack-mcp"
	chmod 755 "$(PREFIX)/bin/stack" "$(PREFIX)/bin/stack-mcp"
	@echo "stack installed to $(PREFIX)/bin/stack"
	@echo "stack-mcp installed to $(PREFIX)/bin/stack-mcp"

install-brew: deps
	install -d "$(LIBEXEC)" "$(PREFIX)/bin"
	rsync -a $(RSYNC_EXCLUDES) "$(STACK_ROOT)/" "$(LIBEXEC)/"
	cd "$(LIBEXEC)" && bun install
	printf '%s\n' \
	  '#!/usr/bin/env bash' \
	  'set -euo pipefail' \
	  'export STACK_APP_ROOT="'"$(LIBEXEC)"'"' \
	  'exec bun run "$$STACK_APP_ROOT/src/main.ts" "$$@"' \
	  > "$(PREFIX)/bin/stack"
	printf '%s\n' \
	  '#!/usr/bin/env bash' \
	  'set -euo pipefail' \
	  'export STACK_APP_ROOT="'"$(LIBEXEC)"'"' \
	  'exec bun run "$$STACK_APP_ROOT/src/mcp/server.ts" "$$@"' \
	  > "$(PREFIX)/bin/stack-mcp"
	chmod 755 "$(PREFIX)/bin/stack" "$(PREFIX)/bin/stack-mcp"
	@cd "$(LIBEXEC)" && bun run scripts/sync_version.ts
	@cd "$(LIBEXEC)" && bun -e 'import { ensureStackCodexSkills } from "./src/codex/install-skills.ts"; ensureStackCodexSkills(process.argv[1])' "$(LIBEXEC)"
	@echo "stack installed to $(PREFIX)/bin/stack (libexec $(LIBEXEC))"

uninstall:
	rm -f "$(PREFIX)/bin/stack" "$(PREFIX)/bin/stack-mcp"
	@echo "removed $(PREFIX)/bin/stack and $(PREFIX)/bin/stack-mcp"

uninstall-brew: uninstall
	rm -rf "$(LIBEXEC)"
	@echo "removed $(LIBEXEC)"
