// ======================
// 慢行站路线数据（模拟服务端数据集）
//
// 数据约定：
// 1. 每条路线有多个版本，比较 API 固定使用"公开版本"（status === 'public'）。
// 2. 指标口径（口径不同不可直接排序比较）：
//    - 时长 duration ＝ 交通方式 transportMode × 估算模型 model
//    - 树荫 shade    ＝ 季节 season × 采样方法 sampling
// 3. null 表示缺值（未调查/未发布），0 表示真实零值，两者严格区分。
// 4. 撤回（withdrawn）/ 删除（deleted）的路线保留占位与原因，
//    绝不用另一条同名路线代替（见 r006 与 r007 同名"河畔栈道"）。
// ======================

const ROUTE_DATA = {
  routes: [
    { id: 'r001', name: '滨江绿道',   region: '滨江片区', tags: ['walk', 'family'], tagLabels: ['步行', '亲子'], desc: '沿江而建的平缓绿道，途经三处观景平台。' },
    { id: 'r002', name: '山脊步道',   region: '西山山区', tags: ['walk'],           tagLabels: ['步行'],         desc: '沿山脊线的登山步道，爬升较大，视野开阔。' },
    { id: 'r003', name: '湖畔骑行道', region: '东湖片区', tags: ['bike'],           tagLabels: ['骑行'],         desc: '环湖专用骑行道，路面平整，适合休闲骑行。' },
    { id: 'r004', name: '古城漫行',   region: '古城区',   tags: ['walk'],           tagLabels: ['步行'],         desc: '串联古城墙与老街巷的漫行路线。' },
    { id: 'r005', name: '林荫通勤道', region: '城北片区', tags: ['ebike'],          tagLabels: ['电助力'],       desc: '通勤友好的林荫慢行道，早晚高峰有潮汐车道。' },
    // r006 已删除：不出现在路线列表，仅在恢复旧分享链接时显示占位
    { id: 'r006', name: '河畔栈道',   region: '南河片区', tags: ['walk'],           tagLabels: ['步行'],         desc: '（旧）南河木栈道，数据已下架。', archived: true },
    // r007 与 r006 同名但为不同路线（2026 年新测绘），不可互相替代
    { id: 'r007', name: '河畔栈道',   region: '北河片区', tags: ['walk', 'family'], tagLabels: ['步行', '亲子'], desc: '（新）北河滨水栈道，2026 年重新测绘。' },
    { id: 'r008', name: '茶园环线',   region: '云雾山',   tags: ['walk'],           tagLabels: ['步行'],         desc: '穿行茶园的环形步道，春季景色最佳。' }
  ],

  versions: {
    r001: [
      { version: 1, status: 'withdrawn', publishedAt: '2026-03-01T09:00:00+08:00',
        withdrawnAt: '2026-05-10T10:00:00+08:00', withdrawnReason: '汛期栈道封闭，原测绘数据失效',
        metrics: { distanceKm: 8.2,
          duration: { minutes: 110, transportMode: 'walk', model: 'naismith-v1' },
          shade: { coveragePct: 58, season: 'summer', sampling: 'lidar' },
          supplies: { count: 3 }, difficulty: { level: 1, scale: '5级制' } } },
      { version: 2, status: 'public', publishedAt: '2026-06-01T09:00:00+08:00',
        metrics: { distanceKm: 8.6,
          duration: { minutes: 105, transportMode: 'walk', model: 'naismith-v1' },
          shade: { coveragePct: 60, season: 'summer', sampling: 'lidar' },
          supplies: { count: 4 }, difficulty: { level: 1, scale: '5级制' } } },
      { version: 3, status: 'public', publishedAt: '2026-09-15T09:00:00+08:00',
        metrics: { distanceKm: 8.6,
          duration: { minutes: 100, transportMode: 'walk', model: 'naismith-v1' },
          shade: { coveragePct: 63, season: 'summer', sampling: 'lidar' },
          supplies: { count: 4 }, difficulty: { level: 1, scale: '5级制' } } }
    ],
    r002: [
      { version: 1, status: 'public', publishedAt: '2026-04-01T09:00:00+08:00',
        metrics: { distanceKm: 6.4,
          duration: { minutes: 150, transportMode: 'walk', model: 'tobler-v2' },
          shade: { coveragePct: 45, season: 'summer', sampling: 'field' },
          supplies: { count: 0 }, difficulty: { level: 4, scale: '5级制' } } },
      { version: 2, status: 'public', publishedAt: '2026-08-20T09:00:00+08:00',
        metrics: { distanceKm: 6.4,
          duration: { minutes: 145, transportMode: 'walk', model: 'tobler-v2' },
          shade: { coveragePct: 47, season: 'summer', sampling: 'field' },
          supplies: { count: 0 }, difficulty: { level: 4, scale: '5级制' } } }
    ],
    r003: [
      { version: 1, status: 'public', publishedAt: '2026-05-12T09:00:00+08:00',
        metrics: { distanceKm: 15.2,
          duration: { minutes: 55, transportMode: 'bike', model: 'cityride-v1' },
          shade: { coveragePct: 38, season: 'autumn', sampling: 'drone' },
          supplies: { count: 2 }, difficulty: { level: 2, scale: '5级制' } } }
    ],
    r004: [
      { version: 1, status: 'withdrawn', publishedAt: '2026-02-10T09:00:00+08:00',
        withdrawnAt: '2026-07-01T10:00:00+08:00', withdrawnReason: '核心区施工，路线临时调整，原数据不再适用',
        metrics: { distanceKm: 4.1,
          duration: { minutes: 70, transportMode: 'walk', model: 'naismith-v1' },
          shade: null, supplies: null, difficulty: { level: 1, scale: '5级制' } } },
      { version: 2, status: 'public', publishedAt: '2026-08-01T09:00:00+08:00',
        metrics: { distanceKm: 4.5,
          duration: { minutes: 75, transportMode: 'walk', model: 'naismith-v1' },
          shade: null,                 // 缺值：树荫调查待补测
          supplies: null,              // 缺值：补给点尚未普查
          difficulty: { level: 1, scale: '5级制' } } }
    ],
    r005: [
      { version: 1, status: 'public', publishedAt: '2026-06-18T09:00:00+08:00',
        metrics: { distanceKm: 9.8,
          duration: { minutes: 32, transportMode: 'ebike', model: 'cityride-v1' },
          shade: { coveragePct: 71, season: 'summer', sampling: 'lidar' },
          supplies: null,              // 缺值：补给点尚未普查
          difficulty: { level: 2, scale: '5级制' } } }
    ],
    r006: [
      { version: 1, status: 'deleted', publishedAt: '2026-01-15T09:00:00+08:00',
        deletedAt: '2026-06-30T10:00:00+08:00', deletedReason: '数据授权到期，应数据方要求下架',
        metrics: { distanceKm: 3.2,
          duration: { minutes: 45, transportMode: 'walk', model: 'naismith-v1' },
          shade: { coveragePct: 52, season: 'spring', sampling: 'field' },
          supplies: { count: 1 }, difficulty: { level: 1, scale: '5级制' } } }
    ],
    r007: [
      { version: 1, status: 'public', publishedAt: '2026-09-01T09:00:00+08:00',
        metrics: { distanceKm: 5.6,
          duration: { minutes: 80, transportMode: 'walk', model: 'naismith-v1' },
          shade: { coveragePct: 49, season: 'summer', sampling: 'drone' },
          supplies: { count: 2 }, difficulty: { level: 2, scale: '5级制' } } }
    ],
    r008: [
      { version: 1, status: 'public', publishedAt: '2026-04-22T09:00:00+08:00',
        metrics: { distanceKm: 7.3,
          duration: { minutes: 130, transportMode: 'walk', model: 'tobler-v2' },
          shade: { coveragePct: 66, season: 'spring', sampling: 'field' },
          supplies: { count: 1 },
          difficulty: null } }         // 缺值：难度评级待复核
    ]
  }
};

// 口径标签（用于界面展示与报告导出，卡片/抽屉/报告共用）
const CALIBER_LABELS = {
  transportMode: { walk: '步行', bike: '骑行', ebike: '电助力' },
  model: {
    'naismith-v1': 'Naismith 模型 v1',
    'tobler-v2': 'Tobler 模型 v2',
    'cityride-v1': 'CityRide 模型 v1'
  },
  season: { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' },
  sampling: { lidar: '激光雷达', drone: '无人机航拍', field: '人工实测' }
};

// 指标元信息：排序时按 caliberKey 分组，仅同口径组内可比较
const METRIC_DEFS = [
  { key: 'distanceKm', label: '距离', unit: 'km',
    caliberOf: () => 'standard',
    caliberText: () => 'GIS 统一测量',
    valueOf: m => m.distanceKm },
  { key: 'duration', label: '时长', unit: '分钟',
    caliberOf: v => v ? `${v.transportMode}|${v.model}` : null,
    caliberText: v => v ? `${CALIBER_LABELS.transportMode[v.transportMode]} · ${CALIBER_LABELS.model[v.model]}` : '',
    valueOf: m => m.duration ? m.duration.minutes : null },
  { key: 'shade', label: '树荫覆盖', unit: '%',
    caliberOf: v => v ? `${v.season}|${v.sampling}` : null,
    caliberText: v => v ? `${CALIBER_LABELS.season[v.season]} · ${CALIBER_LABELS.sampling[v.sampling]}` : '',
    valueOf: m => m.shade ? m.shade.coveragePct : null },
  { key: 'supplies', label: '补给点', unit: '处',
    caliberOf: () => 'standard',
    caliberText: () => '沿线普查',
    valueOf: m => m.supplies ? m.supplies.count : null },
  { key: 'difficulty', label: '难度', unit: '/5',
    caliberOf: () => 'standard',
    caliberText: () => '5级制',
    valueOf: m => m.difficulty ? m.difficulty.level : null }
];
