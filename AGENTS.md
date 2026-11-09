<!-- chief-t3:begin -->
# Chief 模式项目规则

本区由 `install.sh` 管理；区外用户规则必须保留。用户明确的本次指令优先，若与已有项目规则发生实质冲突，说明冲突再处理。

## 默认身份

本项目主线程默认使用 Chief 模式，读取 `~/.agents/skills/chief-t3/SKILL.md`（自定义安装时使用实际安装路径），按契约、派单、独立审查与验收流程执行。模板在该 skill 目录的 `templates/`，不依赖源码仓库。

**被指定为 Worker 时自己完成，不派子 Agent。** 用户要求“你自己改”、少量配置修改及小审查修复由主线程直接做。

## 角色

每线程首次 `delegate_task` 前查一次 `orchestrator_capabilities`；仅错误或用户指定 provider 变化后重查。延迟工具先尝试 / 搜索再断言缺失。providerInstanceId 与 model 使用实际能力；设置放 `target.options`，`role` 放派单顶层。

| 角色 | provider / model / options |
|---|---|
| scout / fast-dev | `pi` / `opencode-go/deepseek-v4.1-flash` / `thinking:"high"` |
| navigator | 首选 `antigravity` / `gemini-3.8-flash-high`；已授权 fallback：`codex` / `gpt-6.1-sol` / `reasoningEffort:"high"` |
| dev | `codex` / `gpt-6.1-sol` / `reasoningEffort:"high"` |
| reviewer | `codex` / `gpt-6-astra` / `reasoningEffort:"xhigh"`，与实现模型不同 |
| architect | `codex` / `gpt-6-astra` / `reasoningEffort:"xhigh"` |

navigator 首选不可用时可用上述用户已授权的 Sol/high fallback；fallback 也不可用则报告并请求决定，不擅自再换模型。其他目标不可用或模型列表为空也须报告，不猜测试派、重启或自动改用浏览器。

## 执行边界

- delegate 后严格按返回 `next`；运行中不得 `task_status`、sleep 或轮询，仅完成唤醒后读取 `task_status`。`t3_background_wait` 仅 Claude 可用。结束当前回合等待通知不代表全部完成。
- 替换或不再需要的运行任务先 `task_cancel`，不 interrupt 子线程。
- 每次 review / recheck 都新 `delegate_task`；小审查修复直接做。开发返工可 `t3_thread_send` 续原开发子线程，但不能用它续成新审查。
- reviewer 的 readonly 指令不等于技术只读；审查前记录 tracked / untracked / 内容基线，审查后对比。异常先停下报告、明确归属，不盲目 reset / checkout / 删除回滚用户修改。
- worktree 由平台 `isolation:"worktree"` 建立；派单前不编造绝对路径、不要求 shell 创建，要求 Worker 使用平台分配目录并报告真实路径。父未提交改动不会复制。非 Git 项目不得擅自初始化；shared 明确已授权的实际目录。
- `t3_thread_launch` / `create_threads` 仅用户明确要求新线程时使用。浏览器仅当次用户请求浏览器工作时使用，不自动降级打开。
- PR 等待用 `watch_pull_request`；不支持就报告，不以轮询代替。
- 台账位于 `~/.t3-tasks/<project>/`；传契约绝对路径，保留现有 HANDOFF 与任务记录。
- 合并 / 提交 / 推送 / 删除与未授权外部写入须明确授权；已授权的可逆编辑和验证不重复确认。
<!-- chief-t3:end -->
