export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  isAvailable(): Promise<boolean>;
  /** Embed a document chunk (for storage) */
  embed(text: string): Promise<number[]>;
  /** Embed a search query (asymmetric models may prepend a search prefix) */
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
