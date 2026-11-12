#!/usr/bin/env node
// Local editor for the global Chief scenes config. No dependencies; binds to 127.0.0.1.
// Usage: node panel/server.mjs [--port 4317]
//
// One file: CHIEF_CONFIG or ~/.chief-t3/config.json, holding every scene set.
// Until it exists, the panel shows the factory default in
// skills/chief-t3/workflows/default.json. A v2 file is upgraded in memory for
// display and written back as v3. T3 provider and project data are read-only;
// only whitelisted fields leave readT3Providers / readT3Projects.
import { createServer } from "node:http";
import { readFile, writeFile, readdir, stat, rename, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upgradeV2, validate } from "../scripts/validate-workflow.mjs";

const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.dirname(PANEL_DIR);
const DEFAULT_FILE = path.join(REPO_DIR, "skills/chief-t3/workflows/default.json");
const CONFIG_FILE = process.env.CHIEF_CONFIG || path.join(homedir(), ".chief-t3", "config.json");
const T3_HOME = process.env.T3CODE_HOME || path.join(homedir(), ".t3");
const T3_DB = process.env.CHIEF_T3_DB || path.join(T3_HOME, "userdata", "statev2.sqlite");
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.CHIEF_PANEL_PORT || 4317);
const HOST = "127.0.0.1";
const MAX_BODY = 512 * 1024;

const STATIC = {
  "/": { file: path.join(PANEL_DIR, "index.html"), type: "text/html; charset=utf-8" },
  "/validate-workflow.mjs": { file: path.join(REPO_DIR, "scripts/validate-workflow.mjs"), type: "text/javascript; charset=utf-8" },
};

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// ---------- T3 projects (read-only) ----------
// Whitelist: title / workspace_root / archived_at. Nothing else leaves here.
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

// ---------- config file ----------
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

async function readConfig() {
  const exists = existsSync(CONFIG_FILE);
  const file = exists ? CONFIG_FILE : DEFAULT_FILE;
  const mtime = exists ? (await stat(CONFIG_FILE)).mtimeMs : null;
  let parsed;
  try { parsed = await readJson(file); }
  catch (e) { return { data: null, file: CONFIG_FILE, exists, mtime, issues: [`无法读取配置：${e.message}`] }; }
  const { data, parseError } = parsed;
  if (parseError) return { data: null, file: CONFIG_FILE, exists, mtime, issues: [`JSON 解析失败：${parseError}`] };
  // A v2 file is shown as v3; saving writes v3 and backs up the old file.
  const upgradedFrom = data?.schemaVersion === 2 ? 2 : undefined;
  const value = upgradedFrom ? upgradeV2(data) : data;
  return { data: value, file: CONFIG_FILE, exists, mtime, issues: validate(value), ...(upgradedFrom ? { upgradedFrom } : {}) };
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

// ---------- API ----------
async function handleApi(req, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/state") {
    return { ok: true, configFile: CONFIG_FILE, exists: existsSync(CONFIG_FILE) };
  }

  if (route === "GET /api/providers") return readT3Providers();

  if (route === "GET /api/projects") {
    const t3 = await readT3Projects();
    if (!t3.ok) return { ok: false, error: t3.error, projects: [] };
    // T3's scratch workspace is not a real project.
    const scratch = path.resolve(T3_HOME, "scratch");
    const projects = t3.rows
      .map((row) => ({
        title: String(row.title || "").trim() || path.basename(String(row.root || "")) || "未命名项目",
        root: String(row.root || "").replace(/[\\/]+$/, ""),
        archived: row.archivedAt !== null && row.archivedAt !== undefined && row.archivedAt !== "",
      }))
      .filter((p) => p.root !== "" && path.resolve(p.root) !== scratch);
    return { ok: true, projects };
  }

  if (route === "GET /api/config") return readConfig();

  if (route === "PUT /api/config") {
    const body = await readBody(req);
    const errors = validate(body.data);
    if (errors.length) throw new HttpError(422, "配置无效，未写入", { errors });
    if (existsSync(CONFIG_FILE) && body.baseMtime !== undefined && (await stat(CONFIG_FILE)).mtimeMs !== body.baseMtime) {
      throw new HttpError(409, "文件已被其他程序修改，请重新加载后再保存");
    }
    const saved = await atomicWrite(CONFIG_FILE, withoutSchema(body.data));
    return { ok: true, file: CONFIG_FILE, backup: saved, mtime: (await stat(CONFIG_FILE)).mtimeMs };
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
  console.log(`Chief 场景配置面板：http://${HOST}:${PORT}`);
  console.log(`配置文件：${CONFIG_FILE}${existsSync(CONFIG_FILE) ? "" : "（还不存在，显示出厂默认）"}`);
  console.log(`出厂默认：${DEFAULT_FILE}`);
});
