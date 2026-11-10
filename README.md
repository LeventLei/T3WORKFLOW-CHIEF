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
| `skills/chief-t3/workflows/` | 默认工作流配置与 JSON Schema，随 skill 安装 |
| `skills/chief-t3/templates/` | 权威模板，随 skill 安装；从 SKILL.md 所在目录相对解析 |
| `templates/` | 仓库入口的兼容模板副本，与打包模板保持一致 |
| `AGENTS.md` | 受管理的项目入口区块，区外保留用户规则 |
| `panel/` | 本地工作流配置面板（`node panel/server.mjs`） |
| `app/` | 把面板打包成 macOS 应用（`bash app/build-mac-app.sh`） |
| `scripts/validate-workflow.mjs` | 工作流配置校验（命令行与面板共用） |
| `install.sh` | 校验、备份、安装、集成项目规则与初始化缺失台账 |

安装后的 skill 和模板独立可用，不需要原仓库仍在磁盘。项目台账为 `~/.t3-tasks/<project>/`，契约、报告、审查与输入用绝对路径传递。

## 工作流配置

角色、模型和流程参数不再写死在文档里，而是放在 JSON 配置中：

| 位置 | 用途 |
|---|---|
| `skills/chief-t3/workflows/default.json` | 默认工作流，随 skill 安装；重新安装会覆盖（覆盖前备份） |
| `~/.chief-t3/workflows/<名称>.json` | 工作流库：你自己建的工作流，可被多个项目共用 |
| `~/.t3-tasks/<project>/workflow.json` | 项目选择：完整配置（专属工作流），或一行引用 `{"use": "<名称>"}`；安装脚本不会创建或改动它 |
| `skills/chief-t3/workflows/workflow.schema.json` | 配置格式（JSON Schema），编辑器可据此补全和校验 |

Chief 每个线程按顺序取第一个存在的配置：用户本次点名的文件或库中名称 → 项目 `workflow.json`（引用时读工作流库里的对应文件）→ 默认配置。`<project>` 是项目根目录的目录名。引用的工作流不存在或无效时 Chief 停止派单，不会悄悄回退到默认配置。

可配置的内容：

- `roles`：每个角色的 provider / model / `options`、`delegate_task` 顶层 `role`、读写权限、汇报字数、已授权 fallback 列表。
- `stages`：recon / design / implement / review 四个阶段的开关、是否必经、可用角色。
- `limits`：并行写 Worker 上限、返工轮数上限、必须写契约的文件数阈值。

不可配置、始终生效的规则在 `SKILL.md`：等待不轮询、审查模型必须与实现模型不同、fallback 之外不换模型、各类操作授权边界等。关闭 review 阶段时，Chief 会在汇报中写明"本次未经独立审查"。

### 配置面板

本地网页编辑器，无第三方依赖。两种启动方式：

```bash
node panel/server.mjs            # 默认 http://127.0.0.1:4317，可加 --port 指定端口
```

macOS 可以打包成双击即用的应用：

```bash
bash app/build-mac-app.sh        # 生成 ~/Applications/Chief 工作流.app，可传入其他目录
```

双击「Chief 工作流」会在后台启动面板并用默认浏览器打开；已经在运行时只打开页面。在 Dock 里退出应用会停止它启动的面板。日志在 `~/Library/Logs/chief-panel.log`。应用记录的是生成时的仓库路径和 node 路径，移动仓库或换了 node 安装位置后重新运行一次构建脚本即可；仓库里的代码更新不需要重新构建。

- 左侧上半部分是**工作流**：内置的默认工作流和你自己建的工作流。「＋ 新建工作流」复制一个现有工作流，起名后即可修改；工作流页面可以「复制一份」或删除（还有项目在用时不能删，删除只是改名保留）。
- 左侧下半部分是 **T3 项目**，直接读取 T3 Code 的项目列表（`~/.t3/userdata/statev2.sqlite`，只读；已删除的项目不显示，已归档的单独列出）。只存在于 `~/.t3-tasks/` 而 T3 里没有的项目标为「不在 T3」。
- 点一个项目，选择它用哪个工作流：默认 / 库里的某个工作流 / 专属工作流（复制一份只给它用，直接在下方修改）。选中即生效。
- 一页分三块：**① 流程**（四个步骤的开关、是否必经、由哪些角色负责）、**② 角色与模型**（点开一行改模型、强度和备用模型，不常用的设置收在“更多设置”）、**③ 规则**（三个数字）。内部名称、文件位置和 JSON 原文在页面底部“高级”里。
- **服务商和模型同步自 T3 Code**：读取 T3 的服务商缓存 `~/.t3/caches/<服务商>.json`（只读，只取服务商、模型和可调参数，不读账号、密钥和用量）。改模型时服务商、模型、推理强度等都是下拉选择，选项和 T3 里一致；未启用的服务商标为「未启用」。换模型后新模型不支持的参数会自动去掉。T3 里已经没有的服务商 / 模型 / 参数值会标黄提示，但不阻止保存（缓存可能比 T3 慢一步）。在 T3 里启用新服务商或更新模型后，点「重新读取」即可。读不到缓存时退回手动填写。
- 校验与 `scripts/validate-workflow.mjs` 相同，问题会标在对应的输入框和步骤上，底部保存栏列出全部问题，点击可跳到出错处；有问题时不能保存。
- 保存前备份旧文件为 `*.bak.<时间>`；文件在面板外被改过时拒绝覆盖，需先重新加载。
- 只监听 127.0.0.1，只能编辑上述三类文件，拒绝跨站请求。
- 位置可用环境变量覆盖：`T3CODE_HOME`（T3 数据目录，默认 `~/.t3`）、`CHIEF_T3_DB`（T3 数据库文件）、`CHIEF_WORKFLOWS_DIR`（工作流库目录）。读取 T3 项目需要 Node 22.5+（内置 `node:sqlite`）或系统里有 `sqlite3` 命令；都没有时只显示台账目录里的项目。
- 改默认工作流后需重新运行 `install.sh` 才会装到 skill 目录；工作流库和项目选择在下一个 Chief 线程开工时生效。

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
