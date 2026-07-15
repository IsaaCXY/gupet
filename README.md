# Gupet

Gupet 是面向 macOS 与 Windows 的桌面 Pet。它使用透明置顶窗口和 Canvas 精灵动画，支持可见像素命中、点击反馈、头眼追随、拖动、左右吸边、托盘管理及减少动态效果。

## 快速开始

环境要求：Node.js 24、pnpm 11。

```bash
pnpm install --frozen-lockfile
pnpm start
```

常用命令：

```bash
pnpm typecheck       # TypeScript 检查
pnpm test            # Vitest 单元测试
pnpm package         # 打包未安装的应用目录
pnpm make            # 生成当前平台安装包
pnpm test:e2e        # Playwright Electron 测试
```

## 文档

- [架构设计](docs/architecture.md)：进程边界、状态机、输入、动画、窗口与数据流。
- [技术选型](docs/technical-decisions.md)：为什么选择 Electron、React、Canvas 2D、Zod、Forge 等方案。
- [使用说明](docs/user-guide.md)：安装、交互、设置、构建、素材替换和故障处理。

## 核心交互

- 鼠标进入 Pet 的可见像素后，根据左右位置触发头眼追随。
- 单击可见区域播放一次反馈动画。
- 移动超过 6 个逻辑像素进入拖动；靠近或越过工作区左右边缘时吸附。
- 右键 Pet 打开托盘菜单；单击托盘图标显示或隐藏 Pet。
- 动画只改变窗口内的画面，不主动改变 Pet 的桌面坐标。

## Pet 素材

默认资源位于 `public/pets/default/`：

- `atlas.webp`：透明无损 WebP，16 列，每格 256×256 像素。
- `pet.json`：动作行、帧时长、循环方式、静态帧和交互绑定。

替换素材后运行：

```bash
pnpm assets:validate
```

详细规范见[使用说明中的素材替换](docs/user-guide.md#替换-pet-素材)。`pnpm assets:placeholder` 会覆盖正式图集，仅用于主动恢复开发占位素材。

## 当前范围

首版不包含自主行走、全局输入监听、上下吸边、在线皮肤、官网、自动更新和业务任务状态。

## 构建与签名

GitHub Actions 在 macOS 和 Windows runner 上分别构建安装包。签名构建所需 Secrets：

- macOS：`MACOS_CERTIFICATE_P12`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- Windows：`WINDOWS_CERTIFICATE_P12`、`WINDOWS_CERTIFICATE_PASSWORD`

未配置签名凭据时仍可构建，但安装时可能出现系统安全提示。
