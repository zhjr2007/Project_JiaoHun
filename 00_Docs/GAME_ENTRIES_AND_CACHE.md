# 游戏入口清单与缓存（2026-11-20）

## 四个入口，同一个站点

`Project_JiaoHun` 的 v2 网络存档版有四个可达入口，**都指向 NAS 上的同一个目录**
`/vol2/1000/Dockers/projects/Project_JiaoHun/site`：

```text
https://sociology.lumi-ember.top/game/
https://sociology.lumi-ember.top:8443/game/
https://sociology.lumi-ember.xyz/game/
https://sociology.lumi-ember.xyz:8443/game/
```

- `.top` 与 `.xyz` 解析到同一组地址（IPv6 `2409:8a55:...` 与 IPv4 `8.163.5.244`），由同一个 Caddy 提供服务。
- 因此**更新一次 `site/` 即四个入口同时生效**，不需要分别发布。
- 更换入口（换域名、换端口、换协议）会换掉浏览器 origin，`localStorage` 也随之分开：主题偏好
  （`jiaohun.ui.theme.v1`）与音乐开关（`jiaohun-demo.music.v1`）在各入口之间互不影响。这是浏览器行为，不是配置错误。

## 怎么证明"一致"（每次部署后跑一次）

```bash
node 04_Code/tools/verify-entries.mjs
```

工具对四个入口逐个取首页、样式、脚本、纹理、配乐与接口健康，按**字节哈希**比对：

- 全部 `OK` → 四个入口发的是同一份站点，退出码 0。
- 出现 `DIVERGENT` → 有入口指向别的目录，需核对 NAS 上各站点块的 `root` 是否都指向 `Project_JiaoHun/site`。
- 出现 `UNREACHABLE` / `STATUS` → 网络或服务问题，与内容无关。

2026-11-20 02:5x 的实测结果：4 个入口 × 9 项资源，全部一致（首页 2067B、`lobby.css` 21259B、
`play.html` 8098B、`audio.mjs` 19209B、`chrome/paper.webp` 5796B、`bgm_01_entry.mp3` 9846865B）。

## 为什么有时"看起来没更新"

Caddy 这两个入口都**没有发 `Cache-Control`**，只有 `Etag` 与 `Last-Modified`。浏览器会对这类响应做
"启发式缓存"（通常按文件年龄的 10% 估算新鲜期）：旧文件放得越久，越可能被直接复用而不回源。
表现就是——HTML 因为 `Etag` 变了而更新，**CSS/图片却还是缓存里那份旧的**，于是"文字变了、背景没变"。

三种处理方式：

1. **立刻生效**：硬刷新（`Ctrl/Cmd + Shift + R`）、无痕窗口，或在地址后加 `?v=2` 回车。
2. **由我们控制（代码层）**：给 CSS/JS 引用加构建戳（如 `lobby.css?v=20261120`），换 URL 即强制回源。
   代价是每次发布要动一个版本号。
3. **一次到位（需要维护者）**：在 Caddy 上按类型下发缓存策略——HTML/CSS/JS 用
   `Cache-Control: no-cache`（每次校验，命中 `Etag` 时只回 304），`chrome/*`、`levels/*`、`media/*`
   这类几乎不变的用长缓存。Caddy 配置属维护者权限，本项目账号只读，不自行修改。

## 与部署流程的关系

- 构建、切换、冒烟与回滚见 [NAS_DEPLOY_PLAN_20261120.md](NAS_DEPLOY_PLAN_20261120.md)。
- 发布后必须补一步：`node 04_Code/tools/verify-entries.mjs`，确认四个入口一致再收工。
- 该工具需要联网，**不参与 `node --test`**；自动化测试与线上状态是两件事。
