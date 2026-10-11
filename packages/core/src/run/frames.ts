import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Clip } from './types';

export type FrameRecorderOptions = {
  /** The image format `capture` returns (default png). */
  extension?: 'png' | 'jpg';
  /** Upper bound on frames per second (default 25). */
  maxFps?: number;
};

/**
 * Record a clip from any driver that can take a screenshot: capture frames back to back while the
 * step runs, then encode them with FFmpeg as H.264 MP4 at their real timing. Drivers without a
 * native screen recorder (Bun WebView, WebDriver) use it; it needs `ffmpeg` on the PATH and
 * returns no clip without it.
 */
export async function recordFrames(capture: () => Promise<Uint8Array>, workDirectory: string, options: FrameRecorderOptions = {}) {
  mkdirSync(workDirectory, { recursive: true });
  const extension = options.extension ?? 'png';
  const gapMs = 1000 / (options.maxFps ?? 25);
  const started = Date.now();
  const frames: { file: string; atMs: number }[] = [];
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const at = Date.now();
      const bytes = await capture().catch(() => null);
      if (bytes && bytes.length) {
        const file = `${String(frames.length).padStart(5, '0')}.${extension}`;
        writeFileSync(path.join(workDirectory, file), bytes);
        frames.push({ file, atMs: at - started });
      }
      const wait = gapMs - (Date.now() - at);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  })();
  return {
    async stop(output: string): Promise<Clip | null> {
      stopped = true;
      await loop;
      const durationMs = Date.now() - started;
      const last = frames.at(-1);
      if (!last) return null;
      const list = frames
        .map((frame, i) => `file '${frame.file}'\nduration ${(((frames[i + 1]?.atMs ?? durationMs) - frame.atMs) / 1000).toFixed(3)}`)
        .concat(`file '${last.file}'`)
        .join('\n');
      const listFile = path.join(workDirectory, 'frames.txt');
      writeFileSync(listFile, `${list}\n`);
      mkdirSync(path.dirname(output), { recursive: true });
      const encoded = spawnSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-r', '30', '-movflags', '+faststart', output],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );
      if (encoded.error || encoded.status !== 0) return null;
      return { video: output, durationMs };
    }
  };
}
