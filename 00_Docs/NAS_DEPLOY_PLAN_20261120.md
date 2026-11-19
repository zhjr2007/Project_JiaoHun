# NAS 部署计划：入场页改版批次（2026-11-20）

> 状态：**尚未部署**。本文只是这一批的部署计划与验收清单；维护者执行后再补一份 `NAS_DEPLOY_RESULT_20261120.md`。
> 上一批（认证 v2）的记录见 [NETWORK_SAVE_20261115.md](NETWORK_SAVE_20261115.md)；运维交接见 [AUTH_V2_HANDOFF.md](../04_Code/deploy/AUTH_V2_HANDOFF.md)。

## 1. 这批改了什么（决定怎么部署）

| 面 | 是否变化 | 说明 |
|---|---|---|
| 前端 `site/` | **变** | 入场/主持/检修/大屏四页的样式与标记；新增 `theme.js`、`entry-tour.mjs`、`chrome/*.webp` |
| 运行时 `runtime/` | **变（仅字符串）** | `network-server.mjs` 里 5 条玩家可见错误消息由旧词改为「密码」；无接口、参数或状态机变化 |
| 数据库 | 不变 | 无迁移、无新表、无列改名；`progress-v2.sqlite` 不碰 |
| Caddy / CSP | **不变** | 新增脚本都是同源外链文件，`script-src 'self'` 无需放宽；不放宽 `unsafe-inline` |
| 关卡内容 `levels/` | 不变 | `content.json` / `manifest.json` / 贴图均未动，`levels/index.json` 由构建重生成 |
| 冻结核心 | 不变 | `core/engine.mjs`、`core/save.mjs` 未改 |

**因此**：不能只覆盖几个静态文件——`runtime/network-server.mjs` 也要一起换，并且 `game-save` 需要重启一次（切换脚本本来就会停/起它）。`site/` 必须是整站重建，不能当成部分覆盖层。

## 2. 构建（在 `04_Code` 里）

```bash
node tools/prepare-art.mjs          # 生成 web/assets.mjs 与 web/assets/（gitignored 生成物）
node --test tests/*.test.mjs        # 期望 103 项全通过
node tools/build.mjs                # 生成 09_Builds/JiaoHun_Demo/site/
```

本批新增到 `site/` 的条目，上线后必须能直接取到（缺任何一个都会静默降级）：

- `theme.js`（深浅切换；缺了 → 深色永远不激活）
- `entry-tour.mjs`（新手引导；缺了 → 入口按钮点了没反应）
- `chrome/paper.webp`、`chrome/stain.webp`（纸纹与边缘磨摊；缺了 → 404，页面仍可读）
- `play.html` 里的 `#orientation-landscape` 与 `#portrait-continue`（横屏建议卡两枚按钮）

`static-site.mjs` 已把 `theme.js`、`entry-tour.mjs` 登记进复制清单，并对 `web/chrome/` 做整目录复制；
`tests/ui-chrome.test.mjs` 会盯住"页面引用的文件必须进清单"和"CSS 里的 url() 必须存在"这两类断链。

## 3. 暂存与切换

沿用既有流程，不新造脚本：

1. 在 NAS 项目目录下建一个独立的 staging 子目录，放入本轮完整的 `site/` 与 `runtime/`（`runtime/` 需含新的 `network-server.mjs`）。
2. 在 staging 中用临时数据目录演练一次启动与健康检查，**不接触生产 `progress-v2.sqlite`**。
3. 维护者通过已授权终端运行 `runtime` 外的 `upgrade-auth-v2.py --stage=<staging>`：只停 `game-save`，用 SQLite backup 快照数据库，保留旧 `site`、`runtime`，切换后启动并做健康检查。
4. 失败时恢复旧站点/运行时代码并重启原服务；新旧数据库文件都保留供检查。

停服务期间玩家侧表现：本机 pending 存档继续保留，恢复后自动补传（既有行为，无改动）。

## 4. 上线后逐项冒烟（本批新增的部分）

静态资源可达性（应为 200，且 `Content-Type` 正确）：

```text
GET /game/theme.js            text/javascript
GET /game/entry-tour.mjs      text/javascript
GET /game/chrome/paper.webp   image/webp
GET /game/chrome/stain.webp   image/webp
```

页面行为（桌面与手机各走一遍）：

1. `/game/` 右上角「深色卷宗 / 浅色纸面」可切换；**刷新后保持**（localStorage `jiaohun.ui.theme.v1`）；深浅都无布局错位。
2. 浅色：整页纸纹 + 桌面边缘磨摊；深色：满幅场景图（手机按裁切，仍可见）。
3. 点「第一次查案？看引导」→ 自动切到「创建账号」→ 逐步走到恢复码；字段可直接输入（遮罩不吃点击）；`Esc` 或「跳过引导」退出后不再自动出现。
4. 游戏页竖屏：建议卡两枚按钮在拇指区；点「横屏展开」整页转横屏（Android 全屏下会再锁方向，iOS 走 CSS 旋转兜底并给出提示）。
5. 玩家可见文案里不出现旧术语；注册/登录/恢复码/改密四条路径的提示都是「密码」。
6. 既有回归面：注册与一次性恢复码、跨设备存档、旧档迁移确认、主持建场与大屏二维码、检修台只读观察。

浏览器控制台应无 CSP 违规（新增脚本均为同源外链）；除预期的未登录 401 与 favicon 403 外不应有资源错误。

### 四个入口一起验

同一份 `site/` 由四个入口提供服务（`.top` / `.xyz` × 443 / 8443，见 [GAME_ENTRIES_AND_CACHE.md](GAME_ENTRIES_AND_CACHE.md)），
更新一次即全部生效。发布后跑一次：

```bash
node 04_Code/tools/verify-entries.mjs
```

它按字节哈希比对四个入口的首页、样式、脚本、纹理、配乐与接口健康；出现 `DIVERGENT` 说明有入口指向别的目录，
需核对 NAS 上各站点块的 `root`。全部 `OK` 且退出码 0 才算这一步通过。

## 5. 回滚

- 站点：恢复上一轮的 `site.before-<timestamp>/`；`runtime/` 同理。
- 数据库：本批不改库，正常回滚不需要动 `progress-v2.sqlite`；若为排查需要备份，用 SQLite backup API 或停服务后连同 WAL 一起处理，**不要只复制主文件**。
- 回滚后 `theme.js` 缺失属预期（旧站点没有它），玩家侧只会退回浅色。

## 6. 风险与未确认项

- **观感由作者定**：纸纹强度、边缘磨摊深浅、深色场景图浓淡都是主观项；`02_Art/CHROME_MANIFEST.json` 里两张纹理仍是 `generated-working-art; user-artistic-acceptance-pending`。
- **真机未验**：`requestFullscreen` + `orientation.lock` 在 Android Chrome 与 iOS Safari 的行为差异、软键盘弹起时引导牌的位置，只能在真机确认；模拟视口测过的是 CSS 旋转兜底这条路径。
- **基线既有问题未处理**（非本批引入）：360px 下入场页 header 两个链接高 30px、主持页页签链接 21.4px、大屏 join-url 16.5px，均低于 44px 触控建议。
- **纸纹体积**：两张纹理共 18KB，只在浅色加载；深色用已有的关卡场景图（48KB，与大屏 intro 共用同一文件，不新增请求）。

## 7. 本地已验证的部分（供维护者判断是否值得占用一次部署窗口）

- `node --test` 103 项全通过（按上面顺序先跑 `prepare-art`）。
- 51 个状态实测（四页 × 深/浅 × 320/360/390/412/430/1440/1920 + 系统文字放大一档 + 引导四态 + 竖屏建议卡三态）：横向溢出 ≤0、文字对比度 ≥4.5:1、引导高亮环与目标重叠 10131–26054px²。
- 与基线 `733bc2b` 逐项对照：小于 44px 的控件集合完全相同，未引入触控回归。
- 自动测试、渲染与截图**都不等于**作者对观感的认可，也不等于真机通过——这两项仍待确认。
