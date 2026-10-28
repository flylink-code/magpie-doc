import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { extract, generate, inventory, moduleOf } from './codemap.mjs';

const docDir = import.meta.dirname;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const projectConfig = () => JSON.parse(fs.readFileSync(path.join(docDir, 'codemap.config.json'), 'utf8'));

test('Go structs, interfaces, methods, functions and top-level bindings', async () => {
  const goCode = `package agentplug
var Formats = map[string]string{".json": "json"}
const MaxWait = 10
type Desc struct {
  ID string
  Name string
}
type Runner interface {
  Run() error
}
func Compile(spec string) (*Desc, error) {
  local := 1
  _ = local
  return nil, nil
}
func (d *Desc) check() error { return nil }
`;
  const result = await extract('magpie/internal/agentplug/agentplug.go', goCode);
  assert.deepEqual(result.diagnostics, []);
  for (const name of ['Formats', 'MaxWait', 'Desc', 'ID', 'Name', 'Runner', 'Compile', 'check']) {
    assert.ok(result.symbols.some(s => s.name === name), `missing Go symbol: ${name}`);
  }
  assert.ok(result.symbols.some(s => s.name === 'ID' && s.scope === 'Desc'));
  assert.ok(result.symbols.some(s => s.name === 'Desc' && s.kind === 'type_spec'));
  // Methods are listed by name; the receiver type is not part of the scope column.
  assert.ok(result.symbols.some(s => s.name === 'check' && s.kind === 'method_declaration'));
  // The shared tree-sitter kind set covers interface types but not their method signatures.
  assert.ok(!result.symbols.some(s => s.name === 'Run'));
  assert.ok(!result.symbols.some(s => s.name === 'local'));
});

test('JS/TS exports and functions; unified diffs carry navigation only', async () => {
  const jsResult = await extract('plugins/magpie-agent-cursor-bridge/agent.js', 'export const agent = { id: "cursor-bridge" }; export function connect({ gateway }) { return gateway; }');
  assert.deepEqual(jsResult.diagnostics, []);
  for (const name of ['agent', 'connect']) {
    assert.ok(jsResult.symbols.some(s => s.name === name), name);
  }
  // Object literal data keys are deliberately not symbols: agent.js is a data module.
  assert.ok(!jsResult.symbols.some(s => s.name === 'id'));

  // No grammar covers unified diffs, so source.patch is indexed as a file without declarations.
  const patchResult = await extract('plugins/magpie-agent-cursor-bridge/source.patch', '+++ b/server/src/config.rs\n+pub fn managed_data_dir() -> Result<PathBuf> {\n');
  assert.deepEqual(patchResult.symbols, []);
});

test('module routing comes from the configured rules', () => {
  const config = projectConfig();
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/agent.js', config), 'bridge-root');
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/lib/relay.js', config), 'bridge-lib');
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/scripts/build-native.sh', config), 'bridge-scripts');
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/test/relay.test.js', config), 'bridge-test');
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/bin/engine', config), 'bridge-bin');
  assert.equal(moduleOf('magpie/internal/agentplug/agentplug.go', config), 'magpie-agentplug');
  assert.equal(moduleOf('magpie/internal/gateway/gateway.go', config), 'magpie-gateway');
  assert.equal(moduleOf('magpie/internal/pluginrt/runtime.go', config), 'magpie-plugin');
  assert.equal(moduleOf('magpie/plugins/usage/usage.go', config), 'magpie-plugin');
  assert.equal(moduleOf('magpie/native/privacy-filter/pf-serve.cpp', config), 'magpie-privacy');
  assert.equal(moduleOf('magpie/main.go', config), 'magpie-cli');
  // A subsystem without its own rule stays in the system bucket instead of being guessed.
  assert.equal(moduleOf('magpie/internal/somewhere_new/file.go', config), 'magpie-sys');
  assert.equal(moduleOf('doc/codemap.mjs', config), 'tooling');
});

test('multi-repo incremental generation, drift detection and stale page cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-fixture-'));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  try {
    const config = projectConfig();
    config.pageRows = 2;
    write('doc/codemap.config.json', JSON.stringify(config));
    write('plugins/magpie-agent-cursor-bridge/agent.js', 'export const A = 1;\nexport const B = 2;\nexport const C = 3;\n');
    write('magpie/internal/agentplug/agentplug.go', 'package agentplug\nfunc Load() {}\n');
    write('magpie/internal/agentplug/agentplug_test.go', 'package agentplug\nfunc TestSkipped() {}\n');
    git(path.join(root, 'plugins/magpie-agent-cursor-bridge'), 'init', '--quiet');
    git(path.join(root, 'magpie'), 'init', '--quiet');

    const first = await generate(root);
    assert.equal(first.files, 2);
    assert.equal(first.diagnostics, 0);
    assert.equal(first.deleted, 0);
    assert.ok(fs.existsSync(path.join(root, 'doc', 'CODE_MAP_INDEX.md')));
    assert.ok(fs.existsSync(path.join(root, 'doc', 'codemap', 'hubs.md')));
    // 3 symbols on pageRows 2 means two symbol pages for agent.js.
    assert.ok(fs.existsSync(path.join(root, 'doc', 'codemap', 'plugins_magpie-agent-cursor-bridge_agent.js-0486eb1d-2.md')));

    assert.equal((await generate(root)).changed, 0);
    await generate(root, { check: true });

    write('plugins/magpie-agent-cursor-bridge/agent.js', 'export const A = 2;\nexport const B = 2;\nexport const C = 3;\nexport const D = 4;\n');
    await assert.rejects(generate(root, { check: true }), /Stale/);
    const updated = await generate(root, { module: 'bridge-root' });
    assert.equal(updated.parsed, 1);
    await generate(root, { check: true });

    write('doc/codemap/leftover.md', '# stale\n');
    const cleaned = await generate(root);
    assert.equal(cleaned.deleted, 1);
    assert.ok(!fs.existsSync(path.join(root, 'doc', 'codemap', 'leftover.md')));
    assert.ok(!inventory(root, config).some(f => f.endsWith('_test.go')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
