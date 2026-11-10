#!/usr/bin/env node
// Local editor for Chief workflow configs. No dependencies; binds to 127.0.0.1.
// Usage: node panel/server.mjs [--port 4317]
//
// Files it can touch (never arbitrary paths):
//   default          <repo>/skills/chief-t3/workflows/default.json   (takes effect after install.sh)
//   lib:<name>       ~/.chief-t3/workflows/<name>.json               (your workflow library)
//   project:<key>    ~/.t3-tasks/<key>/workflow.json                 (full config, or {"use": "<name>"})
// The project list is read (read-only) from T3 Code's state database, merged with ledger folders.
import { createServer } from "node:http";
import { readFile, writeFile, readdir, stat, rename, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, referencedWorkflow } from "../scripts/validate-workflow.mjs";

const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.dirname(PANEL_DIR);
const DEFAULT_FILE = path.join(REPO_DIR, "skills/chief-t3/workflows/default.json");
const LEDGER_DIR = path.join(homedir(), ".t3-tasks");
const LIB_DIR = process.env.CHIEF_WORKFLOWS_DIR || path.join(homedir(), ".chief-t3", "workflows");
const T3_HOME = process.env.T3CODE_HOME || path.join(homedir(), ".t3");
const T3_DB = process.env.CHIEF_T3_DB || path.join(T3_HOME, "userdata", "statev2.sqlite");
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.CHIEF_PANEL_PORT || 4317);
const HOST = "127.0.0.1";
const MAX_BODY = 512 * 1024;
const KEY = /^[a-z0-9][a-z0-9-]*$/;

const STATIC = {
  "/": { file: path.join(PANEL_DIR, "index.html"), type: "text/html; charset=utf-8" },
  "/validate-workflow.mjs": { file: path.join(REPO_DIR, "scripts/validate-workflow.mjs"), type: "text/javascript; charset=utf-8" },
};

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// ---------- T3 projects (read-only) ----------
const T3_QUERY = "SELECT title, workspace_root AS root, archived_at AS archivedAt FROM projection_projects WHERE deleted_at IS NULL ORDER BY COALESCE(pinned_at, '') DESC, updated_at DESC";

async function readT3Projects() {
  if (!existsSync(T3_DB)) return { ok: false, error: `没找到 T3 数据库：${T3_DB}`, rows: [] };
  try {
    // node:sqlite (Node 22.5+) prints an experimental warning; silence just that.
    const listeners = process.listeners("warning");
    process.removeAllListeners("warning");
    const { DatabaseSync } = await import("node:sqlite");
    listeners.forEach((l) => process.on("warning", l));
    const db = new DatabaseSync(T3_DB, { readOnly: true });
    try { return { ok: true, rows: db.prepare(T3_QUERY).all() }; } finally { db.close(); }
  } catch (nodeErr) {
    try {
      const { stdout } = await promisify(execFile)("sqlite3", ["-readonly", "-json", T3_DB, T3_QUERY], { timeout: 5000 });
      return { ok: true, rows: stdout.trim() ? JSON.parse(stdout) : [] };
    } catch {
      return { ok: false, error: `无法读取 T3 项目列表（需要 Node 22.5+ 或 sqlite3 命令）：${nodeErr.message}`, rows: [] };
    }
  }
}

// ---------- T3 providers (read-only) ----------
// T3 keeps a snapshot per provider instance in <T3_HOME>/caches/<instance>.json.
// Only whitelisted fields leave this function: never auth, emails or usage data.
const T3_CACHE_DIR = path.join(T3_HOME, "caches");
async function readT3Providers() {
  let files = [];
  try { files = (await readdir(T3_CACHE_DIR)).filter((f) => f.endsWith(".json")); }
  catch { return { ok: false, error: `没找到 T3 服务商缓存目录：${T3_CACHE_DIR}`, dir: T3_CACHE_DIR, providers: [] }; }
  const providers = [];
  for (const f of files.sort()) {
    let d;
    try { d = JSON.parse(await readFile(path.join(T3_CACHE_DIR, f), "utf8")); } catch { continue; }
    if (!d || typeof d.instanceId !== "string" || !Array.isArray(d.models)) continue;
    providers.push({
      id: d.instanceId, driver: String(d.driver || d.instanceId), name: String(d.displayName || d.instanceId),
      enabled: d.enabled === true, installed: d.installed === true, status: String(d.status || "unknown"),
      authStatus: String(d.auth?.status || "unknown"), checkedAt: typeof d.checkedAt === "string" ? d.checkedAt : null,
      models: d.models.filter((m) => m && typeof m.slug === "string").map((m) => ({
        slug: m.slug, name: String(m.name || m.slug),
        options: (m.capabilities?.optionDescriptors || []).filter((o) => o && typeof o.id === "string").map((o) => ({
          id: o.id, label: String(o.label || o.id), type: String(o.type || "select"),
          choices: Array.isArray(o.options) ? o.options.filter((c) => c && typeof c.id === "string")
            .map((c) => ({ id: c.id, label: String(c.label || c.id), isDefault: c.isDefault === true })) : [],
        })),
      })),
    });
  }
  const usable = (p) => p.enabled && p.installed && p.status === "ready";
  providers.sort((a, b) => Number(usable(b)) - Number(usable(a)) || a.name.localeCompare(b.name));
  return { ok: true, dir: T3_CACHE_DIR, providers };
}

// Ledger folder name = project root's directory name, same as install.sh.
const ledgerKey = (root) => path.basename(root.replace(/[\\/]+$/, ""));
const validKey = (k) => typeof k === "string" && k !== "" && k !== "." && k !== ".." && !/[/\\\0]/.test(k);

async function listProjects() {
  const t3 = await readT3Projects();
  const scratch = path.join(T3_HOME, "scratch");
  const byKey = new Map();
  for (const row of t3.rows) {
    if (!row.root || path.resolve(row.root) === path.resolve(scratch)) continue;
    const key = ledgerKey(row.root);
    if (!validKey(key)) continue;
    const entry = byKey.get(key) || { key, title: row.title || key, roots: [], source: "t3", archived: !!row.archivedAt };
    entry.roots.push(row.root);
    byKey.set(key, entry);
  }
  let dirs = [];
  try { dirs = await readdir(LEDGER_DIR, { withFileTypes: true }); } catch {}
  for (const d of dirs) {
    if (!d.isDirectory() || !validKey(d.name) || d.name.startsWith(".") || byKey.has(d.name)) continue;
    byKey.set(d.name, { key: d.name, title: d.name, roots: [], source: "ledger", archived: false });
  }
  return { t3: { ok: t3.ok, error: t3.error, db: T3_DB }, projects: [...byKey.values()] };
}

async function findProject(key) {
  const { projects } = await listProjects();
  const p = projects.find((x) => x.key === key);
  if (!p) throw new HttpError(404, `未知项目：${key}`);
  return p;
}

// ---------- files ----------
async function readJson(file) {
  const text = await readFile(file, "utf8");
  try { return { text, data: JSON.parse(text) }; } catch (e) { return { text, data: null, parseError: e.message }; }
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(".", "-");
// User files live outside the repo, so they carry no relative $schema link.
const withoutSchema = ({ $schema, ...rest }) => rest;

async function backup(file) {
  if (!existsSync(file)) return null;
  const to = `${file}.bak.${stamp()}`;
  await copyFile(file, to);
  return to;
}
async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const saved = await backup(file);
  const stage = `${file}.stage.${process.pid}.${Date.now()}`;
  await writeFile(stage, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(stage, file);
  return saved;
}

async function listLibrary() {
  let names = [];
  try { names = (await readdir(LIB_DIR)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((n) => KEY.test(n) && n !== "default"); } catch {}
  const items = [];
  for (const name of names.sort()) {
    const file = path.join(LIB_DIR, `${name}.json`);
    const { data, parseError } = await readJson(file);
    items.push({ id: `lib:${name}`, name, title: data?.title || name, file, errorCount: parseError ? 1 : validate(data).length });
  }
  return items;
}

const projectFile = (key) => path.join(LEDGER_DIR, key, "workflow.json");

async function assignmentOf(key) {
  const file = projectFile(key);
  if (!existsSync(file)) return { type: "default" };
  const { data, parseError } = await readJson(file);
  if (parseError) return { type: "broken", error: parseError };
  const ref = referencedWorkflow(data);
  if (ref === undefined) return { type: "broken", error: "use 字段格式不对" };
  if (ref === "default") return { type: "default", explicit: true };
  if (ref) return existsSync(path.join(LIB_DIR, `${ref}.json`)) ? { type: "library", name: ref } : { type: "missing", name: ref };
  return { type: "custom", title: data?.title, errorCount: validate(data).length };
}

async function resolveId(id) {
  if (id === "default") return { id, kind: "default", file: DEFAULT_FILE };
  if (typeof id === "string" && id.startsWith("lib:")) {
    const name = id.slice(4);
    if (!KEY.test(name) || name === "default") throw new HttpError(400, "无效的工作流名称");
    return { id, kind: "library", name, file: path.join(LIB_DIR, `${name}.json`) };
  }
  if (typeof id === "string" && id.startsWith("project:")) {
    const key = id.slice(8);
    const p = await findProject(key);
    return { id, kind: "project", project: key, title: p.title, file: projectFile(key) };
  }
  throw new HttpError(400, "无效的工作流 id");
}

async function readBody(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "需要 application/json");
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "请求过大");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "请求体不是合法 JSON"); }
}

// Only same-origin requests to a loopback Host: blocks DNS rebinding and cross-site writes.
function checkOrigin(req) {
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) throw new HttpError(403, "Host 不被允许");
  const origin = req.headers.origin;
  if (origin && !allowedHosts.map((h) => `http://${h}`).includes(origin)) throw new HttpError(403, "Origin 不被允许");
}

async function loadValid(id) {
  const target = await resolveId(id);
  if (!existsSync(target.file)) throw new HttpError(404, "来源工作流不存在");
  const { data, parseError } = await readJson(target.file);
  if (parseError || referencedWorkflow(data) !== null || validate(data).length) throw new HttpError(422, "来源工作流无效，不能复制");
  return data;
}

// ---------- API ----------
async function handleApi(req, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/state") {
    const { t3, projects } = await listProjects();
    const library = await listLibrary();
    const { data: def, parseError } = await readJson(DEFAULT_FILE);
    for (const p of projects) p.assignment = await assignmentOf(p.key);
    const usedBy = (name) => projects.filter((p) => p.assignment.type === "library" && p.assignment.name === name).map((p) => p.title);
    return {
      t3, ledgerDir: LEDGER_DIR, libDir: LIB_DIR,
      workflows: [
        { id: "default", name: "default", title: def?.title || "默认工作流", file: DEFAULT_FILE, builtin: true,
          errorCount: parseError ? 1 : validate(def).length, usedBy: projects.filter((p) => p.assignment.type === "default").map((p) => p.title) },
        ...library.map((w) => ({ ...w, usedBy: usedBy(w.name) })),
      ],
      projects,
    };
  }

  if (route === "GET /api/providers") return readT3Providers();

  if (route === "GET /api/workflow") {
    const target = await resolveId(url.searchParams.get("id"));
    if (!existsSync(target.file)) throw new HttpError(404, "文件不存在", { file: target.file });
    const { data, text, parseError } = await readJson(target.file);
    return { ...target, data, text, errors: parseError ? [`JSON 解析失败：${parseError}`] : validate(data), mtime: (await stat(target.file)).mtimeMs };
  }

  if (route === "PUT /api/workflow") {
    const target = await resolveId(url.searchParams.get("id"));
    const body = await readBody(req);
    if (target.kind === "library" && body.data?.name !== target.name) throw new HttpError(422, "工作流库里的 name 必须和文件名一致");
    const errors = validate(body.data);
    if (errors.length) throw new HttpError(422, "配置无效，未写入", { errors });
    if (existsSync(target.file) && body.baseMtime !== undefined && (await stat(target.file)).mtimeMs !== body.baseMtime) {
      throw new HttpError(409, "文件已被其他程序修改，请重新加载后再保存");
    }
    const saved = await atomicWrite(target.file, body.data);
    return { ok: true, file: target.file, backup: saved, mtime: (await stat(target.file)).mtimeMs };
  }

  if (route === "POST /api/library/create") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (!KEY.test(name) || name === "default") throw new HttpError(422, "名称只能用小写字母、数字和连字符，且不能叫 default");
    const file = path.join(LIB_DIR, `${name}.json`);
    if (existsSync(file)) throw new HttpError(409, `已经有名为 ${name} 的工作流`);
    const data = await loadValid(body.from || "default");
    const out = { ...withoutSchema(data), name, title: String(body.title || "").trim() || name };
    await atomicWrite(file, out);
    return { ok: true, id: `lib:${name}` };
  }

  if (route === "POST /api/library/delete") {
    const body = await readBody(req);
    const target = await resolveId(`lib:${body.name}`);
    if (!existsSync(target.file)) throw new HttpError(404, "工作流不存在");
    const { projects } = await listProjects();
    const users = [];
    for (const p of projects) { const a = await assignmentOf(p.key); if (a.type === "library" && a.name === target.name) users.push(p.title); }
    if (users.length) throw new HttpError(409, `还有项目在用：${users.join("、")}。请先给它们换一个工作流。`);
    const to = `${target.file}.deleted.${stamp()}`;
    await rename(target.file, to);
    return { ok: true, movedTo: to };
  }

  if (route === "POST /api/project/assign") {
    const body = await readBody(req);
    const p = await findProject(String(body.key));
    const file = projectFile(p.key);
    const use = String(body.use || "");
    if (use === "default") {
      if (!existsSync(file)) return { ok: true };
      const to = `${file}.bak.${stamp()}`;
      await rename(file, to);
      return { ok: true, backup: to };
    }
    if (use.startsWith("lib:")) {
      const target = await resolveId(use);
      if (!existsSync(target.file)) throw new HttpError(404, "工作流不存在");
      return { ok: true, backup: await atomicWrite(file, { use: target.name }) };
    }
    if (use === "custom") {
      const current = await assignmentOf(p.key);
      if (current.type === "custom") return { ok: true };
      const from = current.type === "library" ? `lib:${current.name}` : "default";
      const data = await loadValid(from);
      const out = { ...withoutSchema(data), title: `${p.title} 专属`,
        name: p.key.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(?![a-z0-9])/, "p") || "project" };
      return { ok: true, backup: await atomicWrite(file, out) };
    }
    throw new HttpError(400, "无效的选择");
  }

  throw new HttpError(404, "未知接口");
}

const server = createServer(async (req, res) => {
  const send = (status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  try {
    checkOrigin(req);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return send(200, await handleApi(req, url));
    const asset = STATIC[url.pathname];
    if (!asset || req.method !== "GET") throw new HttpError(404, "Not found");
    send(200, await readFile(asset.file), asset.type);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    send(status, { error: e.message, ...(e.extra || {}) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Chief 工作流面板：http://${HOST}:${PORT}`);
  console.log(`T3 项目来源：${T3_DB}`);
  console.log(`工作流库：${LIB_DIR}`);
});
