import { spawn } from 'child_process';
import { DatabaseManager } from '../db/DatabaseManager';

export class OllamaBootstrap {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if Ollama daemon is reachable
   */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { 
        signal: AbortSignal.timeout(2000) 
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to start the Ollama daemon via shell
   */
  async ensureOllamaRunning(): Promise<boolean> {
    if (await this.isOllamaRunning()) return true;
    
    // Try to start it
    try {
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
      child.on('error', (err) => {
        console.error('[OllamaBootstrap] Failed to spawn ollama (not installed?):', err);
      });
      child.unref();
    } catch (e) {
      console.error('[OllamaBootstrap] Synchronous error spawning ollama:', e);
      return false;
    }
    
    // Wait up to 5 seconds for it to come up
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this.isOllamaRunning()) return true;
    }
    return false;
  }

  /**
   * Check if a specific model is already pulled
   */
  async isModelPulled(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      const data = await res.json();
      return data.models?.some((m: any) => m.name.startsWith(model)) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Pull a model with streaming progress events.
   */
  async pullModel(
    model: string,
    onProgress: (status: string, percent: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // FIX (P1-3): Wrap with a hard timeout so a stalled Ollama HTTP stream
    // doesn't hang the caller indefinitely.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 10 * 60 * 1000); // 10 min

    // Merge external signal with our timeout signal
    const effectiveSignal = (() => {
      if (!signal) return timeoutController.signal;
      const merged = new AbortController();
      const abort = () => merged.abort();
      signal.addEventListener('abort', abort, { once: true });
      timeoutController.signal.addEventListener('abort', abort, { once: true });
      return merged.signal;
    })();

    try {
      const res = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: true }),
        signal: effectiveSignal,
      });

      if (!res.ok) throw new Error(`Ollama pull failed: ${res.statusText}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const lines = decoder.decode(value).split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.total && event.completed) {
                const percent = Math.round((event.completed / event.total) * 100);
                onProgress(event.status ?? 'downloading', percent);
              } else if (event.status) {
                onProgress(event.status, 0);
              }
            } catch {
              // Partial JSON line — ignore
            }
          }
        }
      } finally {
        // Always release the reader lock, even on AbortError, preventing
        // the underlying connection from being held open indefinitely.
        reader.cancel().catch(() => { /* ignore cancel errors */ });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Full bootstrap sequence. Resumes from DB state.
   */
  async bootstrap(
    model = 'nomic-embed-text',
    onProgress: (status: string, percent: number) => void
  ): Promise<'not_running' | 'already_pulled' | 'pulled' | 'failed' | 'in_progress'> {
    
    const db = DatabaseManager.getInstance();
    const status = db.getAppState('ollama_pull_status');
    
    if (status === 'complete') {
        // Double check against daemon just in case user deleted it manually
        const pulled = await this.isModelPulled(model);
        if (pulled) return 'already_pulled';
    }

    const running = await this.ensureOllamaRunning();
    if (!running) return 'not_running';

    const pulled = await this.isModelPulled(model);
    if (pulled) {
        db.setAppState('ollama_pull_status', 'complete');
        return 'already_pulled';
    }

    try {
      db.setAppState('ollama_pull_status', 'in_progress');
      onProgress('starting download', 0);
      
      await this.pullModel(model, onProgress);
      
      onProgress('ready', 100);
      db.setAppState('ollama_pull_status', 'complete');
      return 'pulled';
    } catch (err: any) {
      console.error('[OllamaBootstrap] Pull failed:', err.message);
      db.setAppState('ollama_pull_status', 'failed');
      return 'failed';
    }
  }
}
