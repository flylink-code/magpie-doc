import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { extract, generate, inventory, moduleOf } from './codemap.mjs';

const docDir = import.meta.dirname;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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
  for (const name of ['Formats', 'MaxWait', 'Desc', 'ID', 'Name', 'Runner', 'Run', 'Compile', 'check']) {
    assert.ok(result.symbols.some(s => s.name === name), `missing Go symbol: ${name}`);
  }
  assert.ok(result.symbols.some(s => s.name === 'ID' && s.scope === 'Desc'));
  assert.ok(result.symbols.some(s => s.name === 'Run' && s.scope === 'Runner'));
  assert.ok(result.symbols.some(s => s.name === 'check' && s.scope === '*Desc'));
  assert.ok(!result.symbols.some(s => s.name === 'local'));
});

test('JS/TS exports, functions, classes and patch/shell lexical navigation', async () => {
  const jsResult = await extract('plugins/magpie-agent-cursor-bridge/agent.js', 'export const agent = { id: "cursor-bridge" }; export function connect({ gateway }) { return gateway; }');
  assert.deepEqual(jsResult.diagnostics, []);
  for (const name of ['agent', 'connect']) {
    assert.ok(jsResult.symbols.some(s => s.name === name), name);
  }
  const patchResult = await extract('plugins/magpie-agent-cursor-bridge/source.patch', '+++ b/server/src/config.rs\n+pub fn managed_data_dir() -> Result<PathBuf> {\n+pub struct LocalCatalogOnly;\n');
  assert.ok(patchResult.symbols.some(s => s.name === 'server/src/config.rs' && s.kind === 'patch target'));
  assert.ok(patchResult.symbols.some(s => s.name === 'managed_data_dir' && s.scope === 'server/src/config.rs'));
  assert.ok(patchResult.symbols.some(s => s.name === 'LocalCatalogOnly' && s.scope === 'server/src/config.rs'));
});

test('module routing and multi-repo incremental generation', async () => {
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/agent.js'), 'bridge-root');
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/lib/relay.js'), 'bridge-lib');
  assert.equal(moduleOf('plugins/magpie-agent-cursor-bridge/test/relay.test.js'), 'bridge-test');
  assert.equal(moduleOf('magpie/internal/agentplug/agentplug.go'), 'magpie-agentplug');
  assert.equal(moduleOf('magpie/internal/gateway/gateway.go'), 'magpie-gateway');
  assert.equal(moduleOf('doc/codemap.mjs'), 'tooling');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-fixture-'));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  try {
    const config = JSON.parse(fs.readFileSync(path.join(docDir, 'codemap.config.json'), 'utf8'));
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
    assert.equal((await generate(root)).changed, 0);
    await generate(root, { check: true });

    write('plugins/magpie-agent-cursor-bridge/agent.js', 'export const A = 2;\nexport const B = 2;\nexport const C = 3;\n');
    await assert.rejects(generate(root, { check: true }), /Stale/);
    const updated = await generate(root, { module: 'bridge-root' });
    assert.equal(updated.parsed, 1);
    await generate(root, { check: true });
    assert.ok(!inventory(root, config).some(f => f.endsWith('_test.go')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
