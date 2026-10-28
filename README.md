# Code Survivors

一个代码主题的吸血鬼幸存者（Vampire Survivors）类型 2D 自动射击生存游戏。
玩家控制发光符号 `</>`，在无限刷新的 Bug 潮中生存，收集二进制经验球升级，从 6 种武器和 8 种被动中构筑 Build。

技术栈：**Phaser 3 + TypeScript + Vite**，纯 Canvas/WebGL 渲染，无外部美术资源（所有图形在运行时用 Canvas2D 生成并发光处理）。

## 高清渲染（HiDPI）

游戏按显示器 `devicePixelRatio` 渲染（上限 2x）：canvas 后备缓冲为 CSS 尺寸的 2 倍，由浏览器降采样显示，因此在高分屏上文字、代码字形和线条都是锐利的。

- 所有发光字形贴图按 DPR 生成（`TEX_SCALE = 1/DPR` 换算回世界坐标），1 贴图像素 = 1 物理像素。
- 相机 `zoom = DPR`；UI/菜单相机额外设置 `origin(0,0)` 以保证布局坐标不变。
- 关闭 WebGL MSAA（`antialiasGL: false`）——2x 超采样本身就是抗锯齿，同时省掉 MSAA 在 4K 级缓冲上的带宽开销（Intel 核显实测 23fps → 60fps）。
- 文字对象统一 `setResolution(DPR)`，避免文字贴图被放大后糊掉。

## 运行

### 桌面版（macOS / Windows）

从 [GitHub Releases](https://github.com/RIOTSAKURA/Code-Survivors/releases) 下载对应系统的安装包。首次桌面版本需要维护者推送版本标签、等待构建成功后才会出现在这里。

| 系统 | 下载文件 | 安装 |
| --- | --- | --- |
| macOS Apple Silicon（M 系列） | `Code-Survivors-版本-mac-arm64.dmg` | 打开后拖到 Applications |
| macOS Intel | `Code-Survivors-版本-mac-x64.dmg` | 打开后拖到 Applications |
| Windows x64 | `Code-Survivors-版本-win-x64.exe` | 运行安装向导 |

桌面版自带运行环境，无需 Node.js 或浏览器，安装后可离线游玩。最高记录保存在应用自己的本地数据目录，与浏览器版独立。macOS 另外提供 ZIP 包。

当前安装包没有受信任的发行者签名或 Apple 公证；macOS 仅使用无需证书的 ad-hoc 签名，以保证 Apple Silicon 应用的完整性要求。macOS Gatekeeper / Windows SmartScreen 可能显示验证提示。仅在确认文件来自本仓库 Release 后，使用系统提供的允许打开选项；不要全局关闭系统安全检查。正式签名发布需要另行配置证书。

### 浏览器开发

```bash
npm install
npm run dev        # http://localhost:5173
```

生产构建（`dist/` 可静态部署；浏览器请通过 HTTP 服务访问）：

```bash
npm run build
npm run preview
```

### 桌面开发与打包

建议使用 Node.js 24 LTS，桌面工具链要求 Node.js 22.12 或更新版本。

```bash
npm ci
npm run desktop          # 构建并打开 Electron 窗口
npm run desktop:pack     # 生成当前系统的未安装应用目录
npm run desktop:dist     # 生成当前系统的分发包，输出到 release/
npm run desktop:smoke    # 检查桌面启动、字体、隔离、战斗和暂停（先 build）
```

macOS 安装包在 Mac 上构建，Windows 安装包在 Windows 上构建。桌面窗口运行本地打包资源，不依赖 Vite 服务。渲染进程开启 sandbox 和 contextIsolation，关闭 Node.js 集成。

### GitHub 自动发布

`.github/workflows/desktop-release.yml` 在推送 `v*` 标签时分别构建 macOS arm64、macOS x64、Windows x64；全部构建及桌面检查通过后，将安装包上传并公开到对应 GitHub Release。标签必须与 `package.json` 版本完全对应。

推送 `main` 或在 Actions 页面手动运行 **Desktop release** 时，仅生成可下载的构建产物，不发布 Release。修复提交推送后会自动验证，无需重新运行仍指向旧提交的失败任务。

请先完成本地验证，并由用户确认后再推送。以本次版本为例，将版本更新与功能改动放在同一提交，再创建并推送附注标签：

```bash
git tag -a v1.8.0 -m "v1.8.0"
git push origin HEAD
git push origin v1.8.0
```

工作流通过仓库内置的 `GITHUB_TOKEN` 上传，不需要个人访问令牌；仓库需允许 GitHub Actions 运行。它不会自动提交、打标签或推送代码。

## 操作

| 按键 | 功能 |
| --- | --- |
| `W A S D` / 方向键 | 移动（自动向最近敌人开火） |
| `1` `2` `3` / 鼠标点击 | 选择升级项 |
| `C` | 主菜单：打开图鉴（weapons / bugs / modules 三页） |
| `P` / `ESC` | 暂停 |
| `M` | 静音开关 |
| `R` / `Q` | 结算界面：重新部署 / 退回菜单 |

## 玩法

1. **开局**先从 3 个进攻型武器中选择起始武器。
2. 击杀 Bug 掉落发光 `0` / `1` 经验球 —— **经验留在原地**：敌人死在哪儿，`0`/`1` 就落在哪儿不再移动；只有角色走入拾取范围（角色周围绿色圆圈）后，球才会被吸附并计入经验。装载「垃圾回收」可扩大吸附范围。地上未拾取的球有存活时间：普通球 20 秒、稀有球/Boss 掉落 35 秒，到期前 7 秒开始闪烁提示，超时后消散。
3. 升级时弹出 IDE 自动补全风格的面板，从 3 个随机选项中选 1 个（6 种武器 ×8 级 + 8 种被动 ×5 级）。
4. **随机地形**：每局按种子生成一张代码主题地图 —— 视觉上有 `/*注释块*/`、`git diff` 条纹、`#region` 色带；玩法上有 4 类**不阻挡移动**的代码区域（`#include` 攻速缓存、`#pragma` 移速加速、`/*leak*/` 减速池、`FIXME` 崩溃陨坑），走入即生效，增益类区域停留久了会耗尽、离场后回充。用 `?seed=123456` 可复现同一张地图。
5. **图鉴**：主菜单按 `C`（或点击 `[ C ] 查阅图鉴 codex`）打开，分「武器 / 敌人 / 被动」三页，逐条查看符号、攻击方式、成长数值与敌人行为说明，用 `← →` 或 `1 2 3` 翻页、`C`/`ESC`/点击返回。
6. HP 归零（或被 `0xDEAD` 撞毁）后结算存活时间、击杀数与构筑。

## 项目结构

```
src/
  main.ts                 游戏入口与 Phaser 配置
  config.ts               世界尺寸、配色、玩家/刷怪平衡常量
  core/
    state.ts              共享 HUD 状态与场景事件总线
    types.ts              实体与存档数据结构
    rng.ts                可复现随机数（mulberry32）
    grid.ts               空间哈希网格（最近邻/半径查询）
    pool.ts               精灵与文字对象池
    textures.ts           运行时发光文字/网格/光点贴图生成
    audio.ts              WebAudio 合成音效（无音频资源）
    records.ts            localStorage 最高记录
  data/
    weapons.ts            6 种武器数据与成长曲线
    enemies.ts            6 种敌人数据、解锁权重、强度缩放
    passives.ts           8 种被动数据
  systems/
    progression.ts        XP 曲线、升级候选抽取、升级生效（纯函数，可单测）
    fx.ts                 粒子、飘字、代码字符碎裂特效
  scenes/
    BootScene.ts          生成所有贴图后进入菜单
    MenuScene.ts          标题、操作说明、最高记录 + 背景虫群（两侧向中央进攻）
    CodexScene.ts         图鉴：武器 / 敌人 / 掉落 / 地形 / 被动五页，数据直接取自 data/
    GameScene.ts          主循环：移动、武器、敌人 AI、刷怪、Boss、结算
    UIScene.ts            HUD、升级面板、暂停与结算界面
tests/                    纯逻辑单元测试（vitest）
scripts/smoke.mjs         真实浏览器端到端冒烟测试（playwright-core）
```

## 测试与验证

```bash
npm test           # 60 条纯逻辑单测：XP 曲线、升级抽取/生效、掉落吸附、图鉴数据完整性、Boss 召唤池等
npm run typecheck  # TypeScript 严格模式
npm run build      # 生成 dist/
npm run smoke      # 用本机 Chrome headless 跑完整游戏并断言（需先 npm run build）
```

`npm run smoke` 会真实启动游戏并检查：启动 → **图鉴翻页与返回** → 开局选武器 → 击杀/升级/构筑成长 → 暂停时钟冻结 → 视口缩放 → 帧率 → 掉落规则（原地留存/移动可拾取/超时消失）→ 死亡结算与记录持久化 → Boss 过场静帧、清场、召唤小怪、无掉落与二阶段弹幕，同时断言浏览器控制台零报错，并把截图写入 `screenshots/`。

本机烟测默认要求普通视口和 HiDPI 都达到 30 FPS。GitHub 共享 runner 使用 `SMOKE_PERFORMANCE=report`：记录帧率并检查动画仍在推进，但不将虚拟机帧率当作玩家设备的性能验收；其他功能断言仍然有效。CI 的总测试预算为 15 分钟，失败时可在 `browser-diagnostics` 构建产物中查看日志和截图。可通过 `SMOKE_BROWSER_PATH` 指定已安装的 Chrome / Chromium 可执行文件。

中文字体烟测将实际渲染结果与打包的字体文件逐像素比较，不要求它与操作系统字体有固定差异。Boss 场景使用固定地图和较小视口，玩家原地迎战，并按模拟时间观察战斗。巡逻转向和拾取测量也按模拟时间推进，避免低帧率下移动距离不足。

### QA 跳过参数

长局调试用 URL 参数直接跳到中后期并自动补齐构筑与 Boss：

```
http://localhost:5173/?skip=88      # 从 88 秒开始，按自然档期（95s）刷新 Boss
http://localhost:5173/?skip=120&orbLife=3   # 缩短掉落存活时间，便于验证经验球超时消散
http://localhost:5173/?seed=123456          # 固定地形种子，复现同一张地图
```
