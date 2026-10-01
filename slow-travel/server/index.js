/**
 * 慢行站路线对比 —— 零依赖 HTTP 服务
 *  - 静态托管 public/
 *  - /api/routes                 路线卡片（含撤回/删除状态与版本口径）
 *  - /api/compare                比较 API（固定每条路线的公开版本；snapshot/latest 一致取数政策）
 *  - /api/accounts/:id/draft GET 个人草稿（选择与偏好）
 *  - /api/accounts/:id/draft PUT 保存草稿（三方合并，revision 并发控制）
 *  - /api/test/*                仅测试/演示用管理接口（撤回/恢复/删除/新建版本/重置）
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildComparison,
  listRouteCards
} from '../shared/core.js';
import {
  initDb,
  saveDb,
  getDraft,
  applyDraftWrite3Way,
  defaultDraft,
  DEFAULT_DB_PATH
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8080);
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;
const ENABLE_TEST_API = process.env.ENABLE_TEST_API !== '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

export function createApp(db, { enableTestApi = ENABLE_TEST_API } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res, db, enableTestApi);
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });
  return server;
}

async function handle(req, res, db, enableTestApi) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method;

  // --- API ---
  if (pathname === '/api/routes' && method === 'GET') {
    const transport = url.searchParams.get('transport') || 'walk';
    const season = url.searchParams.get('season') || 'summer';
    return sendJson(res, 200, {
      routes: listRouteCards(db, { transport, season }),
      preferences: { transport, season }
    });
  }

  if (pathname === '/api/compare' && method === 'POST') {
    const body = await readJson(req);
    const policy = body.policy === 'snapshot' ? 'snapshot' : 'latest';
    const transport = body.transport === 'bike' ? 'bike' : 'walk';
    const season = body.season === 'winter' ? 'winter' : 'summer';
    const routeIds = Array.isArray(body.routeIds) ? body.routeIds.map(String) : [];
    const pins = sanitizePins(body.pins);
    const comparison = buildComparison(db, {
      routeIds: routeIds.length ? routeIds : Object.keys(pins),
      pins,
      policy,
      asOf: body.asOf || (policy === 'snapshot' ? (body.asOf || new Date().toISOString()) : null),
      transport,
      season
    });
    // 明确列出无法解析的路线（删除/未知），帮助前端保持占位而不是猜测同名
    comparison.unresolved = comparison.rows
      .filter((r) => r.kind === 'placeholder')
      .map((r) => ({ routeId: r.routeId, reasonCode: r.reasonCode, reason: r.reason }));
    return sendJson(res, 200, comparison);
  }

  const draftMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/draft$/);
  if (draftMatch) {
    const accountId = decodeURIComponent(draftMatch[1]);
    if (method === 'GET') {
      const draft = getDraft(db, accountId);
      return sendJson(res, 200, { accountId, draft: draft || defaultDraft(), exists: Boolean(draft) });
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      const { draft, stale, status } = applyDraftWrite3Way(db, accountId, body);
      await saveDb(db, DB_PATH);
      return sendJson(res, stale ? 200 : 200, { accountId, status, draft, stale });
    }
  }

  // --- 测试/演示管理接口 ---
  if (enableTestApi && pathname.startsWith('/api/test/') && method === 'POST') {
    return handleTestApi(req, res, db, pathname);
  }

  // 浏览器复用服务端同一份共享核心（保证前端与 API 同一组口径/证据逻辑）
  if (method === 'GET' && pathname === '/shared/core.js') {
    const data = await fs.readFile(path.join(__dirname, '..', 'shared', 'core.js'));
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end(data);
  }

  // --- 静态资源 ---
  if (method === 'GET') {
    return serveStatic(res, pathname);
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function handleTestApi(req, res, db, pathname) {
  const body = await readJson(req);

  if (pathname === '/api/test/reset') {
    const { SEED } = await import('./seed-data.js');
    db.routes = structuredClone(SEED.routes);
    if (body.clearAccounts) db.accounts = {};
    await saveDb(db, DB_PATH);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/test/route/withdraw') {
    const r = db.routes[body.routeId];
    if (!r) return sendJson(res, 404, { error: 'route_not_found' });
    r.status = 'withdrawn';
    r.withdrawnReason = body.reason || '测试：路线临时撤回';
    r.withdrawnAt = new Date().toISOString();
    await saveDb(db, DB_PATH);
    return sendJson(res, 200, { ok: true, route: { id: r.id, status: r.status } });
  }

  if (pathname === '/api/test/route/restore') {
    const r = db.routes[body.routeId];
    if (!r) return sendJson(res, 404, { error: 'route_not_found' });
    r.status = 'published';
    r.withdrawnReason = null;
    r.withdrawnAt = null;
    await saveDb(db, DB_PATH);
    return sendJson(res, 200, { ok: true, route: { id: r.id, status: r.status } });
  }

  if (pathname === '/api/test/route/delete') {
    const r = db.routes[body.routeId];
    if (!r) return sendJson(res, 404, { error: 'route_not_found' });
    r.status = 'deleted';
    r.deletedReason = body.reason || '测试：路线删除';
    r.deletedAt = new Date().toISOString();
    await saveDb(db, DB_PATH);
    return sendJson(res, 200, { ok: true, route: { id: r.id, status: r.status } });
  }

  if (pathname === '/api/test/route/publish-version') {
    // 给路线追加一个新公开版本（用于“新版本提示”验收）
    const r = db.routes[body.routeId];
    if (!r) return sendJson(res, 404, { error: 'route_not_found' });
    const n = r.versions.length + 1;
    r.versions.push({
      versionId: body.versionId || `${r.id}-v${n}`,
      label: body.label || `测试新版本 v${n}`,
      publishedAt: new Date().toISOString(),
      dataAsOf: body.dataAsOf || new Date().toISOString().slice(0, 10),
      changeNote: body.changeNote || '测试追加版本',
      metrics: body.metrics || r.versions[r.versions.length - 1].metrics
    });
    await saveDb(db, DB_PATH);
    return sendJson(res, 200, { ok: true, versionId: r.versions[r.versions.length - 1].versionId });
  }

  return sendJson(res, 404, { error: 'unknown_test_action' });
}

function sanitizePins(pins) {
  const out = {};
  if (pins && typeof pins === 'object') {
    for (const [rid, v] of Object.entries(pins)) {
      if (v && typeof v === 'object' && v.versionId) {
        out[rid] = { routeId: v.routeId || rid, versionId: String(v.versionId) };
      }
    }
  }
  return out;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return {};
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // 前端 hash 路由不影响 pathname；其余路径限制在 PUBLIC_DIR 内
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA 回退
    try {
      const index = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  }
}

// 直接运行时启动；被测试 import 时不自动监听
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const db = await initDb(DB_PATH, { force: false });
  const server = createApp(db);
  server.listen(PORT, () => {
    console.log(`慢行站路线对比服务已启动: http://localhost:${PORT}`);
    console.log(`数据库: ${DB_PATH}`);
  });
}
