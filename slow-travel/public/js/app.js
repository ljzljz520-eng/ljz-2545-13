/**
 * 慢行站路线对比 —— 前端
 * 与 /api/compare 使用同一份 shared/core.js 的口径、占位、排序、报告逻辑。
 */
import {
  METRICS, METRIC_KEYS, TRANSPORT_LABELS, SEASON_LABELS,
  describeCaliber, comparableSort, encodePublicHash, decodePublicHash,
  renderReportText, PLACEHOLDER_REASONS
} from '/shared/core.js';

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
const LOCAL_ACCOUNT_KEY = 'slowtravel.account';
const state = {
  accountId: localStorage.getItem(LOCAL_ACCOUNT_KEY) || ('local-' + Math.random().toString(36).slice(2, 8)),
  revision: 0,
  exists: false,
  // 个人草稿（经账号接口同步）
  collection: [],
  pins: {},
  policy: 'latest',
  asOf: null,
  transport: 'walk',
  season: 'summer',
  filters: { status: 'available', minSupplies: 0, q: '' },
  // 运行时
  cards: [],
  comparison: null,
  sort: { metric: null, dir: 'asc' },
  // 异步响应乱序防护：卡片与对比是两条独立请求流，各自维护序号，
  // 只接受各自流中最后一次请求的响应（绝不互相误杀）
  cardSeq: 0,
  compareSeq: 0
};

const $ = (sel) => document.querySelector(sel);
const els = {
  accountInput: $('#accountInput'),
  syncState: $('#syncState'),
  transportSel: $('#transportSel'),
  seasonSel: $('#seasonSel'),
  statusFilter: $('#statusFilter'),
  minSupplies: $('#minSupplies'),
  qFilter: $('#qFilter'),
  filterNote: $('#filterNote'),
  routeCards: $('#routeCards'),
  drawer: $('#drawer'),
  compareCount: $('#compareCount'),
  compareHead: $('#compareHead'),
  compareBody: $('#compareBody'),
  incomparableList: $('#incomparableList'),
  policyDesc: $('#policyDesc'),
  snapshotAsOf: $('#snapshotAsOf'),
  versionBanner: $('#versionBanner'),
  withdrawnBanner: $('#withdrawnBanner'),
  pinCurrentBtn: $('#pinCurrentBtn'),
  exportBtn: $('#exportBtn'),
  copyLinkBtn: $('#copyLinkBtn'),
  toastStack: $('#toastStack')
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function toast(message, level = '') {
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.textContent = message;
  els.toastStack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `${path} ${res.status}`);
  }
  return res.json();
}

function setSync(text, cls = '') {
  els.syncState.textContent = text;
  els.syncState.className = `sync-state ${cls}`;
}

function routeCardById(id) {
  return state.cards.find((c) => c.routeId === id);
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
async function boot() {
  bindEvents();
  els.accountInput.value = state.accountId.startsWith('local-') ? '' : state.accountId;

  await loadDraft();

  // URL 仅编码公开选择：存在分享链接时，公开字段以链接为准（个人过滤器等不被覆盖）
  const shared = decodePublicHash(location.hash);
  if (shared) {
    if (shared.routeIds.length) state.collection = shared.routeIds;
    if (Object.keys(shared.pins).length) state.pins = shared.pins;
    if (shared.policy) state.policy = shared.policy;
    if (shared.asOf) state.asOf = shared.asOf;
    if (shared.transport) state.transport = shared.transport;
    if (shared.season) state.season = shared.season;
    toast('已打开公开分享链接：路线固定为链接指定的公开版本；你的个人过滤器未被改动。', 'info');
  }

  syncFormFromState();
  await refreshAll();
}

async function loadDraft() {
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(state.accountId)}/draft`);
    if (data.exists && data.draft) {
      applyDraftToState(data.draft);
      setSync(`草稿已同步 #${data.draft.revision}`, 'saved');
    } else {
      setSync('新账号（本地草稿待保存）');
    }
  } catch (err) {
    setSync('草稿同步失败', 'error');
    toast(`草稿加载失败：${err.message}`, 'error');
  }
}

function applyDraftToState(d) {
  state.revision = d.revision || 0;
  state.exists = true;
  state.collection = Array.isArray(d.collection) ? d.collection : [];
  state.pins = d.pins || {};
  state.policy = d.policy === 'snapshot' ? 'snapshot' : 'latest';
  state.asOf = d.asOf || null;
  state.transport = d.transport === 'bike' ? 'bike' : 'walk';
  state.season = d.season === 'winter' ? 'winter' : 'summer';
  state.filters = { ...state.filters, ...(d.filters || {}) };
}

function syncFormFromState() {
  els.transportSel.value = state.transport;
  els.seasonSel.value = state.season;
  els.statusFilter.value = state.filters.status || 'available';
  els.minSupplies.value = state.filters.minSupplies ?? 0;
  els.qFilter.value = state.filters.q || '';
}

// ---------------------------------------------------------------------------
// 事件绑定
// ---------------------------------------------------------------------------
function bindEvents() {
  els.transportSel.addEventListener('change', () => {
    state.transport = els.transportSel.value;
    updatePublicUrl(); refreshAll(); scheduleSave();
  });
  els.seasonSel.addEventListener('change', () => {
    state.season = els.seasonSel.value;
    updatePublicUrl(); refreshAll(); scheduleSave();
  });
  els.statusFilter.addEventListener('change', () => {
    state.filters.status = els.statusFilter.value; renderCards(); scheduleSave();
  });
  els.minSupplies.addEventListener('input', () => {
    state.filters.minSupplies = Number(els.minSupplies.value || 0); renderCards(); scheduleSave();
  });
  els.qFilter.addEventListener('input', () => {
    state.filters.q = els.qFilter.value.trim(); renderCards(); scheduleSave();
  });

  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPolicy(btn.dataset.policy));
  });
  els.pinCurrentBtn.addEventListener('click', pinCurrentVersions);
  els.exportBtn.addEventListener('click', exportReport);
  els.copyLinkBtn.addEventListener('click', copyShareLink);

  els.accountInput.addEventListener('change', switchAccount);

  window.addEventListener('hashchange', async () => {
    const shared = decodePublicHash(location.hash);
    if (!shared) return;
    if (shared.routeIds.length) state.collection = shared.routeIds;
    if (Object.keys(shared.pins).length) state.pins = shared.pins;
    if (shared.policy) state.policy = shared.policy;
    if (shared.asOf) state.asOf = shared.asOf;
    if (shared.transport) state.transport = shared.transport;
    if (shared.season) state.season = shared.season;
    syncFormFromState();
    await refreshAll();
  });

  document.querySelectorAll('.demo-grid button').forEach((btn) => {
    btn.addEventListener('click', () => runDemo(btn.dataset.demo));
  });
}

async function switchAccount() {
  const next = els.accountInput.value.trim();
  if (!next) return;
  state.accountId = next;
  localStorage.setItem(LOCAL_ACCOUNT_KEY, next);
  state.revision = 0; state.exists = false;
  await loadDraft();
  syncFormFromState();
  await refreshAll();
  toast(`已切换到账号 ${next}，个人草稿已从服务端同步。`, 'info');
}

function setPolicy(policy) {
  state.policy = policy;
  if (policy === 'snapshot' && !state.asOf) {
    state.asOf = new Date().toISOString();
  }
  if (policy === 'latest') state.asOf = null;
  updatePublicUrl();
  refreshComparison();
  scheduleSave();
  renderPolicyUI();
}

// 固定当前集合的最新版本为公开版本（用于快照分享）
async function pinCurrentVersions() {
  const pins = {};
  for (const id of state.collection) {
    const card = routeCardById(id);
    if (card && card.latestVersionId && card.status !== 'deleted') {
      pins[id] = { routeId: id, versionId: card.latestVersionId };
    }
  }
  state.pins = pins;
  state.policy = 'snapshot';
  state.asOf = new Date().toISOString();
  renderPolicyUI();
  updatePublicUrl();
  await refreshComparison();
  scheduleSave();
  toast('已固定为各路线当前最新公开版本（同一时点快照）；之后发布的新版本只会提示，不会静默替换。', 'info');
}

// ---------------------------------------------------------------------------
// 取数：卡片 + 对比（带乱序防护）
// ---------------------------------------------------------------------------
async function refreshAll() {
  renderPolicyUI();
  await Promise.all([refreshCards(), refreshComparison()]);
}

async function refreshCards() {
  const mySeq = ++state.cardSeq;
  try {
    const data = await api(
      `/api/routes?transport=${state.transport}&season=${state.season}`
    );
    if (mySeq !== state.cardSeq) return; // 旧响应丢弃（卡片流独立序号）
    state.cards = data.routes;
    renderCards();
  } catch (err) {
    toast(`路线加载失败：${err.message}`, 'error');
  }
}

async function refreshComparison() {
  const mySeq = ++state.compareSeq;
  renderPolicyUI();
  if (!state.collection.length) {
    state.comparison = null;
    renderComparison();
    return;
  }
  try {
    const comparison = await api('/api/compare', {
      method: 'POST',
      body: {
        routeIds: state.collection,
        pins: state.pins,
        policy: state.policy,
        asOf: state.asOf,
        transport: state.transport,
        season: state.season
      }
    });
    if (mySeq !== state.compareSeq) return; // 乱序响应防护：只渲染对比流最后一次
    state.comparison = comparison;
    renderComparison();
    handleVersionAlerts(comparison);
  } catch (err) {
    toast(`对比加载失败：${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// 集合操作（两设备并发，删除优先；保存不阻断 UI）
// ---------------------------------------------------------------------------
function toggleRoute(routeId) {
  const i = state.collection.indexOf(routeId);
  if (i >= 0) {
    state.collection.splice(i, 1);
    queueCollectionDelta(routeId, false);
  } else {
    state.collection.push(routeId);
    queueCollectionDelta(routeId, true);
    // 固定版本初值：快照下固定当前最新，latest 下不固定
    const card = routeCardById(routeId);
    if (state.policy === 'snapshot' && card && card.latestVersionId) {
      state.pins[routeId] = { routeId, versionId: card.latestVersionId };
      saveQueue.pins = state.pins;
    }
  }
  updatePublicUrl();
  renderCards();
  refreshComparison();
  scheduleSave();
}

// 在一次去抖窗口内累加增删增量：同一 id 反复切换时以最后一次动作为准
function queueCollectionDelta(routeId, isAdd) {
  const q = saveQueue.collection || (saveQueue.collection = { added: [], removed: [] });
  q.added = q.added.filter((id) => id !== routeId);
  q.removed = q.removed.filter((id) => id !== routeId);
  q[isAdd ? 'added' : 'removed'].push(routeId);
}

function pinVersion(routeId, versionId) {
  state.pins[routeId] = { routeId, versionId };
  saveQueue.pins = state.pins;
  updatePublicUrl();
  refreshComparison();
  scheduleSave();
}

const saveQueue = { collection: null, pins: undefined, timer: null, inflight: false };
function scheduleSave() {
  // 偏好类字段总是整体写入（最后写入获胜）
  saveQueue.policy = state.policy;
  saveQueue.asOf = state.asOf;
  saveQueue.transport = state.transport;
  saveQueue.season = state.season;
  saveQueue.filters = state.filters;
  clearTimeout(saveQueue.timer);
  saveQueue.timer = setTimeout(flushSave, 400);
}

async function flushSave() {
  if (saveQueue.inflight) {
    // 已有保存在路上，稍后重试（避免异步乱序写）
    saveQueue.timer = setTimeout(flushSave, 350);
    return;
  }
  const payload = {
    baseRevision: state.revision,
    baseCollection: state.collection,
    collection: saveQueue.collection,
    pins: saveQueue.pins !== undefined ? saveQueue.pins : state.pins,
    policy: saveQueue.policy || state.policy,
    asOf: saveQueue.asOf !== undefined ? saveQueue.asOf : state.asOf,
    transport: saveQueue.transport || state.transport,
    season: saveQueue.season || state.season,
    filters: saveQueue.filters || state.filters
  };
  saveQueue.collection = null;
  saveQueue.pins = undefined;
  saveQueue.inflight = true;
  setSync('保存中…');
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(state.accountId)}/draft`, {
      method: 'PUT',
      body: payload
    });
    state.revision = data.draft.revision;
    state.exists = true;
    // 服务端与其他设备合并后的集合若有差异，回补本地
    if (data.stale || data.status === 'merged_remote') {
      const before = new Set(state.collection);
      const serverSet = new Set(data.draft.collection);
      const restored = [...serverSet].filter((id) => !before.has(id));
      state.collection = data.draft.collection;
      state.pins = data.draft.pins || state.pins;
      updatePublicUrl();
      renderCards();
      refreshComparison();
      if (restored.length) {
        toast(`检测到其他设备的改动，已按“删除优先”合并集合（新增保留 ${restored.length} 项）。`, 'warn');
      } else {
        toast('检测到其他设备的改动，已合并草稿。', 'info');
      }
    }
    setSync(`已保存 #${data.draft.revision}`, 'saved');
  } catch (err) {
    setSync('保存失败，将重试', 'error');
    toast(`草稿保存失败：${err.message}`, 'error');
  } finally {
    saveQueue.inflight = false;
  }
}

// ---------------------------------------------------------------------------
// URL：仅公开选择
// ---------------------------------------------------------------------------
function currentPublicHash() {
  return encodePublicHash({
    collection: state.collection,
    pins: state.pins,
    policy: state.policy,
    asOf: state.policy === 'snapshot' ? state.asOf : null,
    transport: state.transport,
    season: state.season
  });
}
function updatePublicUrl() {
  const h = currentPublicHash();
  if (location.hash !== h) history.replaceState(null, '', h);
}

async function copyShareLink() {
  updatePublicUrl();
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast('公开分享链接已复制（仅含路线、固定版本、取数政策、交通方式与季节；不含账号与过滤器）。', 'info');
  } catch {
    toast(`复制失败，请手动复制地址栏：${url}`, 'warn');
  }
}

// ---------------------------------------------------------------------------
// 渲染：策略
// ---------------------------------------------------------------------------
function renderPolicyUI() {
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.policy === state.policy);
  });
  els.policyDesc.textContent = state.policy === 'snapshot'
    ? '跨路线同一时点快照：每条路线固定为公开版本，存在新版本时只提示、不静默替换。'
    : '各取最新：每条路线采用当前最新公开版本（不同路线发布时点可能不同）。';
  if (state.policy === 'snapshot' && state.asOf) {
    els.snapshotAsOf.hidden = false;
    els.snapshotAsOf.textContent = `快照时点：${state.asOf}（分享链接固定版本后，各设备看到同一份数据）`;
  } else {
    els.snapshotAsOf.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// 渲染：路线卡片（含“被过滤隐藏但仍在集合”的提示）
// ---------------------------------------------------------------------------
function passesFilter(card) {
  const f = state.filters;
  switch (f.status) {
    case 'published':
      if (card.status !== 'published') return false;
      break;
    case 'withdrawn':
      if (card.status !== 'withdrawn') return false;
      break;
    case 'deleted':
      if (card.status !== 'deleted') return false;
      break;
    case 'available':
      if (card.status === 'deleted') return false; // 默认隐藏已删除
      break;
    case 'all':
    default:
      break;
  }
  if (f.q && !card.name.toLowerCase().includes(f.q.toLowerCase())) return false;
  const latest = card.versions[0];
  const suppliesCell = latest && latest.cells.supplies;
  if ((f.minSupplies ?? 0) > 0) {
    // 缺值路线不满足“至少 N 处”，但不等于 0；被隐藏时给出明确提示
    if (!suppliesCell || suppliesCell.state !== 'ok' || suppliesCell.value < f.minSupplies) return false;
  }
  return true;
}

function renderCards() {
  const selected = new Set(state.collection);
  let hiddenSelected = 0;
  let hiddenCount = 0;
  const html = state.cards.map((card) => {
    const isSelected = selected.has(card.routeId);
    const visible = passesFilter(card);
    if (!visible) {
      hiddenCount += 1;
      if (isSelected) hiddenSelected += 1;
    }
    const latest = card.versions[0];
    const cellHtml = (key) => {
      const def = METRICS[key];
      const cell = latest ? latest.cells[key] : null;
      if (!cell || cell.state === 'missing') {
        return `<span class="cell-missing">缺值</span><span class="cal">非零值</span>`;
      }
      if (cell.state === 'unavailable') {
        return `<span class="cell-missing">不可用</span>`;
      }
      const zero = cell.isZero ? ' cell-zero' : '';
      return `<span class="v${zero}">${cell.value}${def.unit}</span>` +
             (cell.isZero ? '<span class="cal">实测为0</span>' : '');
    };
    const statusBadge = card.status === 'withdrawn'
      ? '<span class="badge withdrawn">已撤回</span>'
      : card.status === 'deleted'
        ? '<span class="badge deleted">已删除</span>'
        : '';
    const sameName = state.cards.some((c) => c.name === card.name && c.routeId !== card.routeId);
    const versionsHtml = card.versions.map((v) => {
      const pinned = state.pins[card.routeId]?.versionId === v.versionId;
      return `<div class="version-line">
        <span>${v.versionId} · ${v.label}（${v.publishedAt.slice(0, 10)}）</span>
        ${card.status === 'deleted' ? '' :
          `<button data-route="${card.routeId}" data-version="${v.versionId}"
                  class="pin-version ${pinned ? 'pinned' : ''}" type="button">
             ${pinned ? '已固定' : '固定此版本'}</button>`}
      </div>`;
    }).join('');
    return `<article class="route-card ${isSelected ? 'selected' : ''} ${visible ? '' : 'hidden-by-filter'}"
              data-route="${card.routeId}">
      <h3>${card.name}${sameName ? ' <span class="badge new">同名注意</span>' : ''}</h3>
      <div class="route-meta">ID: ${card.routeId} · 最新 ${latest ? latest.versionId : '无版本'}</div>
      <div class="badges">${statusBadge}
        ${card.status === 'withdrawn' ? `<span class="badge withdrawn">${escapeHtml(card.withdrawnReason || '')}</span>` : ''}
        ${card.status === 'deleted' ? `<span class="badge deleted">${escapeHtml(card.deletedReason || '')}</span>` : ''}
      </div>
      <div class="metric-chips">
        <span class="chip">距离 ${cellHtml('distance')}</span>
        <span class="chip">时长 ${cellHtml('duration')}</span>
        <span class="chip">树荫 ${cellHtml('shade')}</span>
        <span class="chip">补给 ${cellHtml('supplies')}</span>
      </div>
      <div class="card-versions">${versionsHtml}</div>
      ${isSelected && !visible ? '<div class="hidden-flag">⚠ 该项被当前过滤器隐藏，但仍保留在对比集合中（不会被移除）</div>' : ''}
    </article>`;
  }).join('');
  els.routeCards.innerHTML = html;

  els.routeCards.querySelectorAll('.route-card').forEach((node) => {
    node.addEventListener('click', (ev) => {
      if (ev.target.closest('.pin-version')) return;
      toggleRoute(node.dataset.route);
    });
  });
  els.routeCards.querySelectorAll('.pin-version').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pinVersion(btn.dataset.route, btn.dataset.version);
    });
  });

  els.filterNote.innerHTML = hiddenCount
    ? `过滤器隐藏了 <b>${hiddenCount}</b> 张卡片；其中 <b>${hiddenSelected}</b> 项仍在对比集合中（隐藏 ≠ 移除）。`
    : '过滤器仅影响卡片显示，不改变对比集合。';
}

// ---------------------------------------------------------------------------
// 渲染：对比抽屉
// ---------------------------------------------------------------------------
function renderComparison() {
  const cmp = state.comparison;
  els.compareCount.textContent = state.collection.length;
  if (!cmp) {
    els.compareHead.innerHTML = '';
    els.compareBody.innerHTML = '<tr><td>点击左侧卡片加入对比；个人选择会经账号接口在设备间同步。</td></tr>';
    els.incomparableList.innerHTML = '';
    els.versionBanner.hidden = true;
    els.withdrawnBanner.hidden = true;
    return;
  }

  // 排序（仅在口径一致的列上允许；排序守卫也在 core 中强制）
  let rows = cmp.rows;
  if (state.sort.metric && cmp.columns[state.sort.metric]?.comparable) {
    try {
      rows = comparableSort(cmp.rows, state.sort.metric, cmp.columns, state.sort.dir);
    } catch {
      state.sort = { metric: null, dir: 'asc' };
    }
  }

  // 表头
  const headCells = ['路线', ...METRIC_KEYS.map((key) => {
    const col = cmp.columns[key];
    const def = METRICS[key];
    const sortMark = state.sort.metric === key ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕';
    return `<th>
      <span class="${col.comparable ? 'sortable' : ''}" title="${col.comparable ? '口径一致，可排序' : '不同口径，不可直接排序'}">${def.label}(${def.unit})</span>
      <button class="sortbtn" ${col.comparable ? '' : 'disabled title="口径不一致或数据不足，禁止排序"'}>${sortMark}</button>
      <span class="col-note">${col.comparable
        ? `口径：${col.caliberDescriptions.join('；')}`
        : `⚠ ${escapeHtml(col.sortNote || '不可比')}`}</span>
    </th>`;
  })];
  els.compareHead.innerHTML = `<tr>${headCells.join('')}</tr>`;
  els.compareHead.querySelectorAll('.sortbtn').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const key = METRIC_KEYS[i];
      if (!cmp.columns[key].comparable) {
        toast(`「${METRICS[key].label}」存在不同口径，不能直接排序；请统一取数政策。`, 'warn');
        return;
      }
      if (state.sort.metric === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { metric: key, dir: 'asc' };
      }
      renderComparison();
    });
  });

  // 表体
  els.compareBody.innerHTML = rows.map((row) => renderRow(row, cmp)).join('');
  els.compareBody.querySelectorAll('.remove-row').forEach((btn) => {
    btn.addEventListener('click', () => toggleRoute(btn.dataset.route));
  });
  els.compareBody.querySelectorAll('.pin-select').forEach((sel) => {
    sel.addEventListener('change', () => pinVersion(sel.dataset.route, sel.value));
  });

  // 不可比项说明
  const badKeys = METRIC_KEYS.filter((k) => !cmp.columns[k].comparable);
  els.incomparableList.innerHTML = badKeys.length
    ? badKeys.map((k) => `<li><b>${METRICS[k].label}</b>：${escapeHtml(cmp.columns[k].sortNote)}
        口径有：${cmp.columns[k].caliberDescriptions.map(escapeHtml).join('；') || '（无数值）'}</li>`).join('')
    : '<li>本次对比五个指标均为同一口径，可以直接排序。</li>';

  // 撤回横幅
  const withdrawn = cmp.rows.filter((r) => r.kind === 'data' && r.status === 'withdrawn');
  if (withdrawn.length) {
    els.withdrawnBanner.hidden = false;
    els.withdrawnBanner.textContent =
      `⚠ ${withdrawn.map((r) => `${r.name}（${r.withdrawnReason || '已撤回'}）`).join('；')}。
       历史数据按固定版本冻结展示；旧分享链接保持占位，不会以同名路线替代。`;
  } else {
    els.withdrawnBanner.hidden = true;
  }
}

function renderRow(row, cmp) {
  if (row.kind === 'placeholder') {
    return `<tr class="row-placeholder">
      <td><b>${escapeHtml(row.name)}</b> <span class="evidence">${escapeHtml(row.routeId)}</span>
        <div class="evidence">${escapeHtml(row.reason)}</div>
        <button class="remove-row" data-route="${escapeHtml(row.routeId)}" type="button">移除占位</button>
      </td>
      ${METRIC_KEYS.map(() => '<td>—</td>').join('')}
    </tr>`;
  }

  const card = routeCardById(row.routeId);
  const versionOptions = (card?.versions || []).map((v) =>
    `<option value="${v.versionId}" ${v.versionId === row.resolvedVersion.versionId ? 'selected' : ''}>${v.versionId}</option>`
  ).join('');

  const firstCell = `<td>
    <b>${escapeHtml(row.name)}</b>
    <button class="remove-row" data-route="${escapeHtml(row.routeId)}" type="button" title="移出对比">✕</button>
    <span class="evidence">${escapeHtml(row.routeId)} · ${row.resolvedVersion.versionId}</span>
    ${row.status === 'withdrawn' ? '<span class="badge withdrawn">已撤回冻结</span>' : ''}
    ${state.policy === 'snapshot'
      ? `<select class="pin-select" data-route="${escapeHtml(row.routeId)}">${versionOptions}</select>
         <span class="evidence">发布 ${row.resolvedVersion.publishedAt.slice(0, 10)}</span>`
      : `<span class="evidence">最新版 · 发布 ${row.resolvedVersion.publishedAt.slice(0, 10)}</span>`}
    ${(row.alerts || []).map((a) => `<span class="evidence" style="color:#234b73">ⓘ ${escapeHtml(a.message)}</span>`).join('')}
  </td>`;

  const cells = METRIC_KEYS.map((key) => {
    const cell = row.cells[key];
    if (cell.state === 'unavailable') return '<td class="cell-missing">不可用</td>';
    if (cell.state === 'missing') {
      return '<td><span class="cell-missing">缺值</span><span class="evidence">无数据，非零值</span></td>';
    }
    const zeroCls = cell.isZero ? ' cell-zero' : '';
    const caliberText = describeCaliber(key, cell.caliber, cmp.preferences);
    const col = cmp.columns[key];
    const ev = cell.evidence || {};
    return `<td${zeroCls ? ' class="cell-zero"' : ''}>
      ${cell.value}${cell.isZero ? ' <span class="evidence">(实测0)</span>' : ''}
      <span class="caliber-tag" title="${col.comparable ? '本列同口径' : '本列口径不一致，不参与排序'}">${escapeHtml(caliberText)}</span>
      <span class="evidence">证据：${escapeHtml(ev.source || '')}${ev.surveyedAt ? ' @' + ev.surveyedAt : ''}</span>
    </td>`;
  }).join('');

  return `<tr class="${row.status === 'withdrawn' ? 'row-withdrawn' : ''}">${firstCell}${cells}</tr>`;
}

// ---------------------------------------------------------------------------
// 新版本提示（不静默替换固定版本）
// ---------------------------------------------------------------------------
const alertedVersionKeys = new Set();
function handleVersionAlerts(cmp) {
  const alerts = [];
  for (const row of cmp.rows) {
    for (const a of row.alerts || []) {
      if (a.type !== 'newer_version') continue;
      const key = `${row.routeId}:${a.currentVersionId}:${a.latestVersionId || a.pinnedVersionId}`;
      if (alertedVersionKeys.has(key)) continue;
      alertedVersionKeys.add(key);
      alerts.push(`${row.name}：${a.message}`);
    }
  }
  if (alerts.length) {
    els.versionBanner.hidden = false;
    els.versionBanner.innerHTML = alerts.map(escapeHtml).join('<br>');
    toast('有路线发布了新公开版本：快照固定版本不会被自动替换，可手动更新。', 'info');
  } else if (!cmp.rows.some((r) => (r.alerts || []).some((a) => a.type === 'newer_version'))) {
    els.versionBanner.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// 导出：卡片/抽屉/报告共用同一个 comparison 对象
// ---------------------------------------------------------------------------
function exportReport() {
  if (!state.comparison) {
    toast('请先加入至少一条路线再导出。', 'warn');
    return;
  }
  const text = renderReportText(state.comparison);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `慢行站路线对比_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('对比报告已导出（参数、口径、证据与抽屉完全一致）。', 'info');
}

// ---------------------------------------------------------------------------
// 演示操作
// ---------------------------------------------------------------------------
async function runDemo(action) {
  const post = (p, body) => api(p, { method: 'POST', body });
  try {
    if (action === 'withdraw-r3') {
      await post('/api/test/route/withdraw', { routeId: 'r3', reason: '沿江步道施工，演示撤回' });
      toast('r3 已撤回：旧分享链接与集合中保留占位原因。', 'warn');
    } else if (action === 'restore-r3') {
      await post('/api/test/route/restore', { routeId: 'r3' });
      toast('r3 已恢复为已发布。', 'info');
    } else if (action === 'delete-r2') {
      await post('/api/test/route/delete', { routeId: 'r2', reason: '演示：路线被删除' });
      toast('r2 已删除：对比中保留占位，不以同名路线替代。', 'warn');
    } else if (action === 'newversion-r2') {
      await post('/api/test/route/publish-version', {
        routeId: 'r2', versionId: `r2-v${Date.now() % 100000}`, label: '演示新版本',
        changeNote: '演示：发布新公开版本'
      });
      toast('已为 r2 发布新版本：固定快照的对比只会出现更新提示。', 'info');
    } else if (action === 'reset') {
      await post('/api/test/reset', { clearAccounts: false });
      toast('演示数据已重置。', 'info');
    }
    await refreshAll();
  } catch (err) {
    toast(`演示操作失败：${err.message}`, 'error');
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

boot();
