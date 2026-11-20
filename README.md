# 叫魂 · 萧山剪辫案 AVG Demo

清代历史背景的调查推理游戏工作稿。仓库名称 `Project_JiaoHun` 为暂用工程名，正式游戏名称尚未确定。

当前精简版包含调查、两轮普通会审、三段追加查问、帽子调查、三步最终会审、成功与两种失败结局。剧情由数据驱动，保留扩展完整四轮的接口。离线单文件仍可独立运行；NAS 版本增加了玩家账号、跨设备存档、展示场次、主持观察和大屏入口。

## 运行

需要 Node.js 22 或更新版本。运行时没有第三方依赖，无需安装 npm 包。

在仓库根目录执行：

```powershell
node 04_Code/tools/prepare-art.mjs
node 04_Code/server.mjs
```

浏览器打开 http://127.0.0.1:4173 。服务仅监听本机；进度保存于浏览器，可导入、导出 JSON。旧版 v1 存档兼容。

完整网络版可使用一次性本地预览：

```powershell
node 04_Code/tools/preview-v2.mjs
```

浏览器打开 http://127.0.0.1:4188/game/ 。该预览使用临时数据库和固定 QA 账号，只用于本机验收，不能部署到生产。

## 验证与分发

```powershell
node 04_Code/tools/prepare-art.mjs
node --test 04_Code/tests/*.test.mjs
node 04_Code/tools/build.mjs
```

构建生成 `09_Builds/JiaoHun_Demo/`、内嵌图片的 `Demo.html` 和 ZIP。资源副本及分发包可重建，不提交至 Git。不要在派生目录内保存手写文件或玩家存档。

## 项目内容

| 目录 | 内容 |
|---|---|
| `00_Docs` | 设计取舍、实施记录与资产索引 |
| `02_Art` | 原创生成图片、早期版本、提示词及资源清单 |
| `04_Code` | 状态机、存档、AVG 客户端、服务、工具与测试 |
| `05_Content` | 可执行剧情与改编说明 |
| `10_QA` | 测试结果、独立审查及浏览器截图 |

选用原图共45张：6背景、8人物共30张立绘与差分、4器物、5特写；映射55项运行资源。13项凭据均有配图，记录类凭据复用人物和场景。

本地的第三方参考图、参考视频、原著摘录与聊天过程记录未上传。相关原始资料的本地路径仍可在设计记录中找到；运行和构建不依赖它们。

## 验收与创作边界

79项自动测试通过；浏览器中检查成功路线、普通/最终失败及重试、存档导入导出、v2 注册/恢复码、桌面/手机视口、大屏二维码、玩家加入与只读观察。详见 [验收记录](10_QA/AVG_ACCEPTANCE_20261115.md) 和 [网络存档记录](00_Docs/NETWORK_SAVE_20261115.md)。浏览器工具禁止 file 协议，因此独立 HTML 的实际双击启动未记为实机通过。

图像和对白均为可校订工作稿，不代表用户已认可的最终美术。帽子形制和现场纤维比对属于游戏新增设计；材料相似不作为唯一来源鉴定。沈砚的具体官职未定。本次不含配音和视频。

此仓库尚未授予开源许可。
# NAS 网络存档版与投稿

入口构建在 `09_Builds/JiaoHun_Demo/site/`，关卡源在 `levels/`，投稿规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。线上 v2 使用独立的 `network-server.mjs`、SQLite 和游戏专用账号；玩家以用户名和密码登录，注册时一次性展示恢复码，进度自动保存到 NAS。主持端与检修端使用另建的专用角色账号，不复用玩家密码或 NAS 系统账号。最新部署与运维说明见 [网络存档记录](00_Docs/NETWORK_SAVE_20261115.md)、[v2 交接单](04_Code/deploy/AUTH_V2_HANDOFF.md) 与 [入场页改版部署计划](00_Docs/NAS_DEPLOY_PLAN_20261120.md)；四个入口与缓存说明见 [入口清单](00_Docs/GAME_ENTRIES_AND_CACHE.md)。旧版离线 Demo.html 和本机 server.mjs 仍保持离线行为。

项目共享账号、Git 工作流与受控服务重启见 [NAS 项目维护说明](00_Docs/COLLABORATOR_NAS_ACCESS.md)。

当前账号、home 空间与权限快照见 [NAS 账号清单](00_Docs/NAS_ACCOUNT_INVENTORY_20261115.md)。

协作者 AI agent 的接入提示词见 [叫魂 Agent 提示词](00_Docs/JIAOHUN_DEV_AGENT_PROMPT.md)，NAS 开机项和空壳项目见 [启动项快照](00_Docs/NAS_STARTUP_AND_EMPTY_PROJECTS_20261115.md)。
