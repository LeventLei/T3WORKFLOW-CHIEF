#!/usr/bin/env node
// Validate a Chief workflow config without third-party dependencies.
// Usage: node scripts/validate-workflow.mjs <workflow.json> [...]
// Mirrors skills/chief-t3/workflows/workflow.schema.json plus the cross-field
// rules the schema cannot express (stage roles must exist, reviewer differs).
// Browser-safe: the panel imports it directly; node:fs loads only for the CLI.

const DELEGATE_ROLES = ["implementation", "research", "review", "design", "test", "general"];
const STAGES = ["recon", "design", "implement", "review"];
const KEY = /^[a-z0-9][a-z0-9-]*$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v, min, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;

/** Each issue: { path: (string|number)[], message: string } — path points at the offending field. */
export function issues(cfg) {
  const out = [];
  const add = (path, message) => out.push({ path, message });
  const only = (obj, allowed, path) => {
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) add([...path, key], `不认识的字段 "${key}"`);
  };
  const checkTarget = (t, path) => {
    if (!isObject(t)) return add(path, "必须是对象");
    only(t, ["provider", "model", "options"], path);
    if (typeof t.provider !== "string" || t.provider === "") add([...path, "provider"], "请填写 provider");
    if (typeof t.model !== "string" || t.model === "") add([...path, "model"], "请填写模型");
    if (!isObject(t.options)) add([...path, "options"], "模型参数必须是对象");
    else if ("role" in t.options) add([...path, "options", "role"], "role 应放在派单顶层，不能写在模型参数里");
  };

  if (!isObject(cfg)) return [{ path: [], message: "配置必须是 JSON 对象" }];
  only(cfg, ["$schema", "schemaVersion", "name", "title", "description", "roles", "stages", "limits"], []);
  if (cfg.schemaVersion !== 1) add(["schemaVersion"], "schemaVersion 必须是 1");
  if (typeof cfg.name !== "string" || !KEY.test(cfg.name)) add(["name"], "名称只能用小写字母、数字和连字符");
  if ("title" in cfg && typeof cfg.title !== "string") add(["title"], "显示名称必须是文字");
  if ("description" in cfg && typeof cfg.description !== "string") add(["description"], "描述必须是文字");

  const roles = isObject(cfg.roles) ? cfg.roles : {};
  if (!isObject(cfg.roles) || Object.keys(roles).length === 0) add(["roles"], "至少需要一个角色");
  for (const [key, r] of Object.entries(roles)) {
    const at = ["roles", key];
    if (!KEY.test(key)) add(at, "角色键名只能用小写字母、数字和连字符");
    if (!isObject(r)) { add(at, "必须是对象"); continue; }
    only(r, ["label", "purpose", "delegateRole", "access", "reportLimit", "target", "fallbacks"], at);
    if ("label" in r && typeof r.label !== "string") add([...at, "label"], "显示名必须是文字");
    if (typeof r.purpose !== "string" || r.purpose.trim() === "") add([...at, "purpose"], "请写一句这个角色负责什么");
    if (!DELEGATE_ROLES.includes(r.delegateRole)) add([...at, "delegateRole"], `任务类型必须是 ${DELEGATE_ROLES.join(" / ")} 之一`);
    if (!["readonly", "write"].includes(r.access)) add([...at, "access"], "权限必须是只读或可写");
    if ("reportLimit" in r && !isInt(r.reportLimit, 50)) add([...at, "reportLimit"], "汇报字数上限至少 50");
    checkTarget(r.target, [...at, "target"]);
    if (!Array.isArray(r.fallbacks)) add([...at, "fallbacks"], "备用模型必须是列表");
    else r.fallbacks.forEach((f, i) => checkTarget(f, [...at, "fallbacks", i]));
  }

  const stages = Array.isArray(cfg.stages) ? cfg.stages : [];
  if (stages.length === 0) add(["stages"], "至少需要一个步骤");
  const seen = new Set();
  stages.forEach((s, i) => {
    const at = ["stages", i];
    if (!isObject(s)) return add(at, "必须是对象");
    only(s, ["id", "enabled", "required", "roles", "note"], at);
    if (!STAGES.includes(s.id)) add([...at, "id"], `步骤必须是 ${STAGES.join(" / ")} 之一`);
    else if (seen.has(s.id)) add([...at, "id"], `步骤 "${s.id}" 重复了`);
    seen.add(s.id);
    for (const f of ["enabled", "required"]) if (typeof s[f] !== "boolean") add([...at, f], "必须是 true 或 false");
    if (s.required === true && s.enabled === false) add([...at, "enabled"], "设为必经的步骤不能关闭");
    if (!Array.isArray(s.roles) || s.roles.length === 0) add([...at, "roles"], "至少选一个负责的角色");
    else for (const name of s.roles) if (!(name in roles)) add([...at, "roles"], `角色 "${name}" 不存在`);
  });
  if (!seen.has("implement")) add(["stages"], "必须有“实现”步骤");

  const l = cfg.limits;
  if (!isObject(l)) add(["limits"], "缺少规则设置");
  else {
    only(l, ["maxParallelWriters", "maxReworkRounds", "contractFileThreshold"], ["limits"]);
    if (!isInt(l.maxParallelWriters, 1, 8)) add(["limits", "maxParallelWriters"], "同时写代码的 Worker 数要在 1 到 8 之间");
    if (!isInt(l.maxReworkRounds, 0, 5)) add(["limits", "maxReworkRounds"], "返工轮数要在 0 到 5 之间");
    if (!isInt(l.contractFileThreshold, 0)) add(["limits", "contractFileThreshold"], "文件数阈值不能小于 0");
  }

  // Independent review: a review-stage model must never equal an implement-stage model.
  const stageModels = (id) =>
    (stages.find((s) => isObject(s) && s.id === id && s.enabled)?.roles ?? [])
      .filter((k) => isObject(roles[k]) && isObject(roles[k].target))
      .map((k) => [k, roles[k].target.model]);
  for (const [rk, rm] of stageModels("review")) {
    for (const [ik, im] of stageModels("implement")) {
      if (rm === im) add(["roles", rk, "target", "model"], `审查角色 ${rk} 和实现角色 ${ik} 用了同一个模型（${rm}），审查必须换一个模型`);
    }
  }
  return out;
}

/**
 * A project's workflow.json may be a full config or a reference to a library
 * workflow: { "use": "<name>" }. Returns the library name for a reference, else null.
 */
export function referencedWorkflow(cfg) {
  if (!isObject(cfg) || !("use" in cfg)) return null;
  const extra = Object.keys(cfg).filter((k) => k !== "use" && k !== "$schema");
  return typeof cfg.use === "string" && KEY.test(cfg.use) && extra.length === 0 ? cfg.use : undefined;
}

export const formatPath = (path) =>
  path.reduce((s, p) => (typeof p === "number" ? `${s}[${p}]` : s ? `${s}.${p}` : String(p)), "") || "(根)";

/** Flat string form, used by the CLI and the server. */
export function validate(cfg) {
  return issues(cfg).map((i) => `${formatPath(i.path)}：${i.message}`);
}

const isCli = typeof process !== "undefined" && Boolean(process.versions?.node) && Boolean(process.argv?.[1]) &&
  import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href;
if (isCli) {
  const { readFileSync } = await import("node:fs");
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("用法：node scripts/validate-workflow.mjs <workflow.json> [...]");
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    let errors;
    try {
      errors = validate(JSON.parse(readFileSync(file, "utf8")));
    } catch (e) {
      errors = [`无法读取或解析：${e.message}`];
    }
    if (errors.length) {
      failed = true;
      console.error(`FAIL ${file}`);
      for (const e of errors) console.error(`  - ${e}`);
    } else console.log(`OK   ${file}`);
  }
  process.exit(failed ? 1 : 0);
}
