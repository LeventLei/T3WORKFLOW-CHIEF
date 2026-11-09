# TASK-XX review

结论：`PASS` | `REJECT`

审查者模型：`codex/gpt-6-astra (xhigh)` —— 必须与写代码的模型不同。

## 依据

- 契约：`TASK-XX.md`
- diff：`git diff --name-only` 结果
- 验收命令结果：

## 越界检查

- [ ] 改动文件全部在 Scope 内
- [ ] 没有顺手改动无关文件 / 格式化噪音
- [ ] 断言没有靠改测试通过

## 问题清单（REJECT 时必填）

1. 文件:行 —— 问题 —— 期望

## 给开发 Worker 的返工指令

（若 REJECT：写成可以直接作为新 `delegate_task` brief 的文字，不要引用会话上下文）
