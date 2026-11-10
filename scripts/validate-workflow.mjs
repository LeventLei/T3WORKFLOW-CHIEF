#!/usr/bin/env node
// Validate a Chief scenes config (v2) without third-party dependencies.
// Usage: node scripts/validate-workflow.mjs <config.json> [...]
// Mirrors skills/chief-t3/workflows/workflow.schema.json plus the cross-field
// rules the schema cannot express (references, review independence, escalation).
// Browser-safe: the panel imports it directly; node:fs loads only for the CLI.

const DELEGATE_ROLES = ["implementation", "research", "review", "design", "test", "general"];
const KEY = /^[a-z0-9][a-z0-9-]*$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v, min, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;

/** Each issue: { path: (string|number)[], message: string } — path points at the offending field. */
export function issues(cfg) {
  if (!isObject(cfg)) return [{ path: [], message: "配置必须是 JSON 对象" }];
  if (cfg.schemaVersion !== 2) {
    return [{ path: ["schemaVersion"], message: "这是旧格式，请先运行转换（scripts/migrate-to-scenes.mjs）" }];
  }

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

  only(cfg, ["$schema", "schemaVersion", "title", "scenes", "rules"], []);
  if ("title" in cfg && typeof cfg.title !== "string") add(["title"], "显示名称必须是文字");

  const scenes = isObject(cfg.scenes) ? cfg.scenes : {};
  if (!isObject(cfg.scenes) || Object.keys(scenes).length === 0) add(["scenes"], "至少需要一个场景");
  for (const [key, s] of Object.entries(scenes)) {
    const at = ["scenes", key];
    if (!KEY.test(key)) add(at, "场景键名只能用小写字母、数字和连字符");
    if (!isObject(s)) { add(at, "必须是对象"); continue; }
    only(s, ["label", "when", "delegateRole", "access", "reportLimit", "primary", "backup", "fallback"], at);
    if (typeof s.label !== "string" || s.label.trim() === "") add([...at, "label"], "请填写显示名");
    if (typeof s.when !== "string" || s.when.trim() === "") add([...at, "when"], "请写一句什么时候用这个场景");
    if (!DELEGATE_ROLES.includes(s.delegateRole)) add([...at, "delegateRole"], `任务类型必须是 ${DELEGATE_ROLES.join(" / ")} 之一`);
    if (!["readonly", "write"].includes(s.access)) add([...at, "access"], "权限必须是只读或可写");
    if ("reportLimit" in s && !isInt(s.reportLimit, 50)) add([...at, "reportLimit"], "汇报字数上限至少 50");
    checkTarget(s.primary, [...at, "primary"]);
    for (const slot of ["backup", "fallback"]) {
      if (slot in s && s[slot] !== null) checkTarget(s[slot], [...at, slot]);
    }
  }
  if (!Object.values(scenes).some((s) => isObject(s) && s.access === "write")) {
    add(["scenes"], "至少需要一个可写（access: write）的场景");
  }

  const rules = cfg.rules;
  if (!isObject(rules)) add(["rules"], "缺少规则设置");
  else {
    only(rules, [
      "requireReview", "defaultWriteScene", "escalateTo", "escalateAfter",
      "maxParallelWriters", "maxReworkRounds", "contractFileThreshold",
    ], ["rules"]);
    if (typeof rules.requireReview !== "boolean") add(["rules", "requireReview"], "必须是 true 或 false");
    if (!isInt(rules.maxParallelWriters, 1, 8)) add(["rules", "maxParallelWriters"], "同时写代码的 Worker 数要在 1 到 8 之间");
    if (!isInt(rules.maxReworkRounds, 0, 5)) add(["rules", "maxReworkRounds"], "返工轮数要在 0 到 5 之间");
    if (!isInt(rules.contractFileThreshold, 0)) add(["rules", "contractFileThreshold"], "文件数阈值不能小于 0");

    const implementations = Object.entries(scenes)
      .filter(([, s]) => isObject(s) && s.delegateRole === "implementation")
      .map(([key]) => key);
    const pickScene = (field, label) => {
      const value = rules[field];
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || !KEY.test(value)) {
        add(["rules", field], `请选择一个${label}场景`);
        return null;
      }
      if (!(value in scenes)) {
        add(["rules", field], `${label}场景 "${value}" 不存在`);
        return null;
      }
      if (!implementations.includes(value)) {
        add(["rules", field], `${label}场景 "${value}" 不是 implementation 场景`);
        return null;
      }
      if (scenes[value].access !== "write") {
        add(["rules", field], `${label}场景 "${value}" 必须是可写（access: write）的场景`);
        return null;
      }
      return value;
    };
    const defaultWrite = pickScene("defaultWriteScene", "默认写代码");
    const escalate = pickScene("escalateTo", "升级");
    if (defaultWrite && escalate && defaultWrite === escalate) {
      add(["rules", "escalateTo"], "默认写代码场景和升级场景不能相同");
    }
    if ("escalateAfter" in rules) {
      if (!isInt(rules.escalateAfter, 1, 5)) add(["rules", "escalateAfter"], "升级次数要在 1 到 5 之间");
      else if (isInt(rules.maxReworkRounds, 0, 5) && rules.escalateAfter >= rules.maxReworkRounds) {
        add(["rules", "escalateAfter"], "升级次数要小于返工轮数上限（升级后的场景至少还有一次机会）");
      }
      if (rules.escalateTo === undefined || rules.escalateTo === null) {
        add(["rules", "escalateTo"], "填了升级次数就必须选择一个升级场景");
      }
    } else if (escalate) {
      add(["rules", "escalateAfter"], "填了升级场景就必须填写失败次数");
    }

    if (rules.requireReview === true && !Object.values(scenes).some((s) => isObject(s) && s.delegateRole === "review")) {
      add(["rules", "requireReview"], "打开独立审查时至少需要一个审查场景（delegateRole: review）");
    }
  }

  // Independent review: a review scene's primary must never equal an implementation primary.
  const primaryModels = (role) =>
    Object.entries(scenes)
      .filter(([, s]) => isObject(s) && s.delegateRole === role && isObject(s.primary))
      .map(([key, s]) => [key, s.primary.model]);
  for (const [rk, rm] of primaryModels("review")) {
    for (const [ik, im] of primaryModels("implementation")) {
      if (typeof rm === "string" && rm !== "" && rm === im) {
        add(["scenes", rk, "primary", "model"], `审查场景 ${rk} 和实现场景 ${ik} 用了同一个模型（${rm}），审查必须换一个模型`);
      }
    }
  }
  return out;
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
