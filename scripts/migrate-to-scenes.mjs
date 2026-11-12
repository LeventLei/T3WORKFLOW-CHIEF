#!/usr/bin/env node
// Convert a Chief workflow config to the scene-sets format (v3), or migrate this machine.
// Zero dependencies, rules shared with scripts/validate-workflow.mjs.
//
// Usage:
//   node scripts/migrate-to-scenes.mjs <v1-or-v2-or-v3.json> [--out <file>]
//   node scripts/migrate-to-scenes.mjs --apply [--from <file>] [--out <target>]
//
// --apply reads HOME from process.env.HOME and writes CHIEF_CONFIG (default
// ~/.chief-t3/config.json); an existing config is backed up, never deleted.
// Project ledgers (~/.t3-tasks) were migrated by the previous version and are
// left untouched.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upgradeV2, validate } from "./validate-workflow.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DEFAULT_SOURCE = path.join(REPO_ROOT, "skills/chief-t3/workflows/default.json");
const USAGE = [
  "用法：",
  "  node scripts/migrate-to-scenes.mjs <v1-or-v2-or-v3.json> [--out <file>]",
  "  node scripts/migrate-to-scenes.mjs --apply [--from <file>] [--out <target>]",
  "",
  "  --apply  迁移本机：写全局配置（v3），已存在先备份；不动 ~/.t3-tasks",
  "  --from   指定源配置（默认仓库的 skills/chief-t3/workflows/default.json）",
  "  --out    转换时写到文件；--apply 时覆盖目标全局配置路径",
].join("\n");

const SCENE_LABELS = {
  scout: "小范围摸底",
  navigator: "大范围分析",
  "fast-dev": "小改动",
  dev: "复杂开发",
  architect: "架构设计",
  reviewer: "独立审查",
  docs: "文档",
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function fail(message, code = 1) {
  console.error(`错误：${message}`);
  process.exit(code);
}

function warn(message) {
  console.error(`警告：${message}`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`无法读取或解析 ${file}：${e.message}`);
  }
}

const serialize = (cfg) => `${JSON.stringify(cfg, null, 2)}\n`;
// The global config lives outside the repo, so its relative $schema link would dangle.
const withoutSchema = ({ $schema, ...rest }) => rest;

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

function uniquePath(file) {
  if (!existsSync(file)) return file;
  for (let i = 1; ; i += 1) {
    const candidate = `${file}-${i}`;
    if (!existsSync(candidate)) return candidate;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "-$1Z");
}

function normalizeTarget(t) {
  if (!isObject(t)) return t;
  return { ...t, options: isObject(t.options) ? t.options : {} };
}

function sceneFromRole(key, role, stages, quiet) {
  if (!isObject(role)) return role;
  const label = SCENE_LABELS[key] ?? (typeof role.label === "string" && role.label.trim() !== "" ? role.label : key);
  let when = typeof role.purpose === "string" ? role.purpose.trim() : "";
  const stage = stages.find((s) => isObject(s) && Array.isArray(s.roles) && s.roles.includes(key));
  // implement / review notes describe v1 stage grouping, not what the scene is for.
  const note = isObject(stage) && !["implement", "review"].includes(stage.id) && typeof stage.note === "string" ? stage.note.trim() : "";
  if (note !== "" && !when.includes(note)) when = when === "" ? note : `${when}；${note}`;

  const fallbacks = Array.isArray(role.fallbacks) ? role.fallbacks : [];
  if (fallbacks.length > 2 && !quiet) {
    const dropped = fallbacks.slice(2).map((f) => (isObject(f) ? `${f.provider}/${f.model}` : "（无效目标）"));
    warn(`角色 "${key}" 有 ${fallbacks.length} 个备用模型，只保留前两个；丢弃：${dropped.join("、")}`);
  }
  const scene = {
    label,
    when,
    delegateRole: role.delegateRole,
    access: role.access,
  };
  if (Number.isInteger(role.reportLimit)) scene.reportLimit = role.reportLimit;
  scene.primary = normalizeTarget(role.target);
  scene.backup = fallbacks[0] ? normalizeTarget(fallbacks[0]) : null;
  scene.fallback = fallbacks[1] ? normalizeTarget(fallbacks[1]) : null;
  return scene;
}

/** v1 → v2 (single set), unchanged rules from the previous migration. */
function fromV1(cfg, quiet = false) {
  const roles = isObject(cfg.roles) ? cfg.roles : {};
  const stages = Array.isArray(cfg.stages) ? cfg.stages : [];
  const limits = isObject(cfg.limits) ? cfg.limits : {};
  const scenes = {};
  for (const [key, role] of Object.entries(roles)) scenes[key] = sceneFromRole(key, role, stages, quiet);

  const reviewStage = stages.find((s) => isObject(s) && s.id === "review");
  const rules = { requireReview: reviewStage ? reviewStage.enabled === true : false };
  for (const key of ["maxParallelWriters", "maxReworkRounds", "contractFileThreshold"]) {
    if (key in limits) rules[key] = limits[key];
  }
  if ("fast-dev" in scenes && "dev" in scenes) {
    rules.defaultWriteScene = "fast-dev";
    if (Number.isInteger(rules.maxReworkRounds) && rules.maxReworkRounds >= 2) {
      rules.escalateTo = "dev";
      rules.escalateAfter = Math.min(2, rules.maxReworkRounds - 1);
    }
  }

  const out = {};
  if (typeof cfg.$schema === "string") out.$schema = cfg.$schema;
  out.schemaVersion = 2;
  if (typeof cfg.title === "string") out.title = cfg.title;
  out.scenes = scenes;
  out.rules = rules;
  return out;
}

/** Any supported version → validated v3. */
function convert(cfg, source, { quiet = false } = {}) {
  if (!isObject(cfg)) throw new Error(`${source}：配置必须是 JSON 对象`);
  let out;
  if (cfg.schemaVersion === 3) out = cfg;
  else if (cfg.schemaVersion === 2) out = upgradeV2(cfg);
  else if (cfg.schemaVersion === 1) out = upgradeV2(fromV1(cfg, quiet));
  else throw new Error(`${source}：无法识别的配置版本（schemaVersion=${JSON.stringify(cfg.schemaVersion)}）`);

  const problems = validate(out);
  if (problems.length) throw new Error(`${source}：配置无效\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return out;
}

function apply(opts) {
  const home = process.env.HOME;
  if (!home) fail("HOME 未设置，无法执行 --apply");
  const source = opts.from || opts.input || DEFAULT_SOURCE;
  if (!existsSync(source)) fail(`找不到源配置：${source}`);
  const cfg = convert(readJson(source), source);
  const target = opts.out || process.env.CHIEF_CONFIG || path.join(home, ".chief-t3", "config.json");

  mkdirSync(path.dirname(target), { recursive: true });
  let backup = null;
  if (existsSync(target)) {
    backup = uniquePath(`${target}.bak.${timestamp()}`);
    copyFileSync(target, backup);
  }
  atomicWrite(target, serialize(withoutSchema(cfg)));
  console.log(`全局配置：${target}`);
  if (backup) {
    console.log(`备份：${backup}`);
    console.log("注意：已有全局配置已被本次迁移结果替换；面板里的自定义修改请从备份恢复或手动合并。");
  }
  console.log(`来源：${source}（schemaVersion 3）`);
  console.log(`场景配置套：${Object.keys(cfg.sets).join("、")}；默认：${cfg.defaultSet}`);
  console.log("完成：~/.t3-tasks 与 ~/.chief-t3/workflows 未改动。");
}

function parseArgs(argv) {
  const opts = { apply: false, help: false, input: null, out: null, from: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--out" || arg === "--from") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) fail(`${arg} 需要一个文件路径`, 2);
      i += 1;
      if (arg === "--out") {
        if (opts.out) fail("--out 只能指定一次", 2);
        opts.out = value;
      } else {
        if (opts.from) fail("--from 只能指定一次", 2);
        opts.from = value;
      }
    } else if (arg.startsWith("-")) fail(`不认识的选项：${arg}`, 2);
    else {
      if (opts.input) fail("只能指定一个输入文件", 2);
      opts.input = arg;
    }
  }
  if (opts.input && opts.from) fail("输入文件与 --from 只能选一个", 2);
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (opts.apply) {
    apply(opts);
    return;
  }
  const input = opts.input || opts.from;
  if (!input) fail(USAGE, 2);
  const cfg = convert(readJson(input), input);
  const content = serialize(cfg);
  if (opts.out) {
    atomicWrite(opts.out, content);
    console.log(`已写出：${opts.out}`);
  } else process.stdout.write(content);
}

try {
  main();
} catch (e) {
  console.error(`错误：${e.message}`);
  process.exit(1);
}
