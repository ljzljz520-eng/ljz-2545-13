// jsdom 端到端测试：加载 routes.html（内联脚本），模拟用户操作验证验收场景
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

function buildHtml() {
  let html = fs.readFileSync(__dirname + '/../routes.html', 'utf-8');
  for (const f of ['script.js', 'routes-data.js', 'compare-api.js', 'compare-store.js', 'compare-ui.js']) {
    const code = fs.readFileSync(__dirname + '/../js/' + f, 'utf-8');
    html = html.replace(`<script src="js/${f}"></script>`, () => `<script>\n${code}\n</script>`);
  }
  return html;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what, timeout = 10000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('超时等待: ' + what);
    await wait(60);
  }
}
const CS = w => w.eval('CompareStore');
const CA = w => w.eval('CompareAPI');
const blobText = (w, blob) => typeof blob.text === 'function'
  ? blob.text()
  : new Promise((res, rej) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsText(blob); });
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); };

async function boot(query = '') {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => console.error('[jsdomError]', e.detail && e.detail.message || e.message));
  vc.on('error', (...a) => console.error('[console.error]', ...a));
  const dom = new JSDOM(buildHtml(), {
    url: 'https://slowwalk.test/routes.html' + query,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const { window } = dom;
  // 桩：导出下载与剪贴板
  window.URL.createObjectURL = blob => { window.__capturedBlob = blob; return 'blob:mock'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { window.__clickedAnchor = this; };
  await until(() => window.eval('typeof CompareStore !== "undefined" && CompareStore.state.routeIndex.length > 0 && !CompareStore.state.loading'), '初始化完成');
  return window;
}

(async () => {
  // ============ 场景 A：默认加载 + 集合编辑 + 过滤隐藏 + 排序 + 导出 ============
  console.log('--- 场景 A：基本流程 ---');
  let w = await boot();
  let d = w.document;

  assert(d.querySelectorAll('.route-card').length === 7, 'A1 渲染 7 张路线卡片（已删除 r006 不出现）');
  assert(!d.querySelector('.route-card[data-route-id="r006"]'), 'A2 r006 不在卡片列表');

  // 加入对比
  d.querySelector('.route-card[data-route-id="r001"] button[data-act="add"]').click();
  await until(() => CS(w).state.selection.length === 1 && !CS(w).state.loading, '加入 r001');
  d.querySelector('.route-card[data-route-id="r002"] button[data-act="add"]').click();
  d.querySelector('.route-card[data-route-id="r004"] button[data-act="add"]').click();
  await until(() => CS(w).state.selection.length === 3 && !CS(w).state.loading, '加入 r002/r004');
  assert(d.getElementById('compareBar').classList.contains('visible'), 'A3 对比浮条出现');
  assert(d.getElementById('compareCount').textContent.includes('3/6'), 'A4 浮条计数 3/6');

  // 打开抽屉
  d.getElementById('openDrawer').click();
  await wait(50);
  const rows = d.querySelectorAll('.cmp-table tbody tr');
  assert(rows.length === 6, 'A5 抽屉表格 6 行（5 指标 + 草稿行）');
  assert(d.querySelectorAll('.cmp-table thead .col-head').length === 3, 'A6 三列路线');

  // 缺值与零值在抽屉中分离
  const cells = Array.from(d.querySelectorAll('.cmp-table tbody tr')).map(r => r.textContent);
  const suppliesRow = cells.find(t => t.includes('补给点'));
  assert(suppliesRow.includes('0') && suppliesRow.includes('暂无数据'), 'A7 补给行同时含真实零值(0)与缺值(暂无数据)');
  const shadeRow = cells.find(t => t.includes('树荫'));
  assert(shadeRow.includes('暂无数据'), 'A8 古城漫行树荫为缺值');

  // 过滤导致隐藏项：集合保留
  d.querySelector('#filterBtns .filter-btn[data-tag="bike"]').click();
  await wait(50);
  const r001card = d.querySelector('.route-card[data-route-id="r001"]');
  assert(r001card.style.display === 'none', 'A9 筛选骑行后 r001 卡片隐藏');
  assert(CS(w).state.selection.length === 3, 'A10 隐藏项仍在对比集合中');
  assert(d.getElementById('compareHidden').textContent.includes('3 项被当前筛选隐藏'), 'A11 浮条提示 3 项被隐藏');
  d.getElementById('openDrawer').click(); await wait(30);
  assert(d.querySelectorAll('.hidden-chip').length === 3, 'A12 抽屉列头显示「已被筛选隐藏」');
  // 还原筛选
  d.querySelector('#filterBtns .filter-btn[data-tag="all"]').click();

  // 排序：时长 → 口径分组说明
  d.querySelector('.sort-btn[data-metric="duration"]').click();
  await wait(30);
  const note = d.querySelector('.sort-note');
  assert(note && note.textContent.includes('口径'), 'A13 时长排序出现口径分组说明');
  assert(note.textContent.includes('不直接比较') || note.textContent.includes('口径一致'), 'A14 排序说明包含可比性提示');

  // 导出报告：与抽屉同一组参数与证据
  d.getElementById('exportBtn').click();
  await wait(30);
  const md = await blobText(w, w.__capturedBlob);
  assert(md.includes('取数政策：同一时点快照'), 'A15 报告含取数政策');
  assert(md.includes('数据获取时间（证据）'), 'A16 报告含取数证据');
  assert(md.includes('口径'), 'A17 报告含口径说明');
  assert(md.includes('真实零值'), 'A18 报告区分真实零值');
  assert(md.includes('暂无数据（缺值）'), 'A19 报告标注缺值');
  assert(md.includes('r001@3'), 'A20 报告含固定版本参数');

  // 保存时路线撤回：先固定 v3，再撤回 v3，最后保存
  await CS(w).pinVersion('r001', 3);
  await until(() => !CS(w).state.loading, '固定 v3');
  d.getElementById('demoWithdraw').click();
  await until(() => CS(w).state.comparison && CS(w).state.comparison.items.some(i => !i.ok), '撤回后刷新出占位');
  d.getElementById('openDrawer').click(); await wait(30);
  assert(d.querySelector('.status-chip.status-withdrawn'), 'A21 撤回后 r001 列变为占位');
  d.getElementById('saveBtn').click();
  await until(() => CA(w) && true, '保存调用'); await wait(600);
  const savedSel = JSON.parse(w.localStorage.getItem('mxz.server.selection'));
  assert(savedSel.items.some(i => i.routeId === 'r001'), 'A22 撤回路线仍以占位条目保存在集合中');
  d.getElementById('demoRepublish').click();
  await until(() => !CS(w).state.loading, '恢复 v3');

  // 模拟另一设备修改集合
  d.getElementById('demoRemote').click();
  await until(() => !CS(w).state.loading, '远端同步');
  assert(CS(w).state.selection.length === 2, 'A23 另一设备修改后本端集合同步（移除首项）');

  w.close();

  // ============ 场景 B：恢复旧分享链接（撤回/删除/同名路线） ============
  console.log('--- 场景 B：旧分享链接恢复 ---');
  w = await boot('?c=r001@1,r006@1,r007&p=latest');
  d = w.document;
  d.getElementById('openDrawer').click(); await wait(50);

  const heads = Array.from(d.querySelectorAll('.cmp-table thead .col-head'));
  assert(heads.length === 3, 'B1 恢复 3 列');
  assert(heads[0].textContent.includes('已撤回'), 'B2 r001@1 显示已撤回占位');
  assert(heads[1].textContent.includes('已删除'), 'B3 r006@1 显示已删除占位');
  assert(heads[2].textContent.includes('v1') && heads[2].querySelector('.version-select'), 'B4 r007 正常数据列');
  const phNote = d.querySelector('.placeholder-note');
  assert(phNote && phNote.textContent.includes('汛期'), 'B5 占位说明含撤回原因');
  assert(phNote.textContent.includes('授权到期'), 'B6 占位说明含删除原因');
  assert(phNote.textContent.includes('不会自动替代'), 'B7 明确不以同名路线替代');
  assert(CS(w).state.policy === 'latest', 'B8 URL 恢复取数政策 latest');
  // 导出的报告同样含占位原因
  d.getElementById('exportBtn').click(); await wait(30);
  const md2 = await blobText(w, w.__capturedBlob);
  assert(md2.includes('授权到期') && md2.includes('各取最新'), 'B9 报告与抽屉同一证据（含占位原因与政策）');
  w.close();

  // ============ 场景 C：固定版本 + 新版本提示 + 政策切换 + 异步乱序 ============
  console.log('--- 场景 C：版本固定与乱序防护 ---');
  w = await boot();
  d = w.document;
  d.querySelector('.route-card[data-route-id="r001"] button[data-act="add"]').click();
  await until(() => CS(w).state.selection.length === 1 && !CS(w).state.loading, '加入 r001');
  // 固定到 v2
  d.getElementById('openDrawer').click(); await wait(30);
  const sel = d.querySelector('.version-select');
  sel.value = '2';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => !CS(w).state.loading && CS(w).state.comparison.items[0].version.version === 2, '固定 v2');
  d.getElementById('openDrawer').click(); await wait(30);
  const newver = d.querySelector('.newver-chip');
  assert(newver && newver.textContent.includes('v3'), 'C1 固定旧版后出现「有新版本 v3」提示');
  newver.click();
  await until(() => !CS(w).state.loading && CS(w).state.comparison.items[0].version.version === 3, '更新到 v3');
  assert(CS(w).state.comparison.items[0].version.version === 3, 'C2 一键更新到最新公开版本');

  // 政策切换：snapshot → latest
  const radio = d.querySelector('input[name="policy"][value="latest"]');
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => !CS(w).state.loading && CS(w).state.policy === 'latest', '切换政策');
  assert(CS(w).state.comparison.evidence.policy === 'latest', 'C3 证据政策切换为各取最新');

  // 异步乱序：快速连续操作，最终状态必须与最后操作一致
  d.querySelector('.route-card[data-route-id="r002"] button[data-act="add"]').click();
  d.querySelector('.route-card[data-route-id="r003"] button[data-act="add"]').click();
  d.querySelector('.route-card[data-route-id="r005"] button[data-act="add"]').click();
  await until(() => !CS(w).state.loading, '连续加入完成');
  const items = CS(w).state.comparison.items.map(i => i.route ? i.route.id : i.routeId);
  assert(items.length === CS(w).state.selection.length, 'C4 快速连续操作后比较结果与集合一致（乱序防护）');
  assert(items.join(',') === CS(w).state.selection.map(s => s.routeId).join(','), 'C5 结果顺序与集合一致');
  w.close();

  console.log('\n全部端到端测试完成');
})().catch(e => { console.error('💥 异常:', e); process.exitCode = 1; });
