import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '..');
const localRequire = createRequire(import.meta.url);
const fallbackCandidates = [
  path.resolve(scriptDir, '..', '..', 'Ai-Switcher', 'package.json'),
  path.resolve(scriptDir, '..', 'Ai-Switcher', 'package.json')
];
const fallbackPkg = fallbackCandidates.find(p => fs.existsSync(p));
const fallbackRequire = fallbackPkg ? createRequire(fallbackPkg) : localRequire;

function resolvePackage(specifier) {
  try {
    return localRequire.resolve(specifier);
  } catch {
    return fallbackRequire.resolve(specifier);
  }
}

const ts = localRequire(resolvePackage('typescript'));
const { Parser, Language } = await import(pathToFileURL(resolvePackage('web-tree-sitter')).href);

const hash = text => createHash('sha256').update(text).digest('hex');
const normalize = text => text.replace(/\r\n/g, '\n');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const grammars = new Map();
const rustKinds = new Set([
  'function_item', 'function_signature_item', 'struct_item', 'union_item',
  'enum_item', 'enum_variant', 'trait_item', 'type_item', 'associated_type',
  'const_item', 'static_item', 'mod_item', 'macro_definition', 'field_declaration'
]);

async function parserFor(language) {
  if (!grammars.has(language)) {
    await Parser.init();
    const parser = new Parser();
    const wasmPath = resolvePackage(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`);
    parser.setLanguage(await Language.load(wasmPath));
    grammars.set(language, parser);
  }
  return grammars.get(language);
}

export async function extract(file, text) {
  const symbols = [];
  const diagnostics = [];
  const add = (name, kind, line, scope = '') => symbols.push({ name, kind, line, scope });

  if (/\.(?:[cm]?js|tsx?)$/.test(file)) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const kinds = new Set([
      ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration,
      ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.TypeAliasDeclaration,
      ts.SyntaxKind.EnumDeclaration, ts.SyntaxKind.EnumMember,
      ts.SyntaxKind.ModuleDeclaration, ts.SyntaxKind.MethodDeclaration,
      ts.SyntaxKind.MethodSignature, ts.SyntaxKind.PropertyDeclaration,
      ts.SyntaxKind.PropertySignature, ts.SyntaxKind.GetAccessor,
      ts.SyntaxKind.SetAccessor, ts.SyntaxKind.VariableDeclaration,
      ts.SyntaxKind.TypeParameter, ts.SyntaxKind.BindingElement
    ]);
    const walk = (node, scope = '') => {
      let next = scope;
      const namedExpression = ts.isFunctionExpression(node) || ts.isClassExpression(node);
      const callableProperty = ts.isPropertyAssignment(node) && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
      if ((kinds.has(node.kind) || namedExpression || callableProperty) && node.name) {
        const name = node.name.getText(source);
        add(name, ts.SyntaxKind[node.kind], source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, scope);
        next = scope ? `${scope}.${name}` : name;
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && !node.name) {
        add('default', ts.SyntaxKind[node.kind], source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, scope);
        next = 'default';
      } else if (ts.isConstructorDeclaration(node)) {
        add('constructor', 'Constructor', source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, scope);
      } else if (ts.isExportAssignment(node)) {
        add('default', 'ExportAssignment', source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, scope);
      } else if (ts.isExportSpecifier(node)) {
        add(node.name.text, 'ExportSpecifier', source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, scope);
      }
      ts.forEachChild(node, child => walk(child, next));
    };
    walk(source);
    diagnostics.push(...source.parseDiagnostics.map(d => `line ${source.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`));
  } else if (file.endsWith('.go')) {
    const parser = await parserFor('go');
    let tree = parser.parse(text);
    if (tree.rootNode.hasError) {
      tree.delete();
      const normalized = text.replace(/(?<=\.[A-Za-z0-9_]+)\[(?:map\[[^\]\n]+\][^\])\n]*|\[\][A-Za-z0-9_*]+)\]/g, m => ' '.repeat(m.length));
      tree = parser.parse(normalized);
    }
    const walk = (node, scope = '') => {
      let next = scope;
      if (node.type === 'function_declaration') {
        const name = node.childForFieldName('name');
        if (name) {
          add(name.text, 'function_declaration', node.startPosition.row + 1, scope);
          next = scope ? `${scope}.${name.text}` : name.text;
        }
      } else if (node.type === 'method_declaration') {
        const name = node.childForFieldName('name');
        const recv = node.childForFieldName('receiver');
        const recvType = recv?.namedChildren[0]?.childForFieldName('type')?.text ?? recv?.text ?? '';
        const methodScope = recvType || scope;
        if (name) {
          add(name.text, 'method_declaration', node.startPosition.row + 1, methodScope);
          next = methodScope ? `${methodScope}.${name.text}` : name.text;
        }
      } else if (node.type === 'type_spec' || node.type === 'type_alias') {
        const name = node.childForFieldName('name');
        const typeNode = node.childForFieldName('type');
        if (name) {
          const kind = typeNode?.type === 'struct_type' ? 'struct_type' : typeNode?.type === 'interface_type' ? 'interface_type' : node.type;
          add(name.text, kind, node.startPosition.row + 1, scope);
          next = scope ? `${scope}.${name.text}` : name.text;
        }
      } else if (node.type === 'field_declaration' && scope) {
        for (const child of node.namedChildren) {
          if (child.type === 'field_identifier') {
            add(child.text, 'field_declaration', node.startPosition.row + 1, scope);
          }
        }
      } else if ((node.type === 'method_spec' || node.type === 'method_elem') && scope) {
        const name = node.childForFieldName('name');
        if (name) add(name.text, 'method_spec', node.startPosition.row + 1, scope);
      } else if ((node.type === 'const_spec' || node.type === 'var_spec') && !scope) {
        for (const child of node.namedChildren) {
          if (child.type === 'identifier') {
            add(child.text, node.type, child.startPosition.row + 1, scope);
          }
        }
      }
      if (node.type === 'ERROR' || node.isMissing) diagnostics.push(`line ${node.startPosition.row + 1}: ${node.type}`);
      for (const child of node.namedChildren) walk(child, next);
    };
    walk(tree.rootNode);
    tree.delete();
  } else if (/\.(rs|py)$/.test(file)) {
    const language = file.endsWith('.rs') ? 'rust' : 'python';
    const input = language === 'rust' ? text.replace(/^(\s*)#!(?=\[)/gm, '$1# ') : text;
    const tree = (await parserFor(language)).parse(input);
    const walk = (node, scope = '') => {
      let next = scope;
      const name = node.childForFieldName('name');
      if ((language === 'rust' && rustKinds.has(node.type)) || (language !== 'rust' && ['function_definition', 'class_definition'].includes(node.type))) {
        if (name) {
          add(name.text, node.type, node.startPosition.row + 1, scope);
          next = scope ? `${scope}::${name.text}` : name.text;
        }
      }
      if (node.type === 'impl_item') {
        next = [node.childForFieldName('trait')?.text, node.childForFieldName('type')?.text].filter(Boolean).join(' for ');
        add(next, 'impl', node.startPosition.row + 1, scope);
      }
      if (node.type === 'macro_invocation') {
        add(node.childForFieldName('macro')?.text ?? 'macro', 'macro invocation (unexpanded)', node.startPosition.row + 1, scope);
      }
      if (node.type === 'ERROR' || node.isMissing) diagnostics.push(`line ${node.startPosition.row + 1}: ${node.type}`);
      for (const child of node.namedChildren) walk(child, next);
    };
    walk(tree.rootNode);
    tree.delete();
  } else if (file.endsWith('.patch')) {
    let currentTarget = '';
    for (const [index, line] of text.split('\n').entries()) {
      const header = /^\+\+\+\s+b\/(\S+)/.exec(line);
      if (header) {
        currentTarget = header[1];
        add(currentTarget, 'patch target', index + 1);
        continue;
      }
      const rustDecl = /^\+\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|mod|const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (rustDecl) {
        add(rustDecl[2], `patch ${rustDecl[1]}`, index + 1, currentTarget);
      }
    }
  } else {
    for (const [index, line] of text.split('\n').entries()) {
      if (file.endsWith('.ps1')) {
        const match = /^\s*(?:function|filter|class|enum)\s+([\w:-]+)/i.exec(line);
        if (match) add(match[1], 'lexical declaration', index + 1);
      } else if (file.endsWith('.bat') || file.endsWith('.cmd')) {
        const match = /^:([\w-]+)\s*$/.exec(line);
        if (match) add(match[1], 'batch label', index + 1);
      } else {
        const match = /^\s*(?:function\s+([\w:-]+)(?:\s*\(\s*\))?|([\w:-]+)\s*\(\s*\))\s*\{?/.exec(line);
        const name = match?.[1] || match?.[2];
        if (name && !['if', 'for', 'while', 'case', 'select'].includes(name)) {
          add(name, 'shell function', index + 1);
        }
      }
    }
  }
  return { symbols, diagnostics };
}

const MAGPIE_MODULE_GROUPS = new Map([
  ['agentplug', 'magpie-agentplug'],
  ['agent', 'magpie-agent'],
  ['agentenv', 'magpie-agent'],
  ['plugin', 'magpie-plugin'],
  ['pluginrt', 'magpie-plugin'],
  ['jsmod', 'magpie-plugin'],
  ['gateway', 'magpie-gateway'],
  ['gwbudget', 'magpie-gateway'],
  ['gwmw', 'magpie-gateway'],
  ['gwtool', 'magpie-gateway'],
  ['routes', 'magpie-gateway'],
  ['upstream', 'magpie-gateway'],
  ['middleware', 'magpie-gateway'],
  ['provider', 'magpie-provider'],
  ['catalog', 'magpie-provider'],
  ['codexcat', 'magpie-provider'],
  ['claudebridge', 'magpie-provider'],
  ['claudecode', 'magpie-provider'],
  ['qoder', 'magpie-provider'],
  ['mcpauth', 'magpie-provider'],
  ['gui', 'magpie-gui'],
  ['tui', 'magpie-gui'],
  ['fonts', 'magpie-gui'],
  ['iconproxy', 'magpie-gui'],
  ['webview2env', 'magpie-gui'],
  ['shortcut', 'magpie-gui'],
  ['cli', 'magpie-cli'],
  ['daemon', 'magpie-cli'],
  ['handoff', 'magpie-cli'],
  ['autostart', 'magpie-cli'],
  ['awake', 'magpie-cli'],
  ['update', 'magpie-cli'],
  ['omarchy', 'magpie-cli'],
  ['sessions', 'magpie-sessions'],
  ['codexsummary', 'magpie-sessions'],
  ['library', 'magpie-sessions'],
  ['usage', 'magpie-usage'],
  ['usageapi', 'magpie-usage'],
  ['budget', 'magpie-usage'],
  ['stats', 'magpie-usage'],
  ['otlp', 'magpie-usage'],
  ['probelog', 'magpie-usage'],
  ['redact', 'magpie-privacy'],
  ['masking', 'magpie-privacy'],
  ['maskrec', 'magpie-privacy'],
  ['pii', 'magpie-privacy'],
  ['access', 'magpie-privacy'],
  ['ghtoken', 'magpie-privacy'],
  ['settings', 'magpie-storage'],
  ['profile', 'magpie-storage'],
  ['appdir', 'magpie-storage'],
  ['desktopdir', 'magpie-storage'],
  ['davsync', 'magpie-storage'],
  ['backup', 'magpie-storage'],
  ['edit', 'magpie-storage'],
  ['filelock', 'magpie-storage'],
  ['filememo', 'magpie-storage'],
  ['lastgood', 'magpie-storage'],
  ['sqlitedb', 'magpie-storage'],
  ['source', 'magpie-storage'],
  ['steady', 'magpie-storage']
]);

export function moduleOf(file) {
  const parts = file.split('/');
  if (parts[0] === 'plugins') parts.shift();
  if (parts[0] === 'magpie-agent-cursor-bridge') {
    if (parts.length === 2) return 'bridge-root';
    if (parts[1] === 'lib') return 'bridge-lib';
    if (parts[1] === 'scripts') return 'bridge-scripts';
    if (parts[1] === 'test') return 'bridge-test';
    return `bridge-${parts[1]}`;
  }
  if (parts[0] === 'magpie') {
    if (parts.length === 2) return 'magpie-cli';
    if (parts[1] === 'plugins') return 'magpie-plugin';
    if (parts[1] === 'native') return 'magpie-privacy';
    if (parts[1] === 'build') return 'magpie-sys';
    if (parts[1] === 'internal' && parts.length >= 3) {
      return MAGPIE_MODULE_GROUPS.get(parts[2]) || 'magpie-sys';
    }
    return 'magpie-sys';
  }
  if (parts[0] === 'doc') return 'tooling';
  if (parts[0] === 'src-tauri' && parts[1] === 'src') return `rust-${parts.length > 3 ? parts[2] : 'root'}`;
  if (parts[0] === 'src') return `web-${parts.length > 2 ? parts[1] : 'root'}`;
  if (parts[0] === 'scripts') return `scripts-${parts.length > 2 ? parts[1] : 'root'}`;
  return 'tooling';
}

export function eligible(file, config) {
  const parts = file.split('/');
  if (parts.some(part => config.excludeSegments.includes(part))) return false;
  if (Array.isArray(config.excludePatterns) && config.excludePatterns.some(pattern => new RegExp(pattern).test(file))) return false;
  if (!(config.roots.some(root => file.startsWith(`${root}/`)) || !file.includes('/'))) return false;
  return config.extensions.includes(path.extname(file));
}

function gitList(dir) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  }).split('\0').filter(Boolean);
}

function walkNonGitDir(root, relDir, excludeSegments, out) {
  const absDir = path.join(root, relDir);
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (excludeSegments.includes(entry.name)) continue;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkNonGitDir(root, relPath, excludeSegments, out);
    else if (entry.isFile()) out.add(relPath);
  }
}

export function inventory(root, config) {
  const discovered = new Set();
  const rootHasGit = fs.existsSync(path.join(root, '.git'));
  if (rootHasGit) {
    for (const file of gitList(root)) discovered.add(file);
  } else {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) discovered.add(entry.name);
    }
  }
  for (const sub of config.roots) {
    const subDir = path.join(root, sub);
    if (fs.existsSync(path.join(subDir, '.git'))) {
      for (const file of gitList(subDir)) discovered.add(`${sub}/${file}`);
    } else if (!rootHasGit && fs.existsSync(subDir)) {
      walkNonGitDir(root, sub, config.excludeSegments, discovered);
    }
  }
  return [...discovered]
    .filter(file => eligible(file, config))
    .filter(file => fs.existsSync(path.join(root, file)) && fs.lstatSync(path.join(root, file)).isFile())
    .sort(compare);
}

const escape = value => String(value).replaceAll('|', '\\|').replaceAll('`', "'").replace(/\s+/g, ' ');
const link = file => file.split('/').map(encodeURIComponent).join('/');
const posixRel = (fromDir, toPath) => path.posix.relative(fromDir.replace(/\\/g, '/'), toPath.replace(/\\/g, '/'));

function resolveConfigPath(root) {
  const inDoc = path.join(root, 'doc', 'codemap.config.json');
  if (fs.existsSync(inDoc)) return inDoc;
  return path.join(root, 'codemap.config.json');
}

export async function generate(root = defaultRoot, { check = false, module: selected } = {}) {
  const configPath = resolveConfigPath(root);
  const configText = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configText);
  if (!Number.isInteger(config.pageRows) || config.pageRows < 1 || config.pageRows > 150) throw new Error('pageRows must be 1..150');
  const mapDirRel = (config.outputDir || 'doc/codemap').replace(/\\/g, '/').replace(/\/+$/, '');
  const indexFileRel = (config.indexFile || 'doc/CODE_MAP_INDEX.md').replace(/\\/g, '/');
  const cacheFileRel = (config.cacheFile || 'doc/.codemap-cache.json').replace(/\\/g, '/');
  const indexDirRel = path.posix.dirname(indexFileRel);
  const mapFromIndex = posixRel(indexDirRel === '.' ? '' : indexDirRel, mapDirRel);
  const indexFromMap = posixRel(mapDirRel, indexFileRel);
  const depth = mapDirRel.split('/').filter(Boolean).length;
  const relRoot = '../'.repeat(depth);

  const version = hash(normalize(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')) + configText);
  const cachePath = path.join(root, ...cacheFileRel.split('/'));
  let cache = {};
  if (!check && fs.existsSync(cachePath)) {
    try {
      const stored = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (stored.version === version) cache = stored.files;
    } catch { /* Rebuild invalid local cache. */ }
  }
  const records = {};
  let parsed = 0;
  const files = inventory(root, config);
  if (selected && !files.some(file => moduleOf(file) === selected) && !Object.keys(cache).some(file => moduleOf(file) === selected)) {
    throw new Error(`Unknown module: ${selected}`);
  }
  for (const file of files) {
    const text = normalize(fs.readFileSync(path.join(root, file), 'utf8'));
    const digest = hash(text);
    if (cache[file]?.hash === digest) records[file] = cache[file];
    else {
      if (selected && moduleOf(file) !== selected) throw new Error(`Changed uncached file outside ${selected}: ${file}; run node doc/codemap.mjs`);
      records[file] = { hash: digest, ...await extract(file, text) };
      parsed++;
    }
  }
  if (selected && Object.keys(cache).some(file => !records[file] && moduleOf(file) !== selected)) {
    throw new Error('Deletion outside selected module; run node doc/codemap.mjs');
  }
  const outputs = new Map();
  const modules = [...new Set(files.map(moduleOf))].sort(compare);
  const index = [
    '# Code map index',
    '',
    '<!-- Generated by doc/codemap.mjs; do not edit. -->',
    '',
    'Read AGENTS.md → choose module → file/symbol page → source. [Method, commands and limits](CODE_MAP.md).',
    '',
    '| Module | Files | Symbols | Map |',
    '| --- | ---: | ---: | --- |'
  ];
  let totalSymbols = 0;
  let diagnostics = 0;
  for (const module of modules) {
    const members = files.filter(file => moduleOf(file) === module);
    const count = members.reduce((sum, file) => sum + records[file].symbols.length, 0);
    totalSymbols += count;
    index.push(`| ${module} | ${members.length} | ${count} | [open](${mapFromIndex}/${module}.md) |`);
    const moduleRows = [];
    for (const file of members) {
      const record = records[file];
      diagnostics += record.diagnostics.length;
      const slug = file.replace(/[^a-zA-Z0-9.-]/g, '_') + '-' + hash(file).slice(0, 8);
      const pages = Math.max(1, Math.ceil(record.symbols.length / config.pageRows));
      const pageLinks = [];
      for (let i = 0; i < pages; i++) {
        const name = `${slug}-${i + 1}.md`;
        pageLinks.push(`[${i + 1}](${name})`);
        const rows = [
          '# ' + file,
          '',
          '<!-- Generated by doc/codemap.mjs; do not edit. -->',
          '',
          `[Module](${module}.md) · [Source](${relRoot}${link(file)}) · page ${i + 1}/${pages}`,
          '',
          `Source SHA-256: ${record.hash}`,
          '',
          '| Symbol | Kind | Scope | Line |',
          '| --- | --- | --- | ---: |'
        ];
        for (const symbol of record.symbols.slice(i * config.pageRows, (i + 1) * config.pageRows)) {
          rows.push(`| ${escape(symbol.name)} | ${escape(symbol.kind)} | ${escape(symbol.scope)} | [${symbol.line}](${relRoot}${link(file)}#L${symbol.line}) |`);
        }
        if (!record.symbols.length) rows.push('| (no extracted declarations) | | | |');
        if (record.diagnostics.length) {
          rows.push('', `Parser recovery: ${record.diagnostics.length} diagnostic(s). Inspect source; extraction may be incomplete.`, ...record.diagnostics.slice(0, 8).map(item => `- ${escape(item)}`));
        }
        outputs.set(`${mapDirRel}/${name}`, rows.join('\n') + '\n');
      }
      moduleRows.push(`| [${file}](${relRoot}${link(file)}) | ${record.symbols.length} | ${pageLinks.join(' ')} |`);
    }
    const chunks = Math.ceil(moduleRows.length / config.pageRows);
    for (let i = 0; i < chunks; i++) {
      const name = i ? `${module}-${i + 1}.md` : `${module}.md`;
      outputs.set(`${mapDirRel}/${name}`, [
        `# ${module}`,
        '',
        '<!-- Generated by doc/codemap.mjs; do not edit. -->',
        '',
        `[Root index](${indexFromMap})`,
        '',
        ...Array.from({ length: chunks }, (_, n) => `[Files ${n + 1}](${n ? `${module}-${n + 1}` : module}.md)`),
        '',
        '| File | Symbols | Symbol pages |',
        '| --- | ---: | --- |',
        ...moduleRows.slice(i * config.pageRows, (i + 1) * config.pageRows),
        ''
      ].join('\n'));
    }
  }
  index.push('', `Total: ${files.length} source files, ${totalSymbols} extracted symbols, ${diagnostics} parser diagnostics.`, '', 'Scope includes Go/Rust/TS/JS declarations; excludes imports, parameters, runtime/macro-generated symbols. Shell/PowerShell/BAT/Patch use lexical navigation.');
  outputs.set(indexFileRel, index.join('\n') + '\n');
  const directory = path.join(root, ...mapDirRel.split('/'));
  const stale = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.md') && !outputs.has(`${mapDirRel}/${name}`)) : [];
  const changed = [...outputs].filter(([file, text]) => !fs.existsSync(path.join(root, file)) || normalize(fs.readFileSync(path.join(root, file), 'utf8')) !== text);
  if (!check) {
    fs.mkdirSync(directory, { recursive: true });
    for (const [file, text] of changed) {
      const targetPath = path.join(root, ...file.split('/'));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, text);
    }
    for (const file of stale) fs.unlinkSync(path.join(directory, file));
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ version, files: records }));
  }
  const result = { files: files.length, symbols: totalSymbols, diagnostics, parsed, changed: changed.length, deleted: stale.length, pages: outputs.size };
  if (check && (changed.length || stale.length)) throw new Error(`Stale code map: ${JSON.stringify(result)}. Run node doc/codemap.mjs and include generated changes.`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const valid = new Set(['--check', '--module']);
    for (let i = 0; i < args.length; i++) {
      if (!valid.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
      if (args[i] === '--module' && !args[++i]) throw new Error('--module needs a name');
    }
    const result = await generate(defaultRoot, {
      check: args.includes('--check'),
      module: args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
