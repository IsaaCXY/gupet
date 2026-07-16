# 使用说明

## 1. 环境要求

开发与本地构建需要：

- macOS 或 Windows。
- Node.js 24。
- pnpm 11。

从仓库启动：

```bash
git clone git@github.com:IsaaCXY/gupet.git
cd gupet
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` 会启动 Electron 开发应用。Pet 默认显示在屏幕可见工作区内，设置与位置保存在 Electron 的用户数据目录。

## 2. 基本交互

### 头眼追随

把鼠标移动到 Pet 的非透明像素上即可交互；透明区域仍可点击下方窗口。

只有实际可见像素参与交互，角色周围的透明区域会穿透到底层窗口。

### 点击

在 Pet 可见区域按下并松开，累计移动不超过 6 个逻辑像素，会播放一次点击反馈。动画结束后恢复普通待机或边缘待机。

### 拖动

按住 Pet 可见区域并移动超过 6 个逻辑像素，即进入拖动。松手时保存当前显示器和位置。

动画可以包含角色自身的动作，但不会自动改变 Pet 在桌面上的窗口坐标；桌面坐标只随拖动、吸边、重置或显示器恢复而变化。

### 左右吸边

启用“左右吸边”后，把 Pet 拖到当前显示器工作区的左侧或右侧边缘并松手：

1. 播放一次对应的进入动画。
2. 进入对应的边缘循环待机。
3. 再次拖离边缘后恢复普通状态。

默认阈值为 24 个逻辑像素。快速拖过边缘也会纳入吸附判断。首版不支持顶部或底部吸附。

### 托盘

- 单击托盘图标：显示或隐藏 Pet。
- 右键 Pet 或托盘图标：打开菜单。
- 菜单提供显示/隐藏、打开设置、重置位置和退出。

关闭设置窗口不会退出应用；应用由托盘继续运行。

## 3. 设置

从托盘菜单选择“设置”。可调整：

| 设置 | 范围/选项 | 默认值 | 说明 |
|---|---|---|---|
| Pet 大小 | 96–240px，步进 8px | 160px | 改变窗口内绘制大小 |
| 始终置顶 | 开/关 | 开 | 控制 Pet 是否保持在普通窗口上方 |
| 左右吸边 | 开/关 | 开 | 控制松手后的边缘吸附 |
| 吸边阈值 | 8–64px，步进 4px | 24px | 越大越容易触发吸附 |
| 开机启动 | 开/关 | 关 | 安装版应用登录后启动 |
| 动态效果 | 跟随系统/完整/静态 | 跟随系统 | 静态模式显示动作指定帧 |

“重置位置”会把 Pet 移回主显示器的安全可见区域，并清除停靠状态。

## 4. 多显示器行为

- 支持副屏负坐标和不同工作区尺寸。
- 拖动和吸边使用显示器 `workArea`，不会把任务栏或 Dock 当成可用区域。
- 重启后读取已保存的显示器、绝对位置、纵向比例和停靠侧；停靠位置按当前工作区和纵向比例重算。
- 如果原显示器已移除，Pet 会迁移到主显示器并限制在可见区域。

更换缩放比例、连接或移除显示器后，建议确认一次 Pet 位置；看不到 Pet 时可从托盘执行“重置位置”。

## 5. 动态效果模式

- 跟随系统：读取操作系统的“减少动态效果”偏好。
- 完整：正常播放所有帧。
- 静态：每种状态只显示 manifest 指定的 `reducedMotionFrame`。

静态模式不会禁用点击、拖动或吸边，只改变动画表现。

## 6. 开发命令

| 命令 | 用途 |
|---|---|
| `pnpm start` | 启动开发应用 |
| `pnpm typecheck` | 检查 TypeScript |
| `pnpm test` | 运行 Vitest 单元测试 |
| `pnpm test:watch` | 监听模式运行单元测试 |
| `pnpm package` | 生成当前平台的未安装应用目录 |
| `pnpm make` | 生成当前平台安装包 |
| `pnpm test:e2e` | 运行 Playwright Electron 测试 |
| `pnpm assets:validate` | 校验正式图集和 manifest |
| `pnpm assets:build` | 从本地素材行重新组装图集 |
| `pnpm assets:placeholder` | 用开发占位图覆盖正式图集 |

正常启动和打包不会改写 Pet 素材。

## 7. 构建安装包

在目标平台执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm make
```

产物位于 `out/make/`：

- macOS 构建 DMG。
- Windows 构建 Squirrel 安装包。

不要依赖单一平台交叉生成正式安装包。GitHub Actions 会在 macOS 14 和 Windows 2022 runner 上分别构建，并上传 workflow artifacts；手动触发 workflow 或推送 `v*` tag 都会执行。

### 签名配置

macOS Secrets：

- `MACOS_CERTIFICATE_P12`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Windows Secrets：

- `WINDOWS_CERTIFICATE_P12`
- `WINDOWS_CERTIFICATE_PASSWORD`

凭据未配置时仍可生成本地测试包，但系统可能提示来源未验证。正式分发前必须完成 macOS 签名与公证、Windows 代码签名，并在真机验证安装和卸载。

## 8. 替换 Pet 素材

默认 Pet 位于：

```text
public/pets/default/
├── atlas.webp
└── pet.json
```

可选点击音效放在同一目录的 `click.wav`，并由 `pet.json` 的 `sounds.click` 指向；未配置音效时，点击仍会正常播放动画。

图集要求：

- 透明无损 WebP。
- 32 列，每格 256×256 像素。
- 动作按从左到右、从上到下存储；超过 32 帧时可连续占用多行。
- 未使用单元格必须完全透明。

首版要求以下 binding：

```text
idle
click
dragLeft / dragRight
dockLeftEnter / dockLeftIdle
dockRightEnter / dockRightIdle
```

binding 指向 `animations` 中的实际动作名称。每个动作必须配置所在行、帧数、逐帧时长、循环方式和静态帧。

替换 `atlas.webp` 和 `pet.json` 后执行：

```bash
pnpm assets:validate
pnpm typecheck
pnpm test
```

校验会检查尺寸、binding、帧数、已用单元格内容和未用单元格透明度。发布前还需人工检查 contact sheet 与逐动作 GIF，确认身份、比例、基线、方向、循环、裁切和透明边缘一致。

`pnpm assets:placeholder` 会覆盖当前正式 `atlas.webp`，不要在正常开发或发布流程中误用。

## 9. 数据与恢复

设置文件位于：

```text
app.getPath('userData')/state.json
```

具体根目录由操作系统和应用安装信息决定。文件包含用户设置与 Pet 位置。

- 文件不存在时使用默认值。
- 字段缺失时补齐默认值。
- 文件损坏时自动备份为 `state.json.corrupt-<timestamp>` 并恢复默认值。
- 通常不需要手动编辑；位置问题优先使用托盘“重置位置”。

## 10. 常见问题

### 看不到 Pet

1. 单击托盘图标，或在托盘菜单选择“显示 Pet”。
2. 选择“重置位置”。
3. 确认应用仍在托盘运行。

### 鼠标移动没有触发头眼追随

- 指针必须位于当前帧的非透明像素上。
- 中间区域是稳定静区，不触发左右动作。
- 拖动、点击反馈、进入吸边和边缘待机的优先级高于普通追随。

### 很难触发吸边

- 确认设置中的“左右吸边”已开启。
- 提高“吸边阈值”。
- 在当前显示器工作区的左侧或右侧松手；顶部和底部不会触发。

### 透明区域挡住底层点击

先把指针移出 Pet 的可见像素再点击。若透明区域持续阻挡，重新显示 Pet 或重启应用，并记录当前动作与系统版本用于排查。

### macOS 提示无法验证开发者

本地未签名包可能被 Gatekeeper 拦截。正式安装包应通过配置证书的 CI 完成签名和公证；不要把绕过系统安全策略作为发布方案。

### 设置异常

使用设置页恢复需要的值，或退出应用后备份并移除 `state.json`。下次启动会使用默认配置。损坏文件通常会被应用自动备份。

## 11. 当前限制

- 不监听 Pet 之外的全局鼠标输入。
- 不支持自主行走或物理碰撞。
- 不支持顶部、底部吸边。
- 不支持多 Pet、皮肤下载或在线商城。
- 不包含自动更新服务。
