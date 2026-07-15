# 技术选型

## 1. 选型目标

桌面 Pet 像一个体积很小、但需要同时懂“桌面窗口”和“动画”的工具箱。选型重点不是堆叠能力，而是在跨平台开发速度、交互精度、维护成本之间取得平衡。

目标约束：

- 同一套核心代码支持 Windows 与 macOS。
- 能控制透明置顶窗口、托盘、多屏、鼠标穿透和登录启动。
- 能按像素命中角色，并稳定播放透明精灵动画。
- 首版状态有限，逻辑必须可测试、可替换素材。
- 可生成 DMG 和 Windows 安装包，并接入平台签名。

## 2. 选型总览

| 领域 | 选择 | 主要原因 | 代价 |
|---|---|---|---|
| 桌面运行时 | Electron 43 | BrowserWindow、Tray、screen 和登录项能力完整；macOS/Windows 行为统一 | 安装体积和内存高于原生或 Tauri |
| UI | React 19 | 设置页与异步数据流清晰；生态成熟 | 动画循环需要避开 React 每帧渲染 |
| 语言 | TypeScript 5.9 | 主进程、Preload、Renderer 和测试共享类型 | 外部输入仍需运行时校验 |
| 动画 | Canvas 2D + 精灵图 | 帧控制直接，支持透明像素命中，无需游戏引擎 | 美术图集制作和帧对齐要求较高 |
| 状态管理 | 纯 reducer | 状态少、优先级明确、无额外运行时依赖、易测 | 状态规模显著增长后需要重新评估 |
| 数据校验 | Zod 4 | manifest、设置、位置和 IPC 使用同一套运行时契约 | schema 与业务转换需要维护 |
| 开发构建 | Vite 8 | Renderer 开发反馈快，并可由 Forge 统一组织各入口 | Electron 多入口配置比纯 Web 项目复杂 |
| 分发 | Electron Forge 7 | 与 Electron 集成完整，统一 package/make 和平台 maker | 签名仍依赖平台证书和对应 runner |
| 单元测试 | Vitest 4 | 与 Vite/TypeScript 配合直接，适合纯逻辑测试 | 不覆盖原生窗口的全部系统差异 |
| 端到端 | Playwright 1.58 | 可启动 Electron 并验证真实 Renderer/IPC 流程 | 透明穿透、DPI 等仍需实机验收 |

## 3. Electron，而不是双端原生或 Tauri

Electron 被选中，是因为首版同时依赖以下成熟 API：

- 透明、无边框、置顶、跳过任务栏的窗口。
- `setIgnoreMouseEvents()` 窗口级鼠标穿透。
- 多显示器 `screen` 信息和工作区坐标。
- 托盘、上下文菜单和登录启动。
- macOS 工作区/全屏可见性以及 Windows 安装打包。

React、状态机和几何逻辑可以全部使用 TypeScript，共享代码的直接收益大于 Electron 的体积成本。

未选方案：

- 双端原生：窗口能力最强，但需要维护 Swift/Objective-C 与 C#/C++ 两套实现，首版速度和维护成本较高。
- Tauri：运行体积更小，但仍需为窗口穿透、平台差异和托盘交互编写 Rust/平台适配；当前团队主要逻辑都在 TypeScript 中。
- 游戏引擎：动画能力充足，但对托盘、登录项、安装包和轻量设置页并不占优，首版状态也不足以抵消引擎复杂度。

## 4. React 负责界面，Canvas 负责动画

React 适合管理设置表单、manifest 加载、错误状态和视图切换；但精灵动画每帧更新不应进入 React reconciliation。

因此采用明确分工：

```text
React：组件生命周期、设置、资源加载
Canvas：裁切图集、逐帧绘制、alpha 采样
Reducer：交互状态与动作选择
requestAnimationFrame：动画时钟和拖动节流
```

相较 DOM 多图片切换，Canvas 更容易保证：

- 同一绘制表面上的帧切换。
- 按原始 alpha 数据做命中测试。
- 使用单张图集降低资源请求和动作切换抖动。
- 独立处理循环、单次播放、不同帧时长和静态降级。

首版没有选择 Lottie，因为输入资源是逐帧角色动画，且命中需要与实际位图 alpha 一致；没有选择 WebGL，因为 2D 单角色图集不需要其复杂度。

## 5. 纯 reducer，而不是 XState

首版只有六类模式：`idle`、`pointerLook`、`dragging`、`clickReaction`、`docking`、`docked`。状态优先级固定，事件数量有限。

纯 reducer 的收益：

- 状态转换是无副作用函数，可直接做表格化单元测试。
- 不把资源名称写进状态机，仍能通过 manifest 替换动作。
- 没有额外运行时和学习成本。
- 与 React 的事件处理自然衔接。

如果未来加入自主移动、定时行为、多个 Pet 协作、业务任务状态或复杂并行状态，应重新评估 XState；当前不提前引入。

## 6. Zod 作为运行时边界

TypeScript 只在编译期生效。以下数据可能在运行时损坏或被错误调用：

- 磁盘上的 `state.json`。
- 可替换的 `pet.json`。
- Renderer 发往主进程的 IPC 参数。

Zod 用于把“不可信数据”转换为已校验业务对象。尤其是窗口坐标：Electron 原生绑定要求有效数字，`NaN`、无穷值或非安全整数可能直接抛出主进程异常，因此主进程在调用 `setPosition()` 前再次校验。

## 7. WebP 图集与 manifest

选择透明无损 WebP，是为了在保留 alpha 与细节的同时减小资源体积。动作按行排列，运行时只需要一次解码和按单元格裁切。

`pet.json` 把资源事实与交互语义拆开：

```text
状态机语义 pointerLeft
        ↓ bindings
资源动作名 look-left
        ↓ animations
图集行、帧数、时长、循环、静态帧
```

代价是整张 4096×2560 图集解码后会占用一块固定内存，且所有帧必须统一单元格、基线和透明边界。对单只首版 Pet 可接受；若未来支持大量皮肤同时驻留，需要按需加载或拆分图集。

## 8. JSON 文件持久化

设置量小、结构固定，也不需要查询，因此选用 `userData/state.json`，而不是 SQLite 或第三方配置库。

实现包含：

- Zod 校验与默认值补全。
- 损坏文件备份。
- 临时文件写入后重命名。
- 位置与用户设置由主进程统一持有。

如果未来出现多 Pet、账户同步或版本化复杂迁移，再引入数据库；首版 JSON 更直接。

## 9. Vite、Forge 与平台构建

Vite 负责 Electron 的 main、preload、renderer 多入口开发和构建；Forge 负责应用打包与 maker：

- macOS：DMG。
- Windows：Squirrel 安装包。

安装包必须在目标系统构建。GitHub Actions 使用 macOS 与 Windows runner 分别执行类型检查、单元测试和 `pnpm make`，签名凭据仅从 Secrets 注入。

未把自动更新放入首版，因为它还需要稳定发布源、签名连续性、更新策略和回滚机制，超出当前分发范围。

## 10. 测试分层

```text
Vitest
  ├─状态优先级和动作恢复
  ├─帧计时、循环与静态帧
  ├─alpha 命中
  ├─负坐标、多屏、吸边和工作区限制
  └─manifest、设置及 IPC 契约

Playwright Electron
  └─Renderer、Preload 与主进程联通的关键交互

macOS / Windows 实机
  └─透明窗口、底层点击、DPI、跨屏、全屏、签名安装
```

单元测试覆盖确定性逻辑，E2E 覆盖进程集成；透明穿透、系统安全策略和 DPI 等平台行为不能只靠无头测试，需要保留实机验收。

## 11. 首版边界

当前明确不选择或不实现：

- 全局输入监控权限。
- 自主行走和物理系统。
- 顶部、底部吸附。
- 多 Pet、皮肤商城和在线素材下载。
- 业务任务状态。
- 官网和自动更新服务。

这些边界保证首版聚焦在桌面交互、动画可靠性和跨平台分发。
