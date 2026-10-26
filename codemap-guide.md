# 代码地图使用教程（给 Agent）

> 目的：让任何 Agent 在改动或分析本工作区代码前，先用「代码地图」定位，再定点读源码，避免全仓盲扫。
> 权威说明见 [CODE_MAP.md](CODE_MAP.md)；项目规范与交接见 [AGENTS.md](../AGENTS.md)。本文只是操作教程，不替代它们。

## 1. 它是什么

- 静态符号索引：记录每个源码文件的函数、方法、结构体、接口、类型、变量等声明及行号。
- **不是**调用关系图，也不替代类型检查、LSP 或单元测试。
- 全部由 `doc/codemap.mjs` 生成，**禁止手改** `doc/CODE_MAP_INDEX.md` 与 `doc/codemap/`。

## 2. 三层结构

```mermaid
flowchart LR
    A[AGENTS.md] --> B[doc/CODE_MAP_INDEX.md<br/>按模块路由]
    B --> C[doc/codemap/模块.md<br/>文件列表]
    C --> D[doc/codemap/文件页-N.md<br/>符号表]
    D --> E[源码 #L行号]
```

| 层级 | 位置 | 内容 |
| --- | --- | --- |
| 1 索引 | `doc/CODE_MAP_INDEX.md` | 模块名、文件数、符号数 |
| 2 模块页 | `doc/codemap/<模块>.md` | 模块内文件、符号数、符号页链接 |
| 3 符号页 | `doc/codemap/<路径>-<hash>-<页>.md` | Symbol / Kind / Scope / Line（可跳转到源码行） |

每页最多 100 行；符号多的文件会分多页（`-1.md`、`-2.md`…）。

## 3. 定位流程（必须遵守）

1. 读 [CODE_MAP_INDEX.md](CODE_MAP_INDEX.md)，按目录选模块（区分可修改的 `bridge-*` 与只读参考的 `magpie-*`）。
2. 打开模块页 `doc/codemap/<模块>.md`，找到目标文件，进入对应符号页。
3. 在符号页找到函数/类型/方法的行号，**只读该段源码**。
4. 仅在归属未知时，才在 `doc/codemap/` 内搜索符号名（页面可 grep），不要整图加载。
5. 需要调用关系、引用、接口实现时，配合编辑器的 `usages` / `grep` 精确追踪。

### 模块速查

| 想找什么 | 模块 | 源码路径 | 权限 |
| --- | --- | --- | --- |
| Cursor 桥接插件入口、Supervisor 主循环、安装入口、Rust 引擎补丁 | `bridge-root` | `magpie-agent-cursor-bridge/*.{js,ps1,cmd,command,patch}` | **允许修改** |
| 桥接核心库（配置校验、证书与暂存安装、PID+启动时间锁、Magpie 状态探测、固定端口 TCP 中继、Cursor `settings.json` 事务与还原、Watchdog 判定） | `bridge-lib` | `magpie-agent-cursor-bridge/lib/` | **允许修改** |
| 原生引擎编译脚本 (`cursor-byok` + `source.patch`) | `bridge-scripts` | `magpie-agent-cursor-bridge/scripts/` | **允许修改** |
| 桥接插件单元测试与生命周期验证 | `bridge-test` | `magpie-agent-cursor-bridge/test/` | **允许修改** |
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
2. `doc/codemap/bridge-root.md` → `magpie-agent-cursor-bridge/bridge.js` 符号页 → 定位 `stop`、`panic`、`nextMagpieGate` 调用行号。
3. `doc/codemap/bridge-lib.md` → `magpie-agent-cursor-bridge/lib/magpie.js`（`readWired`、`nextMagpieGate`）与 `magpie-agent-cursor-bridge/lib/settings.js`（`restoreProxy`、`clearStaleProxy`）。
4. 如需确认 Magpie 侧何时写出 `agents-state.json`，再查 `magpie-agent` 模块定位只读源码。

## 4. 符号页字段说明

| 列 | 含义 |
| --- | --- |
| Symbol | 符号名（函数、方法、结构体/字段、接口、变量、补丁目标等） |
| Kind | 语法类型（Go `function_declaration` / `method_declaration` / `struct_type`、JS `FunctionDeclaration` / `VariableDeclaration`、Patch `patch fn` 等） |
| Scope | 词法所在的父级（Go 接收者类型或结构体名、JS 函数/类名、Patch 目标文件路径），仅作导航 |
| Line | 声明行，链接到源码 `#L行号` |

## 5. 命令

在工作区根目录（`e:\W-AI_WorkSpace\magpie`）执行：

```powershell
node doc/codemap.mjs                         # 增量生成（首次 / 配置变化 / 跨模块修改后使用）
node doc/codemap.mjs --module bridge-lib     # 只刷新单模块；需已有缓存，且改动不得越出该模块
node doc/codemap.mjs --check                 # 只检查，不写文件；有漂移则退出码非 0
node --test doc/codemap.test.mjs             # 代码地图工具自测
node --test magpie-agent-cursor-bridge/test/*.test.js # 运行 magpie-agent-cursor-bridge 单元测试
```

- 本地缓存 `doc/.codemap-cache.json` 可随时删除。
- 生成结果不含时间戳与机器路径，可复现。

## 6. 改完代码后的必做清单

1. 确认所有代码修改仅落在允许修改的目录（`magpie-agent-cursor-bridge/` 或 `doc/` 工具脚本），**未触碰 `magpie/` 目录**。
2. 跑相关单元测试（`node --test magpie-agent-cursor-bridge/test/*.test.js`）。
3. 任何文件新增 / 编辑 / 删除 / 重命名后执行 `node doc/codemap.mjs`。
4. 执行 `node doc/codemap.mjs --check`，必须零漂移且解析诊断为 0。
5. 汇报实际验证结果与未覆盖项。

## 7. 覆盖范围与限制

- 索引范围：`magpie-agent-cursor-bridge`（含源码、脚本、测试与 `source.patch`）、`magpie`（仅生产代码，排除 `*_test.go`、`internal/gui/tests/`、`testdata/`、`site/`）以及 `doc/` 下的工具脚本。
- 排除：`node_modules`、`target`、`dist`、`release`、`.git`、`.github`、`testdata`、`site`、`doc/codemap` 等。
- 不收录：`import`、普通参数、函数内局部 `var`/`const`（Go）或 `let`（Rust）、匿名回调、对象字面量普通数据键。
- Shell / PowerShell / BAT / Patch 仅做词法级声明导航。
- `doc/codemap/` 专属生成器，**不要在其中放手写文档**；本教程位于 `doc/codemap-guide.md`。

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| `node doc/codemap.mjs --check` 报漂移 | 运行 `node doc/codemap.mjs` 后重新检查 |
| `--module` 报缓存无效或越界 | 改用无参数 `node doc/codemap.mjs` |
| 找不到符号 | 确认文件在索引范围内；局部临时变量不收录；改用 `grep` / `usages` 查找 |
| 符号页分了多页 | 模块页的「Symbol pages」列列出全部页码 |
| 想手改地图 | 禁止。改源码后重新生成 |

## 9. 给其他 Agent 的提示词模板

```text
先读 AGENTS.md 与 doc/codemap-guide.md。
任何代码任务：从 doc/CODE_MAP_INDEX.md 选模块 → doc/codemap/ 文件符号页 → 定点读源码，不要全仓盲扫。
严禁修改 magpie/ 目录下的任何文件；所有插件功能修改在 magpie-agent-cursor-bridge/ 中完成。
修改后执行 node --test magpie-agent-cursor-bridge/test/*.test.js、node doc/codemap.mjs 与 node doc/codemap.mjs --check，确保测试通过且代码地图零漂移。
```
