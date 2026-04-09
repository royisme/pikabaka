/**
 * Custom fetch adapter that bridges useChat (Vercel AI SDK) to Electron IPC.
 *
 * Instead of making HTTP requests, this communicates via IPC channels exposed
 * on window.electronAPI, returning a ReadableStream formatted as the AI SDK
 * data stream protocol so that useChat can parse it correctly.
 *
 * AI SDK data stream protocol:
 *   TYPE_ID:JSON_VALUE\n
 *   0  = text token
 *   8  = finish_message  { finishReason, usage }
 *   3  = error
 */

// Type-0 text part:  0:"<text>"\n
function encodeTextPart(text: string): string {
  return `0:${JSON.stringify(text)}\n`;
}

// Type-8 finish_message part
function encodeFinishPart(): string {
  return `8:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } })}\n`;
}

// Type-3 error part
function encodeErrorPart(message: string): string {
  return `3:${JSON.stringify(message)}\n`;
}

/**
 * Custom fetch adapter for useChat.
 *
 * Usage:
 *   const { messages, input, handleSubmit } = useChat({
 *     fetch: electronChatFetch,
 *     body: { meetingId, context },
 *   });
 */
export async function electronChatFetch(
  _input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const body = JSON.parse((init?.body as string) ?? '{}');
  const { messages } = body;

  // Custom fields forwarded via useChat's `body` option
  const meetingId: string = body.meetingId ?? '';
  const context: string = body.context ?? '';

  const requestId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      function enqueue(text: string) {
        controller.enqueue(encoder.encode(text));
      }

      // --- IPC listeners ---

      const chunkCleanup = window.electronAPI?.onChatStreamChunk(
        (data: { requestId: string; chunk: string }) => {
          if (data.requestId !== requestId) return;
          enqueue(encodeTextPart(data.chunk));
        }
      );

      const doneCleanup = window.electronAPI?.onChatStreamComplete(
        (data: { requestId: string }) => {
          if (data.requestId !== requestId) return;
          enqueue(encodeFinishPart());
          cleanup();
          controller.close();
        }
      );

      const errorCleanup = window.electronAPI?.onChatStreamError(
        (data: { requestId: string; error: string }) => {
          if (data.requestId !== requestId) return;
          enqueue(encodeErrorPart(data.error));
          cleanup();
          controller.error(new Error(data.error));
        }
      );

      function cleanup() {
        chunkCleanup?.();
        doneCleanup?.();
        errorCleanup?.();
      }

      // --- Abort handling ---

      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          window.electronAPI?.chatCancelStream(requestId);
          cleanup();
          try {
            controller.close();
          } catch {
            // Already closed — ignore
          }
        });
      }

      // --- Kick off the IPC stream ---

      window.electronAPI?.chatStreamMeeting({
        requestId,
        meetingId,
        messages: (messages ?? []).map((m: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => {
          const partsText = m.parts
            ?.filter((part) => part.type === 'text')
            .map((part) => part.text ?? '')
            .join('') ?? '';
          const text = m.content ?? partsText;
          return { role: m.role, content: text };
        }),
        context,
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'x-vercel-ai-data-stream': 'v1',
    },
  });
}
