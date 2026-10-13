import type { FindDoc, Ranked } from './rank';

/** Turns text into vectors. Tests pass a fake. The browser one loads a model on demand. */
export type Embedder = {
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>;
};

/** Below this, a paraphrase is too vague to add to the list. */
export const SEMANTIC_FLOOR = 0.42;

export function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    left += x * x;
    right += y * y;
  }
  const scale = Math.sqrt(left) * Math.sqrt(right);
  return scale === 0 ? 0 : dot / scale;
}

export function textHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function embedText(doc: FindDoc): string {
  return [doc.title, doc.subtitle, ...doc.fields.map((field) => field.text)].join('\n');
}

/**
 * Reorder lexical hits by cosine when both sides have a vector, and add a document the words
 * missed when it is still close to the query. Lexical hits stay in the list either way.
 */
export function applySemantic(docs: readonly FindDoc[], lexical: readonly Ranked[], queryVector: Float32Array, vectors: ReadonlyMap<string, Float32Array>, limit = 40): Ranked[] {
  let maxLexical = 1;
  for (const hit of lexical) if (hit.score > maxLexical) maxLexical = hit.score;
  const blended: Ranked[] = lexical.map((hit) => {
    const vector = vectors.get(hit.doc.id);
    if (!vector) return hit;
    const similarity = cosine(queryVector, vector);
    return { ...hit, score: hit.score * (0.65 + 0.35 * Math.max(0, similarity)) };
  });
  const seen = new Set(blended.map((hit) => hit.doc.id));
  for (const doc of docs) {
    if (seen.has(doc.id)) continue;
    const vector = vectors.get(doc.id);
    if (!vector) continue;
    const similarity = cosine(queryVector, vector);
    if (similarity < SEMANTIC_FLOOR) continue;
    blended.push({ doc, score: similarity * maxLexical * 0.5, snippet: '' });
  }
  blended.sort((a, b) => b.score - a.score || (a.doc.title < b.doc.title ? -1 : a.doc.title > b.doc.title ? 1 : 0));
  return blended.slice(0, limit);
}

type EmbedRequest = { id: number; texts: string[] };
type EmbedResponse = { id: number; vectors?: number[][]; error?: string };

/** True when this module was loaded from a page, so a worker can fetch a model. Tests load it from disk. */
export function embeddingsAvailable(): boolean {
  return import.meta.url.startsWith('http:') || import.meta.url.startsWith('https:');
}

/** One worker for the page. The model is fetched into the browser cache, never shipped in the package. */
export function createWorkerEmbedder(): Embedder {
  const worker = new Worker(new URL('./semantic.worker.ts', import.meta.url), { type: 'module' });
  let next = 0;
  const pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event: MessageEvent<EmbedResponse>) => {
    const wait = pending.get(event.data.id);
    if (!wait) return;
    pending.delete(event.data.id);
    if (event.data.error || !event.data.vectors) wait.reject(new Error(event.data.error ?? 'The embedder returned nothing'));
    else wait.resolve(event.data.vectors.map((values) => Float32Array.from(values)));
  };
  return {
    embed(texts) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const message: EmbedRequest = { id, texts: [...texts] };
        worker.postMessage(message);
      });
    }
  };
}
