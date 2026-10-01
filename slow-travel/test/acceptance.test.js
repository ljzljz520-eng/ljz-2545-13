/**
 * 验收测试：node --test
 * 覆盖需求：
 *  A1 五指标抽屉 + 不同口径禁止排序 + 缺值/零值分离
 *  A2 快照固定公开版本 vs 各取最新 + 新版本只提示不替换
 *  A3 删除/撤回占位 + 原因 + 同名路线不替代
 *  A4 两设备并发改集合（三方合并、删除优先）
 *  A5 保存/分享期间撤回 + 旧分享链接恢复
 *  A6 URL 仅公开参数；报告与 API 同参数同证据
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slowtravel-'));
const dbPath = path.join(tmpDir, 'db.json');
process.env.DB_PATH = dbPath;
process.env.ENABLE_TEST_API = '1';

const { createApp } = await import('../server/index.js');
const { initDb } = await import('../server/db.js');
const core = await import('../shared/core.js');

let server, base;
async function jsonGet(p) {
  const res = await fetch(base + p);
  assert.equal(res.status, 200, `GET ${p}`);
  return res.json();
}
async function jsonPost(p, body, method = 'POST') {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { status: res.status, data };
}
async function reset(clearAccounts = true) {
  await jsonPost('/api/test/reset', { clearAccounts });
}
async function compare(body) {
  const { data } = await jsonPost('/api/compare', body);
  return data;
}
function row(cmp, id) {
  return cmp.rows.find((r) => r.routeId === id);
}

describe('慢行站路线对比验收', () => {
  before(async () => {
    const db = await initDb(dbPath, { force: true });
    server = createApp(db);
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('准备：7 条路线，含撤回 r3、删除 r4、同名 r7', async () => {
    const { routes } = await jsonGet('/api/routes?transport=walk&season=summer');
    assert.equal(routes.length, 7);
    assert.equal(routes.find((r) => r.routeId === 'r3').status, 'withdrawn');
    assert.equal(routes.find((r) => r.routeId === 'r4').status, 'deleted');
    const sameName = routes.filter((r) => r.name === '滨江短驳线');
    assert.deepEqual(sameName.map((r) => r.routeId).sort(), ['r3', 'r7']);
  });

  test('A1: 五指标；时长模型/树荫采样不同口径时不可排序；零值与缺值分离', async () => {
    // 快照固定 2025 年版本：r1-v1(planner-v1 + sample-points) vs r2-v1(survey-avg + sample-points)
    const cmp = await compare({
      routeIds: ['r1', 'r2'],
      pins: { r1: { routeId: 'r1', versionId: 'r1-v1' }, r2: { routeId: 'r2', versionId: 'r2-v1' } },
      policy: 'snapshot',
      asOf: '2025-10-01T00:00:00Z',
      transport: 'walk',
      season: 'summer'
    });
    for (const key of core.METRIC_KEYS) assert.ok(cmp.columns[key], `缺列 ${key}`);

    // 时长：planner-v1 vs survey-avg，不同模型 -> 禁止排序
    assert.equal(cmp.columns.duration.comparable, false);
    assert.match(cmp.columns.duration.sortNote, /不同口径/);
    // 树荫：夏季且同为 sample-points -> 可排序
    assert.equal(cmp.columns.shade.comparable, true);
    // 距离：official-signage vs gps-survey -> 不可排序
    assert.equal(cmp.columns.distance.comparable, false);
    // 补给：同为官方清查 -> 可排序
    assert.equal(cmp.columns.supplies.comparable, true);

    // 零值：r5 补给实测 0（state=ok 且 isZero），不得被当作缺值
    const cmp5 = await compare({ routeIds: ['r5'], policy: 'latest', transport: 'walk', season: 'summer' });
    const supplies = row(cmp5, 'r5').cells.supplies;
    assert.equal(supplies.state, 'ok');
    assert.equal(supplies.value, 0);
    assert.equal(supplies.isZero, true);

    // 缺值：r5 步行时长无口径记录（state=missing）；骑行有值
    const walkDur = row(cmp5, 'r5').cells.duration;
    assert.equal(walkDur.state, 'missing');
    assert.equal(walkDur.value, null);
    const bike = await compare({ routeIds: ['r5'], policy: 'latest', transport: 'bike', season: 'summer' });
    assert.equal(row(bike, 'r5').cells.duration.state, 'ok');

    // 缺值：r5 冬季树荫整条缺失（不是 0%）
    const winter = await compare({ routeIds: ['r5'], policy: 'latest', transport: 'walk', season: 'winter' });
    assert.equal(row(winter, 'r5').cells.shade.state, 'missing');

    // 排序守卫：对不可比列排序必须抛错
    assert.throws(() => core.comparableSort(cmp.rows, 'distance', cmp.columns), /不可直接排序/);

    // 零值参与数值排序（补给：r5=0 排最前），且 r6 口径 osm-poi 导致整列不可比
    const cmpSort = await compare({
      routeIds: ['r1', 'r2', 'r5'],
      policy: 'latest', transport: 'walk', season: 'summer'
    });
    assert.equal(cmpSort.columns.supplies.comparable, true);
    const sorted = core.comparableSort(cmpSort.rows, 'supplies', cmpSort.columns, 'asc');
    assert.deepEqual(sorted.map((r) => r.routeId), ['r5', 'r1', 'r2']);
    const mixed = await compare({ routeIds: ['r1', 'r6'], policy: 'latest', transport: 'walk', season: 'summer' });
    assert.equal(mixed.columns.supplies.comparable, false); // official-inventory vs osm-poi
  });

  test('A2: 快照固定公开版本；新版本仅提示不替换；各取最新采用最新', async () => {
    await reset(false);
    // 固定 r2-v2 的旧快照
    const pinned = await compare({
      routeIds: ['r2'],
      pins: { r2: { routeId: 'r2', versionId: 'r2-v2' } },
      policy: 'snapshot', asOf: '2026-04-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    assert.equal(row(pinned, 'r2').resolvedVersion.versionId, 'r2-v2');
    // 发布新版本（模拟别的设备/之后时间看到更新）
    await jsonPost('/api/test/route/publish-version', {
      routeId: 'r2', versionId: 'r2-v9', label: '验收新版本', changeNote: '验收'
    });
    const afterPublish = await compare({
      routeIds: ['r2'],
      pins: { r2: { routeId: 'r2', versionId: 'r2-v2' } },
      policy: 'snapshot', asOf: '2026-04-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    // 固定版本不变
    assert.equal(row(afterPublish, 'r2').resolvedVersion.versionId, 'r2-v2');
    const alert = (row(afterPublish, 'r2').alerts || []).find((a) => a.type === 'newer_version');
    assert.ok(alert, '必须有新版本提示');
    assert.equal(alert.latestVersionId, 'r2-v9');

    // 各取最新：采用 r2-v9，且不因链接 pin 而停在旧版
    const latest = await compare({
      routeIds: ['r2'],
      pins: { r2: { routeId: 'r2', versionId: 'r2-v2' } },
      policy: 'latest', transport: 'walk', season: 'summer'
    });
    assert.equal(row(latest, 'r2').resolvedVersion.versionId, 'r2-v9');

    // 固定不存在的版本 -> 占位 version_missing，而不是回退到同名/最新
    const ghost = await compare({
      routeIds: ['r1'],
      pins: { r1: { routeId: 'r1', versionId: 'r1-nope' } },
      policy: 'snapshot', asOf: '2026-01-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    assert.equal(row(ghost, 'r1').kind, 'placeholder');
    assert.equal(row(ghost, 'r1').reasonCode, 'version_missing');
  });

  test('A3: 删除路线保留占位原因；撤回路线冻结展示；同名路线不替代', async () => {
    await reset(false);
    // 旧分享链接固定了已删除路线 r4 的版本
    const deletedLink = await compare({
      routeIds: ['r4'],
      pins: { r4: { routeId: 'r4', versionId: 'r4-v1' } },
      policy: 'snapshot', asOf: '2025-06-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    const r4 = row(deletedLink, 'r4');
    assert.equal(r4.kind, 'placeholder');
    assert.equal(r4.reasonCode, 'route_deleted');
    assert.match(r4.reason, /湿地保护区调整/);
    assert.deepEqual(deletedLink.unresolved.map((u) => u.routeId), ['r4']);

    // 未知 id 同样占位
    const unknown = await compare({ routeIds: ['r999'], policy: 'latest', transport: 'walk', season: 'summer' });
    assert.equal(row(unknown, 'r999').kind, 'placeholder');

    // 撤回的 r3：旧链接固定 r3-v1 仍冻结展示并带撤回原因；绝不能被同名 r7 顶替
    const withdrawnLink = await compare({
      routeIds: ['r3'],
      pins: { r3: { routeId: 'r3', versionId: 'r3-v1' } },
      policy: 'snapshot', asOf: '2026-09-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    const r3 = row(withdrawnLink, 'r3');
    assert.equal(r3.kind, 'data');
    assert.equal(r3.status, 'withdrawn');
    assert.equal(r3.resolvedVersion.versionId, 'r3-v1');
    assert.match(r3.withdrawnReason, /施工/);
    assert.equal(withdrawnLink.rows.length, 1); // 没有自动塞进 r7

    // 明确把同名 r7 加入时，它是独立路线（东段新线）
    const both = await compare({
      routeIds: ['r3', 'r7'],
      pins: {
        r3: { routeId: 'r3', versionId: 'r3-v1' },
        r7: { routeId: 'r7', versionId: 'r7-v1' }
      },
      policy: 'snapshot', asOf: '2026-10-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    assert.equal(row(both, 'r3').name, '滨江短驳线');
    assert.equal(row(both, 'r7').name, '滨江短驳线');
    assert.equal(row(both, 'r3').resolvedVersion.versionId, 'r3-v1');
    assert.equal(row(both, 'r7').resolvedVersion.versionId, 'r7-v1');
  });

  test('A4: 两设备并发改集合 —— 三方合并、删除优先、偏好最后写入获胜', async () => {
    await reset(true);
    const acc = `dev-${Math.random().toString(36).slice(2, 6)}`;
    const putDraft = (body) => jsonPost(`/api/accounts/${acc}/draft`, body, 'PUT').then((r) => r.data);
    const getDraft = () => jsonGet(`/api/accounts/${acc}/draft`);

    // 设备 A 建立集合
    let r = await putDraft({ baseRevision: 0, collection: { added: ['r1', 'r2'], removed: [] }, transport: 'walk' });
    assert.equal(r.draft.collection.sort().join(','), 'r1,r2');
    const rev1 = r.draft.revision;

    // 设备 B 拉取后加入 r5（rev2）
    r = await putDraft({
      baseRevision: rev1, baseCollection: ['r1', 'r2'],
      collection: { added: ['r5'], removed: [] }
    });
    assert.equal(r.status, 'merged');
    assert.equal(r.draft.collection.sort().join(','), 'r1,r2,r5');
    const rev2 = r.draft.revision;

    // 设备 A 基于旧 rev1 移除 r1：与 B 的新增并发 -> 合并后 r2,r5（删除优先但保留对方的 r5）
    r = await putDraft({
      baseRevision: rev1, baseCollection: ['r1', 'r2'],
      collection: { added: [], removed: ['r1'] }
    });
    assert.equal(r.status, 'merged_remote');
    assert.equal(r.draft.collection.sort().join(','), 'r2,r5');

    // 竞争：B 新增 r6 的同时 A 删除 r6（A 的祖先集合是 [r1,r2]）
    await putDraft({
      baseRevision: rev1, baseCollection: ['r1', 'r2'],
      collection: { added: ['r6'], removed: [] }
    });
    const before = await getDraft();
    assert.ok(before.draft.collection.includes('r6'));
    r = await putDraft({
      baseRevision: rev1, baseCollection: ['r1', 'r2'],
      collection: { added: [], removed: ['r6'] }
    });
    assert.ok(!r.draft.collection.includes('r6'), '同一集合项并发增删：删除优先');

    // 偏好：旧修订号写入交通方式/季节仍生效（最后写入获胜）
    r = await putDraft({ baseRevision: 1, transport: 'bike', season: 'winter' });
    assert.equal(r.draft.transport, 'bike');
    assert.equal(r.draft.season, 'winter');

    // 纯函数层面的两设备合并：双方同时新增 + 一方删除
    const merged = core.mergeSelection(
      ['r1'],
      { added: ['r2'], removed: ['r1'] },
      { added: ['r3'], removed: [] }
    );
    assert.deepEqual(merged.sort(), ['r2', 'r3']); // r1 被一方删除 -> 不复活
  });

  test('A5: 保存对比期间路线撤回 -> 撤回冻结行；恢复后可用；旧链接依旧占位', async () => {
    await reset(false);
    // 用户保存了 r2 的固定快照
    const savedPins = { r2: { routeId: 'r2', versionId: 'r2-v2' } };
    let cmp = await compare({
      routeIds: ['r2'], pins: savedPins,
      policy: 'snapshot', asOf: '2026-04-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    assert.equal(row(cmp, 'r2').status, 'published');

    // 保存后 r2 被撤回
    await jsonPost('/api/test/route/withdraw', { routeId: 'r2', reason: '验收：施工封闭' });
    cmp = await compare({
      routeIds: ['r2'], pins: savedPins,
      policy: 'snapshot', asOf: '2026-04-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    const withdrawnRow = row(cmp, 'r2');
    assert.equal(withdrawnRow.kind, 'data');
    assert.equal(withdrawnRow.status, 'withdrawn');
    assert.equal(withdrawnRow.resolvedVersion.versionId, 'r2-v2'); // 数据冻结
    assert.match(withdrawnRow.withdrawnReason, /施工封闭/);

    // 恢复后同一链接回到可用
    await jsonPost('/api/test/route/restore', { routeId: 'r2' });
    cmp = await compare({
      routeIds: ['r2'], pins: savedPins,
      policy: 'snapshot', asOf: '2026-04-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    assert.equal(row(cmp, 'r2').status, 'published');

    // 删除不可逆：旧链接始终占位（即便后来有同名路线也不替代）
    await jsonPost('/api/test/route/delete', { routeId: 'r2', reason: '验收：永久撤销' });
    cmp = await compare({
      routeIds: ['r2'], pins: savedPins,
      policy: 'snapshot', asOf: '2026-04-01T00:00:00Z',
      transport: 'walk', season: 'summer'
    });
    assert.equal(row(cmp, 'r2').kind, 'placeholder');
    assert.equal(row(cmp, 'r2').reasonCode, 'route_deleted');
  });

  test('A6: URL 仅编码公开选择；报告内容与抽屉/API 同源同证据', async () => {
    // URL round-trip：含路线固定版本/政策/时点/交通/季节，不含过滤器与账号
    const hash = core.encodePublicHash({
      collection: ['r1', 'r2'],
      pins: { r1: { routeId: 'r1', versionId: 'r1-v2' }, r2: { routeId: 'r2', versionId: 'r2-v2' } },
      policy: 'snapshot', asOf: '2026-05-01T00:00:00Z',
      transport: 'bike', season: 'winter'
    });
    const decoded = core.decodePublicHash(hash);
    assert.equal(decoded.policy, 'snapshot');
    assert.equal(decoded.transport, 'bike');
    assert.equal(decoded.season, 'winter');
    assert.equal(decoded.pins.r1.versionId, 'r1-v2');
    assert.deepEqual(decoded.routeIds, ['r1', 'r2']);
    assert.ok(!hash.includes('filter') && !hash.includes('account') && !hash.includes('revision'));
    // latest 模式分享路线集合但不固定版本（各取最新），不泄漏固定 pin
    const latestHash = core.encodePublicHash({
      collection: ['r1'],
      pins: { r1: { routeId: 'r1', versionId: 'r1-v1' } },
      policy: 'latest', transport: 'walk', season: 'summer'
    });
    assert.ok(!latestHash.includes('r1-v1'));
    assert.ok(latestHash.includes('routes=r1'));

    // 报告与 API 同一 comparison 对象：证据、口径、占位、不可比声明齐全
    await reset(false);
    const cmp = await compare({
      routeIds: ['r1', 'r5', 'r4'],
      pins: {
        r1: { routeId: 'r1', versionId: 'r1-v1' },
        r5: { routeId: 'r5', versionId: 'r5-v1' },
        r4: { routeId: 'r4', versionId: 'r4-v1' }
      },
      policy: 'snapshot', asOf: '2025-10-01T00:00:00Z',
      transport: 'walk', season: 'winter'
    });
    const report = core.renderReportText(cmp);
    assert.match(report, /慢行站 · 路线对比报告/);
    assert.match(report, /湖畔观光线/);
    assert.match(report, /规划模型 v1/);          // 时长口径证据
    assert.match(report, /不可直接排序/);          // 不可比项声明
    assert.match(report, /缺值（无数据，非零值）/); // r5 步行缺值
    assert.match(report, /实测为零|明确零值/);      // r5 零补给
    assert.match(report, /路线已删除/);            // r4 占位原因
    // 单元格证据必须随对比下发（卡片/抽屉/报告共用）
    const evidence = row(cmp, 'r1').cells.distance.evidence;
    assert.ok(evidence.source && evidence.surveyedAt);
  });
});
