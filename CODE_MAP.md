# Layered Code Map

`AGENTS.md` → `doc/CODE_MAP_INDEX.md` → module file list (`doc/codemap/<module>.md`) → file symbol pages (`doc/codemap/<file>-<hash>-<page>.md`) → source (`#L<line>`).

The code map indexes both repositories in this workspace:
- **`magpie-agent-cursor-bridge/`** (modifiable plugin repository): `bridge-root`, `bridge-lib`, `bridge-scripts`, `bridge-test`
- **`magpie/`** (read-only Magpie host/gateway reference repository): `magpie-agentplug`, `magpie-agent`, `magpie-plugin`, `magpie-gateway`, `magpie-provider`, `magpie-gui`, `magpie-cli`, `magpie-sessions`, `magpie-usage`, `magpie-privacy`, `magpie-storage`, `magpie-sys`
- **Workspace tooling**: `tooling` (`doc/codemap.mjs`, `doc/codemap.test.mjs`)

Pages contain at most 100 symbol/file rows by default. Read only the module and file pages needed; do not load the entire map into context.

## Commands

Run from the workspace root (`e:\W-AI_WorkSpace\magpie`):

```powershell
node doc/codemap.mjs                         # Incremental generation (use on first run or after cross-module/config edits)
node doc/codemap.mjs --module bridge-lib     # Refresh a single module when doc/.codemap-cache.json is already warm
node doc/codemap.mjs --check                 # Verify zero drift without writing files (exits non-zero on drift)
node --test doc/codemap.test.mjs             # Run code map generator self-tests
```

## Coverage Contract

`doc/codemap.config.json` defines the indexed roots (`magpie-agent-cursor-bridge`, `magpie`, `doc`), file extensions, exclusions, and output paths (`doc/CODE_MAP_INDEX.md`, `doc/codemap`, `doc/.codemap-cache.json`).

- **Included**:
  - All source, script, test, and patch files in `magpie-agent-cursor-bridge/` (excluding `node_modules/`).
  - All production Go, JS/MJS/CJS/TS, and build/shell scripts in `magpie/` (excluding `*_test.go`, `internal/gui/tests/`, `testdata/`, `site/`, `.github/`).
  - Tooling scripts in `doc/` (`doc/codemap.mjs`, `doc/codemap.test.mjs`).
- **Symbol extraction by language**:
  - **Go (`.go`)**: `web-tree-sitter` (`tree-sitter-go.wasm`): functions, methods (scoped to receiver type), structs and struct fields, interfaces and interface methods, type aliases/specs, and package-level `const`/`var` declarations.
  - **JS/TS/MJS/CJS (`.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`)**: TypeScript compiler AST: functions, arrow/function-valued variables, classes, constructors, methods, properties, interfaces, type aliases, enums, variable declarations/bindings, and export specifiers/assignments.
  - **Unified Diff / Patch (`.patch`)**: Target file headers (`+++ b/...`) and added Rust declarations (`fn`, `struct`, `enum`, `trait`, `impl`, `mod`, `const`, `type`) in `magpie-agent-cursor-bridge/source.patch`.
  - **Shell / PowerShell / Batch (`.sh`, `.command`, `.ps1`, `.bat`, `.cmd`)**: Lexical function/filter/class/enum declarations and batch labels.

`doc/codemap/` and `doc/CODE_MAP_INDEX.md` are exclusively generator-owned — **never edit them by hand**.

## Completion Checklist

1. Locate the target module in `doc/CODE_MAP_INDEX.md`, open its module page in `doc/codemap/<module>.md`, and jump to the file's symbol page and `#L<line>` source range.
2. Remember the repository boundary: **`magpie/` is strictly read-only**; all code changes must be made in `magpie-agent-cursor-bridge/` (or `doc/` tooling).
3. Run the relevant tests (`node --test magpie-agent-cursor-bridge/test/*.test.js`).
4. Run `node doc/codemap.mjs` and `node doc/codemap.mjs --check` after any file/code edit, and confirm 0 drift and 0 parser diagnostics.
