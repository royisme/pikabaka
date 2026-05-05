# Handoff: STT Coherent Profile (Option A)

> **Status**: 计划已批准,待实施。下个会话从这里开始。
> **Created**: 2026-05-05
> **Decision owner**: User (Roy)

## 背景

用户反馈:实时语音记录和翻译的 segment 切得太零碎,中长句被打断,翻译跟着支离破碎。

调查后确认:`electron/lib/transcript-assembler.ts` 已有完整 assembler 框架(2 个 profile),问题在**当前默认 `sentence_bias` profile 的阈值对长句不够耐心** —— 静默 3.2s 就开新 turn,没有"最大持续时长"上限。

## 决策

**Option A**:新增第三个 profile `coherent`,在 Settings 加三选一切换。**默认仍是 `sentence_bias`**(保持向后兼容)。

不选 Option B/C 的原因:Pika 是面试副驾驶,默认行为不能为长句完整性牺牲实时反应速度;让用户自己按场景挑。

## 阈值设计

| 字段 | `sentence_bias` | `low_latency` | **`coherent` (新)** |
|---|---|---|---|
| `maxSilenceBeforeNewTurnMs` | 3200 | 2200 | **6000** |
| `sentenceFlushDelayMs` | 1350 | 700 | **2500** |
| `fragmentFlushDelayMs` | 2600 | 1450 | **5000** |
| `speechEndedSentenceFlushMs` | 260 | 120 | **400** |
| `speechEndedFragmentFlushMs` | 1100 | 500 | **1500** |
| `minWordsBeforeSentenceFlush` | 18 | 8 | **10** |
| **`maxTurnDurationMs` (新字段)** | `0`(禁用)或 `60000` | `0`(禁用) | **`30000`** |

### 新字段 `maxTurnDurationMs`

- 加到 `TranscriptAssemblerThresholds` interface
- 三个 profile 都必须有该字段(`0` 视为禁用上限)
- 在 `bufferFinalTranscriptChunk` 里,**在已有 `maxSilenceBeforeNewTurnMs` 检查之后**再加一道:
  ```ts
  if (buffer && thresholds.maxTurnDurationMs > 0
      && timestamp - buffer.startedAt > thresholds.maxTurnDurationMs) {
    void flushBufferedTranscriptTurn(appState, speaker);
    buffer = null;
  }
  ```
- 触发后照常开新 turn(避免一句无尽长篇被无限缓冲)

## 文件改动清单

### 1. `electron/lib/transcript-assembler.ts`
- 把 `TranscriptAssemblerProfile` 类型加 `'coherent'`
- 在 `TranscriptAssemblerThresholds` 里加 `maxTurnDurationMs: number`
- 给 `sentence_bias` / `low_latency` 也补上该字段(给 `0`)
- 新增 `coherent` 整套阈值
- `bufferFinalTranscriptChunk` 里加 max-duration 检查
- 把 `TRANSCRIPT_ASSEMBLER_PROFILE` 顶部常量改成**从 settings 动态读取**(目前是硬编码 'sentence_bias')—— 改 `getTranscriptAssemblerThresholds(appState)` 实现:从 SettingsManager 读 profile 名字,fallback 到 sentence_bias

### 2. `electron/services/SettingsManager.ts`
- 新增 setting key:`transcriptAssemblerProfile`,类型 `'sentence_bias' | 'low_latency' | 'coherent'`,默认 `'sentence_bias'`
- 暴露 getter / setter

### 3. `electron/ipc/stt.ts`(或 settings IPC 文件)
- 注册 `get-transcript-assembler-profile` / `set-transcript-assembler-profile` 两个 channel

### 4. `electron/preload/settings.ts` + `electron/preload.ts`
- 暴露 `getTranscriptAssemblerProfile()` / `setTranscriptAssemblerProfile(profile)` 给 renderer

### 5. `src/types/electron.d.ts`
- 类型同步:`getTranscriptAssemblerProfile`、`setTranscriptAssemblerProfile`

### 6. `src/components/SettingsOverlay.tsx`(或新加专门的 Advanced/Audio tab)
- 在 audio / STT 相关分区加一个 Radio 或 Select 控件,三选一:

| Profile | UI label | 描述 |
|---|---|---|
| `sentence_bias` | **Sentence-biased** *(默认)* | 平衡:句子完整性优先 + 适度延迟 |
| `low_latency` | **Low-latency** | 最低延迟,可能切碎长句 |
| `coherent` | **Coherent** | 句子最完整,翻译可能延后 5–30s |

控件交互参考已有的 STT provider 选择器(同样是 Settings 里的 dropdown 模式)。

## 验收

- [ ] `pnpm exec tsc --noEmit --pretty false` PASS
- [ ] `npm run app:dev` 起得来
- [ ] Settings 能看到三选一并能持久化
- [ ] 切到 `coherent`,演讲式长句不被切散(主观测试,跑一段 30s+ 演讲音频或自言自语)
- [ ] `currentInterviewerPartial`(实时跳字)在 `coherent` 下仍然实时,不被 buffer
- [ ] 翻译延迟在 30s 内出来
- [ ] 切换 profile 后下一个 turn 立即生效(不需要重启)

## 风险 / 注意

1. `maxTurnDurationMs` 只影响 final segment flush 的上限,**绝不能延迟 partial 显示**(`currentInterviewerPartial` 走的是另外的实时通道)。修改时验证两路独立。
2. 切换 profile 时,正在 buffer 中的 turn 应该用**旧阈值完成现有 flush**,新阈值从下一个 turn 开始 —— 避免在中途换计时器导致跳字。
3. `getTranscriptAssemblerThresholds` 现在是同步读常量,改成读 settings 后注意调用频率(每次 buffer chunk 都会调) —— 把 profile name 缓存到 AppState,settings 变化时主动更新缓存,不要每次 IPC。
4. 不要碰 STT provider 适配层和 native VAD 阈值 —— 范围爆炸 + 高风险。
5. 当前仓库还有未 commit 的 Phase 3 + Launcher 重设计 + slogan 等改动(37 文件 modified),开始这个任务前**先 commit 一波**或单独开 branch,免得回滚困难。

## 实现顺序建议

1. **先 commit 当前未提交改动**(Phase 3 + Launcher 重设计 + slogan + Calendar tab 删除),建议拆 2-3 个 commit
2. 改 `transcript-assembler.ts`(类型 + 新 profile + max-duration 逻辑),tsc 跑过
3. SettingsManager + IPC + preload + types
4. UI Settings 控件
5. `npm run app:dev` 主观测试三种 profile
6. commit

## 不在范围

- STT provider 各自的 partial/final 分段策略(Google / Deepgram / Soniox 等)
- Native module VAD 阈值
- 翻译触发节奏(沿用现有"final segment → 翻译")
- UI 上额外暴露阈值微调(profile 三选一已足够)
