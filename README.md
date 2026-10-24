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

```bash
npm install
npm run dev        # http://localhost:5173
```

生产构建（`dist/` 可直接静态部署，含 `file://` 打开）：

```bash
npm run build
npm run preview
```

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
4. **图鉴**：主菜单按 `C`（或点击 `[ C ] 查阅图鉴 codex`）打开，分「武器 / 敌人 / 被动」三页，逐条查看符号、攻击方式、成长数值与敌人行为说明，用 `← →` 或 `1 2 3` 翻页、`C`/`ESC`/点击返回。
5. HP 归零（或被 `0xDEAD` 撞毁）后结算存活时间、击杀数与构筑。

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
    MenuScene.ts          标题、操作说明、最高记录
    CodexScene.ts         图鉴：武器 / 敌人 / 被动三页，数据直接取自 data/
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

### QA 跳过参数

长局调试用 URL 参数直接跳到中后期并自动补齐构筑与 Boss：

```
http://localhost:5173/?skip=88      # 从 88 秒开始，按自然档期（95s）刷新 Boss
http://localhost:5173/?skip=120&orbLife=3   # 缩短掉落存活时间，便于验证经验球超时消散
```
