# Pika UI/UX 设计审计报告

> 范围: `src/components/**`, `src/index.css`, `tailwind.config.js`
> 方法: 静态扫描 + 关键组件逐文件审查 (PikaInterface / GlobalChatOverlay / MeetingChatOverlay / Settings / WindowControls / TopPill / Launcher)
> 评分维度: 设计系统一致性 · 视觉层级 · 配色 · 间距/圆角/动效 · 交互与可访问性 · 信息密度

---

## 一、总览结论

Pika 拥有**一套相当扎实的 token 基座**(surface/overlay 分层、liquid-glass 多档 blur、light/dark via `[data-theme]`、Linear 风格 shadow elevation),但落地阶段被三类问题稀释:

1. **Token 普适性失守**:semantic 色 (success/error/warning/info) 缺位,导致组件回退到原生 Tailwind palette。
2. **可访问性接近零**:44 个组件中仅 4 个使用 `aria-*` / `role`,29 处 `focus:outline-none` 几乎全无 `focus-visible` 替代。
3. **设计阶梯松散**:圆角 9 档、z-index 11 档、动效时长 7 档、间距出现 `p-5 / p-7` 这类奇数,长期会拖累一致性。

下面分类给出问题清单与建议。

---

## 二、配色 / 设计 token

### ✅ 已经做好

- `--surface / --surface-container-low / --surface-container-high / --surface-variant` 完整三阶。
- `--overlay-*` 一整套独立 token:panel / pill / transcript / chip / input / control / code / icon, 含 hover/focus/border/shadow。
- `--text-primary/secondary/tertiary` + `--bg-input/sidebar/card/component/item-active` 语义清晰。
- light mode 用 shadow 而非 border 做层级 (`#settings-panel-wrapper` 用三层 box-shadow,符合 Linear/Vercel 现代审美)。

### ❌ 主要问题

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| C1 | **状态色绕过 token 系统** | 27× `bg-red-500`、22× `text-red-400`、12× `bg-emerald-500`、11× `bg-emerald-500`、10× `bg-amber-500` | 主题切换 / 品牌调整时不同步;light mode 在白底上 emerald-400 视觉太刺眼 |
| C2 | **slate-* 阶梯混用** | 同时出现 slate-200/400/500/600/700/800/900/950 共 8 阶,但 `text-text-tertiary` 已存在 | 设计 token 迁移半途而废,文字层级不可预测 |
| C3 | **整体偏冷调** | primary `#a8c8ff`、secondary `#72ac6f`(冷绿)、light mode 阴影/border 用蓝调 `rgba(59, 130, 246, ...)` | 浅色 overlay 在白底网页上"撞色"(Slack/Discord/Notion 全是蓝),失去识别度;暗色调过于"工程师" |
| C4 | **WindowControls 关闭按钮过红** | `hover:bg-red-500` (Win/Linux 端) | 与 macOS 红绿黄交通灯不一致,且原生 Win11 Mica 是 #C42B1C 冷红+柔和 hover,这里太饱和 |
| C5 | **`bg-opacity-50` 等手动透明度** | 残留 3 处 | 应统一走 `--overlay-opacity` 或 `bg-*/N` 透明度变量,避免主题适配失效 |

**建议**

```css
/* 在 :root 加 semantic 色,让组件用语义而非 raw color */
--state-success: #22c55e;
--state-success-bg: rgba(34, 197, 94, 0.12);
--state-warning: #f59e0b;
--state-warning-bg: rgba(245, 158, 11, 0.12);
--state-danger:  #ef4444;
--state-danger-bg:  rgba(239, 68, 68, 0.12);
--state-info:    var(--primary);
```

并在 `tailwind.config.js` 暴露:`success / warning / danger / info` —— 全量替换 `bg-red-500` / `text-emerald-400` 等。

---

## 三、布局 / 视觉层级

### 主要问题

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| L1 | **z-index 碎片化** | z-0/10/20/40/49/50/90/100/200/2000/9999 共 11 档,出现 `z-[49]` 这种"夹缝值" | overlay/modal/toast/tooltip 叠加顺序不可推理,新增组件易冲突 |
| L2 | **圆角等级 ≥ 9 档** | rounded / -sm / -md / -lg(145) / -xl(61) / -2xl(17) / -full(150) / -tr / -t/-b | 同一卡片内不同元素圆角参差 |
| L3 | **间距出现奇数尺度** | `p-5(20)`、`p-7(1)`、`m-10(1)` | 偏离 4pt scale,无设计意图的 magic number |
| L4 | **PikaInterface 693 行** + **AIProvidersSettings 1132 行** | 单文件巨型组件 | 难定位、难复用;新人改一处易破坏其他模块 |
| L5 | **default splitter = 40 (transcript 偏左)** | `localStorage('pika_splitter_position')` clamp [20,80],默认 40 | 西方读者视觉流"左→右";AI 答案在右侧符合直觉,但 transcript 应该是次要参考,可考虑默认 60 |
| L6 | **`#root { overflow: hidden }`** + **scrollbar `width: 0px`** | `src/index.css` | 长 transcript / 长 chat 场景下,用户失去滚动定位感;stealth 设计意图可理解,但应在 hover 时露出极细 scroll thumb (类似 macOS 默认) |

**建议:Token 化 z-index**

```css
:root {
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 1000;
  --z-modal: 2000;
  --z-toast: 3000;
  --z-tooltip: 4000;
}
```

---

## 四、字体 / 排版

| # | 问题 | 备注 |
|---|---|---|
| T1 | 4 个字体族 (Inter / Space Grotesk / JetBrains Mono / CelebMF) | CelebMF 在代码里只见 @font-face,实际使用面待确认;3 个已偏多,建议保留 Inter + JetBrains Mono,Space Grotesk 仅做品牌大字标题 |
| T2 | 全局 `font-feature-settings: "tnum" 1, "ss01" 1` | tnum 好;ss01 改 Inter "a" 字形,会与中文混排重心冲突,中英混排建议关闭 |
| T3 | `text-xs / sm / base / lg / xl / 2xl+` 数量没有压力,但 `text-[12px]` 这类硬编码也存在 | 见 TopPill — 建议全部走 token 阶梯 |

---

## 五、动效 / 交互反馈

| # | 问题 | 证据 |
|---|---|---|
| A1 | **缓动函数 5 种**:ease-out(9) / ease-in-out(1) / ease-spring(10) / ease-sculpted(2) / 默认 | `ease-sculpted` 仅 2 处 — 像偶发实验残留 |
| A2 | **时长 7 档**:100/150/200/300/500/700/1000ms,无语义 | 建议 token 化为 `--motion-fast 120ms / --motion-base 200ms / --motion-slow 320ms / --motion-pageshift 480ms` |
| A3 | **缺 `prefers-reduced-motion` 支持** | framer-motion 大量使用,前庭敏感用户难受;全局加 `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; } }` |
| A4 | **236× transition-colors 但 active 反馈仅 TopPill** | `interaction-press:active scale(0.97)` 应推广为 button base class |

---

## 六、可访问性 (重要)

| # | 问题 | 严重度 |
|---|---|---|
| **A11y-1** | 44 个组件中仅 4 个含 aria/role | 🔴 高:屏幕阅读器无法使用 |
| **A11y-2** | 29× `focus:outline-none` vs 仅 2× `focus-visible:*` | 🔴 高:键盘用户找不到焦点 |
| **A11y-3** | Settings Sidebar 三 tab 没有 `role="tablist"/"tab"`、没有方向键、没有 `aria-selected` | 🔴 高:WCAG 2.1 失败 |
| **A11y-4** | AIProvidersSettings 自写 dropdown(`useEffect` 监 mousedown click-outside),无 ↑↓ 选项导航、无 Esc 关闭、无 tabIndex | 🟠 中:有 Radix 但没用 |
| **A11y-5** | 状态徽章只用颜色 (`bg-red-500` / `bg-emerald-400` / `bg-amber-500`) 区分 stt 状态 | 🟠 中:色盲不可读;应配 icon |
| **A11y-6** | WindowControls 按钮仅 `title=` 而无 `aria-label` | 🟡 低 |

**最小修复包**(2 天工作量,价值最高):

1. 全量加 `aria-label` 到 button-only icon 控件 (TopPill / WindowControls / Settings Sidebar / Launcher)。
2. 把 Settings Sidebar 改成 `role="tablist"` + 方向键导航,大约 30 行。
3. 把 AIProvidersSettings 的自写 select 替换为 Radix `<Select>` (项目已依赖 Radix toast/dialog,无新增依赖)。
4. 全局加一条 CSS:`*:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }` —— 重新对所有 `focus:outline-none` 的元素提供键盘焦点环。

---

## 七、信息架构 / 流程

| # | 问题 | 建议 |
|---|---|---|
| I1 | Settings 仅 3 tab(General / AIProviders / About),但 AIProvidersSettings 单文件 1132 行 | 拆 sub-tab:**Models** / **API Keys** / **Defaults** / **Custom Endpoint** |
| I2 | Launcher 有手动 keyboard 监听但 UI 不展示快捷键 | 在 Launcher 入口卡片右下角内联 `⌘1` `⌘2` 等 KeyBadge |
| I3 | MeetingChatOverlay 的高度拖拽 (`dragStartYRef`) 没有视觉手柄 | 顶部加 `<div className="h-1 w-12 rounded-full bg-text-tertiary/30 mx-auto cursor-ns-resize" />` |
| I4 | overlay 透明度调节 `--overlay-opacity` 是变量但 UI 上没有滑块入口? | 加入 General Settings,因为这是 stealth 模式核心调参 |
| I5 | stt 错误状态 (`sttNeedsTroubleshooting`) 仅以颜色 + 文本提示 | 加"复制日志"/"切换 provider"两个一键动作 |

---

## 八、Stealth / Overlay 专项

`overlay-shell-blur 17px → pill 11px → transcript 8px` 这种**逐层降低 blur**手法很专业,与 Apple 自家 Spotlight/Notification Center 的语言一致——保留。

但:

- **Light overlay 在白底网页上几乎不可见** — `--overlay-bg: rgba(247, 249, 253, 0.9)`,`--overlay-pill-shadow: rgba(59, 130, 246, 0.05)`(蓝调阴影,饱和度太低)。建议把 light mode 的 panel-shadow 从 5% 蓝改为 8% 中性灰 `rgba(15, 23, 42, 0.08)`,可读性立刻上升。
- **`interaction-press: scale(0.97) opacity(0.9)`** 在 17px blur 后视觉变化几不可见。stealth 模式下用户更需要确认"按下了"——建议短促 ring pulse(120ms scale + 20ms outline flash) 取代纯 scale。

---

## 九、优先级修复路线图

### P0 — 一周内
- [ ] semantic 色 token (success/warning/danger/info) + 全局替换 27× bg-red-500 等
- [ ] 全局 `*:focus-visible` outline + 移除多数 `focus:outline-none`
- [ ] Settings Sidebar 加 `role="tablist"` + arrow key 导航
- [ ] `prefers-reduced-motion` 全局媒体查询

### P1 — 两周内
- [ ] z-index token 化 (替换 z-[49] / z-[2000] / z-[9999])
- [ ] AIProvidersSettings 拆 sub-tab + 用 Radix Select
- [ ] 圆角 token:`rounded-card / -pill / -input / -modal`(收敛 9 档至 4 档)
- [ ] 动效 token:`duration-fast/base/slow`,清理 ease-sculpted 误用

### P2 — 一个月内
- [ ] PikaInterface (693 lines) 拆 ChatColumn / TranscriptColumn / SplitterShell 三个 dumb component
- [ ] 字体减为 2(Inter + JetBrains Mono),Space Grotesk 限品牌大字
- [ ] Light mode shadow palette 切换为中性灰
- [ ] hover-only scrollbar (像 macOS 默认那样)

---

*Generated 2026-04-27 — 静态分析,未运行实际界面。视觉层面的精修(具体像素位移、对比度数值)需要跑起 `npm run app:dev` 后逐窗口截图复核。*
