/**
 * 演示/测试种子数据。
 * 设计要点（覆盖验收场景）：
 *  - r1 有两个公开版本：v1(planner-v1/sample-points) → v2(planner-v2/canopy-imagery)
 *    => 固定 v1 的旧快照链接会触发“新版本提示”，且不同口径不会被直接排序
 *  - r3 已撤回、r4 已删除；r7 与 r3 同名但 id 不同（禁止以同名路线补位）
 *  - r6 明确零值补给点（0 处），r5 步行/冬季树荫缺值（null），零值与缺值严格区分
 */
export const SEED = {
  routes: {
    r1: {
      id: 'r1',
      name: '湖畔观光线',
      status: 'published',
      versions: [
        {
          versionId: 'r1-v1',
          label: '2025 春季版',
          publishedAt: '2025-04-01T00:00:00Z',
          dataAsOf: '2025-03-20',
          changeNote: '初版公开',
          metrics: {
            distance: { value: 5.2, caliber: 'official-signage', evidence: { source: '市文旅局路牌', surveyedAt: '2025-03-01' } },
            durationByTransport: {
              walk: { value: 62, model: 'planner-v1', evidence: { source: '慢行规划模型 v1', surveyedAt: '2025-03-01' } },
              bike: { value: 26, model: 'planner-v1', evidence: { source: '慢行规划模型 v1', surveyedAt: '2025-03-01' } }
            },
            shadeBySeason: {
              summer: { value: 72, method: 'sample-points', season: 'summer', evidence: { source: '沿线 20 个采样点人工测定', surveyedAt: '2025-07-10' } },
              winter: { value: 31, method: 'sample-points', season: 'winter', evidence: { source: '沿线 20 个采样点人工测定', surveyedAt: '2025-12-10' } }
            },
            supplies: { value: 4, caliber: 'official-inventory', evidence: { source: '官方设施清查', surveyedAt: '2025-03-01' } },
            difficulty: { value: 2, scale: 'citilvl-3', evidence: { source: '城市慢行三级量表评定', surveyedAt: '2025-03-01' } }
          }
        },
        {
          versionId: 'r1-v2',
          label: '2026 夏季修订',
          publishedAt: '2026-05-15T00:00:00Z',
          dataAsOf: '2026-04-30',
          changeNote: '时长改用规划模型 v2；树荫改用冠层影像法',
          metrics: {
            distance: { value: 5.2, caliber: 'official-signage', evidence: { source: '市文旅局路牌', surveyedAt: '2026-04-01' } },
            durationByTransport: {
              walk: { value: 58, model: 'planner-v2', evidence: { source: '慢行规划模型 v2（含信号灯等待）', surveyedAt: '2026-04-30' } },
              bike: { value: 24, model: 'planner-v2', evidence: { source: '慢行规划模型 v2（含信号灯等待）', surveyedAt: '2026-04-30' } }
            },
            shadeBySeason: {
              summer: { value: 74, method: 'canopy-imagery', season: 'summer', evidence: { source: '卫星冠层影像解译', surveyedAt: '2026-06-01' } },
              winter: { value: 28, method: 'canopy-imagery', season: 'winter', evidence: { source: '卫星冠层影像解译', surveyedAt: '2026-01-10' } }
            },
            supplies: { value: 4, caliber: 'official-inventory', evidence: { source: '官方设施清查', surveyedAt: '2026-04-01' } },
            difficulty: { value: 2, scale: 'citilvl-3', evidence: { source: '城市慢行三级量表评定', surveyedAt: '2026-04-01' } }
          }
        }
      ]
    },
    r2: {
      id: 'r2',
      name: '老城慢行道',
      status: 'published',
      versions: [
        {
          versionId: 'r2-v1',
          label: '2025 秋季版',
          publishedAt: '2025-09-10T00:00:00Z',
          dataAsOf: '2025-08-25',
          changeNote: '初版公开',
          metrics: {
            distance: { value: 3.4, caliber: 'gps-survey', evidence: { source: '志愿者 GPS 实测', surveyedAt: '2025-08-20' } },
            durationByTransport: {
              walk: { value: 45, model: 'survey-avg', evidence: { source: '30 名体验者实地采样均值', surveyedAt: '2025-08-25' } },
              bike: { value: 18, model: 'survey-avg', evidence: { source: '30 名体验者实地采样均值', surveyedAt: '2025-08-25' } }
            },
            shadeBySeason: {
              summer: { value: 58, method: 'sample-points', season: 'summer', evidence: { source: '沿线 15 个采样点人工测定', surveyedAt: '2025-07-20' } },
              winter: { value: 22, method: 'sample-points', season: 'winter', evidence: { source: '沿线 15 个采样点人工测定', surveyedAt: '2025-12-20' } }
            },
            supplies: { value: 6, caliber: 'official-inventory', evidence: { source: '官方设施清查', surveyedAt: '2025-08-25' } },
            difficulty: { value: 3, scale: 'citilvl-3', evidence: { source: '城市慢行三级量表评定', surveyedAt: '2025-08-25' } }
          }
        },
        {
          versionId: 'r2-v2',
          label: '2026 春季修订',
          publishedAt: '2026-03-20T00:00:00Z',
          dataAsOf: '2026-02-28',
          changeNote: '新增一处直饮水点',
          metrics: {
            distance: { value: 3.4, caliber: 'gps-survey', evidence: { source: '志愿者 GPS 实测', surveyedAt: '2026-02-20' } },
            durationByTransport: {
              walk: { value: 44, model: 'survey-avg', evidence: { source: '32 名体验者实地采样均值', surveyedAt: '2026-02-28' } },
              bike: { value: 17, model: 'survey-avg', evidence: { source: '32 名体验者实地采样均值', surveyedAt: '2026-02-28' } }
            },
            shadeBySeason: {
              summer: { value: 59, method: 'sample-points', season: 'summer', evidence: { source: '沿线 15 个采样点人工测定', surveyedAt: '2025-07-20' } },
              winter: { value: 22, method: 'sample-points', season: 'winter', evidence: { source: '沿线 15 个采样点人工测定', surveyedAt: '2025-12-20' } }
            },
            supplies: { value: 7, caliber: 'official-inventory', evidence: { source: '官方设施清查', surveyedAt: '2026-02-28' } },
            difficulty: { value: 3, scale: 'citilvl-3', evidence: { source: '城市慢行三级量表评定', surveyedAt: '2026-02-28' } }
          }
        }
      ]
    },
    r3: {
      id: 'r3',
      name: '滨江短驳线',
      status: 'withdrawn',
      withdrawnReason: '沿江步道施工，2026-09-28 起临时封闭',
      withdrawnAt: '2026-09-28T00:00:00Z',
      versions: [
        {
          versionId: 'r3-v1',
          label: '2026 夏季版',
          publishedAt: '2026-06-01T00:00:00Z',
          dataAsOf: '2026-05-20',
          changeNote: '初版公开（后随路线撤回冻结）',
          metrics: {
            distance: { value: 2.6, caliber: 'official-signage', evidence: { source: '滨江管委会路牌', surveyedAt: '2026-05-20' } },
            durationByTransport: {
              walk: { value: 30, model: 'planner-v2', evidence: { source: '慢行规划模型 v2', surveyedAt: '2026-05-20' } },
              bike: { value: 11, model: 'planner-v2', evidence: { source: '慢行规划模型 v2', surveyedAt: '2026-05-20' } }
            },
            shadeBySeason: {
              summer: { value: 18, method: 'canopy-imagery', season: 'summer', evidence: { source: '卫星冠层影像解译', surveyedAt: '2026-06-05' } },
              winter: { value: 9, method: 'canopy-imagery', season: 'winter', evidence: { source: '卫星冠层影像解译', surveyedAt: '2026-01-15' } }
            },
            supplies: { value: 2, caliber: 'official-inventory', evidence: { source: '官方设施清查', surveyedAt: '2026-05-20' } },
            difficulty: { value: 1, scale: 'citilvl-3', evidence: { source: '城市慢行三级量表评定', surveyedAt: '2026-05-20' } }
          }
        }
      ]
    },
    r4: {
      id: 'r4',
      name: '湿地公园支线',
      status: 'deleted',
      deletedReason: '湿地保护区调整，路线撤销',
      deletedAt: '2026-08-15T00:00:00Z',
      versions: [
        {
          versionId: 'r4-v1',
          label: '2025 版',
          publishedAt: '2025-05-01T00:00:00Z',
          dataAsOf: '2025-04-15',
          changeNote: '初版（已随路线删除）',
          metrics: {
            distance: { value: 6.8, caliber: 'gps-survey', evidence: { source: '志愿者 GPS 实测', surveyedAt: '2025-04-15' } },
            durationByTransport: {
              walk: { value: 95, model: 'planner-v1', evidence: { source: '慢行规划模型 v1', surveyedAt: '2025-04-15' } },
              bike: { value: null, model: 'planner-v1', evidence: { source: '湿地栈道禁止骑行', surveyedAt: '2025-04-15' } }
            },
            shadeBySeason: {
              summer: { value: 64, method: 'sample-points', season: 'summer', evidence: { source: '采样点人工测定', surveyedAt: '2025-07-15' } },
              winter: { value: 30, method: 'sample-points', season: 'winter', evidence: { source: '采样点人工测定', surveyedAt: '2025-12-15' } }
            },
            supplies: { value: 1, caliber: 'official-inventory', evidence: { source: '官方设施清查', surveyedAt: '2025-04-15' } },
            difficulty: { value: 3, scale: 'citilvl-5', evidence: { source: '城市慢行五级量表评定', surveyedAt: '2025-04-15' } }
          }
        }
      ]
    },
    r5: {
      id: 'r5',
      name: '河滨林荫道',
      status: 'published',
      versions: [
        {
          versionId: 'r5-v1',
          label: '2026 版',
          publishedAt: '2026-04-10T00:00:00Z',
          dataAsOf: '2026-03-30',
          changeNote: '步行尚未完成计时采样；冬季树荫未测',
          metrics: {
            distance: { value: 4.1, caliber: 'gps-survey', evidence: { source: '志愿者 GPS 实测', surveyedAt: '2026-03-30' } },
            durationByTransport: {
              // 步行时长缺值（无口径记录）；骑行有数
              bike: { value: 20, model: 'planner-v2', evidence: { source: '慢行规划模型 v2', surveyedAt: '2026-03-30' } }
            },
            shadeBySeason: {
              summer: { value: 81, method: 'canopy-imagery', season: 'summer', evidence: { source: '卫星冠层影像解译', surveyedAt: '2026-06-01' } }
              // winter 缺值（整条缺失，非 0%）
            },
            supplies: { value: 0, caliber: 'official-inventory', evidence: { source: '官方设施清查：沿线无固定补给点（实测为零）', surveyedAt: '2026-03-30' } },
            difficulty: { value: 2, scale: 'citilvl-5', evidence: { source: '城市慢行五级量表评定', surveyedAt: '2026-03-30' } }
          }
        }
      ]
    },
    r6: {
      id: 'r6',
      name: '山脊观城线',
      status: 'published',
      versions: [
        {
          versionId: 'r6-v1',
          label: '2026 版',
          publishedAt: '2026-02-15T00:00:00Z',
          dataAsOf: '2026-01-30',
          changeNote: '高难度爬坡路线',
          metrics: {
            distance: { value: 7.3, caliber: 'gps-survey', evidence: { source: '骑行队 GPS 实测', surveyedAt: '2026-01-30' } },
            durationByTransport: {
              walk: { value: 110, model: 'survey-avg', evidence: { source: '徒步活动实测均值', surveyedAt: '2026-01-30' } },
              bike: { value: 48, model: 'survey-avg', evidence: { source: '骑行活动实测均值', surveyedAt: '2026-01-30' } }
            },
            shadeBySeason: {
              summer: { value: 40, method: 'sample-points', season: 'summer', evidence: { source: '沿线 18 个采样点人工测定', surveyedAt: '2025-07-30' } },
              winter: { value: 15, method: 'sample-points', season: 'winter', evidence: { source: '沿线 18 个采样点人工测定', surveyedAt: '2025-12-30' } }
            },
            supplies: { value: 3, caliber: 'osm-poi', evidence: { source: '地图兴趣点统计（非官方清查，口径不同）', surveyedAt: '2026-01-30' } },
            difficulty: { value: 5, scale: 'citilvl-5', evidence: { source: '城市慢行五级量表评定', surveyedAt: '2026-01-30' } }
          }
        }
      ]
    },
    r7: {
      id: 'r7',
      name: '滨江短驳线', // 与 r3 同名，但完全是另一条路线（东段新线）
      status: 'published',
      versions: [
        {
          versionId: 'r7-v1',
          label: '2026 东段新线',
          publishedAt: '2026-09-30T00:00:00Z',
          dataAsOf: '2026-09-20',
          changeNote: '东段新建步道，与原西段（r3）不是同一条路线',
          metrics: {
            distance: { value: 3.1, caliber: 'official-signage', evidence: { source: '滨江管委会路牌', surveyedAt: '2026-09-20' } },
            durationByTransport: {
              walk: { value: 36, model: 'planner-v2', evidence: { source: '慢行规划模型 v2', surveyedAt: '2026-09-20' } },
              bike: { value: 14, model: 'planner-v2', evidence: { source: '慢行规划模型 v2', surveyedAt: '2026-09-20' } }
            },
            shadeBySeason: {
              summer: { value: 25, method: 'canopy-imagery', season: 'summer', evidence: { source: '卫星冠层影像解译', surveyedAt: '2026-09-20' } },
              winter: { value: 12, method: 'canopy-imagery', season: 'winter', evidence: { source: '卫星冠层影像解译', surveyedAt: '2026-09-20' } }
            },
            supplies: { value: 3, caliber: 'official-inventory', evidence: { source: '官方设施清查', surveyedAt: '2026-09-20' } },
            difficulty: { value: 2, scale: 'citilvl-3', evidence: { source: '城市慢行三级量表评定', surveyedAt: '2026-09-20' } }
          }
        }
      ]
    }
  },
  accounts: {}
};
