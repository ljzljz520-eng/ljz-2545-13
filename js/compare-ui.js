// ======================
// 慢行站路线对比 UI
//
// 卡片、抽屉、导出对比报告共用同一个视图模型（buildViewModel），
// 保证三者采用同一组参数（取数政策/快照时点/固定版本）与证据（fetchedAt）。
// ======================

const CompareUI = (() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const els = {};
  let drawerOpen = false;

  // ---------- 工具 ----------
  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function metricCell(item, key) {
    if (!item.ok) return { value: null, caliber: null, caliberText: '' };
    const def = METRIC_DEFS.find(d => d.key === key);
    const m = item.version.metrics;
    const raw = key === 'duration' ? m.duration : key === 'shade' ? m.shade : null;
    return {
      value: def.valueOf(m),                       // null = 缺值；0 = 真实零值
      caliber: def.caliberOf(raw),
      caliberText: def.caliberText(raw)
    };
  }

  // ---------- 视图模型（卡片/抽屉/导出共用） ----------
  function buildViewModel() {
    const st = CompareStore.state;
    const comparison = st.comparison;
    if (!comparison) return null;

    const hiddenIds = computeHiddenRouteIds();

    // 列：数据列 + 占位列
    let columns = comparison.items.map((item, idx) => {
      const base = {
        item,
        idx,
        routeId: item.route ? item.route.id : item.routeId,
        name: item.route ? item.route.name : '未知路线',
        hiddenByFilter: item.route ? hiddenIds.has(item.route.id) : false,
        draft: (st.drafts[item.route ? item.route.id : item.routeId] || {}).text ||
               st.drafts[item.route ? item.route.id : item.routeId] || ''
      };
      if (!item.ok) {
        return Object.assign(base, { type: 'placeholder' });
      }
      const cells = {};
      METRIC_DEFS.forEach(def => { cells[def.key] = metricCell(item, def.key); });
      return Object.assign(base, { type: 'data', cells });
    });

    // 排序：仅同口径组内排序；缺值与占位列不参与，固定末尾
    let sortNote = null;
    const sort = st.sort;
    if (sort.metric) {
      const def = METRIC_DEFS.find(d => d.key === sort.metric);
      const dataCols = columns.filter(c => c.type === 'data');
      const placeholders = columns.filter(c => c.type !== 'data');
      const withVal = dataCols.filter(c => c.cells[sort.metric].value !== null);
      const missing = dataCols.filter(c => c.cells[sort.metric].value === null);

      // 按口径分组
      const groups = new Map();
      withVal.forEach(c => {
        const k = c.cells[sort.metric].caliber;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      });
      // 组内排序，组间按组内最优值排序
      const groupArr = Array.from(groups.entries()).map(([caliber, cols]) => {
        cols.sort((a, b) => (a.cells[sort.metric].value - b.cells[sort.metric].value) * sort.dir);
        cols.forEach((c, i) => { c.rank = i + 1; c.groupSize = cols.length; });
        return { caliber, cols, best: cols[0].cells[sort.metric].value };
      });
      groupArr.sort((a, b) => (a.best - b.best) * sort.dir);

      const multiCaliber = groupArr.length > 1;
      sortNote = {
        metricLabel: def.label,
        groups: groupArr.map(g => ({
          caliberText: g.cols[0].cells[sort.metric].caliberText || '统一口径',
          names: g.cols.map(c => c.name)
        })),
        multiCaliber,
        missingNames: missing.map(c => c.name)
      };
      columns = [].concat(...groupArr.map(g => g.cols), missing, placeholders);
    }

    return { evidence: comparison.evidence, columns, sortNote, policy: st.policy, snapshotAt: st.snapshotAt };
  }

  // 被当前筛选隐藏的路线 id 集合（过滤导致隐藏项：集合保留，仅列表隐藏）
  function computeHiddenRouteIds() {
    const st = CompareStore.state;
    const { tag, keyword } = st.filter;
    const kw = keyword.trim().toLowerCase();
    const hidden = new Set();
    st.routeIndex.forEach(r => {
      const tagOk = tag === 'all' || r.tags.includes(tag);
      const kwOk = !kw || (r.name + r.region + r.desc).toLowerCase().includes(kw);
      if (!tagOk || !kwOk) hidden.add(r.id);
    });
    return hidden;
  }

  // ---------- 路线卡片 ----------
  function renderCards() {
    const st = CompareStore.state;
    const grid = els.cardGrid;
    grid.innerHTML = '';
    st.routeIndex.forEach(route => {
      const v = route.latestVersion;
      const m = v.metrics;
      const selected = CompareStore.isSelected(route.id);
      const selItem = st.selection.find(s => s.routeId === route.id);
      const card = document.createElement('article');
      card.className = 'route-card';
      card.dataset.routeId = route.id;
      card.innerHTML = `
        <div class="route-card-head">
          <div>
            <h3>${esc(route.name)}</h3>
            <p class="route-region">📍 ${esc(route.region)}</p>
          </div>
          <span class="version-badge" title="当前最新公开版本">v${v.version}</span>
        </div>
        <p class="route-desc">${esc(route.desc)}</p>
        <div class="route-tags">${route.tagLabels.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <ul class="route-metrics">
          <li>📏 ${m.distanceKm == null ? '<i class="missing">暂无数据</i>' : m.distanceKm + ' km'}</li>
          <li>⏱️ ${m.duration ? m.duration.minutes + ' 分钟 <small>(' + esc(CALIBER_LABELS.transportMode[m.duration.transportMode]) + ')</small>' : '<i class="missing">暂无数据</i>'}</li>
          <li>🌳 ${m.shade ? m.shade.coveragePct + '% <small>(' + esc(CALIBER_LABELS.season[m.shade.season]) + ')</small>' : '<i class="missing">暂无数据</i>'}</li>
          <li>🥤 ${m.supplies ? m.supplies.count + ' 处' : '<i class="missing">暂无数据</i>'}</li>
          <li>⛰️ ${m.difficulty ? m.difficulty.level + '/5' : '<i class="missing">暂无数据</i>'}</li>
        </ul>
        <div class="route-card-foot">
          ${selected && selItem && selItem.version != null
            ? `<span class="pin-chip" title="对比集合中固定了公开版本">固定 v${selItem.version}</span>` : ''}
          <button class="cbtn ${selected ? 'cbtn-ghost' : 'cbtn-primary'}" data-act="${selected ? 'remove' : 'add'}" data-id="${route.id}">
            ${selected ? '✓ 已加入（点击移除）' : '＋ 加入对比'}
          </button>
        </div>`;
      grid.appendChild(card);
    });
    applyFilter();
  }

  function applyFilter() {
    const hidden = computeHiddenRouteIds();
    $$('.route-card').forEach(card => {
      card.style.display = hidden.has(card.dataset.routeId) ? 'none' : '';
    });
    renderCompareBar(); // 隐藏项提示随筛选变化
  }

  // ---------- 对比浮条 ----------
  function renderCompareBar() {
    const st = CompareStore.state;
    const n = st.selection.length;
    els.compareBar.classList.toggle('visible', n > 0);
    if (!n) return;
    const hidden = computeHiddenRouteIds();
    const hiddenCount = st.selection.filter(s => hidden.has(s.routeId)).length;
    els.compareCount.textContent = `已选 ${n}/${CompareStore.MAX_COMPARE} 项`;
    els.compareHidden.textContent = hiddenCount ? `⚠ ${hiddenCount} 项被当前筛选隐藏（仍在对比集合中）` : '';
  }

  // ---------- 抽屉 ----------
  function renderDrawer() {
    const vm = buildViewModel();
    if (!vm) {
      els.drawerBody.innerHTML = '<p class="drawer-empty">对比集合为空，请先在路线卡片上点击「加入对比」。</p>';
      renderEvidence(null);
      return;
    }
    renderEvidence(vm);

    const metricRows = METRIC_DEFS.map(def => {
      const sort = CompareStore.state.sort;
      const sortable = def.key;
      const sortMark = sort.metric === def.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '';
      return { def, sortMark, sortable };
    });

    let html = '<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr><th class="metric-head">指标</th>';
    vm.columns.forEach(col => { html += columnHeadHtml(col); });
    html += '</tr></thead><tbody>';

    metricRows.forEach(({ def, sortMark }) => {
      html += `<tr><th class="metric-head">
          <div class="metric-label">${def.label}</div>
          <button class="sort-btn" data-metric="${def.key}" title="仅在同口径组内排序；缺值与占位不参与">排序${sortMark}</button>
        </th>`;
      vm.columns.forEach(col => { html += cellHtml(col, def); });
      html += '</tr>';
    });

    // 草稿行（个人草稿仅经账号接口同步，不进 URL）
    html += `<tr><th class="metric-head"><div class="metric-label">我的备注</div><small class="metric-sub">草稿 · 仅账号同步</small></th>`;
    vm.columns.forEach(col => {
      if (col.type !== 'data') { html += '<td class="cell-placeholder">—</td>'; return; }
      html += `<td><input class="draft-input" data-id="${col.routeId}" placeholder="私人备注…" value="${esc(col.draft || '')}"></td>`;
    });
    html += '</tr></tbody></table></div>';

    // 排序分组说明（口径不同不直接比较）
    if (vm.sortNote) html += sortNoteHtml(vm.sortNote);

    // 占位说明（撤回/删除原因，不以同名路线替代）
    html += placeholderNotesHtml(vm);

    els.drawerBody.innerHTML = html;
    bindDrawerEvents();
  }

  function columnHeadHtml(col) {
    if (col.type === 'placeholder') {
      const item = col.item;
      const statusText = { withdrawn: '已撤回', deleted: '已删除', 'not-found': '不存在', 'version-missing': '版本缺失', 'no-public': '无公开版本', 'no-public-at-snapshot': '快照时点无公开版本' }[item.code] || '不可用';
      return `<th class="col-head col-placeholder">
        <div class="col-name">${esc(col.name)}</div>
        <span class="status-chip status-${item.code}">${statusText}</span>
        ${item.requestedVersion != null ? `<span class="version-chip">请求 v${item.requestedVersion}</span>` : ''}
        ${col.hiddenByFilter ? '<span class="hidden-chip">已被筛选隐藏</span>' : ''}
      </th>`;
    }
    const item = col.item;
    const versions = (ROUTE_DATA.versions[col.routeId] || []).filter(v => v.status === 'public');
    const options = [`<option value="">跟随政策</option>`]
      .concat(versions.map(v => `<option value="${v.version}" ${item.pinned && item.version.version === v.version ? 'selected' : ''}>固定 v${v.version}</option>`))
      .join('');
    return `<th class="col-head">
      <div class="col-name">${esc(col.name)}</div>
      <div class="col-badges">
        <span class="version-chip" title="本次取数采用的公开版本">v${item.version.version}</span>
        ${item.pinned ? '<span class="pin-chip">已固定</span>' : '<span class="policy-chip">跟随政策</span>'}
        ${item.hasNewer ? `<button class="newver-chip" data-act="upgrade" data-id="${col.routeId}" data-ver="${item.latestVersionNo}" title="已有更新的公开版本">🔔 有新版本 v${item.latestVersionNo}</button>` : ''}
        ${col.hiddenByFilter ? '<span class="hidden-chip">已被筛选隐藏</span>' : ''}
      </div>
      <select class="version-select" data-id="${col.routeId}" title="固定公开版本（比较 API 固定该版本取数）">${options}</select>
      <button class="col-remove" data-act="remove" data-id="${col.routeId}" title="从对比集合移除">✕</button>
    </th>`;
  }

  function cellHtml(col, def) {
    if (col.type === 'placeholder') {
      return `<td class="cell-placeholder" title="${esc(col.item.reason)}">—</td>`;
    }
    const cell = col.cells[def.key];
    if (cell.value === null) {
      // 缺值：与真实零值严格区分
      return `<td class="cell-missing" title="缺值：尚未调查或未发布，不参与排序">暂无数据</td>`;
    }
    const rank = (CompareStore.state.sort.metric === def.key && col.rank)
      ? `<span class="rank-chip" title="同口径组内排名（共 ${col.groupSize} 项）">第${col.rank}</span>` : '';
    const zero = cell.value === 0 ? '<span class="zero-chip" title="真实零值，非缺值">0</span>' : '';
    const caliber = cell.caliberText ? `<small class="caliber">${esc(cell.caliberText)}</small>` : '';
    return `<td>${zero || cell.value + ' ' + def.unit}${rank}${caliber}</td>`;
  }

  function sortNoteHtml(note) {
    const groups = note.groups.map((g, i) =>
      `<li>口径 ${String.fromCharCode(65 + i)}（${esc(g.caliberText)}）：${g.names.map(esc).join('、')}</li>`).join('');
    return `<div class="sort-note">
      <strong>${esc(note.metricLabel)}排序说明：</strong>
      <ul>${groups}</ul>
      ${note.multiCaliber ? '<p class="warn">⚠ 以上口径不同，排名仅在同一口径组内有效，跨组不直接比较。</p>' : '<p>所有数据列口径一致，可直接比较。</p>'}
      ${note.missingNames.length ? `<p>缺值不参与排序：${note.missingNames.map(esc).join('、')}</p>` : ''}
    </div>`;
  }

  // 占位说明（撤回/删除原因，绝不以同名路线替代）
  function placeholderNotesHtml(vm) {
    const notes = vm.columns.filter(c => c.type === 'placeholder').map(c => {
      const sameName = CompareStore.state.routeIndex.find(r => r.name === c.name && r.id !== c.routeId);
      return `<li><strong>${esc(c.name)}</strong>（${c.routeId}${c.item.requestedVersion != null ? `，请求 v${c.item.requestedVersion}` : ''}）：${esc(c.item.reason)}。
        已保留占位${sameName ? `；存在同名路线「${esc(sameName.name)}」（${sameName.id}），但不会自动替代` : ''}。</li>`;
    });
    return notes.length ? `<div class="placeholder-note"><strong>占位说明：</strong><ul>${notes}</ul></div>` : '';
  }

  function renderEvidence(vm) {
    if (!vm) { els.evidence.innerHTML = ''; return; }
    const e = vm.evidence;
    els.evidence.innerHTML = `
      <span>取数政策：<strong>${e.policy === 'snapshot' ? '同一时点快照' : '各取最新'}</strong></span>
      ${e.policy === 'snapshot' ? `<span>快照时点：${fmtTime(e.snapshotAt)}</span>` : ''}
      <span>取数时间：${fmtTime(e.fetchedAt)}</span>`;
  }

  // ---------- 导出对比报告（与抽屉同一视图模型/同一证据） ----------
  function exportReport() {
    const vm = buildViewModel();
    if (!vm) { showToast('对比集合为空，无法导出', 'warning'); return; }
    const e = vm.evidence;
    const L = [];
    L.push('# 慢行站路线对比报告');
    L.push('');
    L.push(`- 生成时间：${fmtTime(new Date().toISOString())}`);
    L.push(`- 取数政策：${e.policy === 'snapshot' ? `同一时点快照（快照时点 ${fmtTime(e.snapshotAt)}）` : '各取最新'}`);
    L.push(`- 数据获取时间（证据）：${fmtTime(e.fetchedAt)}`);
    L.push(`- 对比参数：${vm.columns.map(c => c.item.ok
      ? `${c.routeId}@${c.item.version.version}${c.item.pinned ? '（固定）' : '（跟随政策）'}`
      : `${c.routeId}${c.item.requestedVersion != null ? '@' + c.item.requestedVersion : ''}（占位）`).join('、')}`);
    L.push('');
    L.push('## 对比表');
    L.push('');
    L.push('| 指标 | ' + vm.columns.map(c => `${c.name}${c.type === 'data' ? ' v' + c.item.version.version : '（占位）'}`).join(' | ') + ' |');
    L.push('|---' + '|---'.repeat(vm.columns.length) + '|');
    METRIC_DEFS.forEach(def => {
      const cells = vm.columns.map(col => {
        if (col.type !== 'data') return '—';
        const cell = col.cells[def.key];
        if (cell.value === null) return '暂无数据（缺值）';
        const v = cell.value === 0 ? `0 ${def.unit}（真实零值）` : `${cell.value} ${def.unit}`;
        return cell.caliberText ? `${v}（${cell.caliberText}）` : v;
      });
      L.push(`| ${def.label} | ${cells.join(' | ')} |`);
    });
    if (vm.columns.some(c => c.draft)) {
      L.push(`| 我的备注 | ${vm.columns.map(c => c.type === 'data' ? (c.draft || '—') : '—').join(' | ')} |`);
    }
    L.push('');

    const placeholders = vm.columns.filter(c => c.type !== 'data');
    if (placeholders.length) {
      L.push('## 占位说明');
      placeholders.forEach(c => {
        L.push(`- ${c.name}（${c.routeId}）：${c.item.reason}。保留占位，未以其他同名路线替代。`);
      });
      L.push('');
    }

    L.push('## 口径与可比性说明');
    L.push('- 时长口径＝交通方式 × 估算模型；树荫覆盖口径＝季节 × 采样方法。口径不同的数值不直接排序比较。');
    METRIC_DEFS.forEach(def => {
      const calibers = new Map();
      vm.columns.forEach(col => {
        if (col.type !== 'data') return;
        const cell = col.cells[def.key];
        if (cell.value === null) return;
        const k = cell.caliberText || '统一口径';
        if (!calibers.has(k)) calibers.set(k, []);
        calibers.get(k).push(col.name);
      });
      if (calibers.size > 1) {
        L.push(`- ${def.label}存在 ${calibers.size} 种口径：` +
          Array.from(calibers.entries()).map(([k, names]) => `${k}（${names.join('、')}）`).join('；') + '，跨口径不可直接排序。');
      }
    });
    L.push('- 缺值（暂无数据）与真实零值（0）严格区分：缺值不参与排序，零值正常参与。');
    L.push('');
    L.push('## 版本证据');
    vm.columns.forEach(c => {
      if (c.type !== 'data') return;
      const it = c.item;
      L.push(`- ${c.name}（${c.routeId}）：采用 v${it.version.version}（发布于 ${fmtTime(it.version.publishedAt)}）` +
        (it.hasNewer ? `；当前最新公开版本 v${it.latestVersionNo}（本报告未采用）` : '；即为当前最新公开版本'));
    });

    const blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `慢行站路线对比报告_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('📄 对比报告已导出（与抽屉同一组参数与证据）', 'success');
  }

  // ---------- 分享（URL 仅编码公开选择） ----------
  function shareLink() {
    const url = location.href;
    const done = () => showToast('🔗 分享链接已复制（仅含公开选择，不含个人草稿）', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => prompt('复制分享链接：', url));
    } else {
      prompt('复制分享链接：', url);
    }
  }

  // ---------- 抽屉事件 ----------
  function bindDrawerEvents() {
    $$('.sort-btn').forEach(btn => btn.addEventListener('click', () => {
      const metric = btn.dataset.metric;
      const sort = CompareStore.state.sort;
      if (sort.metric !== metric) CompareStore.state.sort = { metric, dir: 1 };
      else if (sort.dir === 1) CompareStore.state.sort = { metric, dir: -1 };
      else CompareStore.state.sort = { metric: null, dir: 1 };
      renderDrawer();
    }));
    $$('.version-select').forEach(sel => sel.addEventListener('change', () => {
      const id = sel.dataset.id;
      if (sel.value === '') CompareStore.unpin(id);
      else CompareStore.pinVersion(id, parseInt(sel.value, 10));
    }));
    $$('.col-remove').forEach(btn => btn.addEventListener('click', () => CompareStore.remove(btn.dataset.id)));
    $$('.newver-chip').forEach(btn => btn.addEventListener('click', () =>
      CompareStore.pinVersion(btn.dataset.id, parseInt(btn.dataset.ver, 10))));
    $$('.draft-input').forEach(input => input.addEventListener('change', () =>
      CompareStore.saveDraft(input.dataset.id, input.value.trim())));
  }

  // ---------- 演示控制台 ----------
  function bindDemoConsole() {
    $('#demoWithdraw').addEventListener('click', async () => {
      if (CompareAPI.DemoTools.withdrawVersion('r001', 3, '演示：发现里程数据错误，发布方撤回')) {
        showToast('⚠️ 服务端：滨江绿道 v3 已被撤回（模拟）', 'warning');
        CompareStore.state.routeIndex = await CompareAPI.fetchRouteIndex();
        renderCards();
        await CompareStore.refresh();
      } else showToast('v3 当前不是公开状态', 'info');
    });
    $('#demoRepublish').addEventListener('click', async () => {
      if (CompareAPI.DemoTools.republishVersion('r001', 3)) {
        showToast('✅ 服务端：滨江绿道 v3 已重新公开（模拟）', 'success');
        CompareStore.state.routeIndex = await CompareAPI.fetchRouteIndex();
        renderCards();
        await CompareStore.refresh();
      } else showToast('v3 当前不是撤回状态', 'info');
    });
    $('#demoPublish').addEventListener('click', async () => {
      const v = CompareAPI.DemoTools.publishNewVersion('r003', m => { m.supplies.count += 1; });
      if (v) {
        showToast(`🆕 服务端：湖畔骑行道发布 v${v}（模拟）——固定旧版本的列将出现新版本提示`, 'info');
        CompareStore.state.routeIndex = await CompareAPI.fetchRouteIndex();
        renderCards();
        await CompareStore.refresh();
      }
    });
    $('#demoRemote').addEventListener('click', () => {
      // 模拟另一设备修改集合：写入"服务端"并走与 storage 事件相同的处理路径
      const items = CompareStore.state.selection.map(s => ({ routeId: s.routeId, version: s.version }));
      if (items.length > 1) items.shift();
      else if (!items.some(i => i.routeId === 'r008')) items.push({ routeId: 'r008', version: null });
      const payload = { items, savedAt: new Date().toISOString() };
      localStorage.setItem('mxz.server.selection', JSON.stringify(payload));
      CompareStore.applyRemoteSelection(payload, '另一设备（模拟）');
    });
  }

  // ---------- 初始化 ----------
  function init() {
    ['cardGrid', 'compareBar', 'compareCount', 'compareHidden', 'drawer', 'drawerBody',
      'evidence', 'overlay', 'filterBtns', 'searchInput'].forEach(id => { els[id] = $('#' + id); });

    // 卡片事件（事件委托）
    els.cardGrid.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'add') CompareStore.add(btn.dataset.id);
      else if (btn.dataset.act === 'remove') CompareStore.remove(btn.dataset.id);
    });

    // 筛选（过滤导致隐藏项：集合保留，仅列表隐藏）
    els.filterBtns.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      $$('#filterBtns .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CompareStore.state.filter.tag = btn.dataset.tag;
      applyFilter();
    });
    els.searchInput.addEventListener('input', () => {
      CompareStore.state.filter.keyword = els.searchInput.value;
      applyFilter();
    });

    // 对比条与抽屉
    $('#openDrawer').addEventListener('click', () => setDrawer(true));
    $('#clearCompare').addEventListener('click', () => CompareStore.clear());
    $('#closeDrawer').addEventListener('click', () => setDrawer(false));
    els.overlay.addEventListener('click', () => setDrawer(false));

    // 工具条
    $$('input[name="policy"]').forEach(r => r.addEventListener('change', () => CompareStore.setPolicy(r.value)));
    $('#refreshSnapshot').addEventListener('click', () => CompareStore.refreshSnapshot());
    $('#shareBtn').addEventListener('click', shareLink);
    $('#exportBtn').addEventListener('click', exportReport);
    $('#saveBtn').addEventListener('click', async () => {
      await CompareStore.saveSelection();
      showToast('💾 对比集合已保存到账号', 'success');
    });

    bindDemoConsole();

    // Store 事件
    CompareStore.on('index', renderCards);
    CompareStore.on('comparison', () => { renderCompareBar(); renderDrawer(); renderCards(); });
    CompareStore.on('toast', t => showToast(t.message, t.type, 4500));
    CompareStore.on('loading', on => { document.body.classList.toggle('cmp-loading', on); });

    CompareStore.init().then(() => {
      // 恢复政策开关 UI
      const p = CompareStore.state.policy;
      $$('input[name="policy"]').forEach(r => { r.checked = r.value === p; });
      $('#snapshotTools').style.display = p === 'snapshot' ? '' : 'none';
      $$('input[name="policy"]').forEach(r => r.addEventListener('change', () => {
        $('#snapshotTools').style.display = CompareStore.state.policy === 'snapshot' ? '' : 'none';
      }));
    });
  }

  function setDrawer(open) {
    drawerOpen = open;
    els.drawer.classList.toggle('open', open);
    els.overlay.classList.toggle('visible', open);
    if (open) renderDrawer();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { buildViewModel };
})();
