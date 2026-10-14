import { mkdir, rm } from 'node:fs/promises';

export { directoryStore } from '@crvouga/atlas/reports/directory-store';

export async function emptyDirectory(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
}
