// ======================
// 慢行站对比状态管理
//
// 职责：
// 1. 维护对比集合（routeId + 固定版本）、取数政策、快照时点。
// 2. URL 只编码公开选择（?c=r001@3,r004&p=latest）；个人草稿与偏好
//    只经账号接口同步，绝不写入 URL。
// 3. 每次取数分配递增请求序号，过期响应直接丢弃（防止异步乱序）。
// 4. 选择/偏好变化自动保存到账号接口（数据库）；保存前重新校验，
//    保存时路线被撤回则保留占位并提示。
// 5. 监听 storage 事件：另一设备（标签页）修改集合时提示并刷新。
// ======================

const CompareStore = (() => {
  const MAX_COMPARE = 6;

  const state = {
    selection: [],          // [{ routeId, version|null }] version=null 表示跟随取数政策
    policy: 'snapshot',     // 'snapshot' 同一时点快照 | 'latest' 各取最新
    snapshotAt: null,       // 快照时点（政策为 snapshot 时固定）
    comparison: null,       // 最近一次比较响应 { evidence, items }
    routeIndex: [],         // 路线索引（卡片列表）
    drafts: {},             // 个人草稿（账号同步，不进 URL）
    filter: { tag: 'all', keyword: '' },
    sort: { metric: null, dir: 1 }, // 抽屉内排序（仅同口径组内）
    loading: false,
    restoredFromURL: false
  };

  let reqSeq = 0;           // 请求序号：只接受最新请求的响应
  let saveTimer = null;
  const listeners = {};

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(fn => fn(payload));
  }

  // ---------- URL 编解码（仅公开选择） ----------
  function encodeURL() {
    const params = new URLSearchParams();
    if (state.selection.length) {
      params.set('c', state.selection.map(s =>
        s.version != null ? `${s.routeId}@${s.version}` : s.routeId).join(','));
    }
    params.set('p', state.policy);
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  function decodeURL() {
    const params = new URLSearchParams(location.search);
    const c = params.get('c');
    const p = params.get('p');
    if (p === 'snapshot' || p === 'latest') state.policy = p;
    if (!c) return false;
    // 旧分享链接恢复：逐项解析 routeId@version；无法解析的项跳过并提示
    const items = [];
    const invalid = [];
    c.split(',').forEach(token => {
      const m = token.trim().match(/^([A-Za-z0-9_-]+)(?:@(\d+))?$/);
      if (m) items.push({ routeId: m[1], version: m[2] ? parseInt(m[2], 10) : null });
      else invalid.push(token);
    });
    state.selection = items.slice(0, MAX_COMPARE);
    if (invalid.length) emit('toast', { message: `分享链接中有 ${invalid.length} 项无法识别，已跳过`, type: 'warning' });
    return true;
  }

  // ---------- 取数 ----------
  function currentRequest() {
    return {
      items: state.selection.map(s => ({ routeId: s.routeId, version: s.version })),
      policy: state.policy,
      snapshotAt: state.snapshotAt
    };
  }

  async function refresh() {
    const seq = ++reqSeq;
    if (!state.selection.length) {
      state.comparison = null;
      emit('comparison', null);
      encodeURL();
      return;
    }
    if (state.policy === 'snapshot' && !state.snapshotAt) {
      state.snapshotAt = new Date().toISOString(); // 同一时点快照：进入比较时固定时点
    }
    state.loading = true;
    emit('loading', true);
    try {
      const res = await CompareAPI.fetchComparison(currentRequest());
      if (seq !== reqSeq) return; // 异步响应乱序：丢弃过期响应
      state.comparison = res;
      emit('comparison', res);
    } finally {
      if (seq === reqSeq) {
        state.loading = false;
        emit('loading', false);
      }
    }
    encodeURL();
  }

  // ---------- 集合操作 ----------
  function isSelected(routeId) {
    return state.selection.some(s => s.routeId === routeId);
  }

  async function add(routeId) {
    if (isSelected(routeId)) return { ok: false, reason: 'duplicate' };
    if (state.selection.length >= MAX_COMPARE) return { ok: false, reason: 'full' };
    state.selection.push({ routeId, version: null });
    await refresh();
    scheduleSave();
    return { ok: true };
  }

  async function remove(routeId) {
    state.selection = state.selection.filter(s => s.routeId !== routeId);
    await refresh();
    scheduleSave();
  }

  async function clear() {
    state.selection = [];
    await refresh();
    scheduleSave();
  }

  // 固定/更新到指定公开版本（比较 API 固定公开版本）
  async function pinVersion(routeId, version) {
    const item = state.selection.find(s => s.routeId === routeId);
    if (!item) return;
    item.version = version;
    await refresh();
    scheduleSave();
  }

  // 取消固定，跟随取数政策
  async function unpin(routeId) {
    const item = state.selection.find(s => s.routeId === routeId);
    if (!item) return;
    item.version = null;
    await refresh();
    scheduleSave();
  }

  async function setPolicy(policy) {
    if (policy !== 'snapshot' && policy !== 'latest') return;
    if (state.policy === policy) return;
    state.policy = policy;
    // 切换政策时重新固定快照时点，保证"同一时点"语义一致
    state.snapshotAt = policy === 'snapshot' ? new Date().toISOString() : null;
    await refresh();
    savePrefs();
  }

  // 手动刷新快照时点（同一时点快照政策下取新时点）
  async function refreshSnapshot() {
    if (state.policy !== 'snapshot') return;
    state.snapshotAt = new Date().toISOString();
    await refresh();
  }

  // ---------- 持久化（数据库保存用户选择与偏好） ----------
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSelection, 400);
  }

  // 保存时重新校验：若路线在保存前被撤回/删除，保留占位并提示
  async function saveSelection() {
    if (!state.selection.length) {
      await CompareAPI.AccountAPI.saveSelection({ items: [] });
      return;
    }
    const checks = await CompareAPI.validateSelection(currentRequest().items);
    const broken = checks.filter(c => !c.ok);
    if (broken.length) {
      // 占位条目仍随集合保存（含固定版本信息），恢复时展示原因
      emit('toast', {
        message: `保存完成，但 ${broken.length} 条路线已不可用（${broken.map(b => b.routeId).join('、')}），已保留占位`,
        type: 'warning'
      });
    }
    await CompareAPI.AccountAPI.saveSelection({ items: currentRequest().items });
    emit('saved', { broken });
  }

  async function savePrefs() {
    await CompareAPI.AccountAPI.savePrefs({ policy: state.policy });
  }

  async function saveDraft(routeId, text) {
    state.drafts[routeId] = { text, updatedAt: new Date().toISOString() };
    await CompareAPI.AccountAPI.saveDraft(routeId, text); // 草稿仅经账号接口同步
  }

  // ---------- 跨设备同步（storage 事件模拟另一设备） ----------
  async function applyRemoteSelection(payload, sourceLabel) {
    if (!payload || !Array.isArray(payload.items)) return;
    const incoming = JSON.stringify(payload.items);
    const current = JSON.stringify(currentRequest().items);
    if (incoming === current) return;
    state.selection = payload.items.map(i => ({ routeId: i.routeId, version: i.version != null ? i.version : null }));
    emit('toast', { message: `对比集合已在${sourceLabel || '另一设备'}更新，本页已同步`, type: 'info' });
    await refresh();
  }

  function handleStorageEvent(e) {
    if (e.key === 'mxz.server.selection' && e.newValue) {
      try { applyRemoteSelection(JSON.parse(e.newValue), '另一设备'); } catch (err) { /* 忽略坏数据 */ }
    }
  }

  // ---------- 初始化 ----------
  async function init() {
    window.addEventListener('storage', handleStorageEvent);

    // 1. 优先恢复 URL（旧分享链接）；无 URL 时从账号接口恢复已保存集合
    const fromURL = decodeURL();
    state.restoredFromURL = fromURL;
    if (!fromURL) {
      const saved = await CompareAPI.AccountAPI.getSelection();
      if (saved && Array.isArray(saved.items) && saved.items.length) {
        state.selection = saved.items
          .map(i => ({ routeId: i.routeId, version: i.version != null ? i.version : null }))
          .slice(0, MAX_COMPARE);
      }
    } else {
      emit('toast', { message: '已从分享链接恢复对比集合（含固定版本）', type: 'info' });
    }

    // 2. 恢复偏好与草稿（账号接口）
    const prefs = await CompareAPI.AccountAPI.getPrefs();
    if (prefs && (prefs.policy === 'snapshot' || prefs.policy === 'latest') && !fromURL) {
      state.policy = prefs.policy;
    }
    state.drafts = await CompareAPI.AccountAPI.getDrafts() || {};

    // 3. 拉取路线索引与比较数据
    state.routeIndex = await CompareAPI.fetchRouteIndex();
    emit('index', state.routeIndex);
    await refresh();
  }

  return {
    state, on, init, refresh,
    add, remove, clear, isSelected,
    pinVersion, unpin, setPolicy, refreshSnapshot,
    saveSelection, saveDraft, applyRemoteSelection,
    MAX_COMPARE
  };
})();
