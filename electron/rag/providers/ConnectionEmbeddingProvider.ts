import { openAiRoot, type Connection } from '../../services/aiConnections';
import { IEmbeddingProvider } from './IEmbeddingProvider';

export class ConnectionEmbeddingProvider implements IEmbeddingProvider {
  readonly name: string;
  private dimensionCount = 0;
  private probe: Promise<boolean> | null = null;

  constructor(private connection: Connection, private model: string) {
    if (connection.type !== 'openai' && connection.type !== 'gemini') {
      throw new Error('Embeddings require an OpenAI-type or Gemini-type connection');
    }
    this.name = `${connection.id}:${model}`;
  }

  get dimensions(): number {
    return this.dimensionCount;
  }

  isAvailable(): Promise<boolean> {
    this.probe ??= this.embed('Embedding availability probe.').then(vector => {
      this.dimensionCount = vector.length;
      return true;
    }).catch(() => false);
    return this.probe;
  }

  async embed(text: string): Promise<number[]> {
    if (this.connection.type === 'openai') return (await this.embedBatchInput(text))[0];
    const model = this.model.replace(/^models\//, '');
    const { data, status } = await this.request(
      `${this.connection.baseUrl}/v1beta/models/${model}:embedContent`,
      { content: { parts: [{ text }] } }
    );
    const payload = data as { embedding?: { values?: unknown } } | null;
    return this.vector(payload?.embedding?.values, status);
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this.connection.type === 'openai') return this.embedBatchInput(texts);
    return Promise.all(texts.map(text => this.embed(text)));
  }

  private async embedBatchInput(input: string | string[]): Promise<number[][]> {
    const { data, status } = await this.request(`${openAiRoot(this.connection.baseUrl)}/embeddings`, {
      model: this.model, input,
    });
    const payload = data as { data?: Array<{ index: number; embedding: unknown } | null> } | null;
    if (!Array.isArray(payload?.data) || payload.data.length !== (Array.isArray(input) ? input.length : 1)) {
      throw new Error(`Embedding response contains invalid vectors (HTTP ${status})`);
    }
    return payload.data.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0)).map(item => this.vector(item?.embedding, status));
  }

  private vector(value: unknown, status: number): number[] {
    if (!Array.isArray(value) || value.length === 0 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error(`Embedding response contains an empty or invalid vector (HTTP ${status})`);
    }
    return value;
  }

  private async request(url: string, body: object): Promise<{ data: unknown; status: number }> {
    const headers: Record<string, string> = { ...this.connection.headers, 'Content-Type': 'application/json' };
    if (this.connection.type === 'gemini') headers['x-goog-api-key'] = this.connection.apiKey;
    else if (this.connection.apiKey) headers.Authorization = `Bearer ${this.connection.apiKey}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Network errors can include the URL or input supplied by a host; never forward them.
      throw new Error('Embedding request failed or timed out');
    }
    if (!response.ok) throw new Error(`Embedding request failed (HTTP ${response.status})`);
    try {
      return { data: await response.json(), status: response.status };
    } catch {
      throw new Error(`Embedding response is not valid JSON (HTTP ${response.status})`);
    }
  }
}
