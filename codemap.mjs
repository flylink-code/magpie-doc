import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultRoot = path.resolve(scriptDir, '..');
const hash = text => createHash('sha256').update(text).digest('hex');
const normalize = text => text.replace(/\r\n/g, '\n');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rel = file => file.split('\\').join('/');

// Dependencies are resolved from the workspace first, then from CODEMAP_REQUIRE_FROM,
// then from the sibling installs that share this machine. Nothing is installed here.
const requireScopes = [];
const addScope = candidate => {
  if (!candidate) return;
  const pkg = candidate.endsWith('.json') ? candidate : path.join(candidate, 'package.json');
  if (!fs.existsSync(pkg)) return;
  try {
    requireScopes.push(createRequire(pkg));
  } catch {
    /* Unreadable package.json; try the next scope. */
  }
};
addScope(scriptDir);
addScope(path.resolve(scriptDir, '..'));
addScope(path.resolve(scriptDir, '..', '..'));
if (process.env.CODEMAP_REQUIRE_FROM) addScope(path.resolve(process.env.CODEMAP_REQUIRE_FROM));
for (const sibling of ['Ai-Switcher', 'magpie']) {
  addScope(path.resolve(scriptDir, '..', '..', sibling));
  addScope(path.resolve(scriptDir, '..', sibling));
}
requireScopes.push(createRequire(import.meta.url));

const resolvePackage = specifier => {
  for (const scope of requireScopes) {
    try {
      return scope.resolve(specifier);
    } catch {
      /* Not visible from this scope. */
    }
  }
  throw new Error(`Cannot resolve "${specifier}". Install typescript, web-tree-sitter and tree-sitter-wasms in the workspace, or point CODEMAP_REQUIRE_FROM at a directory whose node_modules provides them.`);
};

const ts = requireScopes.map(scope => {
  try {
    return scope('typescript');
  } catch {
    return null;
  }
}).find(Boolean);
if (!ts) throw new Error('Cannot load typescript. See CODEMAP_REQUIRE_FROM in doc/CODE_MAP.md.');
const { Parser, Language } = await import(pathToFileURL(resolvePackage('web-tree-sitter')).href);

const grammars = new Map();
const rustKinds = new Set([
  'function_item', 'function_signature_item', 'struct_item', 'union_item',
  'enum_item', 'enum_variant', 'trait_item', 'type_item', 'associated_type',
  'const_item', 'static_item', 'mod_item', 'macro_definition', 'field_declaration'
]);
const treeLanguages = {
  '.cs': 'c_sharp', '.go': 'go', '.java': 'java',
  '.c': 'c', '.h': 'cpp', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp'
};
const treeKinds = new Set([
  'namespace_declaration', 'file_scoped_namespace_declaration', 'class_declaration',
  'struct_declaration', 'interface_declaration', 'record_declaration', 'enum_declaration',
  'enum_member_declaration', 'method_declaration', 'constructor_declaration', 'property_declaration',
  'event_declaration', 'delegate_declaration', 'field_declaration', 'function_declaration',
  'function_definition', 'method_definition', 'type_spec', 'type_definition', 'union_specifier',
  'struct_specifier', 'enum_specifier', 'class_specifier', 'interface_type', 'const_spec',
  'var_spec', 'enum_constant', 'variable_declarator'
]);
const REFERENCE_KINDS = new Set([
  'function_item', 'struct_item', 'union_item', 'enum_item', 'trait_item', 'type_item',
  'const_item', 'static_item', 'macro_definition', 'mod_item',
  'FunctionDeclaration', 'ClassDeclaration', 'InterfaceDeclaration', 'TypeAliasDeclaration',
  'EnumDeclaration', 'VariableDeclaration', 'ModuleDeclaration'
]);
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];

async function parserFor(language) {
  if (!grammars.has(language)) {
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load(resolvePackage(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`)));
    grammars.set(language, parser);
  }
  return grammars.get(language);
}

export async function extract(file, text) {
  const symbols = [];
  const diagnostics = [];
  const add = (name, kind, line, scope = '') => symbols.push({ name, kind, line, scope });

  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
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
  } else if (/\.(rs|py)$/.test(file) || treeLanguages[path.extname(file).toLowerCase()]) {
    const language = file.endsWith('.rs') ? 'rust' : file.endsWith('.py') ? 'python' : treeLanguages[path.extname(file).toLowerCase()];
    // This grammar snapshot mistakes Rust inner attributes for shebangs. Treat
    // them as outer attributes for declaration extraction, preserving offsets.
    const input = language === 'rust' ? text.replace(/^(\s*)#!(?=\[)/gm, '$1# ') : text;
    const tree = (await parserFor(language)).parse(input);
    const walk = (node, scope = '') => {
      let next = scope;
      let name = node.childForFieldName('name');
      if (!name && ['function_definition', 'function_declaration', 'method_definition'].includes(node.type)) {
        let declarator = node.childForFieldName('declarator');
        while (declarator && !['identifier', 'field_identifier', 'qualified_identifier'].includes(declarator.type)) declarator = declarator.childForFieldName('declarator');
        name = declarator;
      }
      if ((language === 'rust' && rustKinds.has(node.type)) || (language === 'python' && ['function_definition', 'class_definition'].includes(node.type)) || (treeLanguages[path.extname(file).toLowerCase()] && treeKinds.has(node.type))) {
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
  } else {
    // PowerShell/BAT have no bundled grammar: expose only declaration/label navigation.
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
  return { symbols, diagnostics, imports: extractImports(file, text) };
}

const RUST_USE_BLOCK = /(?:^|\n)[ \t]*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/g;
const TS_IMPORT_BLOCK = /^[ \t]*(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;

// Import-level edges only: what a file asks for, not what a type checker binds.
export function extractImports(file, text) {
  const imports = [];
  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
    for (const match of text.matchAll(TS_IMPORT_BLOCK)) {
      const [spec, source] = [match[1], match[2]];
      const names = [];
      const defaultImport = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(spec);
      if (defaultImport) names.push(defaultImport[1]);
      const braces = /\{([\s\S]*?)\}/.exec(spec);
      if (braces) {
        for (const item of braces[1].split(',')) {
          const name = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
        }
      }
      if (names.length) imports.push({ names: [...new Set(names)], specifier: source });
    }
  } else if (file.endsWith('.rs')) {
    for (const match of text.matchAll(RUST_USE_BLOCK)) {
      for (const leaf of parseRustUse(match[1])) imports.push({ names: [leaf.name], prefix: leaf.prefix });
    }
  }
  return imports;
}

// `use a::b::{C, D as E, self, f::*};` -> [{name:'C', prefix:['a','b']}, {name:'D', prefix:['a','b']},
// {name:'b', prefix:['a']}]. Aliases keep the original name: the edge points at the declaration.
function parseRustUse(body) {
  const leaves = [];
  const stack = [];
  let segments = [];
  let current = '';
  const flush = () => {
    const text = current.trim().replace(/\s+as\s+[\w]+\s*$/, '');
    current = '';
    if (!text) return;
    if (text === 'self') {
      if (segments.length) leaves.push({ name: segments[segments.length - 1], prefix: segments.slice(0, -1) });
      return;
    }
    if (text === '*' || text.endsWith('::*')) return;
    const parts = text.split('::').map(part => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const name = parts[parts.length - 1];
    if (/^[A-Za-z_]\w*$/.test(name)) leaves.push({ name, prefix: [...segments, ...parts.slice(0, -1)] });
  };
  for (const char of body.replace(/\/\/[^\n]*/g, ' ')) {
    if (char === '{') {
      stack.push(segments);
      const pending = current.trim().replace(/::$/, '');
      segments = [...segments, ...(pending ? pending.split('::').map(part => part.trim()).filter(Boolean) : [])];
      current = '';
    } else if (char === '}') {
      flush();
      segments = stack.pop() ?? [];
    } else if (char === ',') {
      flush();
    } else {
      current += char;
    }
  }
  flush();
  return leaves;
}

const moduleRuleCache = new WeakMap();
const moduleRules = config => {
  const cached = moduleRuleCache.get(config);
  if (cached) return cached;
  const rules = Object.entries(config.modules ?? {})
    .map(([pattern, template]) => ({ segments: pattern.split('/').filter(Boolean), template }))
    .sort((a, b) => b.segments.length - a.segments.length || compare(b.template, a.template));
  moduleRuleCache.set(config, rules);
  return rules;
};

export function moduleOf(file, config = {}) {
  const parts = rel(file).split('/');
  for (const rule of moduleRules(config)) {
    // A trailing wildcard routes a directory: it must have a segment after it,
    // otherwise `src/*/` would swallow the files that live directly in `src/`.
    if (rule.segments[rule.segments.length - 1] === '*' && parts.length <= rule.segments.length) continue;
    const captures = [];
    let matched = true;
    for (const [index, segment] of rule.segments.entries()) {
      const actual = parts[index];
      if (actual === undefined) {
        matched = false;
        break;
      }
      if (segment === '*') captures.push(actual);
      else if (segment !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    let captureIndex = 0;
    return rule.template.replace(/\*/g, () => captures[captureIndex++] ?? '');
  }
  return config.defaultModule ?? 'tooling';
}

export function eligible(file, config) {
  const parts = file.split('/');
  if (parts.some(part => (config.excludeSegments ?? []).includes(part))) return false;
  if (Array.isArray(config.excludePatterns) && config.excludePatterns.some(pattern => new RegExp(pattern).test(file))) return false;
  if (!((config.roots ?? []).some(root => file.startsWith(`${root}/`)) || !file.includes('/'))) return false;
  return (config.extensions ?? []).includes(path.extname(file));
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
  for (const sub of config.roots ?? []) {
    const subDir = path.join(root, sub);
    if (fs.existsSync(path.join(subDir, '.git'))) {
      for (const file of gitList(subDir)) discovered.add(`${sub}/${file}`);
    } else if (!rootHasGit && fs.existsSync(subDir)) {
      walkNonGitDir(root, sub, config.excludeSegments ?? [], discovered);
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
  if (process.env.CODEMAP_CONFIG) return path.resolve(process.env.CODEMAP_CONFIG);
  const nextToScript = path.join(scriptDir, 'codemap.config.json');
  if (root === defaultRoot) return nextToScript;
  const inRootDoc = path.join(root, 'doc', 'codemap.config.json');
  if (fs.existsSync(inRootDoc)) return inRootDoc;
  throw new Error(`No ${path.join(root, 'doc', 'codemap.config.json')} and ${root} is not the directory above ${path.basename(scriptPath)}.`);
}

function readConfig(root) {
  const configPath = resolveConfigPath(root);
  if (!fs.existsSync(configPath)) {
    throw new Error(`No codemap.config.json at ${configPath}.`);
  }
  const configText = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configText);
  if (!Number.isInteger(config.pageRows) || config.pageRows < 1 || config.pageRows > 150) throw new Error('pageRows must be 1..150');
  for (const [key, fallback] of [['outputDir', 'doc/codemap'], ['indexFile', 'doc/CODE_MAP_INDEX.md'], ['cacheFile', 'doc/.codemap-cache.json']]) {
    const target = path.resolve(root, config[key] || fallback);
    const insideDoc = path.relative(path.resolve(root, 'doc'), target);
    if (!insideDoc || insideDoc === '..' || insideDoc.startsWith(`..${path.sep}`) || path.isAbsolute(insideDoc)) throw new Error(`${key} must be inside the project doc/ directory`);
  }
  return { config, configText };
}

const fingerprint = configText => hash(normalize(fs.readFileSync(scriptPath, 'utf8')) + configText);
const runHint = root => `node ${rel(path.relative(root, scriptPath))}`;

async function collectRecords(root, config, { check, selected, version }) {
  const cacheFileRel = (config.cacheFile || 'doc/.codemap-cache.json').replace(/\\/g, '/');
  const cachePath = path.join(root, ...cacheFileRel.split('/'));
  let cache = {};
  if (!check && fs.existsSync(cachePath)) {
    try {
      const stored = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (stored.version === version) cache = stored.files;
    } catch {
      /* Rebuild invalid local cache. */
    }
  }
  const files = inventory(root, config);
  if (selected && !files.some(file => moduleOf(file, config) === selected) && !Object.keys(cache).some(file => moduleOf(file, config) === selected)) {
    throw new Error(`Unknown module: ${selected}`);
  }
  const records = {};
  let parsed = 0;
  for (const file of files) {
    const text = normalize(fs.readFileSync(path.join(root, file), 'utf8'));
    const digest = hash(text);
    if (cache[file]?.hash === digest) records[file] = cache[file];
    else {
      if (selected && moduleOf(file, config) !== selected) throw new Error(`Changed uncached file outside ${selected}: ${file}; run ${runHint(root)}`);
      records[file] = { hash: digest, ...await extract(file, text) };
      parsed++;
    }
  }
  if (selected && Object.keys(cache).some(file => !records[file] && moduleOf(file, config) !== selected)) {
    throw new Error(`Deletion outside selected module; run ${runHint(root)}`);
  }
  return { files, records, parsed, cachePath, version };
}

export function buildReferenceGraph(files, records) {
  const declarations = new Map();
  const byName = new Map();
  const rustDeclarations = new Map();
  for (const file of files) {
    const local = new Map();
    const crate = rustCrateOf(file);
    const modulePath = crate ? rustModulePath(file) : null;
    for (const symbol of records[file].symbols) {
      if (symbol.scope !== '' || !REFERENCE_KINDS.has(symbol.kind)) continue;
      if (!local.has(symbol.name)) local.set(symbol.name, symbol);
      const sites = byName.get(symbol.name) ?? [];
      sites.push({ file, line: symbol.line, kind: symbol.kind });
      byName.set(symbol.name, sites);
      if (crate && modulePath) {
        const key = `${crate}\u0000${symbol.name}`;
        const entries = rustDeclarations.get(key) ?? [];
        entries.push({ file, line: symbol.line, path: modulePath.join('::') });
        rustDeclarations.set(key, entries);
      }
    }
    declarations.set(file, local);
  }
  const incoming = new Map();
  let resolved = 0;
  let unresolved = 0;
  let ambiguous = 0;
  const fileSet = new Set(files);
  const bumpDeclaration = (file, line, name) => {
    const key = `${file}\u0000${line}\u0000${name}`;
    incoming.set(key, (incoming.get(key) ?? 0) + 1);
    resolved++;
  };
  const ambiguousNames = name => new Set((byName.get(name) ?? []).map(site => site.file)).size > 1;
  const resolveByName = name => {
    const sites = byName.get(name) ?? [];
    if (!sites.length) return unresolved++;
    if (ambiguousNames(name)) return ambiguous++;
    return bumpDeclaration(sites[0].file, sites[0].line, name);
  };
  for (const file of files) {
    for (const entry of records[file].imports ?? []) {
      if (Array.isArray(entry.prefix)) {
        for (const name of entry.names) {
          const anchor = rustAnchorPath(file, entry.prefix);
          const candidates = anchor ? (rustDeclarations.get(`${rustCrateOf(file)}\u0000${name}`) ?? []) : [];
          const inScope = candidates.filter(site => anchor.length === 0 || site.path === anchor.join('::') || site.path.startsWith(`${anchor.join('::')}::`));
          const exact = inScope.filter(site => site.path === anchor.join('::'));
          const pool = exact.length ? exact : inScope;
          if (!pool.length) resolveByName(name);
          else if (pool.length > 1) ambiguous++;
          else bumpDeclaration(pool[0].file, pool[0].line, name);
        }
      } else if (entry.specifier.startsWith('.')) {
        const target = resolveRelativeImport(file, entry.specifier, fileSet);
        for (const name of entry.names) {
          const declaration = target ? declarations.get(target)?.get(name) : undefined;
          if (declaration) bumpDeclaration(target, declaration.line, name);
          else unresolved++;
        }
      } else {
        for (const name of entry.names) resolveByName(name);
      }
    }
  }
  return { declarations, incoming, stats: { resolved, unresolved, ambiguous } };
}

// Rust 2018 paths: `crate`/`self`/`super` anchor a path to a module directory; a bare
// leading segment is an external crate and stays unresolved rather than guessed.
function rustAnchorPath(importer, prefix) {
  const selfPath = rustModulePath(importer);
  if (!selfPath) return null;
  let anchor = null;
  for (const segment of prefix) {
    if (segment === 'crate') {
      anchor = [];
    } else if (segment === 'self') {
      anchor = [...selfPath];
    } else if (segment === 'super') {
      anchor = (anchor ?? selfPath).slice(0, -1);
    } else if (anchor === null) {
      return null;
    } else {
      anchor.push(segment);
    }
  }
  return anchor ?? selfPath;
}

function rustCrateOf(file) {
  if (!file.endsWith('.rs')) return '';
  const parts = file.split('/');
  const index = parts.lastIndexOf('src');
  return index > 0 ? parts.slice(0, index).join('/') : '';
}

function rustModulePath(file) {
  const parts = file.split('/');
  const index = parts.lastIndexOf('src');
  if (index <= 0 || index >= parts.length - 1) return null;
  const inner = parts.slice(index + 1);
  const base = inner[inner.length - 1].replace(/\.rs$/, '');
  const dirs = inner.slice(0, -1);
  return ['mod', 'lib', 'main'].includes(base) ? dirs : [...dirs, base];
}

function resolveRelativeImport(importer, specifier, fileSet) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const candidates = [base];
  for (const extension of MODULE_EXTENSIONS) candidates.push(base + extension);
  for (const extension of MODULE_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return candidates.find(candidate => fileSet.has(candidate)) ?? '';
}

const hubRows = graph => {
  const rows = [];
  for (const [file, local] of graph.declarations) {
    for (const [name, symbol] of local) {
      const count = graph.incoming.get(`${file}\u0000${symbol.line}\u0000${name}`) ?? 0;
      if (count > 0) rows.push({ file, name, kind: symbol.kind, line: symbol.line, count });
    }
  }
  return rows.sort((a, b) => b.count - a.count || compare(a.name, b.name) || compare(a.file, b.file));
};

function renderHubsPage({ files, records, graph, config, mapDirRel, indexFileRel }) {
  const relRoot = '../'.repeat(mapDirRel.split('/').filter(Boolean).length);
  const indexFromMap = posixRel(mapDirRel, indexFileRel);
  const limit = Math.min(config.hubCount ?? 40, config.pageRows);
  const rows = hubRows(graph).slice(0, limit);
  const total = files.reduce((sum, file) => sum + records[file].symbols.length, 0);
  const lines = [
    '# Hubs — most-referenced declarations',
    '',
    '<!-- Generated by doc/codemap.mjs; do not edit. -->',
    '',
    `[Root index](${indexFromMap})`,
    '',
    `${files.length} files · ${total} symbols · import edges: ${graph.stats.resolved} resolved, ${graph.stats.ambiguous} ambiguous, ${graph.stats.unresolved} unresolved.`,
    '',
    'Edges come from `use`/`import` statements: relative specifiers for TypeScript, `crate`/`self`/`super` module paths plus a unique-name fallback for Rust. Lexical evidence, not type-checked resolution: an ambiguous or unresolved import is counted, never guessed.',
    '',
    '| Symbol | Kind | Module | In-degree | Line |',
    '| --- | --- | --- | ---: | --- |',
    ...rows.map(row => `| ${escape(row.name)} | ${escape(row.kind)} | ${moduleOf(row.file, config)} | ${row.count} | [${row.line}](${relRoot}${link(row.file)}#L${row.line}) |`),
    ''
  ];
  return lines.join('\n');
}

export function renderOverview({ files, records, graph, config, tokens = 1024 }) {
  const hubs = hubRows(graph);
  const total = files.reduce((sum, file) => sum + records[file].symbols.length, 0);
  const lines = [
    `# code map overview — ${files.length} files, ${total} symbols`,
    `# import edges: ${graph.stats.resolved} resolved, ${graph.stats.ambiguous} ambiguous, ${graph.stats.unresolved} unresolved (lexical, not type resolution)`,
    '# most-referenced declarations first'
  ];
  let omitted = 0;
  const candidates = hubs.slice(0, config.hubCount ?? 40);
  let pushed = 0;
  for (const hub of candidates) {
    const row = `- ${hub.name} (${hub.kind}) ${moduleOf(hub.file, config)} ${hub.file}:${hub.line} ← ${hub.count}`;
    if (estimateTokens([...lines, row].join('\n')) > tokens) break;
    lines.push(row);
    pushed++;
  }
  omitted = hubs.length - pushed;
  if (omitted > 0) lines.push(`omitted: ${omitted} rows (${pushed} shown; raise --tokens or hubCount)`);
  return lines.join('\n');
}

const estimateTokens = text => Math.ceil(text.length / 4);

export function searchSymbols(records, query, limit = 20) {
  const needle = query.toLowerCase();
  const hits = [];
  for (const [file, record] of Object.entries(records)) {
    for (const symbol of record.symbols) {
      const name = symbol.name.toLowerCase();
      const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : -1;
      if (rank < 0) continue;
      hits.push({ rank, file, name: symbol.name, kind: symbol.kind, scope: symbol.scope, line: symbol.line });
    }
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || compare(a.file, b.file) || a.line - b.line)
    .slice(0, limit);
}

export function outlineOf(records, fileQuery) {
  const files = Object.keys(records).sort(compare);
  const query = rel(fileQuery);
  const file = files.find(candidate => candidate === query) ?? files.find(candidate => candidate.endsWith(`/${query}`));
  if (!file) throw new Error(`Unknown file: ${fileQuery}`);
  return { file, symbols: [...records[file].symbols].sort((a, b) => a.line - b.line) };
}

export async function generate(root = defaultRoot, { check = false, module: selected } = {}) {
  const { config, configText } = readConfig(root);
  const version = fingerprint(configText);
  const { files, records, parsed, cachePath } = await collectRecords(root, config, { check, selected, version });
  const mapDirRel = (config.outputDir || 'doc/codemap').replace(/\\/g, '/').replace(/\/+$/, '');
  const indexFileRel = (config.indexFile || 'doc/CODE_MAP_INDEX.md').replace(/\\/g, '/');
  const indexDirRel = path.posix.dirname(indexFileRel);
  const mapFromIndex = posixRel(indexDirRel === '.' ? '' : indexDirRel, mapDirRel);
  const indexFromMap = posixRel(mapDirRel, indexFileRel);
  const relRoot = '../'.repeat(mapDirRel.split('/').filter(Boolean).length);
  const graph = buildReferenceGraph(files, records);

  const outputs = new Map();
  const modules = [...new Set(files.map(file => moduleOf(file, config)))].sort(compare);
  const index = [
    '# Code map index',
    '',
    '<!-- Generated by doc/codemap.mjs; do not edit. -->',
    '',
    `Read AGENTS.md → [hubs](${mapFromIndex}/hubs.md) → module → file/symbol page → source. [Method, commands and limits](CODE_MAP.md).`,
    '',
    '| Module | Files | Symbols | Map |',
    '| --- | ---: | ---: | --- |'
  ];
  let totalSymbols = 0;
  let diagnostics = 0;
  for (const module of modules) {
    const members = files.filter(file => moduleOf(file, config) === module);
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
  outputs.set(`${mapDirRel}/hubs.md`, renderHubsPage({ files, records, graph, config, mapDirRel, indexFileRel }));
  index.push(
    '',
    `Total: ${files.length} source files, ${totalSymbols} extracted symbols, ${diagnostics} parser diagnostics; import edges ${graph.stats.resolved} resolved / ${graph.stats.ambiguous} ambiguous / ${graph.stats.unresolved} unresolved.`,
    '',
    'Scope includes Rust/TS/JS declarations; excludes imports, parameters, runtime/macro-generated symbols. Shell/PowerShell/BAT use lexical navigation.'
  );
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
  const result = { files: files.length, symbols: totalSymbols, diagnostics, parsed, changed: changed.length, deleted: stale.length, pages: outputs.size, edges: graph.stats };
  if (check && (changed.length || stale.length)) throw new Error(`Stale code map: ${JSON.stringify(result)}. Run ${runHint(root)} and include generated changes.`);
  return result;
}

async function loadProject(root) {
  const { config, configText } = readConfig(root);
  const version = fingerprint(configText);
  const { files, records } = await collectRecords(root, config, { check: false, version });
  return { config, files, records };
}

const usage = () => `Usage: node doc/codemap.mjs [command]

No command                     incremental generation (first run, config change, cross-module edit)
--module <name>                refresh one module; needs a warm cache and no edits outside it
--check                        verify without writing; exits non-zero on drift
--find <name> [--limit N]      symbol lookup: path:line, kind, scope
--outline <file>               every declaration of one file, in source order
--map [--tokens N]             token-budgeted overview of the most-referenced declarations
--json                         machine-readable output for --find and --outline
--help                         this text

Generation reads the Git working tree of each configured root; queries reuse the cache when it is
current. Set CODEMAP_REQUIRE_FROM when typescript/web-tree-sitter are not resolvable from the workspace.`;

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const args = process.argv.slice(2);
    const options = { check: false, json: false, tokens: 1024, limit: 20 };
    const flagsWithValue = new Set(['--module', '--find', '--outline', '--tokens', '--limit']);
    const booleanFlags = new Set(['--check', '--map', '--json', '--help']);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (flagsWithValue.has(arg)) {
        const value = args[++i];
        if (value === undefined) throw new Error(`${arg} needs a value`);
        if (arg === '--tokens' || arg === '--limit') {
          const number = Number(value);
          if (!Number.isInteger(number) || number < 1) throw new Error(`${arg} needs a positive integer`);
          options[arg.slice(2)] = number;
        } else options[arg.slice(2)] = value;
      } else if (booleanFlags.has(arg)) options[arg.slice(2)] = true;
      else throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.help) {
      console.log(usage());
    } else {
      const root = defaultRoot;
      if (options.find !== undefined || options.outline !== undefined || options.map) {
        const { config, files, records } = await loadProject(root);
        if (options.find !== undefined) {
          const hits = searchSymbols(records, options.find, options.limit);
          if (options.json) console.log(JSON.stringify(hits, null, 1));
          else if (!hits.length) console.error(`no symbol matches "${options.find}"`);
          else console.log(hits.map(hit => `${hit.file}:${hit.line}\t${hit.kind}\t${hit.scope || '-'}\t${hit.name}`).join('\n'));
        } else if (options.outline !== undefined) {
          const result = outlineOf(records, options.outline);
          if (options.json) console.log(JSON.stringify(result, null, 1));
          else console.log([`# ${result.file} — ${result.symbols.length} declarations`, ...result.symbols.map(symbol => `${String(symbol.line).padStart(5)}  ${symbol.kind}\t${symbol.scope ? `${symbol.scope}::` : ''}${symbol.name}`)].join('\n'));
        } else {
          const graph = buildReferenceGraph(files, records);
          console.log(renderOverview({ files, records, graph, config, tokens: options.tokens }));
        }
      } else {
        const result = await generate(root, { check: options.check, module: options.module });
        console.log(JSON.stringify(result));
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
