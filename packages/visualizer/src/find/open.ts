import { createSpotlight } from '@mantine/spotlight';
import { useSyncExternalStore } from 'react';

/** The application's finder and Mantine Spotlight share one store, including under React StrictMode. */
export const [finderStore, finderControls] = createSpotlight();
let help = false;
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
export function subscribeFinder(listener: () => void) {
  listeners.add(listener);
  const stop = finderStore.subscribe(listener);
  return () => {
    listeners.delete(listener);
    stop();
  };
}
export function isFinderOpen() {
  return finderStore.getState().opened;
}
export function isHelpOpen() {
  return help;
}
/** Playback shortcuts are suspended whenever a finder or help overlay is open. */
export function finderBlocksKeys() {
  return isFinderOpen() || help;
}
export function setFinderOpen(value: boolean) {
  if (value) {
    help = false;
    finderControls.open();
  } else finderControls.close();
  emit();
}
export function toggleFinder() {
  setFinderOpen(!isFinderOpen());
}
export function setHelpOpen(value: boolean) {
  help = value;
  if (value) finderControls.close();
  emit();
}
export function useFinderOpen() {
  return useSyncExternalStore(subscribeFinder, isFinderOpen, () => false);
}
export function useHelpOpen() {
  return useSyncExternalStore(subscribeFinder, isHelpOpen, () => false);
}
export function commandKey() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K';
}
