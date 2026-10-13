import { useSyncExternalStore } from 'react';

let open = false;
let help = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeFinder(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isFinderOpen() {
  return open;
}

export function isHelpOpen() {
  return help;
}

/** Recording keys stay put while either layer is up. */
export function finderBlocksKeys() {
  return open || help;
}

export function setFinderOpen(value: boolean) {
  open = value;
  if (value) help = false;
  emit();
}

export function toggleFinder() {
  setFinderOpen(!open);
}

export function setHelpOpen(value: boolean) {
  help = value;
  if (value) open = false;
  emit();
}

export function useFinderOpen() {
  return useSyncExternalStore(subscribeFinder, isFinderOpen, () => false);
}

export function useHelpOpen() {
  return useSyncExternalStore(subscribeFinder, isHelpOpen, () => false);
}
