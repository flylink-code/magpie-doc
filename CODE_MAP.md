# Layered Code Map

`AGENTS.md` → `doc/CODE_MAP_INDEX.md` → `doc/codemap/hubs.md`（可选，跨模块）→ 模块文件列表（`doc/codemap/<module>.md`）→ 文件符号页（`doc/codemap/<file>-<hash>-<page>.md`）→ 源码（`#L<line>`）。

The code map indexes both repositories in this workspace:
- **`plugins/magpie-agent-cursor-bridge/`** (modifiable plugin repository): `bridge-root`, `bridge-lib`, `bridge-scripts`, `bridge-test`
- **`magpie/`** (read-only Magpie host/gateway reference repository): `magpie-agentplug`, `magpie-agent`, `magpie-plugin`, `magpie-gateway`, `magpie-provider`, `magpie-gui`, `magpie-cli`, `magpie-sessions`, `magpie-usage`, `magpie-privacy`, `magpie-storage`, `magpie-sys`
- **Workspace tooling**: `tooling` (`doc/codemap.mjs`, `doc/codemap.test.mjs`)

Pages contain at most 100 symbol/file rows by default. Read only the module and file pages needed; do not load the entire map into context.

## Commands

Run from the workspace root (`e:\W-AI_WorkSpace\magpie`):

```powershell
node doc/codemap.mjs                         # Incremental generation (first run, config change, cross-module edits)
node doc/codemap.mjs --module bridge-lib     # Refresh one module when doc/.codemap-cache.json is warm and nothing outside it changed
node doc/codemap.mjs --check                 # Verify zero drift without writing files (exits non-zero on drift)
node doc/codemap.mjs --find restoreProxy     # Symbol lookup: path:line, kind, scope
node doc/codemap.mjs --outline plugins/magpie-agent-cursor-bridge/agent.js   # Every declaration of one file, in source order
node doc/codemap.mjs --map --tokens 800      # Token-budgeted overview of the most-referenced declarations
node --test doc/codemap.test.mjs             # Run code map generator self-tests
```

`--find` / `--outline` / `--map` only read the cache; they never write generated files. Add `--json` for machine-readable `--find` / `--outline` output, `--limit N` to widen a lookup, `--tokens N` to resize the overview.

## Coverage Contract

`doc/codemap.config.json` defines the indexed roots (`plugins/magpie-agent-cursor-bridge`, `magpie`, `doc`), file extensions, exclusions, module routing, and output paths (`doc/CODE_MAP_INDEX.md`, `doc/codemap`, `doc/.codemap-cache.json`).

- **Included**:
  - All source, script, test, and patch files in `plugins/magpie-agent-cursor-bridge/` (excluding `node_modules/`).
  - All production Go, JS/MJS/CJS/TS/TSX, and build/shell scripts in `magpie/` (excluding `*_test.go`, `internal/gui/tests/`, `testdata/`, `site/`, `.github/`).
  - Tooling scripts in `doc/` (`doc/codemap.mjs`, `doc/codemap.test.mjs`).
- **Excluded on purpose**: `node_modules`, `target`, `dist`, `release`, `generated`, `testdata`, `site`, `.github`, `doc/codemap` (the map itself), and C/C++ headers under `magpie/native` / `magpie/internal/gui`.
- **Module routing** is data, not code: the `modules` map in `doc/codemap.config.json` maps a path prefix to a module name, longest prefix wins, and a trailing `*` only routes directories (`plugins/…/*/` turns `bin/` into `bridge-bin`). A path with no rule falls to `defaultModule` (`tooling`); inside `magpie/internal/` an unmapped subsystem deliberately stays in `magpie-sys` rather than getting a guessed name.

- **Symbol extraction by language**:
  - **Go (`.go`)**: `web-tree-sitter` (`tree-sitter-go.wasm`): functions, methods (name only — the receiver type is not recorded), structs and their fields, interface types, type specs, and package-level `const`/`var`.
  - **JS/TS/MJS/CJS/TSX (`.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`)**: TypeScript compiler AST: functions, arrow/function-valued variables, classes, constructors, methods, properties, interfaces, type aliases, enums, variable declarations/bindings, and export specifiers/assignments. Plain object-literal data keys are not symbols, so `agent.js` shows only `agent` and `connect`.
  - **Rust (`.rs`) / Python (`.py`)**: tree-sitter declarations (`fn`, `struct`, `enum`, `trait`, `impl`, `mod`, `const`, `type`, `def`, `class`). The only `.rs` trees in the plugin (`plugins/magpie-agent-cursor-bridge/.native-source/`, `.native-target/`) are git-ignored build scratch for `cursor-byok`, so no Rust source is indexed.
  - **Unified Diff / Patch (`.patch`)**: indexed as a file so `source.patch` stays reachable from `bridge-root`, but no declaration grammar covers diffs, so it contributes zero symbols. Read the patch itself for its added Rust items.
  - **Shell / PowerShell / Batch (`.sh`, `.command`, `.ps1`, `.bat`, `.cmd`)**: lexical function/filter/class/enum declarations and batch labels.

`doc/codemap/` and `doc/CODE_MAP_INDEX.md` are exclusively generator-owned — **never edit them by hand**.

## Reference Graph and Hubs

`doc/codemap/hubs.md` (and `--map`) rank declarations by how often other indexed files import them. Edges come from `import` / `require` (relative specifiers) for JS/TS and from `crate` / `self` / `super` module paths for Rust. This is lexical evidence, not type resolution: an import is counted as resolved, ambiguous, or unresolved and never guessed.

Consequences for this workspace:

- The hub ranking currently describes the plugin's JS modules only (`bridge-lib`, `bridge-root`, `tooling`). **Go imports produce no edges**, so a Go symbol's absence from `hubs.md` says nothing about how widely it is used; use `grep` / the editor's `usages` for Go.
- Current baseline: 65 edges resolved, 0 ambiguous, 111 unresolved (Node built-ins and Magpie-internal specifiers that no indexed file matches).

## Known Baseline

Recorded on the run that produced this map:

- 1235 source files, 51903 extracted symbols, 1511 generated pages.
- 10 parser diagnostics, all in Go, all the same cause: the bundled `tree-sitter-go` snapshot does not parse a generic instantiation whose type argument is a composite type literal, e.g. `lastgood.KeepUnparsed(p, lastgood.Into[map[string]applied])` in `magpie/internal/agent/applied.go:54`, `agent/stash.go:53`, `agent/wsl.go:1185`, `gateway/desktop.go:312`, `provider/codex_switch.go:305`, `provider/credits_daily.go:178`, `provider/stepfun_plan.go:242`, `provider/test_as.go:175`, `sessions/gateway_delete.go:81`, `sessions/wsl.go:252`.
- Declarations above and below those lines are still extracted; only that statement's subtree is affected. The count is a known grammar gap, not a generation bug — `--check` passes as long as it stays at 10.

## Completion Checklist

1. Locate the target module in `doc/CODE_MAP_INDEX.md`, open its module page in `doc/codemap/<module>.md`, and jump to the file's symbol page and `#L<line>` source range.
2. Remember the repository boundary: **`magpie/` is strictly read-only**; all code changes must be made in `plugins/magpie-agent-cursor-bridge/` (or `doc/` tooling).
3. Run the relevant tests (`node --test plugins/magpie-agent-cursor-bridge/test/*.test.js`).
4. Run `node doc/codemap.mjs` and `node doc/codemap.mjs --check` after any file/code edit, and confirm 0 drift and no diagnostics beyond the known 10.
