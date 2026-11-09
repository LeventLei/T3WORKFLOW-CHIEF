# TASK-XX

## Goal

一句话说清完成后世界是什么样。

## Scope

允许修改的文件（其他一律不动，越界即 REJECT）：

- `path/to/file`
- `path/to/dir/`

## Constraints

- 不要升级依赖 / 不要改公共 API / 保持现有代码风格
- 不新增全局状态

## Acceptance

审查者与 Worker 都要能跑（写绝对路径）：

```bash
# 示例
npm test -- --run
```

通过标准：

- [ ] 上述命令全绿
- [ ] 新增 / 修改的行为有对应测试
- [ ] 改动文件全部落在 Scope 内（`git diff --name-only`）

## 备注

- 契约一旦派单即为只读，需要变更先找 Chief。
