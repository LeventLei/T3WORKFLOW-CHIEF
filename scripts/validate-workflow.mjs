#!/usr/bin/env node
// Validate a Chief scenes config (v3: several sets, each with scenes + rules).
// Usage: node scripts/validate-workflow.mjs <config.json> [...]
// Mirrors skills/chief-t3/workflows/workflow.schema.json plus the cross-field
// rules the schema cannot express (references, review independence, escalation).
// Browser-safe: the panel imports it directly; node:fs loads only for the CLI.

const DELEGATE_ROLES = ["implementation", "research", "review", "design", "test", "general"];
const KEY = /^[a-z0-9][a-z0-9-]*$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v, min, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;
const isAbsolutePath = (v) => typeof v === "string" && (v.startsWith("/") || /^[A-Za-z]:[\\/]/.test(v));

/** scenes + rules of one set; `at` is the set prefix, e.g. ["sets", "video"]. */
function setIssues(scenesLike, rules, at, add) {
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

  const scenes = isObject(scenesLike) ? scenesLike : {};
  if (!isObject(scenesLike) || Object.keys(scenes).length === 0) add([...at, "scenes"], "至少需要一个场景");
  for (const [key, s] of Object.entries(scenes)) {
    const sceneAt = [...at, "scenes", key];
    if (!KEY.test(key)) add(sceneAt, "场景键名只能用小写字母、数字和连字符");
    if (!isObject(s)) { add(sceneAt, "必须是对象"); continue; }
    only(s, ["label", "when", "delegateRole", "access", "reportLimit", "primary", "backup", "fallback"], sceneAt);
    if (typeof s.label !== "string" || s.label.trim() === "") add([...sceneAt, "label"], "请填写显示名");
    if (typeof s.when !== "string" || s.when.trim() === "") add([...sceneAt, "when"], "请写一句什么时候用这个场景");
    if (!DELEGATE_ROLES.includes(s.delegateRole)) add([...sceneAt, "delegateRole"], `任务类型必须是 ${DELEGATE_ROLES.join(" / ")} 之一`);
    if (!["readonly", "write"].includes(s.access)) add([...sceneAt, "access"], "权限必须是只读或可写");
    if ("reportLimit" in s && !isInt(s.reportLimit, 50)) add([...sceneAt, "reportLimit"], "汇报字数上限至少 50");
    checkTarget(s.primary, [...sceneAt, "primary"]);
    for (const slot of ["backup", "fallback"]) {
      if (slot in s && s[slot] !== null) checkTarget(s[slot], [...sceneAt, slot]);
    }
  }
  if (!Object.values(scenes).some((s) => isObject(s) && s.access === "write")) {
    add([...at, "scenes"], "至少需要一个可写（access: write）的场景");
  }

  if (!isObject(rules)) add([...at, "rules"], "缺少规则设置");
  else {
    const rulesAt = [...at, "rules"];
    only(rules, [
      "requireReview", "defaultWriteScene", "escalateTo", "escalateAfter",
      "maxParallelWriters", "maxReworkRounds", "contractFileThreshold",
    ], rulesAt);
    if (typeof rules.requireReview !== "boolean") add([...rulesAt, "requireReview"], "必须是 true 或 false");
    if (!isInt(rules.maxParallelWriters, 1, 8)) add([...rulesAt, "maxParallelWriters"], "同时写代码的 Worker 数要在 1 到 8 之间");
    if (!isInt(rules.maxReworkRounds, 0, 5)) add([...rulesAt, "maxReworkRounds"], "返工轮数要在 0 到 5 之间");
    if (!isInt(rules.contractFileThreshold, 0)) add([...rulesAt, "contractFileThreshold"], "文件数阈值不能小于 0");

    const implementations = Object.entries(scenes)
      .filter(([, s]) => isObject(s) && s.delegateRole === "implementation")
      .map(([key]) => key);
    const pickScene = (field, label) => {
      const value = rules[field];
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || !KEY.test(value)) {
        add([...rulesAt, field], `请选择一个${label}场景`);
        return null;
      }
      if (!(value in scenes)) {
        add([...rulesAt, field], `${label}场景 "${value}" 不存在`);
        return null;
      }
      if (!implementations.includes(value)) {
        add([...rulesAt, field], `${label}场景 "${value}" 不是 implementation 场景`);
        return null;
      }
      if (scenes[value].access !== "write") {
        add([...rulesAt, field], `${label}场景 "${value}" 必须是可写（access: write）的场景`);
        return null;
      }
      return value;
    };
    const defaultWrite = pickScene("defaultWriteScene", "默认写代码");
    const escalate = pickScene("escalateTo", "升级");
    if (defaultWrite && escalate && defaultWrite === escalate) {
      add([...rulesAt, "escalateTo"], "默认写代码场景和升级场景不能相同");
    }
    if ("escalateAfter" in rules) {
      if (!isInt(rules.escalateAfter, 1, 5)) add([...rulesAt, "escalateAfter"], "升级次数要在 1 到 5 之间");
      else if (isInt(rules.maxReworkRounds, 0, 5) && rules.escalateAfter >= rules.maxReworkRounds) {
        add([...rulesAt, "escalateAfter"], "升级次数要小于返工轮数上限（升级后的场景至少还有一次机会）");
      }
      if (rules.escalateTo === undefined || rules.escalateTo === null) {
        add([...rulesAt, "escalateTo"], "填了升级次数就必须选择一个升级场景");
      }
    } else if (escalate) {
      add([...rulesAt, "escalateAfter"], "填了升级场景就必须填写失败次数");
    }

    if (rules.requireReview === true && !Object.values(scenes).some((s) => isObject(s) && s.delegateRole === "review")) {
      add([...rulesAt, "requireReview"], "打开独立审查时至少需要一个审查场景（delegateRole: review）");
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
        add([...at, "scenes", rk, "primary", "model"], `审查场景 ${rk} 和实现场景 ${ik} 用了同一个模型（${rm}），审查必须换一个模型`);
      }
    }
  }
}

/** Each issue: { path: (string|number)[], message: string } — path points at the offending field. */
export function issues(cfg) {
  if (!isObject(cfg)) return [{ path: [], message: "配置必须是 JSON 对象" }];
  if (cfg.schemaVersion === 1 || cfg.schemaVersion === 2) {
    return [{ path: ["schemaVersion"], message: "这是旧格式，请先运行转换（scripts/migrate-to-scenes.mjs）" }];
  }
  if (cfg.schemaVersion !== 3) {
    return [{ path: ["schemaVersion"], message: "无法识别的配置版本，应为 3" }];
  }

  const out = [];
  const add = (path, message) => out.push({ path, message });
  const only = (obj, allowed, path) => {
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) add([...path, key], `不认识的字段 "${key}"`);
  };

  only(cfg, ["$schema", "schemaVersion", "title", "defaultSet", "sets", "projects"], []);
  if ("title" in cfg && typeof cfg.title !== "string") add(["title"], "显示名称必须是文字");

  const sets = isObject(cfg.sets) ? cfg.sets : {};
  if (!isObject(cfg.sets) || Object.keys(sets).length === 0) add(["sets"], "至少需要一套场景配置");
  for (const [key, set] of Object.entries(sets)) {
    const at = ["sets", key];
    if (!KEY.test(key)) add(at, "套的键名只能用小写字母、数字和连字符");
    if (!isObject(set)) { add(at, "必须是对象"); continue; }
    only(set, ["label", "scenes", "rules"], at);
    if (typeof set.label !== "string" || set.label.trim() === "") add([...at, "label"], "请填写这套配置的显示名");
    setIssues(set.scenes, set.rules, at, add);
  }

  const defaultSet = cfg.defaultSet;
  if (typeof defaultSet !== "string" || !KEY.test(defaultSet)) add(["defaultSet"], "请选择默认的一套场景配置");
  else if (!(defaultSet in sets)) add(["defaultSet"], `默认场景配置套 "${defaultSet}" 不存在`);

  if ("projects" in cfg) {
    if (!isObject(cfg.projects)) add(["projects"], "必须是对象");
    else {
      for (const [project, setName] of Object.entries(cfg.projects)) {
        const at = ["projects", project];
        if (!isAbsolutePath(project)) add(at, "项目路径必须是绝对路径");
        if (typeof setName !== "string" || !(setName in sets)) {
          add(at, `指向的场景配置套 "${setName}" 不存在`);
        }
      }
    }
  }
  return out;
}

/** v2 (single set) → v3: wrap scenes/rules into sets.dev, label "开发". */
export function upgradeV2(v2) {
  if (!isObject(v2)) return v2;
  const out = {};
  if (typeof v2.$schema === "string") out.$schema = v2.$schema;
  out.schemaVersion = 3;
  if (typeof v2.title === "string") out.title = v2.title;
  out.defaultSet = "dev";
  out.sets = { dev: { label: "开发", scenes: v2.scenes, rules: v2.rules } };
  out.projects = {};
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
