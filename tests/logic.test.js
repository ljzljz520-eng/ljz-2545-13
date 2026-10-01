// Node 逻辑测试：在共享 vm 上下文中加载数据/API/Store 并验证关键行为
const fs = require('fs');
const vm = require('vm');

const storeMap = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, JSON, Object, Array, Map, Date, Promise, Math, URLSearchParams, process,
  localStorage: {
    getItem: k => (storeMap.has(k) ? storeMap.get(k) : null),
    setItem: (k, v) => storeMap.set(k, String(v)),
    removeItem: k => storeMap.delete(k)
  },
  location: { search: '', pathname: '/routes.html', href: '/routes.html' },
  history: { replaceState: (a, b, url) => { sandbox.__lastURL = url; } },
  __lastURL: ''
};
sandbox.window = { addEventListener: (evt, fn) => { sandbox.__storageHandler = fn; } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const run = f => vm.runInContext(fs.readFileSync(f, 'utf-8'), sandbox, { filename: f });
run(__dirname + '/../js/routes-data.js');
run(__dirname + '/../js/compare-api.js');
run(__dirname + '/../js/compare-store.js');

const test = `
(async () => {
  const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); };

  // 1. 路线索引：r006（已删除）不出现，r007（同名）出现
  const index = await CompareAPI.fetchRouteIndex();
  assert(!index.some(r => r.id === 'r006'), '已删除路线 r006 不出现在索引');
  assert(index.some(r => r.id === 'r007'), '同名新路线 r007 正常出现');
  assert(index.find(r => r.id === 'r001').latestVersion.version === 3, 'r001 最新公开版本为 v3');

  // 2. 固定公开版本：撤回版本 → 占位 + 原因
  let res = await CompareAPI.fetchComparison({ items: [{ routeId: 'r001', version: 1 }], policy: 'latest', snapshotAt: null });
  assert(res.items[0].ok === false && res.items[0].code === 'withdrawn', '固定已撤回版本 → 占位(withdrawn)');
  assert(res.items[0].reason.includes('汛期'), '占位包含撤回原因');

  // 3. 已删除路线占位，且不被同名路线替代
  res = await CompareAPI.fetchComparison({ items: [{ routeId: 'r006', version: 1 }, { routeId: 'r007', version: null }], policy: 'latest', snapshotAt: null });
  assert(res.items[0].code === 'deleted' && res.items[0].route.name === '河畔栈道', 'r006 删除占位保留原名');
  assert(res.items[1].ok && res.items[1].route.id === 'r007', 'r007 独立解析，未替代 r006');

  // 4. 取数政策：同一时点快照 vs 各取最新
  const snap = await CompareAPI.fetchComparison({ items: [{ routeId: 'r001', version: null }], policy: 'snapshot', snapshotAt: '2026-07-01T00:00:00+08:00' });
  assert(snap.items[0].version.version === 2, '快照时点 2026-07 → r001 解析为 v2');
  const lat = await CompareAPI.fetchComparison({ items: [{ routeId: 'r001', version: null }], policy: 'latest', snapshotAt: null });
  assert(lat.items[0].version.version === 3, '各取最新 → r001 解析为 v3');
  assert(snap.evidence.snapshotAt === '2026-07-01T00:00:00+08:00' && lat.evidence.snapshotAt === null, '证据记录快照时点');

  // 5. 缺值与零值分离
  const mix = await CompareAPI.fetchComparison({ items: [{ routeId: 'r002', version: null }, { routeId: 'r004', version: null }], policy: 'latest', snapshotAt: null });
  assert(mix.items[0].version.metrics.supplies.count === 0, 'r002 补给为真实零值 0');
  assert(mix.items[1].version.metrics.supplies === null, 'r004 补给为缺值 null');
  assert(mix.items[1].version.metrics.shade === null, 'r004 树荫为缺值 null');

  // 6. 口径元数据
  const d1 = mix.items[0].version.metrics.duration, d2 = mix.items[1].version.metrics.duration;
  assert(d1.model === 'tobler-v2' && d2.model === 'naismith-v1', '时长口径（估算模型）随数据返回');

  // 7. 新版本提示：固定旧版 → hasNewer
  const old = await CompareAPI.fetchComparison({ items: [{ routeId: 'r001', version: 2 }], policy: 'latest', snapshotAt: null });
  assert(old.items[0].hasNewer === true && old.items[0].latestVersionNo === 3, '固定 v2 → 提示有新版本 v3');

  // 8. 保存时路线撤回：校验接口报告不可用
  CompareAPI.DemoTools.withdrawVersion('r001', 3, '测试撤回');
  const checks = await CompareAPI.validateSelection([{ routeId: 'r001', version: 3 }]);
  assert(checks[0].ok === false && checks[0].code === 'withdrawn', '保存前校验发现 v3 已撤回');
  CompareAPI.DemoTools.republishVersion('r001', 3);

  // 9. Store：URL 恢复 + 仅编码公开选择
  location.search = '?c=r001@2,r006@1,r007&p=latest';
  await CompareStore.init();
  assert(CompareStore.state.restoredFromURL === true, '从分享链接恢复集合');
  assert(CompareStore.state.selection.length === 3, '恢复 3 项（含撤回/删除占位项）');
  assert(__lastURL.includes('c=') && !__lastURL.includes('draft'), 'URL 仅编码公开选择');

  // 10. 模拟另一设备修改
  await CompareStore.applyRemoteSelection({ items: [{ routeId: 'r008', version: null }] }, '设备B');
  assert(CompareStore.state.selection.length === 1 && CompareStore.state.selection[0].routeId === 'r008', '另一设备修改后本端同步');

  // 11. 保存到账号接口（数据库）
  await CompareStore.saveSelection();
  const saved = await CompareAPI.AccountAPI.getSelection();
  assert(saved.items.length === 1 && saved.items[0].routeId === 'r008', '选择集合已保存到账号接口');

  // 12. 草稿仅经账号接口
  await CompareStore.saveDraft('r008', '周末去');
  const drafts = await CompareAPI.AccountAPI.getDrafts();
  assert(drafts['r008'].text === '周末去', '草稿经账号接口同步');
  assert(!__lastURL.includes(encodeURIComponent('周末')), '草稿不进入 URL');

  console.log('\\n全部逻辑测试完成');
})().catch(e => { console.error('💥 异常:', e); process.exitCode = 1; });
`;
vm.runInContext(test, sandbox, { filename: 'test.js' });
