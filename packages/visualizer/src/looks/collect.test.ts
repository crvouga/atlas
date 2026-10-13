import { describe, expect, it } from 'bun:test';

import type { RunReport } from '@crvouga/atlas/reports/report-types';

import { buildAtlasView, type ImageMedia, type StateView, type TransitionView } from '../data/model';
import { parseManifest } from '../data/parse/manifest';
import { parseSpec } from '../data/parse/spec';
import { eventLooks, reportLooks, stateLooks } from './collect';

function shot(src: string, client: string | null = null, also: ImageMedia['also'] = []): ImageMedia {
  return { state: 'available', full: src, thumb: `${src}?thumb`, client, also };
}

function state(name: string, image: ImageMedia | null, paths: StateView['result'] extends infer R ? R extends { screenshotsByPath: infer P } ? P : never : never = []): StateView {
  return {
    key: name,
    name,
    result: image ? { screenshot: image, screenshotsByPath: paths } : null
  } as StateView;
}

describe('looks', () => {
  it('keeps every client and every path as its own picture', () => {
    const pictures = stateLooks(
      state('Welcome', shot('/welcome.png', 'phone', [{ client: 'desktop', full: '/welcome-desktop.png', thumb: null }]), [
        { path: { id: 'failed', name: 'Payment declined' }, image: shot('/declined.png') }
      ])
    ).pictures;
    expect(pictures.map((picture) => picture.label)).toEqual(['Welcome · phone', 'Welcome · desktop', 'Payment declined']);
    expect(pictures.map((picture) => picture.src)).toEqual(['/welcome.png', '/welcome-desktop.png', '/declined.png']);
  });

  it('reads a transition as a video, the screens on either side, and a timeline', () => {
    const welcome = state('Welcome', shot('/welcome.png'));
    const working = state('Working', shot('/working.png'));
    const view = { states: new Map([['Welcome', welcome], ['Working', working]]) } as unknown as Parameters<typeof eventLooks>[0];
    const transition = {
      id: 'Welcome :: Start',
      source: 'Welcome',
      target: 'Working',
      event: 'Start',
      result: {
        clip: { state: 'available', src: '/start.mp4', poster: '/start.webp', durationMs: 4000, captions: '/start.vtt' },
        timeline: [
          { atMs: 0, kind: 'tap', label: 'Tap start' },
          { atMs: 1200, kind: 'screen', label: 'Working' }
        ]
      }
    } as TransitionView;
    const looks = eventLooks(view, transition);
    expect(looks.films).toEqual([
      {
        id: 'Welcome :: Start',
        label: 'Start',
        src: '/start.mp4',
        poster: '/start.webp',
        captions: '/start.vtt',
        durationMs: 4000,
        chapters: [
          { atMs: 0, label: 'Tap start' },
          { atMs: 1200, label: 'Working' }
        ]
      }
    ]);
    expect(looks.pictures.map((picture) => picture.label)).toEqual(['Before · Welcome', 'After · Working']);
    expect(looks.moments.map((moment) => moment.label)).toEqual(['Tap start', 'Working']);
    expect(looks.moments.map((moment) => [moment.caption, moment.thumb])).toEqual([
      ['Tap', '/welcome.png'],
      ['Screen', '/working.png']
    ]);
  });

  it('treats a video, a still, and a frame timeline from any runner as separate evidence', () => {
    const step = (title: string, at: number, media: 'png' | 'video' | 'html', file: string): RunReport['steps'][number] => ({
      index: at,
      kind: 'when',
      title,
      status: 'passed',
      startedAtMs: at,
      endedAtMs: at + 1,
      durationMs: 1,
      frames: [{ index: 0, capturedAtMs: at, durationMs: 300, snapshots: [{ name: 'screen', media, file }] }],
      steps: []
    });
    const report: RunReport = {
      meta: { testId: 'add', runId: 'latest', title: 'Add', system: 'todo', runtime: 'gherkin', seed: 'add', status: 'passed', actorIds: [], startedAtMs: 0, endedAtMs: 3, durationMs: 3 },
      steps: [step('Open', 0, 'html', 'frames/0.html'), step('Shown', 1, 'png', 'frames/1.png'), step('Film', 2, 'video', 'film.mp4')]
    };
    const looks = reportLooks(report, (file) => `/evidence/${file}`);
    expect(looks.pictures.map((picture) => picture.src)).toEqual(['/evidence/frames/1.png']);
    expect(looks.films.map((film) => film.src)).toEqual(['/evidence/film.mp4']);
    expect(looks.moments.map((moment) => moment.label)).toEqual(['Open', 'Shown', 'Film']);
    expect(looks.moments[1]?.thumb).toBe('/evidence/frames/1.png');
    expect(looks.moments[0]?.thumb).toBeNull();
  });

  it('uses an attached video and screenshots when a runner has no frames', () => {
    const step = (title: string, at: number): RunReport['steps'][number] => ({
      index: at, kind: 'when', title, status: 'passed', startedAtMs: at, endedAtMs: at + 1, durationMs: 1, frames: [], steps: []
    });
    const report: RunReport = {
      meta: { testId: 'add', runId: 'latest', title: 'Add', system: 'todo', runtime: 'gherkin', seed: 'add', status: 'passed', actorIds: [], startedAtMs: 1000, endedAtMs: 4000, durationMs: 3000 },
      steps: [step('Given a list', 1200), step('When they add', 2500)],
      artifacts: [
        { name: 'After adding', media: 'png', file: 'shots/1.png' },
        { name: 'Recording', media: 'video', file: 'recording.webm', poster: 'recording.webp' },
        { name: 'Browser log', media: 'text', file: 'log.txt' }
      ]
    };
    const looks = reportLooks(report, (file) => `/evidence/${file}`);
    expect(looks.moments).toEqual([]);
    expect(looks.pictures.map((picture) => picture.src)).toEqual(['/evidence/shots/1.png']);
    expect(looks.films).toEqual([{
      id: 'recording.webm',
      label: 'Recording',
      src: '/evidence/recording.webm',
      poster: '/evidence/recording.webp',
      captions: null,
      durationMs: null,
      chapters: [
        { atMs: 200, label: 'Given a list' },
        { atMs: 1500, label: 'When they add' }
      ]
    }]);
  });

  it('keeps the other clients a chart run captured of one screen', () => {
    const spec = parseSpec({
      ref: null,
      files: [{ path: 'app.machine.json', text: JSON.stringify({ id: 'app', initial: 'Welcome', states: { Welcome: { on: { Start: 'Working' } }, Working: { type: 'final' } } }) }]
    });
    const run = parseManifest('run-1', 'manifest.json', {
      schemaVersion: 1,
      run: { id: 'run-1', startedAt: '2026-10-13T00:00:00Z', durationMs: 10, mode: 'showcase', specVersion: 'v1', finishedAt: '2026-10-13T00:00:01Z' },
      states: { Welcome: { status: 'passed', screenshot: { png: 'welcome.png', client: 'phone', also: [{ png: 'welcome-desktop.png', client: 'desktop' }] } } },
      transitions: {
        'Welcome :: Start': {
          source: 'Welcome',
          event: 'Start',
          target: 'Working',
          status: 'passed',
          clip: { video: 'start.mp4', poster: 'start.webp', durationMs: 4000 },
          timeline: [{ atMs: 200, kind: 'tap', label: 'Tap start' }]
        }
      }
    });
    const view = buildAtlasView({ spec, specIssues: [], runs: [], run, runIssues: [], resolveMedia: (_id, file) => `/media/${file}` });
    expect(stateLooks(view.states.get('Welcome')!).pictures.map((picture) => [picture.label, picture.src])).toEqual([
      ['Welcome · phone', '/media/welcome.png'],
      ['Welcome · desktop', '/media/welcome-desktop.png']
    ]);
    const start = [...view.transitions.values()].find((transition) => transition.event === 'Start');
    expect(start).toBeDefined();
    const looks = eventLooks(view, start!);
    expect(looks.films[0]?.src).toBe('/media/start.mp4');
    expect(looks.films[0]?.chapters).toEqual([{ atMs: 200, label: 'Tap start' }]);
  });
});
