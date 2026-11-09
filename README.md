# T3WORKFLOW-CHIEF

T3 Code 主线程的 Chief 工作流：拆单 → `delegate_task` → 独立审查 → 验收。被指定为 Worker 时自己完成，不再派单。

## 安装

需要 Bash 与常用 coreutils / awk；Windows 使用 Git Bash。

```bash
cd /f/T3WORKFLOW-CHIEF
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
| `skills/chief-t3/templates/` | 权威模板，随 skill 安装；从 SKILL.md 所在目录相对解析 |
| `templates/` | 仓库入口的兼容模板副本，与打包模板保持一致 |
| `AGENTS.md` | 受管理的项目入口区块，区外保留用户规则 |
| `install.sh` | 校验、备份、安装、集成项目规则与初始化缺失台账 |

安装后的 skill 和模板独立可用，不需要原仓库仍在磁盘。项目台账为 `~/.t3-tasks/<project>/`，契约、报告、审查与输入用绝对路径传递。

## 角色

每线程首次 `delegate_task` 前一次 `orchestrator_capabilities`；仅错误或用户指定 provider 变化后重查。使用返回的实例与准确模型 ID；延迟工具先尝试 / 搜索再认定缺失。设置写在 `target.options`，Worker `role` 是 `delegate_task` 顶层字段。

| 角色 | provider / model / target.options | 用途 |
|---|---|---|
| chief | 当前线程 | 拆单、契约、验收 |
| scout / fast-dev | `pi` / `opencode-go/deepseek-v4.1-flash` / `{"thinking":"high"}` | 摸底 / 小改动 |
| navigator | 首选 `antigravity` / `gemini-3.8-flash-high`；已授权 fallback：`codex` / `gpt-6.1-sol` / `{"reasoningEffort":"high"}` | 大范围 / 视觉分析 |
| dev | `codex` / `gpt-6.1-sol` / `{"reasoningEffort":"high"}` | 跨文件实现与验证 |
| reviewer | `codex` / `gpt-6-astra` / `{"reasoningEffort":"xhigh"}` | 独立审查，必须与实现模型不同 |
| architect | `codex` / `gpt-6-astra` / `{"reasoningEffort":"xhigh"}` | S 级架构方案 |
| 文档工作 | `pi` / `opencode-go/deepseek-v4.1-flash` / `{"thinking":"low"}` | 文档整理 |

navigator 首选不可用（含缺失、空模型列表或调用错误）时，可以使用用户已明确授权的 **Codex Sol/high fallback**，先核对其可用性；fallback 也不可用则报告，请用户决定，不再换其他模型。其他角色目标不可用也不得擅自替换；不自动重启、不猜模型试派。浏览器只能用于用户当次请求的浏览器工作，不能作模型失败后的自动降级。

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
```

安装回归在临时目录隔离 HOME 与 CHIEF_SKILL_DIR，覆盖已有文件和备份、无效参数零写入、空格路径、源目标冲突、自包含模板、重复安装与 AGENTS 用户内容保留；不需要真实派单或浏览器。
