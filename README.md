# T3WORKFLOW-CHIEF

T3 Code 主线程的 Chief 工作流：拆单 → `delegate_task` → 独立审查 → 验收。被指定为 Worker 时自己完成，不再派单。

## 安装

需要 Bash 与常用 coreutils / awk。macOS 自带的 Bash 3.2 和 BSD 工具即可；Windows 使用 Git Bash。

```bash
cd ~/dsh/T3WORKFLOW-CHIEF                # Windows Git Bash 例：cd /f/T3WORKFLOW-CHIEF
bash install.sh                          # 只安装 skill
bash install.sh "/f/project with spaces" # 同时集成项目 AGENTS 和台账
# 可指定 skill 安装目录；不要指向源码 skill 目录
CHIEF_SKILL_DIR="$HOME/.agents/skills/chief-t3" bash install.sh
```

默认安装到 `~/.agents/skills/chief-t3/`。已有线程按所用 provider 支持的方式重载技能；安装脚本不重启 T3、不启动新线程或派单。

安装前校验参数、完整源文件、目标路径和现有 AGENTS 标记结构，校验失败不写入。逐文件更新 skill，不清空目标，不删除额外文件；变更前备份到目标中的 `.chief-t3-backup.*` 目录。相同内容重复安装不改文件、不增加备份。源目标相同或嵌套、符号链接、文件 / 目录类型冲突会拒绝安装。

项目目录必须已经存在。已有 AGENTS 中，**只替换 `<!-- chief-t3:begin -->` 到 `<!-- chief-t3:end -->` 标记区**；没有标记则保留原文并追加 Chief 区，不整体覆盖。写入前生成 `AGENTS.md.bak.*` 备份，保留已有 HANDOFF。已有未标记的旧 Chief 规则不会被自动删除；若存在旧模型或规则冲突，应比较备份，明确归属后合并。文本集成会补齐行末换行。文件系统 I/O 故障仍可能留下部分已安装内容或暂存文件，需按日志和备份处理，脚本不自动破坏性回滚。

## 文件

| 文件 | 用途 |
|---|---|
| `skills/chief-t3/SKILL.md` | Chief 规则与工作流 |
| `skills/chief-t3/workflows/` | 出厂场景配置与 JSON Schema，随 skill 安装 |
| `skills/chief-t3/templates/` | 权威模板，随 skill 安装；从 SKILL.md 所在目录相对解析 |
| `templates/` | 仓库入口的兼容模板副本，与打包模板保持一致 |
| `AGENTS.md` | 受管理的项目入口区块，区外保留用户规则 |
| `panel/` | 本地场景配置面板（`node panel/server.mjs`） |
| `app/` | 把面板打包成 macOS 应用（`bash app/build-mac-app.sh`） |
| `scripts/validate-workflow.mjs` | 场景配置校验（命令行与面板共用） |
| `scripts/migrate-to-scenes.mjs` | 旧配置转场景格式（v1 → v2），支持整机迁移 |
| `install.sh` | 校验、备份、安装、集成项目规则与初始化缺失台账 |

安装后的 skill 和模板独立可用，不需要原仓库仍在磁盘。项目台账为 `~/.t3-tasks/<project>/`，契约、报告、审查与输入用绝对路径传递。

## 工作流配置

配置只有一份，全局共用，分两块：**场景**（什么时候用、用哪些模型）和**规则**（审查、并行、返工、契约阈值）。

| 位置 | 用途 |
|---|---|
| `~/.chief-t3/config.json` | 全局配置；在面板里保存后生成，下一次派单立即生效 |
| `skills/chief-t3/workflows/default.json` | 出厂默认；没有全局配置时使用，随 skill 安装，重装不覆盖全局配置 |
| `skills/chief-t3/workflows/workflow.schema.json` | 配置格式（JSON Schema），编辑器可据此补全和校验 |

路径可用 `CHIEF_CONFIG` 覆盖（测试用）。Chief 每个线程先看 `~/.chief-t3/config.json`，存在就用它，否则用技能目录的 `workflows/default.json`，并在首次汇报中说明用了哪个文件。用户在消息里临时提的要求（如“这次别派审查”）照常作为本次指令处理，不需要配置支持。

每个场景写清楚什么时候用，并固定三个模型位置：

- `scenes.<key>.primary` / `backup` / `fallback`：首选（必填）/ 备选 / 兜底（可空）；首选不可用时按顺序往后换。
- `scenes.<key>.label` / `when`：显示名、什么时候用；Chief 据此按任务挑选、组合场景。
- `scenes.<key>.delegateRole` / `access` / `reportLimit`：派单顶层 `role`、只读或可写、汇报字数上限。

规则：

- `requireReview`：改了代码必须独立审查（默认开）；实际使用的审查模型必须与写代码的模型不同。
- `defaultWriteScene` / `escalateTo` / `escalateAfter`：写代码默认场景、失败 N 次后转给哪个场景；两者都必须是可写的实现场景，N 必须小于返工轮数上限。
- `maxParallelWriters` / `maxReworkRounds` / `contractFileThreshold`：并行写 Worker 上限、返工轮数上限、必须写契约的文件数阈值。

不可配置、始终生效的规则在 `SKILL.md`：等待不轮询、审查模型必须与实现模型不同、场景之外不换模型、各类操作授权边界等。关闭独立审查时，Chief 会在汇报中写明“本次未经独立审查”。

旧格式一次性迁移：

```bash
node scripts/migrate-to-scenes.mjs --apply
```

`--apply` 以 `skills/chief-t3/workflows/default.json` 为源写 `~/.chief-t3/config.json`（已存在先备份），把 `~/.t3-tasks/*/workflow.json` 逐个改名为 `workflow.json.bak.<时间>` 并打印与全局配置的模型差异；`~/.chief-t3/workflows/` 原样保留。单份转换用 `node scripts/migrate-to-scenes.mjs <v1.json> [--out <file>]`，`--from` 可指定源。迁移前建议先备份；想先看效果，用临时 HOME 跑：`HOME=$(mktemp -d) node scripts/migrate-to-scenes.mjs --apply`（`CHIEF_CONFIG` 只改全局配置路径，不会阻止 `~/.t3-tasks/*/workflow.json` 被改名）。`--apply` 是一次性动作；重跑会用出厂默认替换 `~/.chief-t3/config.json`（先备份为 `config.json.bak.<时间>`），面板里的自定义修改请从备份恢复或手动合并。

### 配置面板

本地网页编辑器，无第三方依赖，只有一页。两种启动方式：

```bash
node panel/server.mjs            # 默认 http://127.0.0.1:4317，可加 --port 指定端口
```

macOS 可以打包成双击即用的应用：

```bash
bash app/build-mac-app.sh        # 生成 ~/Applications/Chief 工作流.app，可传入其他目录
```

双击「Chief 工作流」会在后台启动面板并用默认浏览器打开；已经在运行时只打开页面。在 Dock 里退出应用会停止它启动的面板。日志在 `~/Library/Logs/chief-panel.log`。应用记录的是生成时的仓库路径和 node 路径，移动仓库或换了 node 安装位置后重新运行一次构建脚本即可；仓库里的代码更新不需要重新构建。

- 顶栏是「Chief 场景配置」，右边是保存 / 撤销修改；保存后下一次派单立即生效。
- **场景**：收起时一行显示显示名、什么时候用、首选模型、只读 / 可写和备用数量；点开可改显示名、键名、什么时候用、权限、任务类型、汇报字数，以及首选 / 备选 / 兜底三个模型位置（服务商、模型、推理参数；备选和兜底可清空）。底部「添加场景」新建并直接展开；每行可删除（二次确认）。删场景或改键名时，规则里的默认写场景 / 升级目标会同步清空或更新。
- **规则**：审查开关；写代码默认用哪个场景；同一任务失败几次后转给哪个场景（下拉只列可写的实现场景，另有“不指定 / 不升级”）；并行写 Worker、返工轮数、契约文件数阈值。
- **高级**：显示名称、配置文件位置、从磁盘重新加载、直接编辑 JSON。还没有全局配置文件时页面显示的是出厂默认，保存后写到 `~/.chief-t3/config.json`（写入时去掉 `$schema`）。
- **服务商和模型同步自 T3 Code**：读取 T3 的服务商缓存 `~/.t3/caches/<服务商>.json`（只读，只取服务商、模型和可调参数，不读账号、密钥和用量）。改模型时服务商、模型、推理强度等都是下拉选择，选项和 T3 里一致；未启用的服务商标为「未启用」。换模型后新模型不支持的参数会自动去掉。T3 里已经没有的服务商 / 模型 / 参数值会标黄提示，但不阻止保存（缓存可能比 T3 慢一步）。在 T3 里启用新服务商或更新模型后，点「重新读取」即可。读不到缓存时退回手动填写。
- 校验与 `scripts/validate-workflow.mjs` 相同，问题会标在对应字段和场景行上，底部保存栏列出全部问题，点击可跳到出错处；有问题时不能保存。
- 保存前备份旧文件为 `*.bak.<时间>`；文件在面板外被改过时拒绝覆盖，需先重新加载。
- 只监听 127.0.0.1，只能编辑全局配置文件，拒绝跨站请求。
- 位置可用环境变量覆盖：`CHIEF_CONFIG`（全局配置文件，默认 `~/.chief-t3/config.json`）、`T3CODE_HOME`（T3 数据目录，默认 `~/.t3`）。
- 保存后下一次派单立即生效；重装技能不会覆盖 `~/.chief-t3/config.json`。

## T3 执行要点

- 委派后严格遵循返回的 `next`。运行中不查 `task_status`、不 sleep、不轮询；只有完成唤醒后读取 `task_status`。`t3_background_wait` 仅 Claude 可用。结束当前回合等通知不表示完成交付。
- 替换或不再需要的运行任务先 `task_cancel`，不 interrupt 子线程。长期任务不授权创建顶层线程；`t3_thread_launch` / `create_threads` 必须有用户明确的新线程请求。
- worktree 通过平台 `isolation:"worktree"` 创建，派单前未知其路径；要求 Worker 使用分配目录并报告真实路径，不编造路径、不用 shell 建 worktree。父目录未提交改动不会复制；依赖这些输入时明确快照策略或经授权使用 shared。非 Git 项目不自动初始化；shared 使用明确授权的实际目录，不能把主线程父目录当作仓库。
- 每次 review / recheck 都新 `delegate_task`，且与实现模型不同。readonly 指令不保证技术只读；审查前保存 tracked / untracked / 内容基线，审查后对比。异常先停下报告，明确归属，不盲目 reset / checkout 或删除用户文件。
- 小审查修复由主线程直接做。大返工可新派任务或 `t3_thread_send` 续原开发子线程；T3 支持续会话，但新的独立复查必须新派，不能续旧审查。
- 需要等 PR 时用 `watch_pull_request`；工具不支持就报告，不轮询替代。
- 合并、提交、推送、删除及未授权外部写入须有明确授权；已授权的可逆编辑直接完成。

## 验证

```bash
bash -n install.sh
node scripts/validate-workflow.mjs skills/chief-t3/workflows/default.json
```

安装回归在临时目录隔离 HOME 与 CHIEF_SKILL_DIR，覆盖已有文件和备份、无效参数零写入、空格路径、源目标冲突、自包含模板、重复安装与 AGENTS 用户内容保留；不需要真实派单或浏览器。
