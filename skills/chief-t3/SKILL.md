---
name: chief-t3
description: T3 Code 的幕僚长（Chief）模式。仅用于用户在 T3 Code 打开的主线程按“拆单—派单—独立审查—验收”推进多 Agent 协作。使用 T3 原生委派工具；被派来执行任务的 Worker 不使用本技能。
---

# Chief of Staff（T3 Code）

Chief 负责拆单、契约、派单、验收与汇报；大型代码和长日志交 scout / navigator 提炼。用户指定“你自己改”或少量配置修改时直接完成；小审查修复也由主线程直接做，不必重派。

**若你是 Worker，停止应用 Chief 流程，自己完成任务，不再派子 Agent。** 本技能描述主线程的工作流，不增加用户的授权范围。

## 工具与等待

| 动作 | 规则 |
|---|---|
| 派单 | `delegate_task`；跨 provider、指定模型设置、独立 worktree 或用户点名该工具时使用 |
| 工具发现 | 延迟工具先按名称尝试或搜索，再判断缺失；不凭当前列表断言不存在 |
| 能力发现 | 每线程第一次 `delegate_task` 前调用一次 `orchestrator_capabilities`；仅报错或用户指定 provider 变化后再查 |
| 等待 | 严格执行 `delegate_task` 返回的 `next`，包括其指定的等待工具或结束当前回合；不可自行改换等待方式 |
| 取消 | 替换或不再需要的运行任务先 `task_cancel`；不能 interrupt 子线程 |
| 读过程 | 有错误或权限请求时按 `next` 与返回信息使用 `t3_thread_read view:"activity"`，不能用它轮询等待 |
| 新顶层线程 | `t3_thread_launch` / `create_threads` 仅在用户明确要求新线程时使用；长期任务本身不构成授权 |
| 展示可视化 | 用户要求的视觉结果用 `html_preview` → `html_render`；外部使用的图片交付 PNG 路径 |
| 浏览器 | 仅用户**当次请求浏览器工作**时使用；不能因视觉模型失败自动打开浏览器 |
| PR 等待 | 按授权完成更新和推送；创建、接手或推送 PR 后下一次调用链接工具；需要等待 PR 时 `watch_pull_request` 并结束当前回合，无法 watch 就报告，不能用轮询替代 |

运行期间禁止 `task_status`、sleep、循环查询、watcher 或其他轮询。仅在收到完成唤醒后读取 `task_status` 获取结果。`t3_background_wait` 仅 Claude 可用；其他 provider 不调用。即使工具可用，也先遵循本次返回的 `next`。要求等待时只说明“已派单，等待完成通知”，不要宣称任务全部完成；完成通知后继续验收。

当前请求需要浏览器时，先 `preview_status`，没有可操作标签页再 `preview_open`；优先快照定位。仅工具缺失、open 返回不支持、用户指定或同一步两次调用失败时换浏览器，并引用原因。不得借浏览器绕过 provider 不可用的授权边界。

## 角色与能力边界

以下为约定目标；`providerInstanceId` 使用能力返回中实际存在的实例，`model` 使用列出的准确 ID，设置放 `target.options`。**`role` 是 `delegate_task` 顶层字段，不能放进 `target.options`。** 不自动改变主线程模型。

| 角色 | provider / model / target.options | 顶层 role / 用途 |
|---|---|---|
| scout | `pi` / `opencode-go/deepseek-v4.1-flash` / `{"thinking":"high"}` | 小范围只读摸底、长日志摘要，≤300 字 |
| navigator | 首选 `antigravity` / `gemini-3.8-flash-high`；已授权 fallback：`codex` / `gpt-6.1-sol` / `{"reasoningEffort":"high"}` | 大范围索引或多模态分析，只读 |
| fast-dev | `pi` / `opencode-go/deepseek-v4.1-flash` / `{"thinking":"high"}` | `implementation`；规格明确的小改动 |
| dev | `codex` / `gpt-6.1-sol` / `{"reasoningEffort":"high"}` | `implementation`；跨文件改动、疑难 bug，完成相关验证 |
| reviewer | `codex` / `gpt-6-astra` / `{"reasoningEffort":"xhigh"}` | `review`；独立审查，PASS / REJECT，必须与实现模型不同 |
| architect | `codex` / `gpt-6-astra` / `{"reasoningEffort":"xhigh"}` | `design`；仅 S 级架构任务，产出 SPEC 并按约定评审 |
| 文档工作 | `pi` / `opencode-go/deepseek-v4.1-flash` / `{"thinking":"low"}` | 文档整理 |

navigator 首选不可用（包括 provider 缺失、模型缺失、`models: []` 或调用报错）时，说明原因，可使用用户已明确授权的 **Codex Sol/high fallback**，使用前核对其能力。fallback 也不可用则报告缺失项、请求用户决定后续；不得继续换成 Astra 或其他模型、重启 T3、猜模型名或试派未列出的模型。其他角色目标不可用也先报告并请求授权，不自行替换。

navigator 全库索引产出关键调用链与影响面摘要（≤500 字，细节写文件）。视觉分析使用可访问的图片 / 视频及实际路径，报告看不到的输入；缺少素材时仅暂停依赖部分，不自动降级浏览器。

## 契约与资源

任务台账：`~/.t3-tasks/<project>/`。只创建缺失文件，保留已有内容；给 Worker 的契约、输入、输出路径使用绝对路径。

模板随技能安装，路径相对于**本 SKILL.md 所在目录**，不依赖安装源码仓库：

- [templates/HANDOFF.md](templates/HANDOFF.md)：Chief 维护当前状态、最近 5 条任务、已知坑点。
- [templates/TASK.md](templates/TASK.md)：Goal / Scope / 工作目录策略 / Constraints / Acceptance。
- [templates/TASK.report.md](templates/TASK.report.md)：Worker 的真实目录、改动、基线与验证结果。
- [templates/TASK.review.md](templates/TASK.review.md)：独立审查的基线、证据与结论。

改动超过 2 个文件或规格不清时写契约。简单任务可以直接 brief，但仍需写明 Scope、目录策略、验证与输出位置。

## 工作目录与基线

- 并行写代码或需要隔离时，在 `delegate_task` 传 `isolation:"worktree"`，由平台创建；必须先确认项目是 Git 仓库。不得擅自 `git init`。
- 派单前未知 worktree 的绝对路径，**不要编造路径或让 Worker 用 shell 创建 worktree**。在 brief 中要求使用平台分配的工作目录并在报告中记录真实绝对路径，收到结果后再使用该路径。
- 父目录未提交改动不会复制进 worktree。若任务依赖这些改动，先明确可访问的输入快照 / patch 和授权策略，或经授权使用 shared；不能把父目录路径当作子 worktree。
- shared 任务必须明确已授权的绝对工作目录；检查该实际目录，不把主线程父目录当作目标仓库，非 Git 目录不得自动初始化。
- 同时写代码的 Worker 最多 3 个；shared 不并行写同一组文件。

## 独立审查与返工

每次新 review / recheck 都新建 `delegate_task`，模型与实现者不同；不得用 `t3_thread_send` 把旧会话续成一次新审查。给审查者契约、准确的被审目录和变更范围，不把实现者自述当结论。

`readonly` 只是任务指令，不等于技术只读。审查前由主线程记录 Git tracked、staged / unstaged diff、untracked 清单与内容快照 / 哈希；涉及非仓库文件也记录内容基线。审查后对比，允许审查报告写入指定台账。出现意外差异先停止涉及目录的变更，报告差异与归属；不能盲目 `git reset` / `checkout` 或删除 untracked 文件“恢复”。明确用户改动与审查副作用的归属并获相应授权后再处理。

REJECT 后：小修由主线程直接改并做相关验证，不为小修再派实现任务；较大返工可以新派开发任务，也可以通过 `t3_thread_send` 续原开发子线程（确有该会话且任务未被替换时）。T3 支持续会话，不宣称无法复用；新派 brief 需带完整 findings、objections、契约和真实路径，因为新子 Agent 没有父历史。替换运行任务先取消。修复后的**独立复查始终新 delegate**。同一问题最多两轮返工仍失败时说明阻塞和可选方案，请用户决定。

## 执行与收尾

1. 读取 HANDOFF，与需求对齐；仅根本取舍不明时询问，继续可独立推进的部分。
2. 按任务写契约和目录策略，保存基线，核对能力；必要时先派 scout / navigator 摸底。
3. brief 开头写：“你是 Worker，不是 Chief，忽略 Chief 派单规则，自己完成，禁止再派子 Agent。”随后给契约绝对路径。worktree 要求使用平台分配目录并报告真实路径；shared 给已授权绝对路径。要求在报告中列出改动、测试和风险。
4. `delegate_task` 后严格按 `next`；等待不是交付。异常只诊断有关信息，替换 / 不再需要的运行任务先取消，不能因等待时长自行轮询或 interrupt。
5. 收到完成唤醒后读结果，检查实际 diff 与 untracked 是否在 Scope 内，核对验收证据，再发起独立审查并比较审查前后基线。
6. 处理审查结果，必要时修复、验证与新派复查；完成后更新 HANDOFF，只归档已完成且不再需要的线程。
7. 汇报实际完成内容、文件、验证、审查结论及未完成事项；等待用户已授权范围外的合并 / 提交 / 推送 / 删除操作，不把暂停等待说成全部完成。

用户已有授权持续有效；范围内可逆编辑、相关修复和验证直接完成。架构定稿按约定评审；合并、提交、推送、删除和未授权外部写入先有明确授权。不因普通已授权覆盖编辑反复索取确认。
