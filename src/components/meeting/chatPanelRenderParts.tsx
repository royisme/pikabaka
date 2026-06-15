import React from 'react';
import { getFriendlyModelDisplayName, type OpenAICompatibleProviderSummary } from '../../utils/modelUtils';

export interface ChatPanelAttachment {
  path: string;
  preview: string;
}

export type SetAttachedContext = React.Dispatch<React.SetStateAction<ChatPanelAttachment[]>>;

export interface ClipboardItemLike {
  type: string;
}

export interface ClipboardEventLike {
  clipboardData?: {
    items?: ArrayLike<ClipboardItemLike>;
  } | null;
  preventDefault: () => void;
}

export interface KeyDownEventLike {
  key: string;
}

export const CHAT_PANEL_CONTROL_BAR_CLASS =
  'shrink-0 draggable-area flex flex-col min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between gap-2 px-4 pt-3 pb-2 border-b overlay-border-subtle';
export const CHAT_PANEL_CONTROL_BUTTON_CLASS =
  'no-drag flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium border overlay-chip-surface overlay-text-interactive interaction-base interaction-hover interaction-press min-h-[30px]';
export const CHAT_PANEL_DRAG_HANDLE_CLASS =
  'draggable-area flex min-w-0 flex-1 items-center gap-2 rounded-full px-2 py-1 text-[11px] overlay-text-muted';
export const CHAT_PANEL_ACTION_BAR_CLASS =
  'shrink-0 grid grid-cols-2 min-[520px]:flex min-[520px]:flex-wrap justify-stretch min-[520px]:justify-center items-center gap-1.5 px-4 py-2.5 no-drag';

export const CHAT_PANEL_FOOTER_CLASS = 'shrink-0 p-3 pt-0 no-drag min-h-[118px]';

export const CHAT_PANEL_FOOTER_CONTROLS_CLASS =
  'flex flex-wrap items-center justify-between gap-2 mt-3 px-0.5 min-w-0';

export const CHAT_PANEL_INPUT_BASE_CLASS =
  'w-full min-h-[42px] border focus:ring-1 rounded-xl pl-3 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed';

export function getChatPanelModelDisplayName(
  currentModel: string,
  openAICompatibleProviders: OpenAICompatibleProviderSummary[] = []
): string {
  return getFriendlyModelDisplayName(currentModel, openAICompatibleProviders);
}

export function handleChatInputPaste(
  event: ClipboardEventLike,
  handlePasteImage: () => void
): void {
  const hasImage = Array.from(event.clipboardData?.items || []).some((item) =>
    item.type.startsWith('image/')
  );

  if (!hasImage) return;

  event.preventDefault();
  handlePasteImage();
}

export function createChatInputPasteHandler(handlePasteImage: () => void) {
  return (event: ClipboardEventLike) => handleChatInputPaste(event, handlePasteImage);
}

export function handleChatInputKeyDown(
  event: KeyDownEventLike,
  handleManualSubmit: () => void
): void {
  if (event.key === 'Enter') handleManualSubmit();
}

export type ChatRunState = 'running' | 'paused' | 'idle';

export interface ChatPanelControlBarProps {
  isProcessing: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  onStop: () => void;
  onToggleCollapse?: () => void;
  onOpenLauncher?: () => void;
}

export function getChatPanelRunState(isProcessing: boolean, isPaused: boolean): ChatRunState {
  if (isPaused) return 'paused';
  if (isProcessing) return 'running';
  return 'idle';
}

export function ChatPanelControlBar({
  isProcessing,
  isPaused,
  onTogglePause,
  onStop,
  onToggleCollapse,
  onOpenLauncher,
}: ChatPanelControlBarProps) {
  const runState = getChatPanelRunState(isProcessing, isPaused);
  const statusLabel = runState === 'paused' ? 'Paused' : runState === 'running' ? 'Answering' : 'Ready';

  return (
    <div className={CHAT_PANEL_CONTROL_BAR_CLASS} data-testid="chat-control-bar">
      <div className={CHAT_PANEL_DRAG_HANDLE_CLASS} aria-label="Drag chat window" title="Drag chat window">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full overlay-icon-surface" aria-hidden="true">
          <span className="text-[15px] leading-none">⋮⋮</span>
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium overlay-text-primary">AI Chat</div>
          <div className="truncate text-[10px] uppercase tracking-[0.12em]">Drag here • {statusLabel}</div>
        </div>
      </div>
      <div className="no-drag grid grid-cols-2 min-[420px]:flex min-[420px]:flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          className={`${CHAT_PANEL_CONTROL_BUTTON_CLASS} ${isPaused ? 'text-state-warning' : ''}`}
          onClick={onTogglePause}
          aria-pressed={isPaused}
          aria-label={isPaused ? 'Resume meeting listening' : 'Pause meeting listening'}
          title={isPaused ? 'Resume meeting listening' : 'Pause meeting listening'}
        >
          <span aria-hidden="true">{isPaused ? '▶' : 'Ⅱ'}</span>
          <span>{isPaused ? 'Resume' : 'Pause'}</span>
        </button>
        <button
          type="button"
          className={`${CHAT_PANEL_CONTROL_BUTTON_CLASS} hover:bg-state-danger-soft hover:text-state-danger`}
          onClick={onStop}
          aria-label={isProcessing ? 'Stop current answer' : 'Stop and clear chat'}
          title={isProcessing ? 'Stop current answer' : 'Stop and clear chat'}
        >
          <span aria-hidden="true">■</span>
          <span>Stop</span>
        </button>
        {onToggleCollapse && (
          <button
            type="button"
            className={CHAT_PANEL_CONTROL_BUTTON_CLASS}
            onClick={onToggleCollapse}
            aria-label="Collapse chat"
            title="Collapse chat"
          >
            Hide
          </button>
        )}
        {onOpenLauncher && (
          <button
            type="button"
            className={CHAT_PANEL_CONTROL_BUTTON_CLASS}
            onClick={onOpenLauncher}
            aria-label="Open launcher"
            title="Open launcher"
          >
            Home
          </button>
        )}
      </div>
    </div>
  );
}

interface ChatPanelAttachedScreenshotsProps {
  attachedContext: ChatPanelAttachment[];
  setAttachedContext: SetAttachedContext;
  isLightTheme: boolean;
  subtleSurfaceClass?: string;
  subtleStyle?: React.CSSProperties;
  iconStyle?: React.CSSProperties;
  removeAllIcon?: React.ReactNode;
  removeIcon?: React.ReactNode;
}

export function ChatPanelAttachedScreenshots({
  attachedContext,
  setAttachedContext,
  isLightTheme,
  subtleSurfaceClass = 'overlay-subtle-surface',
  subtleStyle,
  iconStyle,
  removeAllIcon = '×',
  removeIcon = '×',
}: ChatPanelAttachedScreenshotsProps) {
  if (attachedContext.length === 0) return null;

  return (
    <div
      className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`}
      style={subtleStyle}
      data-testid="chat-panel-attachments"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium overlay-text-primary">
          {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''} attached
        </span>
        <button
          type="button"
          onClick={() => setAttachedContext([])}
          className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
          title="Remove all"
          aria-label="Remove all screenshots"
          style={iconStyle}
        >
          {removeAllIcon}
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
        {attachedContext.map((ctx, idx) => (
          <div key={ctx.path} className="relative group/thumb flex-shrink-0">
            <img
              src={ctx.preview}
              alt={`Screenshot ${idx + 1}`}
              className={`h-10 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
            />
            <button
              type="button"
              onClick={() => setAttachedContext((prev) => prev.filter((_, i) => i !== idx))}
              className="absolute -top-1 -right-1 w-4 h-4 bg-state-danger hover:bg-state-danger rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
              title="Remove"
              aria-label={`Remove screenshot ${idx + 1}`}
            >
              {removeIcon}
            </button>
          </div>
        ))}
      </div>
      <span className="text-[10px] overlay-text-muted">Ask a question or click Answer</span>
    </div>
  );
}

interface ChatPanelTextInputProps {
  textInputRef?: React.Ref<HTMLInputElement>;
  inputValue: string;
  setInputValue: (value: string) => void;
  handleManualSubmit: () => void;
  handleInputPaste: (event: ClipboardEventLike) => void;
  inputClass?: string;
  inputStyle?: React.CSSProperties;
  controlStyle?: React.CSSProperties;
  selectiveScreenshotShortcut?: string[];
}

export function ChatPanelTextInput({
  textInputRef,
  inputValue,
  setInputValue,
  handleManualSubmit,
  handleInputPaste,
  inputClass = '',
  inputStyle,
  controlStyle,
  selectiveScreenshotShortcut,
}: ChatPanelTextInputProps) {
  const shortcut = selectiveScreenshotShortcut || ['⌘', 'Shift', 'H'];

  return (
    <div className="relative group">
      <input
        ref={textInputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => handleChatInputKeyDown(e, handleManualSubmit)}
        onPaste={handleInputPaste as React.ClipboardEventHandler<HTMLInputElement>}
        className={`${CHAT_PANEL_INPUT_BASE_CLASS} ${inputClass}`.trim()}
        style={inputStyle}
      />

      {!inputValue && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[12px] overlay-text-muted/90 max-w-[calc(100%-56px)] overflow-hidden whitespace-nowrap">
          <span className="truncate">Ask anything on screen or conversation</span>
          <div className="hidden min-[500px]:flex items-center gap-1 opacity-80">
            {shortcut.map((key, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-[10px]">+</span>}
                <kbd
                  className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary"
                  style={controlStyle}
                >
                  {key}
                </kbd>
              </React.Fragment>
            ))}
          </div>
          <span className="hidden min-[500px]:inline">for screenshot</span>
        </div>
      )}

      {!inputValue && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
          <span className="text-[10px]">↵</span>
        </div>
      )}
    </div>
  );
}
