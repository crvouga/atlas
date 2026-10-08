import { randomUUID } from 'node:crypto';

import type { CloudEvent } from '@crvouga/atlas';

import { DEFAULT_LIST_NAME, EVENT_TYPES, RETRY_AFTER_MS } from './server';

type Op = { type: 'add'; title: string } | { type: 'complete-all' } | { type: 'clear-completed' };
type BusinessEvent = keyof typeof EVENT_TYPES;

/**
 * The todo app's rules as a plain in-memory model, with no browser and no server. It follows the
 * same statecharts as the web app, so Atlas can run the same spec against it.
 */
export class TodoModel {
  screen: 'welcome' | 'naming' | 'list' = 'welcome';
  nameDraft = '';
  listName = '';
  todos: { title: string; done: boolean }[] = [];
  sync: 'synced' | 'offline' = 'synced';
  private pending: Op[] = [];
  private now = 0;
  private retryAt: number | null = null;

  constructor(private readonly publish: (event: CloudEvent) => void = () => undefined) {}

  private emit(event: BusinessEvent) {
    this.publish({ specversion: '1.0', id: randomUUID(), source: '/examples/todo/model', type: EVENT_TYPES[event] });
  }

  private apply(op: Op) {
    if (op.type === 'add') this.emit('Todo added');
    if (op.type === 'complete-all') this.emit('Todos completed');
    if (op.type === 'clear-completed') this.emit('Completed todos cleared');
  }

  private change(op: Op) {
    if (op.type === 'add') this.todos.push({ title: op.title, done: false });
    if (op.type === 'complete-all') this.todos = this.todos.map((t) => ({ ...t, done: true }));
    if (op.type === 'clear-completed') this.todos = this.todos.filter((t) => !t.done);
    if (this.sync === 'offline') this.pending.push(op);
    else this.apply(op);
  }

  private open(name: string) {
    Object.assign(this, { screen: 'list', listName: name, todos: [], sync: 'synced', pending: [], retryAt: null });
    this.emit('List created');
  }

  get openCount() {
    return this.todos.filter((t) => !t.done).length;
  }

  getStarted() {
    this.screen = 'naming';
    this.nameDraft = '';
  }

  typeListName(name: string) {
    this.nameDraft = name;
  }

  createList() {
    if (!this.nameDraft.trim()) throw new Error('A list needs a name');
    this.open(this.nameDraft.trim());
  }

  skipNaming() {
    this.open(DEFAULT_LIST_NAME);
  }

  addTodo(title: string) {
    this.change({ type: 'add', title });
  }

  markAllDone() {
    this.change({ type: 'complete-all' });
  }

  clearCompleted() {
    this.change({ type: 'clear-completed' });
  }

  startOver() {
    Object.assign(this, { screen: 'welcome', listName: '', todos: [], sync: 'synced', pending: [], retryAt: null });
    this.emit('List discarded');
  }

  /** The server reports that changes did not get through. */
  syncFails() {
    if (this.screen !== 'list' || this.sync === 'offline') return;
    this.sync = 'offline';
    this.retryAt = this.now + RETRY_AFTER_MS;
    this.emit('Sync interrupted');
  }

  /** Let time pass; a due retry sends what waited on the device. */
  advanceClock(ms: number) {
    this.now += ms;
    if (this.retryAt === null || this.now < this.retryAt) return;
    this.retryAt = null;
    for (const op of this.pending) this.apply(op);
    this.pending = [];
    this.sync = 'synced';
    this.emit('Changes synced');
  }
}
