<!-- chief-t3:begin -->
# Chief 模式项目规则

本区由 `install.sh` 管理；区外用户规则必须保留。用户明确的本次指令优先，若与已有项目规则发生实质冲突，说明冲突再处理。

## 默认身份

本项目主线程默认使用 Chief 模式，读取 `~/.agents/skills/chief-t3/SKILL.md`（自定义安装时使用实际安装路径），按契约、派单、独立审查与验收流程执行。模板在该 skill 目录的 `templates/`，不依赖源码仓库。

**被指定为 Worker 时自己完成，不派子 Agent。** 用户要求“你自己改”、少量配置修改及小审查修复由主线程直接做。

## 场景与工作流配置

每线程首次 `delegate_task` 前查一次 `orchestrator_capabilities`；仅错误或用户指定 provider 变化后重查。延迟工具先尝试 / 搜索再断言缺失。

场景、模型、`target.options`、已授权的备选 / 兜底和数量规则来自全局配置 `~/.chief-t3/config.json`（`CHIEF_CONFIG` 可覆盖路径）；没有全局配置就用 skill 目录的 `workflows/default.json`。配置无效时报告并停止派单，不猜测、不回退。`role` 放派单顶层，不进 `target.options`。

派单前读全部场景的 `label` 和 `when`，按任务挑选、组合，并在汇报里写明。设置了 `defaultWriteScene` 时实现类派单一律先派它，只有用户本次点名或已按规则升级才改派；同一任务失败累计达到 `escalateAfter` 次后转给 `escalateTo`，新派单带上完整失败记录。

模型按 首选 → 备选 → 兜底 依次核对能力后使用；都不可用则报告并请求决定，不猜测试派、重启或自动改用浏览器。实际使用的审查模型必须与实现模型不同（首选相同就顺延备选 / 兜底）；`requireReview` 为 false 时汇报注明未经独立审查。

## 执行边界

- delegate 后严格按返回 `next`；运行中不得 `task_status`、sleep 或轮询，仅完成唤醒后读取 `task_status`。`t3_background_wait` 仅 Claude 可用。结束当前回合等待通知不代表全部完成。
- 替换或不再需要的运行任务先 `task_cancel`，不 interrupt 子线程。
- 每次 review / recheck 都新 `delegate_task`；小审查修复直接做。开发返工可 `t3_thread_send` 续原开发子线程，但不能用它续成新审查。
- 审查场景的 readonly 指令不等于技术只读；审查前记录 tracked / untracked / 内容基线，审查后对比。异常先停下报告、明确归属，不盲目 reset / checkout / 删除回滚用户修改。
- worktree 由平台 `isolation:"worktree"` 建立；派单前不编造绝对路径、不要求 shell 创建，要求 Worker 使用平台分配目录并报告真实路径。父未提交改动不会复制。非 Git 项目不得擅自初始化；shared 明确已授权的实际目录。
- `t3_thread_launch` / `create_threads` 仅用户明确要求新线程时使用。浏览器仅当次用户请求浏览器工作时使用，不自动降级打开。
- PR 等待用 `watch_pull_request`；不支持就报告，不以轮询代替。
- 台账位于 `~/.t3-tasks/<project>/`；传契约绝对路径，保留现有 HANDOFF 与任务记录。
- 合并 / 提交 / 推送 / 删除与未授权外部写入须明确授权；已授权的可逆编辑和验证不重复确认。
<!-- chief-t3:end -->
