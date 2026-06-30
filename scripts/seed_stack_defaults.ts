#!/usr/bin/env bun

import { resolve } from "node:path"
import { ensureStackDefaults } from "../src/seed/defaults.ts"
import { stackAppRoot } from "../src/version.ts"

const stackRoot = resolve(process.argv[2] ?? stackAppRoot())
ensureStackDefaults(stackRoot, stackAppRoot())
console.log(`seed_stack_defaults_ok stack_root=${stackRoot}`)
