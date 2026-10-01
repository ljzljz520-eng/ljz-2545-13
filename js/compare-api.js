// ======================
// 慢行站比较 API（模拟后端）
//
// 职责：
// 1. 路线索引：仅返回"当前有公开版本"的路线（已删除/无公开版本的不出现）。
// 2. 比较接口：固定每条路线的公开版本——
//    - 调用方可显式固定版本（routeId@version），用于分享链接与已存集合；
//    - 未固定时按取数政策解析：
//      · 'snapshot' 同一时点快照：所有路线取 snapshotAt 之前发布的最新公开版本；
//      · 'latest'   各取最新：每条路线各取当前最新公开版本。
// 3. 撤回/删除/不存在的路线返回占位（含原因），绝不替换为同名路线。
// 4. 账号接口：选择集合、偏好、个人草稿的服务端同步（localStorage 模拟）。
//
// 所有接口带随机延迟，模拟真实网络（配合前端请求序号防止异步乱序）。
// ======================

const CompareAPI = (() => {
  const SERVER_PREFIX = 'mxz.server.'; // 模拟服务端存储命名空间

  function latency() {
    return new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 320));
  }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // ---------- 版本查询辅助 ----------
  function getRoute(routeId) {
    return ROUTE_DATA.routes.find(r => r.id === routeId) || null;
  }
  function getVersions(routeId) {
    return ROUTE_DATA.versions[routeId] || [];
  }
  function findVersion(routeId, versionNo) {
    return getVersions(routeId).find(v => v.version === versionNo) || null;
  }
  // asOf 之前（含）发布的最新公开版本；不传 asOf 表示当前最新公开版本
  function latestPublicVersion(routeId, asOf) {
    const candidates = getVersions(routeId).filter(v =>
      v.status === 'public' && (!asOf || v.publishedAt <= asOf));
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => (a.version > b.version ? a : b));
  }

  // ---------- 占位构造 ----------
  // 撤回/删除/缺失的路线：保留占位与原因，不拿另一同名路线代替
  function placeholder(sel, code, reason, route, version) {
    return {
      ok: false,
      code,                                  // not-found | version-missing | no-public | no-public-at-snapshot | withdrawn | deleted
      reason,
      pinned: sel.version != null,
      routeId: sel.routeId,
      requestedVersion: sel.version != null ? sel.version : null,
      route: route ? clone(route) : { id: sel.routeId, name: '未知路线', region: '', tags: [], tagLabels: [], desc: '' },
      version: version ? clone(version) : null
    };
  }

  // ---------- 单项解析 ----------
  function resolveItem(sel, request) {
    const route = getRoute(sel.routeId);
    const versions = getVersions(sel.routeId);
    if (!route || !versions.length) {
      return placeholder(sel, 'not-found', '路线不存在或已被移除');
    }

    let version = null;
    if (sel.version != null) {
      // 固定版本：严格取该版本，即使已有更新公开版本
      version = findVersion(sel.routeId, sel.version);
      if (!version) {
        return placeholder(sel, 'version-missing', `未找到 v${sel.version}（该版本可能从未发布）`, route);
      }
    } else if (request.policy === 'snapshot') {
      version = latestPublicVersion(sel.routeId, request.snapshotAt);
      if (!version) {
        return placeholder(sel, 'no-public-at-snapshot', '快照时点之前该路线无公开版本', route);
      }
    } else {
      version = latestPublicVersion(sel.routeId);
      if (!version) {
        return placeholder(sel, 'no-public', '该路线当前无公开版本', route);
      }
    }

    if (version.status === 'withdrawn') {
      return placeholder(sel, 'withdrawn', version.withdrawnReason || '该版本已被发布方撤回', route, version);
    }
    if (version.status === 'deleted') {
      return placeholder(sel, 'deleted', version.deletedReason || '该路线数据已删除', route, version);
    }

    const latest = latestPublicVersion(sel.routeId);
    return {
      ok: true,
      pinned: sel.version != null,
      route: clone(route),
      version: clone(version),
      // 新版本提示：所取版本落后于当前最新公开版本时置真
      hasNewer: !!latest && latest.version > version.version,
      latestVersionNo: latest ? latest.version : null
    };
  }

  // ---------- 公开接口 ----------

  // GET /api/routes —— 路线索引（仅含当前有公开版本的路线）
  async function fetchRouteIndex() {
    await latency();
    return ROUTE_DATA.routes
      .filter(r => !r.archived)
      .map(r => {
        const latest = latestPublicVersion(r.id);
        return latest ? Object.assign(clone(r), { latestVersion: clone(latest) }) : null;
      })
      .filter(Boolean);
  }

  // POST /api/compare —— 比较接口
  // request: { items: [{routeId, version|null}], policy: 'snapshot'|'latest', snapshotAt: ISO|null }
  // 返回 evidence（取数政策/快照时点/取数时间），卡片、抽屉、导出报告共用同一份证据
  async function fetchComparison(request) {
    await latency();
    const items = request.items.map(sel => resolveItem(sel, request));
    return {
      evidence: {
        policy: request.policy,
        snapshotAt: request.policy === 'snapshot' ? request.snapshotAt : null,
        fetchedAt: new Date().toISOString()
      },
      items
    };
  }

  // POST /api/compare/validate —— 保存前校验（不解析指标，只回状态）
  async function validateSelection(selection) {
    await latency();
    return selection.map(sel => {
      const resolved = resolveItem(sel, { policy: 'latest', snapshotAt: null });
      return { routeId: sel.routeId, version: sel.version, ok: resolved.ok, code: resolved.code || null, reason: resolved.reason || null };
    });
  }

  // ---------- 账号接口（模拟）：选择集合 / 偏好 / 个人草稿 ----------
  // 个人草稿只经账号接口同步，绝不写入 URL。
  function readServer(key, fallback) {
    try {
      const raw = localStorage.getItem(SERVER_PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeServer(key, value) {
    localStorage.setItem(SERVER_PREFIX + key, JSON.stringify(value));
  }

  const AccountAPI = {
    async getSelection() { await latency(); return readServer('selection', null); },
    async saveSelection(payload) {
      await latency();
      writeServer('selection', Object.assign({}, payload, { savedAt: new Date().toISOString() }));
      return { ok: true };
    },
    async getPrefs() { await latency(); return readServer('prefs', null); },
    async savePrefs(prefs) {
      await latency();
      writeServer('prefs', Object.assign({}, prefs, { savedAt: new Date().toISOString() }));
      return { ok: true };
    },
    async getDrafts() { await latency(); return readServer('drafts', {}); },
    async saveDraft(routeId, text) {
      await latency();
      const drafts = readServer('drafts', {});
      drafts[routeId] = { text: text, updatedAt: new Date().toISOString() };
      writeServer('drafts', drafts);
      return { ok: true };
    }
  };

  // ---------- 演示工具（模拟服务端数据变更，仅用于验收演示） ----------
  const DemoTools = {
    // 模拟发布方撤回某版本
    withdrawVersion(routeId, versionNo, reason) {
      const v = findVersion(routeId, versionNo);
      if (!v || v.status !== 'public') return false;
      v.status = 'withdrawn';
      v.withdrawnAt = new Date().toISOString();
      v.withdrawnReason = reason || '发布方撤回';
      return true;
    },
    // 模拟发布方重新公开某版本
    republishVersion(routeId, versionNo) {
      const v = findVersion(routeId, versionNo);
      if (!v || v.status !== 'withdrawn') return false;
      v.status = 'public';
      delete v.withdrawnAt;
      delete v.withdrawnReason;
      return true;
    },
    // 模拟发布新版本（基于最新公开版本微调指标）
    publishNewVersion(routeId, mutate) {
      const latest = latestPublicVersion(routeId);
      if (!latest) return null;
      const next = clone(latest);
      next.version = latest.version + 1;
      next.publishedAt = new Date().toISOString();
      if (typeof mutate === 'function') mutate(next.metrics);
      ROUTE_DATA.versions[routeId].push(next);
      return next.version;
    }
  };

  return {
    fetchRouteIndex,
    fetchComparison,
    validateSelection,
    AccountAPI,
    DemoTools,
    _internals: { latestPublicVersion, findVersion, getRoute }
  };
})();
