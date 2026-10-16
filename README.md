# Codex Recharge

用 Remotion 重建发光电量卡片，并把它做成 macOS 桌面悬浮组件：标题改为 **Codex**，百分比显示当前账号的 Codex 剩余用量；点击打开 Codex，悬停查看本机正在运行的任务数，拖动调整位置。悬停提示根据摆件所在屏幕的可用空间，自动显示在上方或下方。桌面版采用紧凑的横向长方形，保留原有圆角风格，并为进度条四周留出间距。

参考：[Motionface · Primium Recharge Overlay](https://motionface.cc/?recording=610805bb-4a78-484b-b37c-916aa34bbee6)。构图、关键帧和复刻取舍见 [参考分析](docs/REFERENCE.md)。源码使用 SVG、React 和 Remotion 绘制，不依赖参考视频文件。

## 运行与渲染

需要 Node.js 22.12+、npm，以及已登录的本机 Codex。本机任务统计另需 Python 3；桌面版需要 macOS 13+ 和 Xcode Command Line Tools，构建产物适用于当前 Mac 的处理器架构。

```sh
npm ci
npm run dev                # 浏览器预览，悬停可查看状态
npm run studio             # Remotion 时间线
npm run render             # 15 秒参考节奏动画
npm run render -- --compact # 导出横向版本
npm run render -- --live    # 以渲染开始时的实际剩余用量生成视频
npm run desktop:build      # 构建本机桌面应用
open "outputs/Codex Recharge.app"
```

渲染输出为 `outputs/codex-recharge.mp4`（720 × 720、60 fps、H.264）。`npm run render -- --still` 可输出 PNG。实时渲染读取一次用量快照；桌面组件和开发预览约每秒刷新任务数，每 30 秒刷新额度，两者独立读取，额度请求不会阻塞任务更新。`npm run build` 执行类型检查与前端构建，`npm test` 运行状态解析测试。

桌面应用驻留菜单栏，可打开 Codex、显示或隐藏悬浮窗、刷新用量和退出。它复用本机 Node.js，无开机启动项，也不安装全局软件或修改 Codex 配置。应用采用本机临时签名，未经过 Apple 公证；换一台 Mac 时建议重新构建。原生宿主和自检命令见 [desktop/README.md](desktop/README.md)。

桌面宿主将未激活窗口的第一次鼠标按下直接交给组件，点击即可打开 Codex。按下时捕获指针，拖动中一旦偏离按下位置达到 5 点，即使返回原处再松开也不会触发打开；取消拖动或失去指针捕获会结束本次手势。

## 数字的含义

- **剩余用量**：通过本机 Codex app-server 的 `account/rateLimits/read` 读取账号额度。优先选择 `rateLimitsByLimitId.codex`，兼容单桶 `rateLimits`；每个有效额度窗口按 `100 - usedPercent` 计算，卡片显示该桶各窗口中最少的剩余百分比。悬停可查看各窗口。这不是 token 余额或付费 credits。
- **运行任务数**：只读本机 Codex SQLite 状态元数据，统计最新 turn 仍为 `inProgress` 且 writer lock 被进程持有的桌面 / IDE 根会话。排除子代理和已归档会话，不包含云端或其他电脑上的任务；它不是账号全局任务总数。
- **不可用与旧数据**：读取失败时，用量可保留最多 24 小时并标记为上次读取，任务数可在当前进程内保留最多 2 分钟。过期或缺失数据返回不可用，不会被当成 0% 或 0 个任务。API、数据库格式变化可能需要更新适配器，详见 [状态读取说明](telemetry/README.md)。

本项目只读取已有登录会话，不要求在源码中填写 token。数据访问与缓存范围见 [隐私说明](docs/PRIVACY.md)。

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `src/RechargeCard.tsx` | 卡片、液面、颜色和参考动画关键帧 |
| `src/Composition.tsx`、`src/remotion.tsx` | Remotion compositions |
| `src/main.tsx` | 实时预览、悬停提示和桌面交互 |
| `telemetry/` | 本机用量和运行任务读取 |
| `desktop/main.swift` | 透明悬浮窗、菜单栏和打开 Codex |
| `scripts/` | 视频渲染和桌面构建 |

技术参考：[Remotion 文档](https://www.remotion.dev/docs/)、[OpenAI 官方 Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)。这是独立的本机桌面工具。
