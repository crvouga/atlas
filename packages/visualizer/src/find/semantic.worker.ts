/**
 * Loads a small quantized MiniLM when the finder opens. The weights come from the network and
 * stay in the browser cache. They are not part of the published package.
 */

type Extractor = (text: string, options: { pooling: 'mean'; normalize: true }) => Promise<{ data: Float32Array }>;

type Transformers = {
  pipeline: (task: 'feature-extraction', model: string, options: { dtype: 'q8' }) => Promise<Extractor>;
  env: { useBrowserCache: boolean; allowLocalModels: boolean };
};

let extractor: Promise<Extractor> | null = null;

function model(): Promise<Extractor> {
  extractor ??= (async () => {
    const href = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';
    const mod = (await import(/* @vite-ignore */ href)) as Transformers;
    mod.env.useBrowserCache = true;
    mod.env.allowLocalModels = false;
    return mod.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
  })();
  return extractor;
}

self.onmessage = (event: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = event.data;
  void model()
    .then(async (embed) => {
      const vectors: number[][] = [];
      for (const text of texts) {
        const result = await embed(text, { pooling: 'mean', normalize: true });
        vectors.push([...result.data]);
      }
      self.postMessage({ id, vectors });
    })
    .catch((error: unknown) => {
      self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    });
};
