# 架构设计

## 1. 设计概览

可以把 Gupet 理解成一座小剧场：Electron 主进程是舞台经理，负责窗口、屏幕和托盘；Preload 是只传递指定消息的对讲机；React Renderer 是演员；`pet.json` 和精灵图则是剧本与分镜。这样，动画内容可以替换，而系统权限和桌面窗口控制仍集中在可信边界内。

```text
操作系统：鼠标、屏幕、托盘、登录项
                    │
                    ▼
┌──────────────── Electron Main ────────────────┐
│ BrowserWindow / Tray / Screen / StateStore    │
│ 窗口坐标、吸边、多屏恢复、设置持久化、应用生命周期 │
└──────────────────────┬────────────────────────┘
                       │ 窄 IPC
                       ▼
┌─────────────────── Preload ───────────────────┐
│ contextBridge：只暴露 desktopPet API          │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌──────────────── React Renderer ───────────────┐
│ reducer 状态机 → animation binding → Canvas   │
│           ↘ alpha mask 命中测试 ↗             │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
            pet.json + atlas.webp
```

核心原则：

- 桌面能力由主进程持有，Renderer 不直接使用 Node.js。
- 交互状态由纯 TypeScript reducer 决定，动画名称通过 manifest 绑定。
- Pet 的桌面位置只由窗口移动逻辑改变；精灵动画本身不会修改窗口坐标。
- 所有跨边界数据在运行时校验，不能只依赖 TypeScript 类型。

## 2. 模块边界

```text
src/
├── main/
│   ├── main.ts              窗口、托盘、屏幕、IPC、登录项
│   └── state-store.ts       设置与位置持久化
├── preload/
│   └── preload.ts           安全 IPC 桥
├── renderer/
│   ├── App.tsx              Pet/设置视图入口、manifest 加载
│   ├── PetCanvas.tsx        Canvas 动画、命中、指针与拖动
│   └── SettingsView.tsx     设置界面
└── shared/
    ├── contracts.ts         Zod 数据契约与默认值
    ├── pet-machine.ts       Pet 状态机
    ├── animation-clock.ts   帧计时
    └── geometry.ts          吸边、多屏和坐标计算

public/pets/default/
├── pet.json                 版本化 Pet manifest
└── atlas.webp               透明精灵图集
```

### Electron Main

主进程创建两个窗口：

- Pet 窗口：320×320、透明、无边框、不可缩放、默认置顶、跳过任务栏、无阴影。
- 设置窗口：460×600，仅在需要时显示。

主进程同时负责：

- 托盘显示/隐藏、设置、重置位置和退出。
- 根据 `screen.getDisplayMatching()` 选择当前显示器。
- 在工作区内约束位置，兼容负坐标副屏、任务栏和 Dock。
- 结束拖动时根据 Pet 绘制区域计算左右吸边并持久化位置。
- 显示器变化时恢复到仍然有效的可见区域。
- 将开机启动、始终置顶等设置映射到 Electron API。

应用生命周期由托盘持有。关闭设置窗口不会退出；只有托盘“退出”或系统退出事件会终止应用。

### Preload

Preload 使用 `contextBridge` 暴露 `window.desktopPet`，只包含设置读写、显示隐藏、拖动、结束拖动、重置位置、鼠标穿透和菜单等必要能力。

安全配置为：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

Renderer 因此无法直接访问文件系统、进程环境或任意 Electron 模块。

### Renderer

`App.tsx` 根据查询参数选择 Pet 视图或设置视图，并使用 Zod 校验 `pet.json`。加载失败时回退到编译期默认 manifest。

`PetCanvas.tsx` 负责：

- 通过 `requestAnimationFrame` 驱动动画时钟。
- 按 manifest 中的行、帧数和持续时间裁切图集。
- 缓存每帧 alpha mask 和可见边界。
- 把窗口内指针转换为角色可见区域内的归一化坐标。
- 使用 Pointer Capture 区分点击与拖动。
- 每个浏览器动画帧最多发送一次窗口移动 IPC。
- 根据系统或用户设置显示完整动画或静态帧。

设置页面只负责编辑状态；实际持久化由主进程完成。

### Shared

共享层不依赖 Electron 或 React，便于用 Vitest 直接验证：

- `contracts.ts`：manifest、设置、位置和 IPC 参数的数据契约。
- `pet-machine.ts`：状态转换及动作 binding 解析。
- `animation-clock.ts`：可变帧时长、循环、单次结束和减少动态效果。
- `geometry.ts`：工作区限制、左右吸边、纵向比例和多屏恢复。

## 3. 状态机与动作绑定

状态由 reducer 管理：

```text
idle ──单击──────────> clickReaction ──动画结束──┐
 │                                             │
 └──拖动──────────> dragging ──松手───────────┤
                                  │            │
                                  ├─吸边─> docking ──结束─> docked
                                  └─未吸边───────────────> idle
```

交互优先级为：

```text
dragging > clickReaction > docking > docked > idle
```

状态机不硬编码资源名称。例如，状态机只请求 `click`，实际播放 `click-reaction` 由 `pet.json.bindings.click` 决定。替换动作命名或美术资源时，不需要修改状态转换逻辑。

单次动画结束后：

- 普通状态恢复 `idle` 或当前指针朝向。
- 吸边进入动画恢复对应的 `docked` 循环。
- 点击反馈结束后，如果角色仍已停靠，则恢复停靠待机。

## 4. 输入与鼠标穿透

透明窗口的命中不能只靠 DOM 的 `pointer-events`。操作系统看到的是整个矩形窗口，因此 Renderer 必须根据当前精灵帧的 alpha 值通知主进程切换窗口级穿透。

处理流程：

```text
鼠标移动
  → 映射到当前精灵帧
  → 查询缓存 alpha mask
  ├─ alpha < threshold：setIgnoreMouseEvents(true, forward)
  └─ alpha ≥ threshold：setIgnoreMouseEvents(false)
```

角色命中使用当前帧的可见边界，而不是完整 256×256 单元格。这样可避免素材周围透明留白导致视觉位置和触发位置不一致。

指针分区包含：

- 40ms 防抖，过滤短暂抖动。
- 4% 回滞，减少左右状态在边界反复切换。
- 中间静区，指针离开左右区域后恢复普通待机。

按下后启用 Pointer Capture。累计移动不超过 6 个逻辑像素判定为点击；超过后进入拖动，避免轻微手抖同时触发点击动画。

## 5. 拖动、吸边与多屏

拖动时 Renderer 计算新的窗口左上角坐标，但通过 `requestAnimationFrame` 合并高频事件，再经 IPC 交给主进程调用原生窗口 API。

```text
pointermove
  → 累积目标坐标
  → 下一帧发送一次 moveWindow
  → 主进程校验有限安全整数
  → BrowserWindow.setPosition(x, y)
```

松手后，主进程使用当前显示器 `workArea` 和 Pet 绘制区域边界计算停靠：

- 启用吸边且角色边界接近或已越过左/右边缘时触发。
- 阈值按逻辑像素计算，默认 24px。
- 只支持左右边缘；不支持顶部或底部。
- 位置保存显示器 ID、绝对坐标、纵向比例和停靠侧。
- 原显示器消失时迁移到主显示器，并限制在可见工作区。

这里必须允许“越过边缘”仍能吸附。如果只判断边界距离的绝对值，用户把角色快速拖出屏幕后反而会错过触发区。

## 6. 动画与资源

默认图集是 32 列、10 行、每格 256×256 的透明无损 WebP。动作按从左到右、从上到下读取；长动作可连续占用多行：

| 语义 | 默认动作 | 帧数 | 播放方式 |
|---|---|---:|---|
| 普通待机 | `idle` | 90 | 循环，约 3 秒；跨前三行存储 |
| 点击反馈 | `click-reaction` | 12 | 单次 |
| 向左/右拖动 | `drag-left/right` | 各 16 | 循环 |
| 左右进入吸边 | `dock-left/right-enter` | 各 12 | 单次 |
| 左右边缘待机 | `dock-left/right-idle` | 各 12 | 循环 |

每个动作可配置独立帧时长、是否循环和减少动态效果时使用的静态帧。缺失 binding 或动作时回退到 `idle`，避免渲染中断。

动画可以表现身体动作，但不会改变 BrowserWindow 的桌面坐标。角色坐标只在用户拖动、吸边、重置或屏幕恢复时变化。

## 7. 设置与持久化

设置和位置保存在 Electron `app.getPath('userData')/state.json`。启动时使用 Zod 校验并补齐默认值：

```text
读取 state.json
  ├─合法：合并默认值后使用
  ├─不存在：使用默认值
  └─损坏：备份为 state.json.corrupt-<timestamp>，恢复默认值
```

写入先落到临时文件，再重命名为正式文件，降低进程中断导致半写文件的风险。Renderer 不直接读写该文件。

## 8. 关键注意事项

- TypeScript 类型在运行时会被擦除。IPC 坐标必须经 Zod 校验并转换为有限安全整数后，才能传给 Electron 原生 API。
- alpha mask 与可见边界按“动作 + 帧”缓存；替换图集时必须保持 manifest 和单元格布局一致。
- Pet 窗口是固定矩形，透明穿透是窗口级状态；每次指针移动都按当时的动画帧重新判断命中。
- Canvas 动画循环不应通过 React state 每帧重渲染，否则会增加无意义的组件更新。
- macOS 和 Windows 的签名、安装包格式不同，必须在对应系统 runner 上构建与实机验收。
