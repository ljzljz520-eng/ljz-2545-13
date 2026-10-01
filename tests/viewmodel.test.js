// 视图模型测试：排序分组、缺值/零值、占位
const fs = require('fs');
const vm = require('vm');

const storeMap = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, JSON, Object, Array, Map, Date, Promise, Math, URLSearchParams, process,
  localStorage: { getItem: k => storeMap.get(k) ?? null, setItem: (k, v) => storeMap.set(k, String(v)), removeItem: k => storeMap.delete(k) },
  location: { search: '', pathname: '/routes.html', href: '/routes.html' },
  history: { replaceState: () => {} },
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
};
sandbox.window = { addEventListener: () => {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const run = f => vm.runInContext(fs.readFileSync(f, 'utf-8'), sandbox, { filename: f });
run(__dirname + '/../js/routes-data.js');
run(__dirname + '/../js/compare-api.js');
run(__dirname + '/../js/compare-store.js');
run(__dirname + '/../js/compare-ui.js');

const test = `
(async () => {
  const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); };

  // 构造对比集合：r001(走/naismith 100) r002(走/tobler 145) r003(骑/cityride 55) r004(撤回占位) r005(补给缺值)
  CompareStore.state.selection = [
    { routeId: 'r001', version: 3 }, { routeId: 'r002', version: null },
    { routeId: 'r003', version: null }, { routeId: 'r004', version: 1 }, { routeId: 'r005', version: null }
  ];
  CompareStore.state.policy = 'latest';
  await CompareStore.refresh();
  const st = CompareStore.state;

  // 未排序：保持选择顺序
  let vm1 = CompareUI.buildViewModel();
  assert(vm1.columns.map(c => c.routeId).join(',') === 'r001,r002,r003,r004,r005', '未排序保持原顺序');
  assert(vm1.columns[3].type === 'placeholder' && vm1.columns[3].item.code === 'withdrawn', 'r004 固定撤回版本 → 占位列');

  // 按时长升序：同口径组内排序，组间不混排
  st.sort = { metric: 'duration', dir: 1 };
  const vm2 = CompareUI.buildViewModel();
  const dataCols = vm2.columns.filter(c => c.type === 'data');
  assert(vm2.sortNote.multiCaliber === true && vm2.sortNote.groups.length === 4, '时长识别出 4 种口径分组（naismith/tobler/骑行/电助力）');
  assert(dataCols[0].routeId === 'r005' && dataCols[0].rank === 1, '升序最前为 r005（电助力32分钟）且组内第1');
  assert(dataCols.find(c => c.routeId === 'r001').rank === 1, 'r001 在其口径组内第1');
  assert(vm2.columns[vm2.columns.length - 1].type === 'placeholder', '占位列固定在末尾');
  const groupOf = id => dataCols.find(c => c.routeId === id).cells.duration.caliber;
  assert(groupOf('r001') !== groupOf('r002'), 'r001 与 r002 时长口径不同（naismith vs tobler）');

  // 按补给升序：真实零值参与排序且最小，缺值不参与排末尾（占位之前？占位最后）
  st.sort = { metric: 'supplies', dir: 1 };
  const vm3 = CompareUI.buildViewModel();
  const cols = vm3.columns;
  assert(cols[0].routeId === 'r002' && cols[0].cells.supplies.value === 0, '真实零值 0 参与排序且升序最小');
  const missingIdx = cols.findIndex(c => c.routeId === 'r005');
  const placeholderIdx = cols.findIndex(c => c.type === 'placeholder');
  assert(missingIdx > 0 && missingIdx < placeholderIdx, '缺值列排参与排序列之后、占位列之前');
  assert(vm3.sortNote.missingNames.includes('林荫通勤道'), '排序说明列出缺值路线');

  // 树荫口径：季节×采样
  st.sort = { metric: 'shade', dir: -1 };
  const vm4 = CompareUI.buildViewModel();
  const shadeCols = vm4.columns.filter(c => c.type === 'data' && c.cells.shade.value !== null);
  const calibers = new Set(shadeCols.map(c => c.cells.shade.caliber));
  assert(calibers.size >= 2, '树荫存在多口径（季节/采样不同）→ 不直接混排');

  // 证据一致性：抽屉/导出共用
  assert(vm4.evidence.fetchedAt === st.comparison.evidence.fetchedAt, '视图模型携带同一取数证据');
  console.log('\\n视图模型测试完成');
})().catch(e => { console.error('💥 异常:', e); process.exitCode = 1; });
`;
vm.runInContext(test, sandbox, { filename: 'test2.js' });
