/**
 * Custom fetch adapter that bridges useChat (AI SDK 7) to Electron IPC.
 *
 * Instead of making HTTP requests, this communicates via IPC channels exposed on window.electronAPI
 * and answers with the AI SDK's UI message stream: server-sent events whose `data:` payload is one
 * UI message chunk (`start`, `text-start`, `text-delta`, `text-end`, `finish`, `error`, `abort`),
 * tagged by the `x-vercel-ai-ui-message-stream: v1` header. DefaultChatTransport parses this format:
 * the older `TYPE:JSON` data-stream lines yield zero chunks, so the message arrives empty.
 */

const UI_MESSAGE_STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
} as const

type StreamChunk =
  | { type: 'start'; messageId: string }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'finish'; finishReason: 'stop' }
  | { type: 'error'; errorText: string }
  | { type: 'abort'; reason?: string }

const encodeChunk = (chunk: StreamChunk): Uint8Array =>
  new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)

/**
 * Custom fetch adapter for useChat.
 *
 * Usage:
 *   useChat({ transport: new DefaultChatTransport({ fetch: electronChatFetch, body: { meetingId, context } }) })
 */
export async function electronChatFetch(
  _input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // The transport always sends JSON, but a malformed body must fail the request, not the renderer.
  const body = (() => {
    try {
      return JSON.parse((init?.body as string) ?? '{}')
    } catch {
      return {}
    }
  })()
  const { messages } = body

  // Custom fields forwarded via useChat's `body` option
  const meetingId: string = body.meetingId ?? ''
  const context: string = body.context ?? ''

  const requestId = crypto.randomUUID()
  const textId = crypto.randomUUID()
  const signal = init?.signal
  // Every terminal path (done, error, abort, consumer cancel) runs this once: listeners and the abort
  // handler must not outlive the stream, and nothing may enqueue after it ended.
  let ended = false
  let dispose = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const subscriptions = [
        window.electronAPI?.onChatStreamChunk((data: { requestId: string; chunk: string }) => {
          if (data.requestId !== requestId || ended) return
          send({ type: 'text-delta', id: textId, delta: data.chunk })
        }),
        window.electronAPI?.onChatStreamComplete((data: { requestId: string }) => {
          if (data.requestId !== requestId || ended) return
          send({ type: 'text-end', id: textId })
          send({ type: 'finish', finishReason: 'stop' })
          end()
        }),
        window.electronAPI?.onChatStreamError((data: { requestId: string; error: string }) => {
          if (data.requestId !== requestId || ended) return
          // A chunk, not controller.error(): the parser turns this into the message's error part.
          send({ type: 'error', errorText: data.error })
          end()
        }),
      ].filter((cleanup): cleanup is () => void => typeof cleanup === 'function')

      function send(chunk: StreamChunk) {
        if (ended) return
        controller.enqueue(encodeChunk(chunk))
      }

      // Declared before `dispose`: the pre-aborted path ends the stream before this point.
      const abortListener = () => onAbort(true)

      dispose = () => {
        for (const cleanup of subscriptions.splice(0)) cleanup()
        signal?.removeEventListener('abort', abortListener)
      }

      function end() {
        if (ended) return
        ended = true
        dispose()
        controller.close()
      }

      function onAbort(stopMainProcess: boolean) {
        if (ended) return
        // Nothing to stop when the request never started; otherwise the main process is still running.
        if (stopMainProcess) void window.electronAPI?.chatCancelStream(requestId)
        send({ type: 'abort' })
        end()
      }

      // An already-aborted request must never reach the main process, so there is nothing to cancel.
      if (signal?.aborted) {
        onAbort(false)
        return
      }
      signal?.addEventListener('abort', abortListener, { once: true })

      send({ type: 'start', messageId: crypto.randomUUID() })
      send({ type: 'text-start', id: textId })

      Promise.resolve(
        window.electronAPI?.chatStreamMeeting({
          requestId,
          meetingId,
          messages: (messages ?? []).map((m: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => {
            const partsText = m.parts
              ?.filter((part) => part.type === 'text')
              .map((part) => part.text ?? '')
              .join('') ?? ''
            const text = m.content ?? partsText
            return { role: m.role, content: text }
          }),
          context,
        })
      ).then(
        (result) => {
          // The main process reports validation failures by sending an error event first and returning
          // `{ success: false }` with no message, so any failure without a preceding terminal event
          // still ends the response instead of leaving it open.
          if (ended || !result || result.success !== false) return
          send({ type: 'error', errorText: result.error ?? 'The chat request failed.' })
          end()
        },
        (error: unknown) => {
          if (ended) return
          send({ type: 'error', errorText: error instanceof Error ? error.message : 'The chat stream could not start.' })
          end()
        }
      )
    },
    cancel() {
      // The consumer stopped reading (component unmounted): stop the main-process stream too.
      void window.electronAPI?.chatCancelStream(requestId)
      if (ended) return
      ended = true
      dispose()
    },
  })

  return new Response(stream, { status: 200, headers: UI_MESSAGE_STREAM_HEADERS })
}
