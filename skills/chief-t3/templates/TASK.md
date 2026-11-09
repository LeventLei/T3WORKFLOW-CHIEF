# TASK-XX

## Goal

描述可观察的完成结果。

## Scope

允许改动的文件 / 目录；明确台账报告路径，不修改其他配置或用户文件。

## Workspace / Inputs

- 隔离策略：worktree 或已授权 shared。
- worktree：由平台 isolation:worktree 分配，派单时路径未知；使用分配的工作目录，报告真实绝对路径。不得用 shell 创建或编造路径。
- shared：填写用户已授权的绝对工作目录；非 Git 项目不擅自 git init。
- 父未提交内容不会复制到 worktree：列出依赖输入的绝对路径 / 内容快照与使用授权。
- 契约、输入、报告均使用可访问的绝对路径；Worker 不再派单。

## Constraints

- 记录开工 tracked / untracked / 内容基线，保留已有修改；只做 Scope 内已授权改动。
- 不提交、推送、合并或删除，除非任务另有明确授权。

## Acceptance

填写可在实际工作目录执行的命令与通过标准；不要预填不存在的 worktree 路径。
验证与风险匹配，低风险文案改动不机械新增测试。交付实际改动（含 untracked）、命令结果、风险与未完成项。
契约变更先与 Chief 对齐。
