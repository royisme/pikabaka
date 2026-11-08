import type { Message } from './useMeetingChat';

const lastOf = (prev: Message[]): Message | undefined => prev[prev.length - 1];

const replaceLast = (prev: Message[], next: Message): Message[] => [...prev.slice(0, -1), next];

/** The last message is still streaming and, when an intent is given, belongs to it. */
const isOpenStream = (last: Message | undefined, intent: string | undefined): last is Message =>
  Boolean(last && last.isStreaming && (intent === undefined || last.intent === intent));

/** A streamed token: extend the open message, or start a streaming one. */
export function appendStreaming(prev: Message[], text: string, intent?: string): Message[] {
  const last = lastOf(prev);
  if (isOpenStream(last, intent)) return replaceLast(prev, { ...last, text: last.text + text });
  return [...prev, { id: Date.now().toString(), role: 'system', text, ...(intent ? { intent } : {}), isStreaming: true }];
}

/** The full answer: close the open message with it, or add it as a finished message. */
export function finalizeStreaming(prev: Message[], text: string, intent: string): Message[] {
  const last = lastOf(prev);
  if (isOpenStream(last, intent)) return replaceLast(prev, { ...last, text, isStreaming: false });
  return [...prev, { id: Date.now().toString(), role: 'system', text, intent }];
}

/** The stream ended: stop the open message, or change nothing. */
export function endStreaming(prev: Message[]): Message[] {
  const last = lastOf(prev);
  return last && last.isStreaming ? replaceLast(prev, { ...last, isStreaming: false }) : prev;
}

/** A finished message with no stream behind it. */
export function pushSystem(prev: Message[], text: string, isError?: boolean): Message[] {
  return [...prev, { id: Date.now().toString(), role: 'system', text, ...(isError ? { isError } : {}) }];
}

/** An error after a stream: an empty open placeholder gives way to it. */
export function pushStreamError(prev: Message[], text: string): Message[] {
  const last = lastOf(prev);
  const errMsg: Message = { id: Date.now().toString(), role: 'system', text, isError: true };
  if (last && last.isStreaming && last.text === '') return prev.slice(0, -1).concat(errMsg);
  return [...prev, errMsg];
}
