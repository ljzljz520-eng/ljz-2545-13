/**
 * 慢行站路线对比 —— 共享核心（纯逻辑，无 DOM / Node 依赖）
 * 服务端 API 与浏览器前端都使用本模块，保证“同一组参数、同一组证据”。
 */

// ---------------------------------------------------------------------------
// 指标列定义
// ---------------------------------------------------------------------------
export const METRICS = {
  distance: {
    key: 'distance',
    label: '距离',
    unit: 'km',
    // 口径键：相同口径之间才允许排序/对比
    caliberOf: (m) => m && m.caliber,
    // 缺值与零值分开：missing = 无数据(null/undefined)，zero = 明确测量为 0
    numeric: true,
    comparableOnly: true
  },
  duration: {
    key: 'duration',
    label: '时长',
    unit: 'min',
    // 时长口径 = 交通方式 + 估算模型，不同模型不可直接排序
    caliberOf: (m, ctx) => {
      if (!m) return null;
      return `${m.transport || ctx.transport}|${m.model || 'unknown'}`;
    },
    numeric: true,
    comparableOnly: true
  },
  shade: {
    key: 'shade',
    label: '树荫覆盖率',
    unit: '%',
    // 树荫口径 = 季节 + 采样方法，跨季节/跨采样方法不可直接排序
    caliberOf: (m, ctx) => {
      if (!m) return null;
      return `${m.season || ctx.season}|${m.method}`;
    },
    numeric: true,
    comparableOnly: true
  },
  supplies: {
    key: 'supplies',
    label: '补给点',
    unit: '处',
    // 补给口径 = 清查来源
    caliberOf: (m) => m && m.caliber,
    numeric: true,
    comparableOnly: true
  },
  difficulty: {
    key: 'difficulty',
    label: '难度',
    unit: '级',
    // 难度口径 = 评级量表 id，不同量表不可直接排序（数值越大代表的含义不同）
    caliberOf: (m) => m && m.scale,
    numeric: true,
    comparableOnly: true
  }
};

export const METRIC_KEYS = Object.keys(METRICS);

export const TRANSPORT_LABELS = {
  walk: '步行',
  bike: '骑行'
};

export const SEASON_LABELS = {
  summer: '夏季（盛叶）',
  winter: '冬季（落叶）'
};

// 口径人类可读说明（用于页面对比说明与导出报告）
export function describeCaliber(metricKey, caliber, ctx) {
  switch (metricKey) {
    case 'distance':
      return caliber === 'official-signage' ? '官方路牌里程' :
             caliber === 'gps-survey' ? 'GPS 实测里程' : caliber || '未知口径';
    case 'duration': {
      const [transport, model] = String(caliber).split('|');
      return `${TRANSPORT_LABELS[transport] || transport} · ${
        model === 'planner-v1' ? '路径规划模型 v1' :
        model === 'planner-v2' ? '路径规划模型 v2' :
        model === 'survey-avg' ? '实地采样均值' : model
      }`;
    }
    case 'shade': {
      const [season, method] = String(caliber).split('|');
      return `${SEASON_LABELS[season] || season} · ${
        method === 'sample-points' ? '采样点法' :
        method === 'canopy-imagery' ? '冠层影像法' : method
      }`;
    }
    case 'supplies':
      return caliber === 'official-inventory' ? '官方设施清查' :
             caliber === 'osm-poi' ? '地图兴趣点统计' : caliber || '未知口径';
    case 'difficulty':
      return caliber === 'citilvl-3' ? '城市慢行三级量表' :
             caliber === 'citilvl-5' ? '城市慢行五级量表' : caliber || '未知量表';
    default:
      return caliber || '';
  }
}

// ---------------------------------------------------------------------------
// 占位原因（路线被删除或撤回：保留占位 + 原因，绝不以同名路线替代）
// ---------------------------------------------------------------------------
export const PLACEHOLDER_REASONS = {
  route_deleted: '路线已删除（占位保留，不可以同名路线替代）',
  route_withdrawn: '路线已撤回（暂时不可用，占位保留）',
  version_missing: '所固定的公开版本不存在（链接可能已失效）',
  version_no_metric: '该版本缺少所选条件下的数据（缺值，非零值）',
  metric_unknown: '该指标无数据（缺值，非零值）'
};

// ---------------------------------------------------------------------------
// 版本选择：固定公开版本（snapshot）vs 各取最新（latest）
// 输入 route: { id, name, status, withdrawnReason, versions: [...] }
// pin:  { routeId, versionId } | null
// ---------------------------------------------------------------------------
export function resolveRoute(route, pin, asOf, policy, ctx) {
  asOf = asOf || null;

  // 1) 路线已删除：永远是占位，即使链接里固定了版本
  if (route.status === 'deleted') {
    return {
      routeId: route.id,
      name: route.name,
      kind: 'placeholder',
      reasonCode: 'route_deleted',
      reason: PLACEHOLDER_REASONS.route_deleted + (route.deletedReason ? `：${route.deletedReason}` : ''),
      pin, policy, asOf,
      resolvedVersion: null,
      cells: placeholderCells()
    };
  }

  const versions = [...(route.versions || [])].sort(
    (a, b) => new Date(a.publishedAt) - new Date(b.publishedAt)
  );
  const latest = versions[versions.length - 1] || null;

  // 2) 固定公开版本（跨路线同一时点快照）
  if (policy === 'snapshot') {
    const v = pin && versions.find((x) => x.versionId === pin.versionId);
    if (!v) {
      return {
        routeId: route.id,
        name: route.name,
        kind: 'placeholder',
        reasonCode: 'version_missing',
        reason: PLACEHOLDER_REASONS.version_missing,
        pin, policy, asOf,
        resolvedVersion: null,
        cells: placeholderCells()
      };
    }
    const alerts = [];
    if (latest && v.versionId !== latest.versionId) {
      alerts.push({
        type: 'newer_version',
        level: 'info',
        message: `存在更新的公开版本 ${latest.versionId}（${latest.label || ''}），当前对比仍固定在 ${v.versionId}（${v.label || ''}）。切换到“各取最新”或手动固定新版本后生效。`,
        currentVersionId: v.versionId,
        latestVersionId: latest.versionId
      });
    }
    return {
      routeId: route.id,
      name: route.name,
      kind: 'data',
      status: route.status,
      withdrawnReason: route.status === 'withdrawn' ? route.withdrawnReason : null,
      pin, policy, asOf,
      resolvedVersion: publicVersion(v),
      latestVersionId: latest ? latest.versionId : null,
      alerts,
      cells: buildCells(v, ctx)
    };
  }

  // 3) 各取最新：按 publishedAt 取最新（无 asOf 时点概念）
  if (!latest) {
    return {
      routeId: route.id,
      name: route.name,
      kind: 'placeholder',
      reasonCode: 'version_missing',
      reason: PLACEHOLDER_REASONS.version_missing,
      pin, policy, asOf,
      resolvedVersion: null,
      cells: placeholderCells()
    };
  }
  const alerts = [];
  if (pin && pin.versionId && pin.versionId !== latest.versionId) {
    alerts.push({
      type: 'newer_version',
      level: 'info',
      message: `已按“各取最新”采用 ${latest.versionId}（${latest.label || ''}）；链接原固定版本 ${pin.versionId} 未用于本次取数。`,
      currentVersionId: latest.versionId,
      pinnedVersionId: pin.versionId
    });
  }
  return {
    routeId: route.id,
    name: route.name,
    kind: 'data',
    status: route.status,
    withdrawnReason: route.status === 'withdrawn' ? route.withdrawnReason : null,
    pin, policy, asOf,
    resolvedVersion: publicVersion(latest),
    latestVersionId: latest.versionId,
    alerts,
    cells: buildCells(latest, ctx)
  };
}

function publicVersion(v) {
  // 比较 API 只暴露“公开版本”的固定字段
  return {
    versionId: v.versionId,
    label: v.label || '',
    publishedAt: v.publishedAt,
    dataAsOf: v.dataAsOf || null,
    changeNote: v.changeNote || ''
  };
}

function placeholderCells() {
  const cells = {};
  for (const key of METRIC_KEYS) {
    cells[key] = { state: 'unavailable', value: null, caliber: null, evidence: null };
  }
  return cells;
}

// ---------------------------------------------------------------------------
// 从一个版本构造各指标单元格
// 状态：ok（含明确的零值 zero）/ missing（缺值，无数据）/ unavailable（占位行）
// ---------------------------------------------------------------------------
export function buildCells(version, ctx) {
  const cells = {};
  for (const key of METRIC_KEYS) {
    cells[key] = buildCell(key, version, ctx);
  }
  return cells;
}

export function buildCell(metricKey, version, ctx = {}) {
  const bag = metricBag(metricKey, version, ctx);
  if (!bag) {
    return {
      state: 'missing',
      value: null,
      caliber: null,
      evidence: {
        source: 'absence',
        reason: metricKey === 'duration'
          ? `该版本无“${TRANSPORT_LABELS[ctx.transport] || ctx.transport}”时长数据（缺值，非零值）`
          : PLACEHOLDER_REASONS.metric_unknown
      }
    };
  }
  const def = METRICS[metricKey];
  const value = bag.value;
  const caliber = def.caliberOf(bag, ctx);

  if (value === null || value === undefined) {
    // 有口径记录但未测得：缺值
    return {
      state: 'missing',
      value: null,
      caliber,
      evidence: bag.evidence || { source: version.versionId, note: '记录存在但数值缺失' }
    };
  }

  return {
    // 关键：数值 0 是明确测量结果（如 0 处补给点），与 missing 严格区分
    state: 'ok',
    isZero: Number(value) === 0,
    value: Number(value),
    caliber,
    evidence: bag.evidence || { source: version.versionId }
  };
}

function metricBag(metricKey, version, ctx) {
  const m = version.metrics || {};
  switch (metricKey) {
    case 'distance':
      return m.distance || null;
    case 'difficulty':
      return m.difficulty || null;
    case 'supplies':
      return m.supplies || null;
    case 'duration': {
      const byTransport = m.durationByTransport || {};
      return byTransport[ctx.transport] || null;
    }
    case 'shade': {
      const bySeason = m.shadeBySeason || {};
      return bySeason[ctx.season] || null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 完整对比：rows + 列口径 + 列是否可整体排序
// ---------------------------------------------------------------------------
export function buildComparison(db, { routeIds, pins = {}, policy = 'latest', asOf = null, transport, season }) {
  const ctx = { transport, season };
  const rows = [];
  const globalAlerts = [];

  for (const routeId of routeIds) {
    const route = db.routes[routeId];
    // 未知 id / 已被删除：保留占位，绝不以同名路线“补位”
    if (!route) {
      rows.push({
        routeId,
        name: routeId,
        kind: 'placeholder',
        reasonCode: 'route_deleted',
        reason: PLACEHOLDER_REASONS.route_deleted,
        pin: pins[routeId] || null, policy, asOf,
        resolvedVersion: null,
        cells: placeholderCells()
      });
      continue;
    }
    const row = resolveRoute(route, pins[routeId] || null, asOf, policy, ctx);
    rows.push(row);
  }

  const columns = {};
  for (const key of METRIC_KEYS) {
    const def = METRICS[key];
    const activeRows = rows.filter((r) => r.kind === 'data');
    const calibers = new Set();
    let okCount = 0;
    let zeroCount = 0;
    let missingCount = 0;
    for (const r of activeRows) {
      const cell = r.cells[key];
      if (cell.state === 'ok') {
        calibers.add(cell.caliber);
        okCount += 1;
        if (cell.isZero) zeroCount += 1;
      } else if (cell.state === 'missing') {
        missingCount += 1;
      }
    }
    // 只有“同口径且至少 2 个数值”才允许排序/排名；不同口径字段不得直接排序
    const comparable = calibers.size === 1 && okCount >= 2;
    columns[key] = {
      key,
      label: def.label,
      unit: def.unit,
      comparable,
      caliberCount: calibers.size,
      calibers: [...calibers],
      caliberDescriptions: [...calibers].map((c) => describeCaliber(key, c, ctx)),
      okCount,
      zeroCount,
      missingCount,
      sortNote: comparable
        ? null
        : (calibers.size > 1
            ? `本列存在 ${calibers.size} 种不同口径，禁止直接排序；请统一取数政策后再比较。`
            : (okCount < 2 ? '同口径数值不足 2 条，无法排序。' : '本列暂不可排序。'))
    };
  }

  const dataPolicy = {
    policy,
    asOf,
    transport,
    season,
    description: policy === 'snapshot'
      ? `跨路线同一时点快照：各路线固定为链接指定的公开版本（时点 ${asOf || '未记录'}）；存在新版本时只提示、不静默替换。`
      : '各取最新：每条路线采用其当前最新公开版本；不同路线的发布时点可能不同，跨版本比较请留意。'
  };

  return {
    generatedAt: new Date().toISOString(),
    dataPolicy,
    preferences: { transport, season },
    columns,
    rows,
    globalAlerts
  };
}

// 排序辅助：仅 comparable 列可用；missing / zero 语义分离，missing 不参与数值排序
export function comparableSort(rows, metricKey, columns, direction = 'asc') {
  const col = columns[metricKey];
  if (!col || !col.comparable) {
    throw new Error(`指标 ${metricKey} 当前口径不一致或数据不足，不可直接排序`);
  }
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ca = a.cells[metricKey];
    const cb = b.cells[metricKey];
    const aOk = ca.state === 'ok';
    const bOk = cb.state === 'ok';
    if (aOk && !bOk) return -1; // 有数值的排前（零值也是数值）
    if (!aOk && bOk) return 1;
    if (!aOk && !bOk) {
      // 占位行排在缺值之后；缺值排最后段
      const rank = (r) => (r.kind === 'placeholder' ? 2 : 1);
      return rank(a) - rank(b);
    }
    if (ca.value === cb.value) return 0;
    return ca.value < cb.value ? -1 * sign : 1 * sign;
  });
}

// ---------------------------------------------------------------------------
// 版本卡片列表（左侧卡片用，附每版本口径概要）
// ---------------------------------------------------------------------------
export function listRouteCards(db, { transport, season }) {
  const ctx = { transport, season };
  return Object.values(db.routes).map((route) => {
    const versions = [...(route.versions || [])].sort(
      (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
    );
    const latest = versions[0] || null;
    return {
      routeId: route.id,
      name: route.name,
      status: route.status, // published | withdrawn | deleted
      withdrawnReason: route.withdrawnReason || null,
      deletedReason: route.deletedReason || null,
      latestVersionId: latest ? latest.versionId : null,
      versions: versions.map((v) => ({
        ...publicVersion(v),
        cells: buildCells(v, ctx)
      }))
    };
  });
}

// ---------------------------------------------------------------------------
// 跨设备集合合并（3-way merge）
// 两设备改集合：base(共同祖先) + localAdd/localRemove + remoteAdd/remoteRemove
// 同一集合项的增删同时发生时：删除优先（tombstone 优先），结果稳定可预测
// ---------------------------------------------------------------------------
export function mergeSelection(baseIds, localChange, remoteChange) {
  const base = new Set(baseIds || []);
  const localAdd = new Set((localChange && localChange.added) || []);
  const localRemove = new Set((localChange && localChange.removed) || []);
  const remoteAdd = new Set((remoteChange && remoteChange.added) || []);
  const remoteRemove = new Set((remoteChange && remoteChange.removed) || []);

  // 双方各自基于祖先的最终集合
  const localSet = new Set(base);
  for (const id of localAdd) localSet.add(id);
  for (const id of localRemove) localSet.delete(id);
  const remoteSet = new Set(base);
  for (const id of remoteAdd) remoteSet.add(id);
  for (const id of remoteRemove) remoteSet.delete(id);

  // 先取并集，再统一应用“删除优先”：任何一方明确删除即删除，
  // 包括“一方新增、另一方删除”的并发竞争，结果稳定可预测。
  const merged = new Set([...localSet, ...remoteSet]);
  for (const id of [...localRemove, ...remoteRemove]) merged.delete(id);
  return [...merged];
}

// 服务端修订合并：基于服务端当前 current、客户端祖先 base、客户端增删
export function mergeIntoCurrent(currentIds, baseIds, clientChange) {
  const current = new Set(currentIds || []);
  const base = new Set(baseIds || []);
  const added = new Set((clientChange && clientChange.added) || []);
  const removed = new Set((clientChange && clientChange.removed) || []);

  // 其他设备相对祖先已删除的项
  const remoteRemoved = new Set([...base].filter((id) => !current.has(id)));

  const merged = new Set(current);
  for (const id of added) {
    // 另一设备已删除：删除优先，不重新加入
    if (!remoteRemoved.has(id)) merged.add(id);
  }
  for (const id of removed) {
    // 删除优先，即使另一设备并发新增也删除
    merged.delete(id);
  }
  return [...merged];
}

// ---------------------------------------------------------------------------
// URL 仅编码“公开选择”；个人草稿（偏好以外的 UI 状态/过滤器）经账号接口同步
// 公开参数：pins（路线->公开版本）、policy、asOf、transport、season
// 不含：过滤器、排序、抽屉开合、账号、修订号
// ---------------------------------------------------------------------------
export function encodePublicHash({ collection = [], pins, policy, asOf, transport, season }) {
  const params = new URLSearchParams();
  const pinMap = {};
  for (const rid of collection || []) {
    pinMap[rid] = policy === 'snapshot' && pins[rid]?.versionId
      ? pins[rid].versionId
      : ''; // latest：分享路线集合但不固定版本（各取最新）
  }
  const entries = Object.entries(pinMap).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length) {
    params.set('routes', entries.map(([rid, vid]) => (vid ? `${rid}:${vid}` : rid)).join(','));
  }
  if (policy) params.set('policy', policy);
  if (asOf) params.set('asOf', asOf);
  if (transport) params.set('transport', transport);
  if (season) params.set('season', season);
  const qs = params.toString();
  return qs ? `#/compare?${qs}` : '#/compare';
}

export function decodePublicHash(hash) {
  try {
    if (!hash || !hash.startsWith('#/compare')) return null;
    const qIndex = hash.indexOf('?');
    const params = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : '');
    const pins = {};
    const routeIds = [];
    const raw = params.get('routes');
    if (raw) {
      for (const part of raw.split(',')) {
        const [rid, vid] = part.split(':');
        if (!rid) continue;
        routeIds.push(rid);
        if (vid) pins[rid] = { routeId: rid, versionId: vid };
      }
    }
    return {
      routeIds,
      pins,
      policy: params.get('policy') === 'snapshot' ? 'snapshot' : 'latest',
      asOf: params.get('asOf') || null,
      transport: params.get('transport') || null,
      season: params.get('season') || null
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 导出文本对比报告 —— 与卡片、抽屉使用同一个 comparison 对象（同参数同证据）
// ---------------------------------------------------------------------------
export function renderReportText(comparison) {
  const lines = [];
  lines.push('慢行站 · 路线对比报告');
  lines.push('='.repeat(44));
  lines.push(`生成时间：${comparison.generatedAt}`);
  const dp = comparison.dataPolicy;
  lines.push(`交通方式：${TRANSPORT_LABELS[dp.transport] || dp.transport}`);
  lines.push(`树荫季节：${SEASON_LABELS[dp.season] || dp.season}`);
  lines.push(`取数政策：${dp.description}`);
  lines.push('');

  // 取数列所用口径
  lines.push('— 指标口径与可比性 —');
  for (const key of METRIC_KEYS) {
    const col = comparison.columns[key];
    const cal = col.caliberDescriptions.length
      ? col.caliberDescriptions.join('；')
      : '无可用数值口径';
    lines.push(
      `· ${col.label}（${col.unit}）：${cal} | ${
        col.comparable
          ? '口径一致，可排序'
          : `不可直接排序（${col.sortNote}）`
      } | 数值 ${col.okCount} 条（含零值 ${col.zeroCount}），缺值 ${col.missingCount} 条`
    );
  }
  lines.push('');

  lines.push('— 逐条路线证据 —');
  comparison.rows.forEach((row, i) => {
    lines.push('');
    lines.push(`[${i + 1}] ${row.name}（${row.routeId}）`);
    if (row.kind === 'placeholder') {
      lines.push(`    占位：${row.reason}`);
      return;
    }
    lines.push(`    版本：${row.resolvedVersion.versionId}（${row.resolvedVersion.label}）`);
    lines.push(`    发布：${row.resolvedVersion.publishedAt}　取数政策：${row.policy}`);
    if (row.status === 'withdrawn') {
      lines.push(`    ⚠ 路线已撤回：${row.withdrawnReason}（历史版本冻结展示，不参与新的固定）`);
    }
    for (const key of METRIC_KEYS) {
      const col = comparison.columns[key];
      const cell = row.cells[key];
      const def = METRICS[key];
      let text;
      if (cell.state === 'unavailable') text = '不可用（占位）';
      else if (cell.state === 'missing') text = '缺值（无数据，非零值）';
      else text = `${cell.value} ${def.unit}${cell.isZero ? '（明确零值）' : ''}`;
      const ev = cell.evidence || {};
      lines.push(
        `    · ${def.label}：${text}｜口径：${
          cell.caliber ? describeCaliber(key, cell.caliber, comparison.preferences) : '—'
        }｜证据：${ev.source || '—'}${ev.surveyedAt ? ` @${ev.surveyedAt}` : ''}${
          ev.note ? `（${ev.note}）` : ''
        }`
      );
      if (!col.comparable && cell.state === 'ok') {
        lines.push(`      └ 说明：该指标与对比中其他路线口径不同，不参与排序。`);
      }
    }
    for (const a of row.alerts || []) {
      lines.push(`    提示：${a.message}`);
    }
  });

  lines.push('');
  lines.push('— 不可比项声明 —');
  const incomparable = METRIC_KEYS.filter((k) => !comparison.columns[k].comparable);
  if (!incomparable.length) {
    lines.push('本次对比全部指标口径一致。');
  } else {
    for (const key of incomparable) {
      lines.push(`· ${METRICS[key].label}：${comparison.columns[key].sortNote}`);
    }
  }
  lines.push('');
  lines.push('注：缺值（无数据）与零值（实测为 0）严格区分；不同口径字段不直接排序。');
  return lines.join('\n');
}

export const CLIENT_PREF_VERSION = 1;
