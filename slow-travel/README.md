# 慢行站 · 路线对比（slow-travel-compare）

扩展慢行站的路线对比能力。零第三方依赖：Node 内置 HTTP 服务 + JSON 文件持久化 + 原生前端；
服务端与浏览器共用 **同一份** `shared/core.js`，保证卡片、抽屉、导出报告使用同一组参数与证据。

## 运行

```bash
cd slow-travel
npm run seed        # 初始化/重置演示数据（可选，首次启动会自动建库）
npm start           # http://localhost:8080
npm test            # 7 组验收测试（node:test，真实 HTTP 起服）
```

两个隐身窗口输入不同账号（如 tester-a / tester-b）即可模拟“两设备”。
页面底部「验收演示操作」可撤回/恢复/删除路线、发布新版本、重置数据。

## 需求 → 实现对照

### 1. 抽屉五维指标：距离、时长、树荫、补给、难度
- 列定义 `shared/core.js` 的 `METRICS`；单元格状态三态：`ok`（含 `isZero`）/ `missing`（缺值）/ `unavailable`（占位行）。

### 2. 时长依交通方式与估算模型；树荫依季节与采样方法；不同口径禁止直接排序
- 时长口径键 = `交通方式|估算模型`（walk/planner-v2 与 walk/survey-avg 不可比）。
- 树荫口径键 = `季节|采样方法`（summer/sample-points 与 summer/canopy-imagery 不可比）。
- 距离 = 里程来源（official-signage / gps-survey）；补给 = 清查来源；难度 = 评级量表 id。
- 只有“同口径且 ≥2 个数值”的列 `comparable=true`；表头排序按钮禁用，`comparableSort()` 在核心层再次抛错兜底。
- 抽屉「不可比项说明」与导出报告均列出每种口径与不可排序原因。

### 3. 缺值与零值严格分开
- `r5`：补给点**实测为 0**（`ok + isZero`，紫色标注），步行时长与冬季树荫为**缺值**（无数据，斜体标注“非零值”）。
- 排序时零值是正常数值参与排序，缺值不参与数值比较。

### 4. 比较 API 固定每条路线的公开版本；两种一致取数政策
- `policy=snapshot`：按分享链接固定 `pins={routeId:versionId}`，跨路线同一时点（`asOf`）快照；
  存在新版本时只在 `row.alerts[].type=newer_version` **提示**，绝不静默替换。
- `policy=latest`：每条路线各取其最新公开版本；链接里的 pin 不参与取数（响应中有说明性提示）。
- 固定到不存在的版本 → 占位 `version_missing`，不回退最新、不猜同名。

### 5. 数据库保存用户选择与偏好
- 账号草稿 `GET/PUT /api/accounts/:id/draft`：集合、固定版本、政策、时点、交通方式、季节、**个人过滤器**。
- 偏好/过滤器最后写入获胜；集合用三方合并（`mergeIntoCurrent` / `mergeSelection`），**删除优先**。
- 并发基于 `revision + baseCollection`，过期写入不报错而在响应标注 `stale/merged_remote`，客户端回补并提示。

### 6. URL 仅编码公开选择；个人草稿经账号接口同步
- 公开 hash：`#/compare?routes=r1:r1-v2,r2:r2-v2&policy=snapshot&asOf=...&transport=walk&season=summer`。
- latest 模式：`routes=r1,r2`（只分享集合，不固定版本）。
- 不编码：账号、revision、过滤器、排序、抽屉状态。

### 7. 删除/撤回路线保留占位原因，不以同名路线替代
- 删除：无论是否 pin，恒为占位行 `route_deleted` + 原因（r4“湿地保护区调整”）。
- 撤回：快照下历史版本**冻结展示**（黄条 + 撤回原因），不是占位但也不参与新固定；latest 下取其最后一个版本。
- 同名：r3 与 r7 都叫“滨江短驳线”，id 不同即不同路线；旧链接的 r3 永远不会被 r7 顶替（卡片有“同名注意”角标）。

### 8. 验收五场景（test/acceptance.test.js）
1. 两设备改集合：A 建立 → B 增 r5 → A 用旧 revision 删 r1，合并结果 `r2,r5`；同项并发增删时删除优先。
2. 过滤导致隐藏项：隐藏只影响卡片（半透明 + “仍在对比集合中”提示），集合与抽屉不变。
3. 异步响应乱序：卡片流与对比流**各自独立序号**（cardSeq/compareSeq），只渲染各自最后一次响应。
4. 保存时撤回：固定版本冻结 + 撤回原因；恢复后旧链接回可用；删除则永久占位。
5. 旧分享链接：恢复链接仍按固定版本取数；删除路线打开为占位；新版本只提示不替换。
6. 卡片、抽屉、导出报告：均由同一个 `buildComparison()` 返回对象渲染，证据（来源 + 测定日期）逐格下发。

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/routes?transport=&season=` | 路线卡片（状态、全部公开版本、各版单元格） |
| POST | `/api/compare` | body: `routeIds,pins,policy,asOf,transport,season`；返回列口径/可比性、行、证据、占位、alerts |
| GET | `/api/accounts/:id/draft` | 个人草稿（无则返回默认草稿 `exists:false`） |
| PUT | `/api/accounts/:id/draft` | `baseRevision,baseCollection,collection{added,removed},pins,policy,asOf,transport,season,filters` |
| POST | `/api/test/route/withdraw|restore|delete|publish-version` `/api/test/reset` | 仅演示/测试（`ENABLE_TEST_API=0` 可关闭） |

## 目录

```
slow-travel/
├── shared/core.js        # 口径/快照/占位/合并/URL/报告（前后端共用，无环境依赖）
├── server/
│   ├── index.js          # HTTP 服务、路由、静态托管
│   ├── db.js             # JSON 持久化（原子写）+ 草稿三方合并
│   ├── seed-data.js      # 演示数据（含撤回/删除/同名/缺值/零值）
│   └── seed.js           # 建库脚本
├── public/               # 前端（index.html / css / js/app.js）
├── data/db.json          # 运行时数据库（gitignore）
└── test/acceptance.test.js
```
