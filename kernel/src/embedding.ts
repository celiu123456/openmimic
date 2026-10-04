/**
 * Embedding client interface and utilities.
 *
 * The production implementation talks to any OpenAI-compatible
 * `/embeddings` endpoint. The fake implementation is deterministic
 * (character bigram hash to a fixed-dimensional vector) and used in tests.
 */

/** Injectable embedding client. */
export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
}

/** Cosine similarity between two vectors. Returns 0 for zero-norm inputs. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Deterministic embedding for tests: character bigram hashing into a
 * fixed-dimensional vector.
 *
 * Not cryptographic — just stable enough that two semantically unrelated
 * strings get low cosine and two overlapping strings get high cosine.
 */
export class FakeEmbedding implements EmbeddingClient {
  constructor(private readonly dims: number = 64) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.hashVector(text));
  }

  private hashVector(text: string): number[] {
    const vector = new Array<number>(this.dims).fill(0);
    const lower = text.toLowerCase();
    for (let i = 0; i + 1 < lower.length; i++) {
      const code = lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1);
      const bucket = ((code % this.dims) + this.dims) % this.dims;
      vector[bucket] += 1;
    }
    // Normalize to unit length
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) vector[i] /= norm;
    }
    return vector;
  }
}

export interface OpenAICompatEmbeddingClientOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Production embedding client for any OpenAI-compatible `/embeddings` endpoint.
 *
 * Falls back to `LLM_BASE_URL` / `LLM_API_KEY` when the embedding-specific
 * env vars are not set.
 */
export class OpenAICompatEmbeddingClient implements EmbeddingClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatEmbeddingClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.EMBEDDING_BASE_URL ??
      process.env.LLM_BASE_URL ??
      ''
    ).replace(/\/+$/, '');
    this.apiKey =
      options.apiKey ??
      process.env.EMBEDDING_API_KEY ??
      process.env.LLM_API_KEY ??
      '';
    this.model =
      options.model ??
      process.env.EMBEDDING_MODEL ??
      '';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return this.baseUrl.length > 0 && this.model.length > 0;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.baseUrl) throw new Error('EMBEDDING_BASE_URL is not configured');
    if (!this.model) throw new Error('EMBEDDING_MODEL is not configured');

    const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Embedding request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 500)}` : ''}`,
      );
    }

    const body = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return body.data.map((item) => item.embedding);
  }
}
