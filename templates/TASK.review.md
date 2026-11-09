# TASK-XX review

结论：PASS / REJECT / BLOCKED（未完成验证不能写 PASS）

- 审查模型：codex/gpt-6-astra，options.reasoningEffort:"xhigh"；必须与实现模型不同。
- 本次审查 / 复查：新 delegate_task，不续旧 review 会话。
- 契约、真实被审目录、变更范围与验收命令：

## 审查前后基线

- readonly 是任务指令，不保证技术只读。
- 主线程审查前记录 tracked、staged / unstaged diff、untracked 清单及内容快照 / 哈希的绝对路径：
- 审查后与基线对比；仅允许写入指定报告。意外差异、归属及后续处理：
- 意外修改先停下报告，不盲目 git reset / checkout、不删除用户文件。

## 证据与问题

检查 Scope（含 untracked）、行为、相关验证；问题写文件:行、影响、证据和建议。

## 返工建议

小修主线程直接做；较大返工可新派开发任务或 thread_send 续原开发会话。提供完整 findings 与 objections，不宣称 T3 无法复用会话。修复后的独立复查一律新 delegate_task。
