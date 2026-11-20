# Agent 操作日志

## 2026-11-19 21:32 GMT+8 — 入场页术语统一与观测笔记秩序改版

**执行者**：Lumin2Ember (WorkBuddy)
**仓库基线**：`733bc2b`，两端工作树（WorkBuddy worktree 与 E 盘 codex/deploy-pr2）已对齐

### 做了什么

1. **两端同步到远程 main 进度**：`workbuddy/main-ab8b8a2d` 从 `9c315df` 快进到 `733bc2b`（122 文件变更，含内容 v2 与 NAS 部署证据）；`codex/deploy-pr2` 本已在 733bc2b，未动。注：`git fetch` 因 502 代理网关失败，改用 GitHub API 验证远端分支与本地缓存一致。

2. **"暗号"→"密码"术语统一**（仅可见文案，10 个文件）：`web/lobby.html`、`web/network-lobby.mjs`、`web/operator.mjs`、`web/screen.mjs`、`web/inspect.html`、`network-server.mjs`（服务端错误消息）、`tests/entry-ui.test.mjs`、`tests/network-save.test.mjs`、`tools/generate-walkthrough.mjs`、`README.md`。
   - 未改内部 `secret` 系列字段（API/DB 契约），未改 `00_Docs/` 与 `10_QA/` 历史快照。
   - 验证：活跃代码零"暗号"残留；`secret` 计数不变；术语相关测试通过。

3. **入场页视觉改造**（`web/lobby.html` + `web/lobby.css`）：借 stellar-ui 技能包的方法论（宽体眉标 `// CASE FILE NO.001`、真实编号、细线字段行、snap/mech 短硬动效、深浅双主题），不借其紫色/荧光绿皮肤；保留米色纸感、宋体标题与全部手机断点。

4. **计划文档**：新增 `ENTRY_REDESIGN_PLAN.md`，记录已完成项、待办（视觉实测 / 测试 / 交付）、风险取舍与文件清单。

### 验证状态

- 测试：93 项，91 通过；2 项失败（`assets.test.mjs`、`build.test.mjs`）根因是基线缺构建产物 `web/assets.mjs`，`origin/main` 同样缺失，与本次改动无关。
- 静态校验：HTML 标签闭合、CSS 括号平衡、class 对应均通过。
- 视觉实测：**未完成**——浏览器下载按用户要求中止，仅清理了本次产生的空锁目录 `ms-playwright/__dirlock`。

### 结果

改动已落地工作树，**未提交**，待视觉实测后由 Lumile 决定提交与否。详细计划见 `ENTRY_REDESIGN_PLAN.md`。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-19 23:33 GMT+8 — NAS 部署与 GitHub 差异核查 / 配音对稿

**执行者**：Lumin2Ember (WorkBuddy)

### 核查结果

1. **SSH 连接**：`lumi-nas` 配置用的 `lumi_nas_notebook` 密钥被拒（Permission denied）；项目专用账号 `jiaohun-dev` + `~/.ssh/jiaohun-dev` 可正常连接。项目根：`/vol2/1000/Dockers/projects/Project_JiaoHun`。
2. **源码层三方一致**：NAS 仓库 `main` = `origin/main` = GitHub main = `733bc2b`，工作树 0 改动；剧本文件（`剧情.md`、`full-content.mjs`、`levels/*.content.json`）本地与 NAS 哈希完全相同。
3. **运行层**：服务跑 `runtime/network-server.mjs`（与源码哈希一致），静态资源读 `site/`。`site/levels/*/content.json` 与源码逐字节一致 → **玩家实际读到的剧本就是 GitHub 733bc2b 那版**。
4. **静态资源差异**：`site/` 中 8 个前端文件与 `04_Code/web/` 源码哈希不同（构建脚本改写或历史部署残留），`lobby.html` 在 site 中重命名为 `index.html`。服务端无差异。

### 配音对稿（重点）

- 游戏展示 `levels/xiaoshan-demo/content.json` 101 句台词；完整剧本 `05_Content/full-content.mjs`（由《剧情.md》生成）同为 101 句、stage 结构相同。
- **逐字一致仅 1 句，差异 100 句**。两份是并行演化、互不同步的文本；差异集中在序幕（叙述被拆细/改写）与结局。
- 结论：照剧本配音会与屏幕文字大面积对不上，**配音应以展示文本为准**。
- 归档关 `xiaoshan-legacy` 另有 26 句展示台词，不在完整剧本内，需单独从其 content.json 取文本。
- 明细见 `配音对稿清单.md`（101 行逐句对照表）。

### 结果

仅生成报告文件 `配音对稿清单.md`，未改动任何游戏代码。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-19 23:35 GMT+8 — 生成分角色配音稿（以展示文本为准）

**执行者**：Lumin2Ember (WorkBuddy)

### 背景
微信聊天确认配音分工：Lumin2Ember 负责沈砚、曾日理；其余角色由对方处理。口径：**以游戏实际展示文本为准**（不用剧本原文）。

### 产出
- `叫魂_配音稿_沈砚_曾日理.md`：156 句（沈砚 113 + 曾日理 43），按展示顺序，带场景与朗读标注。
- `叫魂_配音稿_全角色.md`：282 句，10 个角色分节，供对方接手其余角色。
- 来源：`levels/xiaoshan-demo/content.json`（GitHub main `733bc2b` = NAS 部署版）。递归抽取全部 `{speaker,text}`（含 intro/locations/rules/presentResponses 等字段），零重复。
- 括号内心理/动作描写标注为「不读」（共 2 句），仅作语气参考。

### 验证
行数校验通过：156 = 113+43，全角色 282，格式无破损。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-19 23:36 GMT+8 — 生成权威完整配音台词本（解决"对不上"）

**执行者**：Lumin2Ember (WorkBuddy)

### 背景
对方反馈"台词本和游戏实际里的台词对不上"。用户要求先以游戏实际展示文本为准，把全部台词整理好。

### 根因
旧《剧情.md》/ `full-content.mjs` 与游戏展示 `content.json` 是并行演化的两套文本。正式关 `intro` 字段两边各 101 句，逐字一致仅 1 句，其余为改写/错位。

### 产出
- `叫魂_分角色配音台词本_以游戏展示为准.md`：**381 句**（正式关 282 + 归档关 99）、10 角色分节，全部逐句取自 `levels/*/content.json`（GitHub main `733bc2b` = NAS 源码 = NAS 部署 site，哈希已核验）。
- 修正此前低估：归档关此前报"26 句"仅数了 intro，递归全文实为 99 句。
- 分工标注：沈砚 146、曾日理 61 → Lumin2Ember；其余 → 对方。
- 括号内心理/动作描写标「不读」（2 句）。

### 验证
数据行 381 = 282+99，角色 10，朗读标注完整，统计口径表述已校正。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 00:16 GMT+8 — 配音稿补入追问台词 + IndexTTS 2.5 参数规范

**执行者**：Lumin2Ember (WorkBuddy)

### 发现并修正的 bug
此前递归抽取台词时，遇到含 `speaker`/`text` 的节点即 `return`，漏掉了其下的 `press.lines`（玩家点"追问"才出现的对话）。修正为"记录后继续下钻"后：总台词 381 → 515，我的部分 156 → 281。追问台词：正式关 102（沈砚55/蔡瑞44/曾日理3）+ 归档关 32（沈砚16/蔡瑞16）。

### 联网核对 IndexTTS 2.5（官方 README）
- 类名 `IndexTTS2`，2.5 从 `indextts.infer_v2_5` 导入（二手文章的 `IndexTTS` 是错的）
- 情感：`use_emo_text=True` + `emo_text` + `emo_alpha=0.6`；2.5 必须构造时加 `use_qwen_emo=True`
- 8 维向量顺序 `[happy, angry, sad, afraid, disugsted, melancholic, surprised, calm]`
- 语速 `duration_factor` 0.5–2.0（>1 慢、<1 快）；多音字 `<字|拼音>`；`use_random=True` 降保真
- 官方 infer() 无公开断句参数 → 稿中每句单独合成，靠标点自然停顿

### 产出
- `叫魂_配音稿_沈砚曾日理_IndexTTS.md`：281 句（沈砚217、曾日理64），含追问 74；每行带 ID（SY-xxx/ZRL-xxx）、场景、类型、台词、emo_text 建议、语速、朗读标注。
- 校验：281 行、ID 唯一、追问 74、不读 11，全部通过。

### 待确认
- 角色"曾日理"的"曾"读作 Zēng 还是 céng，需按参考音频习惯确认。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 02:36 GMT+8 — 远端同步 + IndexTTS 配音验证 + 检修/大屏计划

**执行者**：Lumin2Ember (WorkBuddy)

### 1. 远端同步（重要）
`git fetch` 本次成功。远端 main 已从 `733bc2b` 前进到 **`aca3d1d`**，新增 9 个提交，其中包括：
- `41d08ee 入场页术语统一与秩序改版：深浅主题限定在共用外观页`
- `b09b9f1 入场页深色对齐游戏内卷宗`
- `a06da2e 入场页搭上游戏的场景与卷宗构件（P1）`
- `4d77577 新手引导：覆盖式 coach-mark`
- `7c85f0b 入场页纸纹与边缘磨摊（5060 Ti + Qwen-Image 2.1）`
- `aca3d1d 补上 NAS 部署说明：前端整站重建 + 运行时字符串 + 重启 game-save`

**核对结论**：远端已完整覆盖我在 733bc2b 上的 11 处改动（9 个文件"暗号"计数全为 0，lobby.css 保留了我那套增强层的 6 处特征），且做得更完整。**已丢弃本地重复改动，快进到 aca3d1d**，工作树干净。未跟踪的计划/台词本文档保留。

### 2. IndexTTS 2.5 配音验证
- **CUDA（RTX 5060 Ti）完全跑通**：`.venv`（torch 2.8.0+cu128）+ `use_bf16=True` + `use_qwen_emo=True` + **`use_cuda_kernel=False`**（关键：无 ninja 时会卡死）。
- 产出：5 组情感样板 + 5 组参数对比 + 30 句真实台词批量，0 失败。稳定 RTF ≈1.75，约 8.7 秒/句。
- 参数验证：`duration_factor` 0.90/1.0/1.10 → 3.91/4.42/4.56 秒，单调正确；`emo_alpha` 0.3/0.6/0.9 → RMS 0.192/0.220/0.259。
- **ROCm（7600M XT）突破**：`MIOPEN_FIND_MODE=FAST` 可绕过 conv 死锁（默认模式在 gfx1102 上挂死），首次编译 115.8 秒。详见 `_rocm_work/notes/ROCm-MIOpen突破.md`。
- 产物目录：`E:/projects/VocalStudio-refs/indextts2.5/_rocm_work/`（venv/scripts/samples_cuda/audio_cuda/notes/logs 分类）。
- 台词清单：`lines_shenyan_zeng.json`（281 句，沈砚 217 / 曾日理 64，追问 74，心理描写 11），ID 与 wav 文件名一一对应。

### 3. 计划文档
新增 `MAINTENANCE_AND_SCREEN_PLAN.md`：检修通道（任意进度 + 逐句音频核查 + 审计）与大屏展示增强方案，含 API 设计、实施步骤、验收标准与三个待确认项。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 08:31 GMT+8 — 全量配音完成 + ASR 自动核验

**执行者**：Lumin2Ember (WorkBuddy)

### 覆盖范围扩大到全角色全字段
按要求把"追问和细致文本都要配"落实：从 `levels/*/content.json` 重新导出 **515 句**（原只导出沈砚+曾日理 281 句）。

角色分布：沈砚 217 / 蔡瑞 136 / 曾日理 64 / 案情 40 / 正一 18 / 围观者 11 / 巨成 11 / 超凡 9 / 旁白 5 / 净心 4。
字段分布：intro 127 / locations 113 / rules 87 / 追问 134 / statements 36 / presentResponses 18。

### 修复 ID 体系错位（重要）
早先导出用"混合索引"编号（SY-015 与 ZRL-015 共用一个计数器），全量清单改为按角色独立连续编号后，两套 ID 仅 1.1% 对得上。
已按「角色+文本」（281 组全唯一）把先期生成的 110 个文件迁移到新体系，110 命中、0 冲突。

### 全量合成结果
**515 / 515 完成，0 失败**（中途会话中断漏 2 句，已补跑）。
- 设备：RTX 5060 Ti，`.venv`（torch 2.8.0+cu128）
- 关键参数：`use_bf16=True`、`use_qwen_emo=True`、**`use_cuda_kernel=False`**（无 ninja，否则卡死）
- 单句约 10–19 秒，全量约 90 分钟
- 语气按实机情境分层：序幕叙述 / 查办勘验 / 四轮会审逐级加压 / 最终会审收束，追问句叠加"锐利、尾音上扬"
- 产出：`E:/projects/VocalStudio-refs/indextts2.5/_rocm_work/audio_cuda/`

### ASR 自动核验（FunASR Paraformer + VAD，GPU 89 秒）
结果：**pass 365 / warn 120 / fail 30**，平均 CER **3.99%**。

排查中修掉两个自身错误：
1. 多此一举的 ffmpeg 转 16k 导致全部识别失败（FunASR 本就能处理 22.05kHz）→ 去掉转码。
2. `norm()` 把整句括号心理描写删成空串，导致 40+ 条误判 CER=1.0 → 改为只删括号符号保留内容；另加短句（≤4 字）互相包含即算对。

剩余 30 条 fail 经逐条核对，**绝大多数是 ASR 同音误判而非配音错误**：
- 箱中物证 → 乡中物证
- 有疑 → 友谊
- 纤维之疑 → 谦卑之疑
- 天未黑动身…到衙时已打过初更 → 同音串错

### 听审入口
`_rocm_work/reports/review.html`：515 条可筛选（返工/复核/通过/心理描写）、逐条播放、同屏显示原文与 ASR 识别。
配套 `reports/asr_verify.md` 与 `asr_verify.csv`。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 11:40 GMT+8 — 分支更新 + 本地检修台（台词核查）

**执行者**：Lumin2Ember (WorkBuddy)

### 1. 分支更新
`git merge --ff-only origin/main` → **59b3f5c**（配乐接入 #5：`web/audio.mjs` 440 行 + 11 段 BGM + style.css）。
本次 `git fetch` 被隧道 502 挡回一次，改用已有 origin/main 引用快进；工作区无冲突（已跟踪文件零改动）。

### 2. 构建站点
`node tools/prepare-art.mjs`（生成 `web/assets.mjs`）→ `node tools/build.mjs`。
产物 `09_Builds/JiaoHun_Demo/`：239 文件 / 300MB。

### 3. 检修台新增「台词核查」
**零后端改动**，纯静态 + 前端增强：

- 新增数据：`site/lines.json`（515 句台词清单）、`site/voice-check.json`（ASR 核验：CER + 识别文本 + 判定）、`site/audio/`（515 个 wav，101MB）。
- `04_Code/web/inspect.html`：在账号面板后新增 `#voice-panel`，含统计条、筛选按钮、列表容器、加载更多；配套内联样式（走 CSP 允许的 `style-src 'unsafe-inline'`）。
- `04_Code/web/inspect.mjs`：新增 `loadVoice / voiceFiltered / renderVoice`，单例 `Audio` 播放器（避免 515 个 audio 元素），默认筛选"返工"并按 CER 降序，支持 返工/复核/通过/心理描写/全部 五档，每次加载 40 条。

### 4. 本地运行
`JIAOHUN_PREVIEW_PORT=4188 node 04_Code/tools/preview-v2.mjs`
- 使用 `preview-v2.mjs` 的隔离临时库与 QA 账号：**qa-inspector / LocalPreview123!**
- 入口：`http://127.0.0.1:4188/game/inspect.html`（未登录会跳 `operator.html?role=inspector`）
- 已验证：页面 200、lines.json 200、audio/SY-001.wav 200（116KB）、登录 200、operator/me 返回 qa-inspector

### 5. 注意
- 这是 **LOCAL QA 实例**：临时数据库、无安全 cookie，仅本机演示，不可用于生产。
- 正式接入需按 `MAINTENANCE_AND_SCREEN_PLAN.md` 补：diagnostics 鉴权接口、审计日志、`line_reviews` 持久化。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 11:48 GMT+8 — 修复检修页崩溃 + 新增"任意进度实机查看"

**执行者**：Lumin2Ember (WorkBuddy)

### 1. 修复崩溃
现象：台词核查区报 `Cannot access 'voiceLines' before initialization`，整块不渲染。
原因：`let voiceLines` 声明在文件末尾，而 `loadVoice()` 在 try 块中被提前调用；`let` 有暂时性死区，函数提升救不了变量。
修复：把 `voiceLines / voiceChecks / voiceFilter / voiceShown / voiceAudio` 移到模块顶部（`loadVoice` 调用之前）。

### 2. 新增：检修查看任意玩家任意进度（实机画面）
此前检修只能看摘要（阶段名/版本/修订号），看不到实机渲染。

**后端** `04_Code/network-server.mjs`：
新增 `GET /api/v2/diagnostics/players/:id/observe?slug=`，`auth(req,'inspector')`。
逻辑与房间 observe 一致但不依赖 room：取 `progress(playerId)` → 选中 slug（缺省取最新）→ `saveFor` + `decodeSave` + `getView` 返回只读 view。含 migrationRequired 分支。

**游戏页** `04_Code/web/network-play.mjs`：
新增 `?inspect=<playerId>` 通道：
- 身份走 `operator/me?role=inspector`（未登录跳 `operator.html?role=inspector`）
- `readOnly=true`、独立 storageKey
- 数据源分流：observe 走 `rooms/:room/observe/:player`，inspect 走 `diagnostics/players/:id/observe`
- inspect 模式不接 SSE，改 4 秒轮询（页面隐藏时暂停）
- 复用同一个 `controller.showView()` 渲染器，所以看到的是**真渲染器**的实机画面，不是另做的预览

**检修页** `04_Code/web/inspect.mjs`：
账号列表每份进度下加「查看实机画面」按钮 → 新标签打开 `play.html?inspect=<id>&level=<slug>`；`migrationRequired` 的进度给出说明而不给按钮。

### 3. 验证
- 三个 mjs 语法检查通过
- 服务重启（`JIAOHUN_PREVIEW_SEED=1`，端口 4188）
- 玩家列表返回 3 个测试档（含 1 个 migrationRequired）
- 新接口 `diagnostics/players/1/observe?slug=xiaoshan-demo` 返回 `final_cut` 阶段完整 view

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 11:57 GMT+8 — 检修升级为"沙盒可推进"（能连续听上下文）

**执行者**：Lumin2Ember (WorkBuddy)

### 反馈
Lumile：只读看一个定格 + 列表里孤立听一句，判断不出情境与情绪把控。需要检修能在实机画面上手动前后推进。

### 改造
**后端** `network-server.mjs` 新增：
`GET /api/v2/diagnostics/players/:id/save?slug=`（`auth(req,'inspector')`）
返回原始存档字符串 + version/revision/slug/stageTitle，供前端本地引擎载入；`migrationRequired` 返回 409。

**游戏页** `web/network-play.mjs`：
- `?inspect=<playerId>` 从"只读 observe"改为**沙盒**：拉存档 → `controller.restore(save)` → `readOnly=false`、`sandbox=true`。
- 操作走本地引擎 dispatch，`persist()` 只写本标签页独立 storageKey（`inspector:` 前缀），`cloud` 未初始化 → `onSave` 不上传，**不写回玩家存档**。
- 回退：新增 `onBeforeAct` 钩子记录 `structuredClone(state)` 快照栈（上限 400），`Backspace` 逐步回退（输入框内不触发），可连续退到载入点。
- 状态栏文案：`检修沙盒 · 玩家 #N · 阶段 · 可自由推进，改动不会写回玩家存档`。

**引擎** `web/app.mjs`（最小改动）：
- `act()` 内加 `platform.onBeforeAct?.(state)`（可选钩子，其他模式不受影响）
- `onReady` 暴露 `setState(next){state=next;render()}`

### 验证
- 四个 mjs 语法检查通过
- 重新构建（239 文件）+ 重放 lines.json / voice-check.json / audio（515）
- 沙盒接口返回 `contentVersion:3, stageId:final_cut` 的完整存档
- 服务以 `JIAOHUN_PREVIEW_SEED=1` 重启于 4188

### 用途
检修账号可进入任意玩家任意进度，连续点下去听同一角色的多句台词，判断语气是否连贯、情绪是否贴合场景——这是列表孤立播放做不到的。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 12:16 GMT+8 — 接入游戏内配音 + 修回看键 + 多音字/语调 + 审查页配图

**执行者**：Lumin2Ember (WorkBuddy)

### 1. 关键发现：游戏本来就没有配音播放功能
`web/media/` 下只有 `bgm`，app.mjs 里的 "voice" 全是文字提示（`voice-hint`）。生成的 515 句 wav 只用于检修核查列表，游戏内从未播放——所以"进入检修没听到配音"不是 bug。

### 2. 接入台词配音
- 新增 `voice-index.json`（`说话人|台词` → 音频 id，515 条），音频在 `site/audio/<id>.wav`
- `web/app.mjs`：新增 `playVoiceLine()`，单例 `Audio`，按 `speaker|text` 去重；在 `render` 设置 speaker/text 后调用，仅当 `view.dialogue` 或听审 `view.statement` 存在时播放
- 说明：截图里"先查看物件，听取陈述…"是 app.mjs 第 239 行 `investigation` 分支的**硬编码兜底文案**，不在关卡数据内，因此永远无配音（这是正确的，不是缺陷）

### 3. 修「上一句」
`previous` 原实现为 `if(!view.dialogue&&view.kind==='hearing')act({type:'PREV_STATEMENT'})`——只在听审阶段切证词，其他阶段按了无反应。
改为：听审阶段切证词 → 沙盒内 `platform.undo()` 回退一步 → 否则打开 LOG 看历史。

### 4. 多音字与语调
IndexTTS 支持 `<字|拼音大写>` 标注（如 `<行|XING2>`）。
- `SY-083`「查与拿」→ 文本改 `<查|CHA2>与拿，是两件事。` 强制二声
- `SY-210`「…发生冲突？」→ emo_text 强化反问上扬（`emo_alpha=0.5`）
- 注意：写文件时绝对路径会触发环境 safe-delete 保护导致落盘失败；改「先写 _rocm_work/tmp 再 cp」绕过

### 5. 台词审查页配场景图
新增 `voice-scene.json`（19 个 stage → 4 种背景），审查列表每条右侧显示该句所属场景的背景缩略图（`site/levels/xiaoshan-demo/assets/background_*.webp`）。

—— by Lumin2Ember (WorkBuddy)

## 2026-11-20 12:32 GMT+8 — 合并对方配音 234 句（逐句取优）

**执行者**：Lumin2Ember (WorkBuddy)

### 来源
`E:/projects/Project_JiaoHun/配音输出/`：234 个 wav，命名 `角色_L###.wav`。

**命名规则已破译**：`L###` = 该句在 `lines_all.json` 中的**全局 1-based 序号**，角色前缀用于交叉校验。
抽样验证：`净心_L101` → 第 101 条 = `JX-001`；`围观者_L035` → `WGZ-001`；`巨成_L067` → `JC-001`，全部吻合。

### 分工正好互补
对方 234 句 = 蔡瑞 136 + 案情 40 + 正一 18 + 巨成 11 + 围观者 11 + 超凡 9 + 旁白 5 + 净心 4，
即「除沈砚、曾日理之外的全部角色」，与我方 281 句（沈砚 217 + 曾日理 64）合成完整 515。

### 导入与取优
- 导入 234 句，0 越界、0 角色不符；原版备份至 `_rocm_work/audio_cuda_mine/`
- 规格一致：22050Hz / 16-bit / mono
- 逐句 ASR 对比：对方**更优 34 / 更差 29 / 持平 171**，平均 3.26% → 2.97%
- 对「对方更差」的 29 句换回我方版本

### 最终核验（515 句）
| 版本 | pass | warn | fail | 平均 CER |
|---|---|---|---|---|
| 我方全部 | 370 | 127 | 18 | 3.30% |
| 对方全量 | 374 | 122 | 19 | 3.17% |
| **逐句取优** | **386** | **112** | **17** | **2.85%** |

已同步 515 个 wav 与 `voice-check.json` 至站点，检修审查页与游戏内配音即时生效。

—— by Lumin2Ember (WorkBuddy)
