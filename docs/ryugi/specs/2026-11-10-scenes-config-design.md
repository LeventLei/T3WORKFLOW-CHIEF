# 设计说明：把“流程 + 角色”合并成“场景”，全局一套配置

日期：2026-11-10　状态：待用户确认

## 为什么改

现在的配置把同一件事配了两遍：“模型与角色”里每个角色的职责描述已经写清楚“什么情况下用它”（如“规格明确的小改动”），“流程”又把这些角色塞进 摸底 / 架构设计 / 实现 / 审查 四个固定格子，还要逐格选人。再加上工作流按项目分配、只能复制新建，操作繁琐。用户要的是：

- 把这些东西当作**业务场景**来配：每个场景写清楚什么时候用，直接配首选 / 备选 / 兜底三个模型；
- 不再分“流程”和“模型与角色”两大块；
- **全局一套**配置，所有项目共用，Chief 看任务自己挑场景、自己组合。

成功的样子：打开面板只有一页，“场景”和“规则”两块；改完点保存，下一次派单立即生效，不用重跑 install.sh，也不用跟 Chief 说切换。

## 已定下的决定（用户 2026-11-10 在对话中同意）

1. 现有 7 个角色直接转成 7 个场景，描述沿用原职责描述。显示名：scout→小范围摸底，navigator→大范围分析，fast-dev→小改动，dev→复杂开发，architect→架构设计，reviewer→独立审查，docs→文档。
2. 场景可以新增、删除、改名；每个场景设：只读 / 可写、任务类型（delegateRole）。
3. 每个场景固定三个模型位置：首选（必填）、备选、兜底（可空）；首选不可用时按顺序往后换。
4. 保留硬规则：改了代码必须独立审查（开关，默认开）；审查模型不能与写代码的模型相同；同时写代码的 Worker 数、返工轮数、写契约的文件数阈值照旧。
5. Chief 每次派单前读全部场景描述，按任务挑一个或几个场景串起来用，汇报里写明用了哪些场景、为什么。
6. 旧配置一次性自动转换，转换前备份；之后只支持新格式。
7. 只保留一套全局配置。面板左栏的项目列表和工作流库去掉，不再按项目分配工作流。
8. 写代码默认场景 + 失败升级（用户 2026-11-10 提出：Chief 用的 astra 几乎把任务都给复杂开发，其实小改动 / 普通开发也能完成）。规则里设“写代码默认用哪个场景”和“同一任务失败 N 次后转给哪个场景”，具体规则见“Chief 怎么用”。

## 配置格式 v2

文件位置（**我的决定**）：全局配置放用户目录 `~/.chief-t3/config.json`。这样保存后立即生效、重装技能不会覆盖。可用环境变量 `CHIEF_CONFIG` 覆盖路径（测试用）。技能安装目录里的 `workflows/default.json` 改成 v2 格式，只作为“还没有全局配置时”的出厂默认。

```json
{
  "schemaVersion": 2,
  "title": "Chief 场景配置",
  "scenes": {
    "fast-dev": {
      "label": "小改动",
      "when": "规格明确的小改动",
      "delegateRole": "implementation",
      "access": "write",
      "reportLimit": 300,
      "primary":  { "provider": "opencode", "model": "opencode-go/deepseek-v4.1-flash", "options": { "variant": "high" } },
      "backup":   null,
      "fallback": null
    }
  },
  "rules": {
    "requireReview": true,
    "defaultWriteScene": "fast-dev",
    "escalateTo": "dev",
    "escalateAfter": 2,
    "maxParallelWriters": 2,
    "maxReworkRounds": 2,
    "contractFileThreshold": 3
  }
}
```

- 场景键名：小写字母、数字、连字符（沿用 `KEY` 规则）；新建场景时由显示名自动生成，用户可改。
- `label`、`when`（什么时候用，必填非空）、`delegateRole`（implementation / research / review / design / test / general）、`access`（readonly / write）、`reportLimit`（可选，≥50）。
- `primary` 必填；`backup`、`fallback` 为 target 对象或 `null`（也允许省略）。target 结构和校验与 v1 相同：provider、model 非空，options 是对象且不能含 `role`。
- 不再有 `name`、`description`、`roles`、`stages`、`limits` 字段。

校验（`scripts/validate-workflow.mjs` 改写为 v2，仍浏览器 / CLI 两用、零依赖）：

- 至少一个场景；至少一个 `access: write` 的场景。
- `rules.requireReview` 为 true 时，至少有一个 `delegateRole: review` 的场景。
- 审查场景的**首选**模型与任一 `delegateRole: implementation` 场景的**首选**模型相同 → 报错（和 v1 一样只比较首选；运行时规则见下）。
- rules 数值范围同 v1：并行写 1–8，返工 0–5，阈值 ≥0。
- `defaultWriteScene`、`escalateTo` 可选；填了就必须指向存在的、`delegateRole: implementation` 的场景，且两者不能相同。`escalateTo` 填了时 `escalateAfter` 必填，整数 1–5，并且必须小于 `maxReworkRounds`（升级后的场景至少还有一次机会），否则报错“升级次数要小于返工轮数上限”。删除或改名场景时，面板同步清空或更新这些引用。
- `schemaVersion` 不是 2 时报错“这是旧格式，请先运行转换”。
- `workflow.schema.json` 同步改成 v2。

## Chief 怎么用（SKILL.md 改写“工作流配置”一节）

- 读取顺序：`~/.chief-t3/config.json` 存在就用它；否则用本技能目录的 `workflows/default.json`。首次汇报说明用的哪个文件。去掉“用户点名的工作流 / 项目配置 / 工作流库”三条。用户在消息里临时提的要求（如“这次别派审查”）照常作为本次指令处理，不需要配置支持。
- 选场景：派单前读全部场景的 `label` 和 `when`，按任务挑；可以组合（如 小范围摸底 → 复杂开发 → 独立审查）；汇报里写明用了哪些场景和理由。没有合适场景时说明并请用户决定，不自行套用不相干的场景。
- 写代码默认场景：设置了 `defaultWriteScene` 时，所有实现类派单**一律先派这个场景**，不按“任务看起来复杂”自行改派更高的场景。只有两种例外：用户在本次消息里点名要用某个场景；或该任务已按下面的升级规则升级。设计类（design 场景）、摸底、审查不受影响，仍按描述挑选。
- 失败升级：同一任务在默认场景上“没修好”累计达到 `escalateAfter` 次后，改派给 `escalateTo` 场景，新派单带上完整的失败记录（审查 findings、验收失败的证据、契约和真实路径）。“没修好”一次 = 一次独立审查给出 REJECT，或主线程验收发现未达标并要求返工。升级前后的次数合计受 `maxReworkRounds` 限制；到上限仍失败时按原规则说明阻塞、请用户决定。汇报里写明是否升级、在第几次失败后升级。
- 模型：按 首选 → 备选 → 兜底 依次核对能力后使用；三个都不可用时报告缺失项、请用户决定。不得用场景之外的模型、猜模型名、重启 T3。
- 审查：`requireReview` 为 true 时，凡有写代码的派单，交付前必须派一个 review 场景做独立审查；实际使用的审查模型必须与该任务实现者实际用的模型不同——如果审查场景的首选恰好相同，就顺延到它的备选 / 兜底；都相同则报告冲突请用户决定。`requireReview` 为 false 时可以不审，但最终汇报写明“本次未经独立审查”。
- `rules.maxParallelWriters` / `maxReworkRounds` / `contractFileThreshold` 替换原文中 `limits.*` 的引用；执行步骤 2 “必要时先用 recon 阶段的角色摸底，S 级任务走 design 阶段”改为“按场景描述决定是否先摸底、是否先出设计”。
- `delegateRole`、`access`、`reportLimit`、target / options 的用法说明从“roles.<key>.*”改为“scenes.<key>.*”，含义不变。
- 配置无效时的处理不变：报告具体问题、停止派单，不猜、不回退。

## 面板（panel/index.html + panel/server.mjs）

页面结构：

- 去掉左栏（工作流列表、项目列表、新建工作流、移动端抽屉）、项目分配页、“复制一份”、新建工作流对话框。页面变成单栏：顶栏（标题“Chief 场景配置” + 保存 / 撤销修改，沿用现有保存条、勾号、轻顶等反馈）→ 说明行 → **场景** → **规则** → 高级（JSON 查看，沿用现有 `sec-adv`）。
- 说明行：“Chief 每次派单前会读这些场景，按任务挑选、组合。保存后下一次派单立即生效。”；还没有全局配置文件时追加一句“现在显示的是出厂默认，保存后会写到 ~/.chief-t3/config.json”。
- **场景**区：沿用现有角色列表的行 + 展开编辑样式（`.role-*` 结构、展开动画、T3 服务商 / 模型下拉、重新读取、shimmer 都保留）。
  - 收起时一行：显示名、什么时候用（截断）、首选模型、只读 / 可写徽标、备用数量徽标。
  - 展开后：基本（显示名、键名、什么时候用、只读 / 可写、任务类型、汇报字数上限）+ 三个模型位置“首选 / 备选 / 兜底”，每个位置是现有的 provider + model + 参数编辑器；备选、兜底有“清空”。
  - 区块底部“添加场景”：插入一个空白场景并直接展开（显示名“新场景”、access write、delegateRole implementation、首选为空待选）；每行展开区有“删除场景”（二次确认）。
- **规则**区：开关“改了代码必须独立审查”；“写代码默认用 [场景下拉，可选“不指定”]”；“同一任务失败 [N] 次后转给 [场景下拉，可选“不升级”]”（下拉只列 implementation 类场景）；再加原来三个数字（沿用现有规则区控件）。
- 去掉“流程”区及其信号流动效（`layoutFlowSignal` 等）。其它动效、深浅色、视觉风格保持。
- 校验问题仍在保存条显示数量、点了能定位到对应字段。

服务端：

- 新接口：`GET /api/config` 返回 `{ data, file, exists, mtime, issues }`（`exists:false` 时 data 来自出厂默认）；`PUT /api/config` 带 `{ data, baseMtime }`，校验通过才写入（原子写 + 备份，沿用 `atomicWrite`），409 冲突逻辑同现在。`GET /api/providers` 保留。
- 删除：`/api/state` 里的项目 / 工作流库部分（接口本身保留，见“其它文件”）、`/api/workflow`、`/api/library/*`、`/api/project/assign`，以及只为它们存在的函数（`listProjects`、`readT3Projects`、`assignmentOf`、`listLibrary` 等）。如果 `readT3Providers` 依赖其中的东西，保留所需部分。
- T3 数据只读、不读 `~/.t3/userdata/secrets`、只透出白名单字段——这些约束不变。

## 转换旧配置

新增 `scripts/migrate-to-scenes.mjs`：

- `node scripts/migrate-to-scenes.mjs <v1.json> [--out <file>]`：把一份 v1 转成 v2 打印或写出。映射：每个 role → 同键名 scene；`label` 用决定 1 的中文名（不在表里的键用原 label）；`when` = purpose，若对应 stage 有 note 且 purpose 里没有，用“；”拼到后面；`primary` = target，`backup` = fallbacks[0]，`fallback` = fallbacks[1]，多于两个备用时打印警告列出被丢弃的；`rules.requireReview` = review 阶段 enabled（没有该阶段则 false）；limits 原样搬到 rules；源里同时有 `fast-dev` 和 `dev` 两个场景时写入 `defaultWriteScene: "fast-dev"`、`escalateTo: "dev"`、`escalateAfter: 2`（若 maxReworkRounds ≤ 2 则取 maxReworkRounds − 1，为 0 时不写升级），否则不写这三项。
- 脚本对输入版本做判断：v1 按上面映射转换；已经是 v2 的直接校验后原样使用。这样不论仓库 default.json 先还是后转换，`--apply` 都能跑。可用 `--from <file>` 指定源。
- `--apply`：一次性迁移本机。默认以仓库里的 `skills/chief-t3/workflows/default.json`（含用户在面板里改过、尚未提交的模型选择）为源，写出 `~/.chief-t3/config.json`（已存在则先备份为 `config.json.bak.<时间>`）；把 `~/.t3-tasks/*/workflow.json` 逐个改名为 `workflow.json.bak.<时间>`，并打印每个项目配置与全局配置在场景模型上的差异，方便用户手动合并；`~/.chief-t3/workflows/` 若存在则原样保留不动，只打印提示。
- 仓库里的 `skills/chief-t3/workflows/default.json` 同时转换为 v2 作为出厂默认（**我的决定**：出厂默认采用用户当前工作副本里的模型选择）。

## 其它文件

- 仓库根目录 `AGENTS.md`（install.sh 会把其中的 chief-t3 区块写进各项目的 AGENTS.md）：同步改成 v2 说法——读 `~/.chief-t3/config.json`，没有就用技能目录的 default.json；按场景挑选；去掉“用户点名 → 项目 workflow.json → default.json”和“角色 / 阶段”的表述。已安装到各项目的旧区块由用户重跑 install.sh 更新，本次不直接改各项目文件。
- `GET /api/state` 保留为轻量的状态接口（`app/` 启动器用它判断面板是否已启动），只返回 `{ ok: true, configFile, exists }`。
- `install.sh`：PAYLOAD 不变（default.json、schema、模板、SKILL.md）；结束时如果 `~/.chief-t3/config.json` 不存在，提示“可在面板里保存生成全局配置”；不覆盖已有 config.json。去掉为每个项目写 workflow.json 的逻辑（如有），台账目录照建。
- `README.md`：改写配置说明为“场景 + 规则、全局一份、文件位置、迁移命令”。
- `app/` 启动器不需要改。

## 不做

- 不做多套配置 / 按项目覆盖（用户已决定只要一套）。
- 不做按“任务规模”自动路由的硬编码；规模判断全部写在场景描述里由 Chief 判断。
- 不改面板视觉风格；不新增依赖。
- 不改 T3 相关的读取方式和隐私约束。

## 留给实现者决定

- 场景行收起时的具体排版、徽标文案；“添加场景”的键名自动生成细节。
- 服务端删除旧代码的范围（以不留死代码为准）。
- 校验报错的具体措辞（中文、指到字段）。

## 验收

- `node --check` 两个 mjs；面板模块脚本语法检查；`node scripts/validate-workflow.mjs skills/chief-t3/workflows/default.json` 通过。
- 用 `CHIEF_CONFIG=<临时文件>` 起测试服务：无配置文件时显示出厂默认、保存后生成文件；改首选模型、加场景、删场景、关审查开关、保存后刷新读回一致；制造审查与实现首选相同 → 保存被拦并定位。
- 迁移脚本先在临时 HOME 上跑 `--apply`，确认备份、输出、差异打印正确；真实迁移由主线程在用户确认后执行。
