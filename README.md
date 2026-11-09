# T3WORKFLOW-CHIEF

在 **T3 Code** 里复刻 Paseo 的 **Chief（幕僚长）** 多 Agent 协作模式。
原版依赖 Paseo MCP（`create_agent` / `send_agent_prompt` / `list_profiles`…），本仓库把它换成 T3 原生工具（`delegate_task` + 线程工具），角色、契约、审查规则保持不变。

## 组成

| 文件 | 作用 |
|---|---|
| `skills/chief-t3/SKILL.md` | 主配置：工具映射、角色表（provider/model/档位）、契约约定、独立审查、REJECT 流程、红线 |
| `AGENTS.md` | 项目级入口模板：让该项目的新线程默认进入 Chief 模式 |
| `templates/` | `HANDOFF.md` 与 `TASK-XX.md` / `.report.md` / `.review.md` 契约模板 |
| `install.sh` | 一键把 skill 装到 `~/.agents/skills/chief-t3`，可选把 `AGENTS.md` 装进指定项目 |

## 安装

```bash
git clone https://github.com/ShawnWei0323/T3WORKFLOW-CHIEF.git
cd T3WORKFLOW-CHIEF
./install.sh /f/your-project      # 只装 skill 就省略路径参数
```

`~/.agents/skills/` 是 Pi 的默认 skill 扫描目录，装完即被发现。已开着的会话执行 `/reload`，或直接新开线程。

## 角色表

派单前先跑 `orchestrator_capabilities` 校验 provider/model 是否仍存在（provider 会停用、模型会改名）。

| 角色 | target | 职责 |
|---|---|---|
| chief | 当前线程（强模型：`pi` + `openai/gpt-6-astra`，`thinking:"low"`） | 拆单、写契约、验收，不写业务代码 |
| scout | `pi` + `opencode-go/deepseek-v4.1-flash`，`thinking:"high"` | 小范围摸底，只读，≤300 字 |
| navigator | 首选 `antigravity` + Gemini；回退 `pi` + `openai/gpt-6-astra` | 全库索引 / 多模态视觉排障，只读 |
| fast-dev | `pi` + `opencode-go/deepseek-v4.1-flash`，`thinking:"high"` | 规格明确的小改动 |
| dev | `codex` + `gpt-6.1-sol`，`reasoningEffort:"high"` / `"xhigh"` | 跨文件重构、并发权限、疑难 bug |
| reviewer | `codex` + `gpt-6-astra`，`reasoningEffort:"xhigh"` | 合并前独立审查，PASS/REJECT |
| architect | `codex` + `gpt-6-astra`，`reasoningEffort:"xhigh"` | 仅 S 级立项，产出 `SPEC.md` |
| 文档工作 | `pi` + `opencode-go/deepseek-v4.1-flash`，`thinking:"low"` | 把难读的文档改成人话 |

规则要点：**写代码的 Worker 不审自己**（dev=`sol` / reviewer=`astra` 即合规）；并行写代码 ≤3 个；超过 2 个文件或规格不清才写契约。

## Paseo 对照

| Paseo | T3 Code |
|---|---|
| `create_agent(profile)` | `delegate_task{target:{…}}` |
| `create_workspace` | `delegate_task{isolation:"worktree"}` |
| `notifyOnFinish` | 完成时唤醒；`mode:"wait"` / `task_status` |
| `get_agent_activity` | `t3_thread_read view:"activity"` |
| `archive_agent` | `t3_thread_organize settle/archive` |
| `send_agent_prompt`（REJECT 复用上下文） | **重新 `delegate_task`** 并把 findings 写进 brief（子 Agent 无父历史） |
| `~/.paseo-tasks/<proj>/` | `~/.t3-tasks/<proj>/`（文件约定不变） |

## 已知差异

1. **没有 profile 概念**：Paseo 用 `list_profiles` 一句带过，T3 每次派单都要写全 `providerInstanceId + model + options`，所以角色表固化在本仓库里。
2. **navigator 的视觉能力取决于 `antigravity` 实例**：`orchestrator_capabilities` 里该 provider 返回 `models: []` 时无法指定模型，需先让 AGY 侧把模型列出来；否则退回 `preview_snapshot` 取证 + 让用户给图片绝对路径。
3. **REJECT 不复用 Worker 上下文**：返工要靠 brief 里写清 findings，这也是 T3 官方推荐做法。
4. **worktree 隔离要求项目本身是 git 仓库**。

## 环境要求

- T3 Code（服务端与本机 `t3` CLI 已就绪）
- 可用的 provider：`pi`、`deepseek-harness`、`codex`；`antigravity` 可选
- git + bash（Windows 上用 Git Bash 跑 `install.sh`）
