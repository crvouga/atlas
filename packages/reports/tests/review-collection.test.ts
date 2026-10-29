import { describe, expect, test } from 'bun:test';

import { digestOf, foldReviewed, safeFileName, type ReviewNote } from '../src/review-collection';

const note = (id: string, atMs: number, kind: ReviewNote['kind'], entry: string, by = 'ana'): ReviewNote => ({ id, collection: 'rc-00000000', revision: 1, entry, kind, by, atMs });

describe('review collection helpers', () => {
  test('a file name is safe to write: one segment, no traversal, no hidden file, never empty', () => {
    expect(safeFileName('../../etc/pass wd.webm')).toBe('pass_wd.webm');
    expect(safeFileName('C:\\temp\\take 1.mp4')).toBe('take_1.mp4');
    expect(safeFileName('.env')).toBe('env');
    expect(safeFileName('///')).toBe('file');
    expect(safeFileName('é.webm')).toBe('_.webm');
    expect(safeFileName('a'.repeat(300)).length).toBe(100);
  });

  test('only a recorded sha256 is a digest; a bundle key is unknown, not verified', () => {
    expect(digestOf(`sha256:${'a'.repeat(64)}`)).toBe('a'.repeat(64));
    expect(digestOf('layers/blobs/x.gz')).toBeNull();
    expect(digestOf(undefined)).toBeNull();
  });

  test('the newest reviewed or unreviewed mark of an entry decides, and other notes never count as a mark', () => {
    const notes = [note('2', 20, 'unreviewed', 'e1'), note('1', 10, 'reviewed', 'e1'), note('3', 15, 'reviewed', 'e2', 'bo'), note('4', 30, 'note', 'e2')];
    expect(foldReviewed(notes)).toEqual({ e2: { by: 'bo', atMs: 15 } });
  });
});
