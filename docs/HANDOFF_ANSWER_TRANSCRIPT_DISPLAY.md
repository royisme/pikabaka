# Handoff: Answer 按钮 / Transcript Context / 主动查询返回数据不显示

> **Status**: 上一轮改动完成；下一步排查 transcript context 与主动查询的 UI 显示
> **Created**: 2026-05-06
> **Decision owner**: User (Roy)

## 上一轮已完成（本会话）

### 1. Answer 按钮语义改造
- **改动前**：`PikaInterface.handleAnswerNow` 是 push-to-talk 录麦克风 → 拼 mic STT → 调 `streamGeminiChat`。空音频时弹 "No speech detected"。
- **改动后**：`handleAnswerNow = () => chat.handleWhatToSay()` —— 直接走 transcript-based 回答。
- **File**: `src/components/PikaInterface.tsx:58`
- **副作用**：按钮永远显示 "Answer"（不再切 Stop）；`isManualRecording` / `audio.voiceInputRef` / `finalizeMicSTT` 这些字段仍被 `useMeetingAudio` 维护未清理，可后续 dead-code 删除。

### 2. Gemini stream tokens 不显示在 UI
- **根因**：`submitPrompt` → `streamGeminiChat` 通过 IPC 通道 `gemini-stream-token` / `gemini-stream-done` / `gemini-stream-error` 推 token，但 `useMeetingChat.ts` 只订阅了 `intelligence-suggested-answer-token` 等其他 channel —— token 全部丢失，只剩 SessionTracker.addAssistantMessage 落库日志。
- **修复**：`src/hooks/useMeetingChat.ts` 新增 `onGeminiStreamToken / onGeminiStreamDone / onGeminiStreamError` 监听器，把 token 追加到最近的 `isStreaming` 占位 system message。

### 3. 窗口 resize 不自适应
- **根因**：overlay 窗口尺寸由 PikaInterface ResizeObserver 上报内容尺寸驱动 → main 用 `setOverlayDimensions` 强行覆盖窗口尺寸，撤销用户拖拽。同时根容器 `h-fit` 不会跟随窗口长大。
- **修复**：
  - `src/components/PikaInterface.tsx`：展开态下 `updateContentDimensions` 直接 return；根 div 切到 `h-screen`；motion.div 加 `flex-1 min-h-0`
  - `src/components/meeting/SplitterShell.tsx`：外壳加 `flex-1 min-h-0`

### 4. 布局从左右切到上下
- `src/components/ui/ResizableSplitter.tsx`：新增 `orientation: 'vertical' | 'horizontal'` prop；horizontal 模式用 clientY/rect.height、`cursor-row-resize`、横向条样式
- `src/components/meeting/SplitterShell.tsx`：容器改 `flex-col`；上块 `height: ${splitterPosition}%`、下块 `flex-1`；splitter 传 `orientation="horizontal"`
- localStorage `pika_splitter_position` 复用（值由"宽度%"变"高度%"，默认 40 = transcript 占 40%）

### 5. 默认窗口尺寸 + 视觉分区
- `electron/helpers/WindowHelper.ts`：overlay 默认/重置宽度 `1000 → 600`（行 199, 459）；overlay `minWidth: 600 → 380`
- `src/components/meeting/SplitterShell.tsx`：每个分区包成 `<section>` + `ZoneHeader`（lucide `Mic` / `MessageSquare` 图标 + 大写小标签 + `border-b` + 暗底色对比）

---

## 下一步排查的问题

**症状**：当前还有两条入口的"返回数据无法显示"bug：
1. **transcript context 相关入口** —— 基于 transcript 的某些查询/操作（不是 handleWhatToSay，已修），返回数据不显示在 UI
2. **主动查询问题（proactive / auto-ask）** —— 系统主动触发的查询，返回数据不显示

### 已知线索

- `useMeetingChat.ts` 已订阅的 IPC channel（应该都能正常显示）：
  - `onIntelligenceAssistUpdate` (insight token, intent='assist')
  - `onIntelligenceSuggestedAnswerToken` / `onIntelligenceSuggestedAnswer` (intent='what_to_answer')
  - `onIntelligenceRefinedAnswerToken` / `onIntelligenceRefinedAnswer` (intent=动态)
  - `onIntelligenceRecapToken` / `onIntelligenceRecap` (intent='recap')
  - `onIntelligenceFollowUpQuestionsToken` / `onIntelligenceFollowUpQuestionsUpdate` (intent='follow_up_questions')
  - `onIntelligenceManualResult` / `onIntelligenceError`
  - `onSuggestionGenerated` / `onSuggestionError`
  - `onIntelligenceClarifyToken` / `onIntelligenceClarify` (intent='clarify')
  - **新加的** `onGeminiStreamToken` / `onGeminiStreamDone` / `onGeminiStreamError`（generic 流，attach 到最近 isStreaming 占位）

- `electron/core/IntelligenceEngine.ts` 中调 `addAssistantMessage` 的位置：行 246, 326, 394, 531, 626, 705, 750, 783 —— 落到 SessionTracker，但**不一定有对应 IPC 推到 renderer**。
- `electron/ipc/core.ts:307`（非流式 `gemini-chat`）和 `:379`（流式 `gemini-chat-stream`）都会 `addAssistantMessage`。

### 排查方向（建议顺序）

1. **找出"主动查询"代码路径**：grep `proactive`, `autoQuery`, `auto-assist`, `intelligence` 之类关键词，找到从转录 → LLM 的触发点。
   - 推测在 `electron/core/IntelligenceEngine.ts` 某个 onTranscript hook 里。
2. **看它最终调哪个 LLM 函数 / 通过哪个 IPC 通道把结果推给 renderer**。
3. **对照 `useMeetingChat.ts` 的订阅清单**：如果 main 推的 channel 没有对应 renderer 监听，token 就丢了（和上面 #2 同病）。
4. **如果 main 根本没推 IPC**（只 `addAssistantMessage` 落库），需要在该路径加 `mainWindow.webContents.send(...)` 推送。

### 关键文件清单

- `electron/core/IntelligenceEngine.ts` — 所有 intelligence quick-action 流的 main 端逻辑
- `electron/core/SessionTracker.ts` — 转录/答案历史落库；`addAssistantMessage` 只是 in-memory 记录，不推 IPC
- `electron/IntelligenceManager.ts` — 包装 SessionTracker，被 IPC handler 调
- `electron/ipc/core.ts` — `gemini-chat` / `gemini-chat-stream` IPC handler
- `electron/preload.ts` & `electron/preload/intelligence.ts` — IPC channel ↔ window.electronAPI 映射
- `src/hooks/useMeetingChat.ts:152-` — renderer 端所有 IPC 监听
- `src/hooks/useMeetingChat.ts:363-` `submitPrompt` — 占位 placeholder + 调 `streamGeminiChat`

### 调试建议

- 先开 DevTools，触发"主动查询"，看 console 有没有 `[IPC]` 或 `[SessionTracker] addAssistantMessage` 打印
- 同时在 `useMeetingChat.ts` 的各 `cleanups.push(...)` 监听器开头加临时 `console.log` 看哪个 channel fire
- 如果 main 落库但 renderer 没收到任何 channel → main 端缺少推送
- 如果 renderer 收到但 placeholder 没匹配上 intent → intent 不一致或没有 isStreaming 占位

---

## 测试 checklist（实施时使用）

- [ ] Answer 按钮单击 → transcript-based 回答正常流式显示
- [ ] 快捷键 whatToAnswer / clarify / recap / followUp 都能流式显示
- [ ] 主动查询触发 → 答案在 chat 区显示
- [ ] 窗口 resize 后内容自适应 + 上下分区比例保留
- [ ] 折叠 / 展开 pill 行为不变
