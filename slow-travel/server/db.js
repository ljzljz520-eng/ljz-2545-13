/**
 * JSON 文件持久化（零依赖）。
 * 结构：{ routes, accounts: { [accountId]: draft } }
 * 写入采用临时文件 + rename 原子替换，避免并发读到半截 JSON。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mergeIntoCurrent } from '../shared/core.js';
import { SEED } from './seed-data.js';

export const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'db.json');

export async function loadDb(dbPath = DEFAULT_DB_PATH) {
  try {
    const raw = await fs.readFile(dbPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveDb(db, dbPath = DEFAULT_DB_PATH) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf-8');
  await fs.rename(tmp, dbPath);
}

export async function initDb(dbPath = DEFAULT_DB_PATH, { force = false } = {}) {
  const existing = force ? null : await loadDb(dbPath);
  const db = existing || structuredClone(SEED);
  if (!existing || force) await saveDb(db, dbPath);
  return db;
}

// ---------------------------------------------------------------------------
// 账号草稿（个人选择与偏好）。URL 只承载公开选择；草稿经账号接口同步。
// draft: {
//   revision, updatedAt,
//   collection: [routeId...],         // 对比集合（个人）
//   pins: { [routeId]: { routeId, versionId } },
//   policy, asOf, transport, season,  // 偏好
//   filters: {...}                    // 个人 UI 过滤（不进入分享 URL）
// }
// ---------------------------------------------------------------------------
export function getDraft(db, accountId) {
  return db.accounts[accountId] || null;
}

export function defaultDraft() {
  return {
    revision: 0,
    updatedAt: null,
    collection: [],
    pins: {},
    policy: 'latest',
    asOf: null,
    transport: 'walk',
    season: 'summer',
    filters: { status: 'all', minSupplies: 0, q: '' }
  };
}

/**
 * 带祖先集合的精确三方合并（客户端回传 baseCollection）。
 * 永远可收敛，不强制 409；revision 不匹配时在响应中标注 mergedRemotely。
 */
export function applyDraftWrite3Way(db, accountId, body) {
  const existed = Boolean(db.accounts[accountId]);
  const server = db.accounts[accountId]
    ? structuredClone(db.accounts[accountId])
    : defaultDraft();
  const serverRevision = existed ? server.revision : 0;
  const stale = Number(body.baseRevision || 0) !== serverRevision;

  if (body.collection) {
    const baseCollection = Array.isArray(body.baseCollection)
      ? body.baseCollection
      : (stale ? [] : server.collection);
    if (stale && Array.isArray(body.baseCollection)) {
      server.collection = mergeIntoCurrent(server.collection, baseCollection, body.collection);
    } else {
      const next = new Set(server.collection);
      for (const id of body.collection.added || []) next.add(id);
      for (const id of body.collection.removed || []) next.delete(id);
      server.collection = [...next];
    }
  }

  // 偏好：最后写入获胜
  if (body.pins !== undefined) server.pins = sanitizePins(body.pins);
  if (body.policy === 'snapshot' || body.policy === 'latest') server.policy = body.policy;
  if ('asOf' in body) server.asOf = body.asOf || null;
  if (body.transport === 'walk' || body.transport === 'bike') server.transport = body.transport;
  if (body.season === 'summer' || body.season === 'winter') server.season = body.season;
  if (body.filters && typeof body.filters === 'object') {
    server.filters = { ...server.filters, ...body.filters };
  }

  server.revision = serverRevision + 1;
  server.updatedAt = new Date().toISOString();
  db.accounts[accountId] = server;
  return { status: stale ? 'merged_remote' : 'merged', draft: server, stale };
}

function sanitizePins(pins) {
  const out = {};
  if (!pins || typeof pins !== 'object') return out;
  for (const [rid, v] of Object.entries(pins)) {
    if (v && typeof v === 'object' && v.versionId) {
      out[rid] = { routeId: v.routeId || rid, versionId: String(v.versionId) };
    }
  }
  return out;
}
