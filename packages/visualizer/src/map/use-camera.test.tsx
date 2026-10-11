// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamera, type CameraController } from './use-camera';

const flow = vi.hoisted(() => ({ getViewport: vi.fn(), setViewport: vi.fn() }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => flow }));
let root: Root;
let container: HTMLDivElement;
let camera: CameraController;
let current = { x: 0, y: 0, zoom: 1 };
let now = 0;
let frameId = 0;
let frames: Map<number, FrameRequestCallback>;
let reduced = false;
let preferenceListeners: Set<() => void>;
const settled = vi.fn();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  frames = new Map();
  preferenceListeners = new Set();
  now = 0;
  frameId = 0;
  reduced = false;
  current = { x: 0, y: 0, zoom: 1 };
  settled.mockClear();
  flow.getViewport.mockImplementation(() => current);
  flow.setViewport.mockReset().mockImplementation((viewport) => {
    current = viewport;
    return Promise.resolve(true);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, listener: () => void) => preferenceListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => preferenceListeners.delete(listener)
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    camera = useCamera(settled);
    return null;
  }
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function tick(time: number) {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(now)));
}
async function preference(value: boolean) {
  reduced = value;
  await act(async () => preferenceListeners.forEach((listener) => listener()));
}

it('interpolates smoothly and persists only the final viewport', async () => {
  camera.moveTo({ x: 100, y: 200, zoom: 2 });
  expect(flow.setViewport).not.toHaveBeenCalled();
  await tick(225);
  expect(current).toEqual({ x: 50, y: 100, zoom: 1.5 });
  expect(settled).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  await tick(450);
  expect(current).toEqual({ x: 100, y: 200, zoom: 2 });
  expect(settled).toHaveBeenCalledExactlyOnceWith(current);
  expect(frames.size).toBe(0);
});
it('cancels old navigation and begins the next slide from the current position', async () => {
  camera.moveTo({ x: 100, y: 0, zoom: 1 });
  await tick(225);
  camera.moveTo({ x: -100, y: 0, zoom: 1 });
  expect(frames.size).toBe(1);
  await tick(450);
  expect(current.x).toBe(-25);
  await tick(675);
  expect(current.x).toBe(-100);
  expect(settled).toHaveBeenCalledTimes(1);
});
it('stops immediately for a user gesture without snapping to the old destination', async () => {
  camera.moveTo({ x: 100, y: 0, zoom: 1 });
  await tick(100);
  const interrupted = current;
  camera.cancel();
  await tick(600);
  expect(current).toEqual(interrupted);
  expect(frames.size).toBe(0);
  expect(settled).not.toHaveBeenCalled();
});
it('responds to live reduced-motion changes and never schedules a reduced-motion slide', async () => {
  camera.moveTo({ x: 100, y: 0, zoom: 1 });
  await tick(100);
  await preference(true);
  expect(current.x).toBe(100);
  expect(frames.size).toBe(0);
  await act(async () => camera.moveTo({ x: 200, y: 0, zoom: 1 }));
  expect(current.x).toBe(200);
  expect(frames.size).toBe(0);
  await preference(false);
  camera.moveTo({ x: 300, y: 0, zoom: 1 });
  expect(frames.size).toBe(1);
});
it('positions initially without animation and cancels pending frames on unmount', async () => {
  await act(async () => camera.moveTo({ x: 100, y: 0, zoom: 1 }, false));
  expect(current.x).toBe(100);
  expect(frames.size).toBe(0);
  camera.moveTo({ x: 200, y: 0, zoom: 1 });
  expect(frames.size).toBe(1);
  await act(async () => root.render(null));
  expect(frames.size).toBe(0);
  expect(preferenceListeners.size).toBe(0);
});
it('finishes when hidden rather than leaving a throttled animation pending', async () => {
  camera.moveTo({ x: 100, y: 0, zoom: 1 });
  await tick(100);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(current.x).toBe(100);
  expect(frames.size).toBe(0);
  await act(async () => camera.moveTo({ x: 200, y: 0, zoom: 1 }));
  expect(current.x).toBe(200);
  expect(frames.size).toBe(0);
});
