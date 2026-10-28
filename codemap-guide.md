# 代码地图使用教程（给 Agent）

> 目的：让任何 Agent 在改动或分析本工作区代码前，先用「代码地图」定位，再定点读源码，避免全仓盲扫。
> 权威说明见 [CODE_MAP.md](CODE_MAP.md)；项目规范与交接见 [AGENTS.md](../AGENTS.md)。本文只是操作教程，不替代它们。

## 1. 它是什么

- 静态符号索引：记录每个源码文件的函数、方法、结构体、接口、类型、变量等声明及行号。
- **不是**调用关系图，也不替代类型检查、LSP 或单元测试。
- 全部由 `doc/codemap.mjs` 生成，**禁止手改** `doc/CODE_MAP_INDEX.md` 与 `doc/codemap/`。

## 2. 分层结构

```mermaid
flowchart LR
    A[AGENTS.md] --> B[doc/CODE_MAP_INDEX.md<br/>按模块路由]
    B --> H[doc/codemap/hubs.md<br/>被引用最多的声明]
    B --> C[doc/codemap/模块.md<br/>文件列表]
    C --> D[doc/codemap/文件页-N.md<br/>符号表]
    D --> E[源码 #L行号]
```

| 层级 | 位置 | 内容 |
| --- | --- | --- |
| 0 枢纽 | `doc/codemap/hubs.md`（`--map` 同源） | 被 import 次数最多的声明；只覆盖 JS/TS（见第 7 节） |
| 1 索引 | `doc/CODE_MAP_INDEX.md` | 模块名、文件数、符号数、全局统计 |
| 2 模块页 | `doc/codemap/<模块>.md` | 模块内文件、符号数、符号页链接 |
| 3 符号页 | `doc/codemap/<路径>-<hash>-<页>.md` | Symbol / Kind / Scope / Line（可跳转到源码行） |

每页最多 100 行；符号多的文件会分多页（`-1.md`、`-2.md`…）。模块归属完全由 `doc/codemap.config.json` 的 `modules` 规则决定（最长路径前缀优先，末尾 `*` 只路由目录），未命中的路径落到 `defaultModule`（`tooling`），`magpie/internal/` 下没有专门规则的新子系统留在 `magpie-sys`。

## 3. 定位流程（必须遵守）

1. 读 [CODE_MAP_INDEX.md](CODE_MAP_INDEX.md)，按目录选模块（区分可修改的 `bridge-*` 与只读参考的 `magpie-*`）。
2. 只知道符号名时直接用 `node doc/codemap.mjs --find <名字>` 拿 `路径:行号`，比翻页更快。
3. 打开模块页 `doc/codemap/<模块>.md`，找到目标文件，进入对应符号页；要看某文件全部声明用 `node doc/codemap.mjs --outline <文件>`。
4. 在符号页找到函数/类型/方法的行号，**只读该段源码**。
5. 需要跨模块找「被广泛依赖的入口」时先看 `doc/codemap/hubs.md` 或 `node doc/codemap.mjs --map`，但记住它只统计 import 边（见第 7 节）。
6. 需要调用关系、引用、接口实现时，配合编辑器的 `usages` / `grep` 精确追踪。

### 模块速查

| 想找什么 | 模块 | 源码路径 | 权限 |
| --- | --- | --- | --- |
| Cursor 桥接插件入口、Supervisor 主循环、安装入口、Rust 引擎补丁 | `bridge-root` | `plugins/magpie-agent-cursor-bridge/*.{js,ps1,cmd,command,patch}` | **允许修改** |
| 桥接核心库（配置校验、证书与暂存安装、PID+启动时间锁、Magpie 状态探测、固定端口 TCP 中继、Cursor `settings.json` 事务与还原、Watchdog 判定） | `bridge-lib` | `plugins/magpie-agent-cursor-bridge/lib/` | **允许修改** |
| 原生引擎编译脚本 (`cursor-byok` + `source.patch`) | `bridge-scripts` | `plugins/magpie-agent-cursor-bridge/scripts/` | **允许修改** |
| 桥接插件单元测试与生命周期验证 | `bridge-test` | `plugins/magpie-agent-cursor-bridge/test/` | **允许修改** |
| Magpie Agent 插件宿主（`moejs` 加载 `agent.js`、`connect` 钩子调用） | `magpie-agentplug` | `magpie/internal/agentplug/` | 只读参考 |
| Magpie Agent 接线、状态 (`agents-state.json`、`applied.json`、`stash.json`)、WSL 与重连 | `magpie-agent` | `magpie/internal/agent/`、`agentenv/` | 只读参考 |
| Magpie 插件运行时（内置插件 `pluginrt`、OpenCode 插件宿主 `plugin`、`jsmod`、`plugins/*`） | `magpie-plugin` | `magpie/internal/plugin/`、`pluginrt/`、`jsmod/`、`magpie/plugins/` | 只读参考 |
| Magpie 本地网关（`:3425`、`/v1/models`、协议互转、路由回退、网关中间件） | `magpie-gateway` | `magpie/internal/gateway/`、`gwbudget/`、`gwmw/`、`gwtool/`、`routes/`、`upstream/`、`middleware/` | 只读参考 |
| Magpie 供应商、账号、模型目录、订阅迁移 | `magpie-provider` | `magpie/internal/provider/`、`catalog/`、`codexcat/`、`claudebridge/`、`claudecode/`、`qoder/`、`mcpauth/` | 只读参考 |
| Magpie 桌面 GUI、前端脚本 (`app.js`、`kernel.js`、`i18n.js`)、HTTP API (`/api/*`)、TUI | `magpie-gui` | `magpie/internal/gui/`、`tui/`、`fonts/`、`iconproxy/`、`webview2env/`、`shortcut/` | 只读参考 |
| Magpie CLI 命令（`magpie cursor-bridge`、`magpie plugin` 等）、守护进程、自启与更新 | `magpie-cli` | `magpie/main.go`、`magpie/internal/cli/`、`daemon/`、`handoff/`、`autostart/`、`awake/`、`update/`、`omarchy/` | 只读参考 |
| Magpie 会话聚合、Library（Instructions / MCP / Skills 下发） | `magpie-sessions` | `magpie/internal/sessions/`、`codexsummary/`、`library/` | 只读参考 |
| Magpie 用量统计、配额、预算、OTel 导出 | `magpie-usage` | `magpie/internal/usage/`、`usageapi/`、`budget/`、`stats/`、`otlp/`、`probelog/` | 只读参考 |
| Magpie 隐私脱敏、PII 过滤、网关访问密钥、原生隐私过滤器 | `magpie-privacy` | `magpie/internal/redact/`、`masking/`、`maskrec/`、`pii/`、`access/`、`ghtoken/`、`magpie/native/` | 只读参考 |
| Magpie 配置存储、原子写、路径、WebDAV/S3/GitHub 同步备份 | `magpie-storage` | `magpie/internal/settings/`、`profile/`、`appdir/`、`desktopdir/`、`davsync/`、`backup/`、`edit/`、`filelock/`、`filememo/`、`lastgood/`、`sqlitedb/`、`source/`、`steady/` | 只读参考 |
| Magpie 进程管理、网络代理、WSL 运行、系统工具与构建脚本 | `magpie-sys` | `magpie/internal/proc/`、`netproxy/`、`netguard/`、`wslrun/`、`dirent/`、`libc/`、`tune/`、`imagemcp/`、`fx/`、`testenv/`、`magpie/build/` | 只读参考 |
| 代码地图生成器与自测 | `tooling` | `doc/codemap.mjs`、`doc/codemap.test.mjs` | **允许修改** |

模块页只是目录路由，实际文件以 `doc/CODE_MAP_INDEX.md` 为准。

### 示例

任务：排查 Magpie 关闭开关后 `magpie-agent-cursor-bridge` 如何还原 Cursor 代理配置。

1. 索引 → `bridge-root` 与 `bridge-lib`。
2. `doc/codemap/bridge-root.md` → `plugins/magpie-agent-cursor-bridge/bridge.js` 符号页 → 定位 `stop`、`panic`、`nextMagpieGate` 调用行号。
3. `doc/codemap/bridge-lib.md` → `plugins/magpie-agent-cursor-bridge/lib/magpie.js`（`readWired`、`nextMagpieGate`）与 `plugins/magpie-agent-cursor-bridge/lib/settings.js`（`restoreProxy`、`clearStaleProxy`）。
4. 如需确认 Magpie 侧何时写出 `agents-state.json`，再查 `magpie-agent` 模块定位只读源码。

## 4. 符号页字段说明

| 列 | 含义 |
| --- | --- |
| Symbol | 符号名（函数、方法、结构体/字段、接口、变量等） |
| Kind | 语法类型（Go `function_declaration` / `method_declaration` / `type_spec`、JS `FunctionDeclaration` / `VariableDeclaration` 等） |
| Scope | 词法所在的父级（Go 结构体字段记结构体名、JS 函数/类/参数名），仅作导航；Go 方法**不记录接收者类型**，同名方法用行号区分 |
| Line | 声明行，链接到源码 `#L行号` |

## 5. 命令

在工作区根目录（`e:\W-AI_WorkSpace\magpie`）执行：

```powershell
node doc/codemap.mjs                         # 增量生成（首次 / 配置变化 / 跨模块修改后使用）
node doc/codemap.mjs --module bridge-lib     # 只刷新单模块；需已有缓存，且改动不得越出该模块
node doc/codemap.mjs --check                 # 只检查，不写文件；有漂移则退出码非 0
node doc/codemap.mjs --find restoreProxy     # 符号查询：路径:行号、Kind、Scope
node doc/codemap.mjs --outline plugins/magpie-agent-cursor-bridge/agent.js  # 单文件全部声明（按源码顺序）
node doc/codemap.mjs --map --tokens 800      # 受 token 预算限制的枢纽概览
node --test doc/codemap.test.mjs             # 代码地图工具自测
node --test plugins/magpie-agent-cursor-bridge/test/*.test.js # 运行 magpie-agent-cursor-bridge 单元测试
```

- 查询类命令（`--find` / `--outline` / `--map`）只读缓存，不写任何文件；追加 `--json` 可拿机器可读结果，`--limit N` 扩大匹配数，`--tokens N` 调整概览体积。
- 本地缓存 `doc/.codemap-cache.json` 可随时删除；生成器脚本或配置变化会让缓存自动失效。
- 生成结果不含时间戳与机器路径，可复现：连续两次生成 `changed` 必为 0 且 `deleted` 为 0。

## 6. 改完代码后的必做清单

1. 确认所有代码修改仅落在允许修改的目录（`plugins/magpie-agent-cursor-bridge/` 或 `doc/` 工具脚本），**未触碰 `magpie/` 目录**。
2. 跑相关单元测试（`node --test plugins/magpie-agent-cursor-bridge/test/*.test.js`）。
3. 任何文件新增 / 编辑 / 删除 / 重命名后执行 `node doc/codemap.mjs`。
4. 执行 `node doc/codemap.mjs --check`，必须零漂移，且解析诊断不超过已知基线 10 条。
5. 汇报实际验证结果与未覆盖项。

## 7. 覆盖范围与限制

- 索引范围：`magpie-agent-cursor-bridge`（含源码、脚本、测试与 `source.patch`）、`magpie`（仅生产代码，排除 `*_test.go`、`internal/gui/tests/`、`testdata/`、`site/`）以及 `doc/` 下的工具脚本。
- 排除：`node_modules`、`target`、`dist`、`release`、`.git`、`.github`、`testdata`、`site`、`doc/codemap`，以及 `magpie/native`、`magpie/internal/gui` 下的 C/C++ 头文件。
- 各语言粒度：
  - Go：函数、方法（**只记名字，不记接收者类型**）、结构体与其字段、接口类型（**不记接口方法签名**）、类型声明、包级 `var`/`const`。
  - JS/TS：函数、箭头函数变量、类、构造器、方法、属性、接口、类型别名、枚举、变量声明、`export` 说明符；**对象字面量的普通数据键不算符号**（所以 `agent.js` 只有 `agent` 与 `connect`）。
  - Shell / PowerShell / BAT：仅词法级声明与批处理标签。
  - `.patch`：只作为文件出现在模块页，**不产出符号**（没有 diff 语法），`source.patch` 里的 Rust 改动需直接读补丁。
- 不收录：`import`、普通参数、函数内局部 `var`/`const`（Go）、匿名回调、对象字面量普通数据键。
- 引用图与枢纽（`hubs.md`、`--map`）只统计 JS/TS 的相对 `import` 与 Rust 的模块路径；**Go 的 import 不产生边**，所以「某 Go 符号没出现在枢纽页」不代表没人用它。当前基线：65 条已解析 / 0 条歧义 / 111 条未解析。
- 已知诊断基线：10 条，全部是 Go，原因是捆绑的 `tree-sitter-go` 快照无法解析「泛型实例化的类型实参是复合类型字面量」（如 `lastgood.Into[map[string]applied]`）。受影响的 10 处语句子树之外的声明仍完整提取；只要诊断数不超过 10 就算正常。
- `doc/codemap/` 专属生成器，**不要在其中放手写文档**；本教程位于 `doc/codemap-guide.md`。

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| `node doc/codemap.mjs --check` 报漂移 | 运行 `node doc/codemap.mjs` 后重新检查 |
| `--module` 报缓存无效或越界 | 改用无参数 `node doc/codemap.mjs` |
| `diagnostics` 不是 0 | 正常基线是 10（Go 泛型实例化的语法快照缺口）；明显超过 10 再看新增文件用了什么语法 |
| 找不到符号 | 先 `--find`；仍无则确认文件在索引范围内；接口方法、局部变量、对象字面量数据键不收录 |
| `source.patch` 符号页是空的 | 设计如此：补丁文件只登记文件本身，声明要看补丁内容 |
| 枢纽页里没有 Go 符号 | 引用图不含 Go import，用 `grep` / `usages` 代替 |
| 模块名不是预期的 | 改 `doc/codemap.config.json` 的 `modules` 规则；未命中路径按 `defaultModule` 处理 |
| 符号页分了多页 | 模块页的「Symbol pages」列列出全部页码 |
| 想手改地图 | 禁止。改源码后重新生成 |

## 9. 给其他 Agent 的提示词模板

```text
先读 AGENTS.md 与 doc/codemap-guide.md。
任何代码任务：从 doc/CODE_MAP_INDEX.md 选模块 → doc/codemap/ 文件符号页 → 定点读源码，不要全仓盲扫；
只知道符号名时用 node doc/codemap.mjs --find <名字>，看单文件全部声明用 --outline <文件>。
严禁修改 magpie/ 目录下的任何文件；所有插件功能修改在 plugins/magpie-agent-cursor-bridge/ 中完成。
修改后执行 node --test plugins/magpie-agent-cursor-bridge/test/*.test.js、node doc/codemap.mjs 与 node doc/codemap.mjs --check，确保测试通过且代码地图零漂移（parse diagnostics 保持已知基线 10）。
```
