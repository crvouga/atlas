// A dependency-free todo app. It syncs every change to the server; when a sync check fails it
// keeps changes on the device and retries after 30 seconds.

const RETRY_AFTER_MS = 30_000;
const POLL_EVERY_MS = 1_000;

const state = {
  screen: 'loading',
  listName: '',
  todos: [],
  sync: 'synced',
  pending: [],
  retryTimer: null,
  pollTimer: null
};

const root = document.getElementById('app');
let outbox = Promise.resolve();

async function api(path, body) {
  const init = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function welcome() {
  return `
    <main class="card center">
      <div class="badge" aria-hidden="true">✓</div>
      <h1>Plan your day</h1>
      <p class="muted">One list, synced to the server, that keeps working offline.</p>
      <button class="primary" data-action="start">Get started</button>
    </main>`;
}

function naming() {
  return `
    <main class="card">
      <h1>Name your list</h1>
      <label for="list-name">List name</label>
      <input id="list-name" autocomplete="off" placeholder="Weekend chores" />
      <button class="primary" data-testid="create-list" data-action="create" disabled>Create list</button>
      <button class="link" data-action="skip">Skip for now</button>
    </main>`;
}

function list() {
  const open = state.todos.filter((t) => !t.done).length;
  const done = state.todos.length - open;
  const sync =
    state.sync === 'synced'
      ? '<p role="status" class="sync ok">All changes synced</p>'
      : '<p role="status" class="sync offline"><strong>Offline</strong> · Changes are kept on this device. Retrying in 30 seconds.</p>';
  const items = state.todos.length
    ? `<ul>${state.todos
        .map(
          (t) => `<li class="todo${t.done ? ' done' : ''}"><span class="check" aria-hidden="true">${t.done ? '✓' : ''}</span><span class="title">${escape(t.title)}</span>${t.pending ? '<span class="pending">not synced</span>' : ''}</li>`
        )
        .join('')}</ul>`
    : '<p class="empty">Nothing to do yet</p>';
  const footer = !state.todos.length
    ? ''
    : open
      ? `<footer><span>${open} left</span><span class="actions">${done ? '<button class="link" data-action="clear">Clear completed</button>' : ''}<button class="secondary" data-action="complete-all">Mark all done</button></span></footer>`
      : '<footer><span>All done!</span><button class="secondary" data-action="clear">Clear completed</button></footer>';
  return `
    <main class="card list">
      <header><h1>${escape(state.listName)}</h1><button class="link" data-action="start-over">Start over</button></header>
      ${sync}
      <form class="add" data-action="add">
        <label for="new-todo" class="hidden-label">New todo</label>
        <input id="new-todo" autocomplete="off" placeholder="What needs doing?" />
        <button class="primary" type="submit">Add</button>
      </form>
      ${items}
      ${footer}
    </main>`;
}

function render() {
  root.innerHTML = state.screen === 'welcome' ? welcome() : state.screen === 'naming' ? naming() : state.screen === 'list' ? list() : '';
}

function stopTimers() {
  clearInterval(state.pollTimer);
  clearTimeout(state.retryTimer);
  state.pollTimer = null;
  state.retryTimer = null;
}

function openList(listName, todos) {
  Object.assign(state, { screen: 'list', listName, todos, sync: 'synced', pending: [] });
  stopTimers();
  state.pollTimer = setInterval(checkSync, POLL_EVERY_MS);
  render();
}

function goOffline() {
  if (state.sync === 'offline') return;
  state.sync = 'offline';
  clearTimeout(state.retryTimer);
  state.retryTimer = setTimeout(retry, RETRY_AFTER_MS);
  render();
}

async function checkSync() {
  if (state.screen !== 'list' || state.sync !== 'synced') return;
  try {
    await api('/api/sync-status');
  } catch {
    goOffline();
  }
}

async function retry() {
  const ops = state.pending;
  try {
    await api('/api/ops', { ops, retry: true });
    state.pending = state.pending.slice(ops.length);
    state.todos = state.todos.map(({ pending: _pending, ...t }) => t);
    state.sync = 'synced';
    render();
  } catch {
    state.retryTimer = setTimeout(retry, RETRY_AFTER_MS);
  }
}

function change(op) {
  if (op.type === 'add') state.todos.push({ title: op.title, done: false, pending: state.sync === 'offline' });
  if (op.type === 'complete-all') state.todos = state.todos.map((t) => ({ ...t, done: true }));
  if (op.type === 'clear-completed') state.todos = state.todos.filter((t) => !t.done);
  render();
  if (state.sync === 'offline') {
    state.pending.push(op);
    return;
  }
  outbox = outbox.then(() =>
    api('/api/ops', { ops: [op] }).catch(() => {
      state.pending.push(op);
      goOffline();
    })
  );
}

const actions = {
  start: () => {
    state.screen = 'naming';
    render();
  },
  create: async () => {
    const name = document.getElementById('list-name').value.trim();
    const created = await api('/api/setup', { name });
    openList(created.listName, created.todos);
  },
  skip: async () => {
    const created = await api('/api/setup', {});
    openList(created.listName, created.todos);
  },
  'complete-all': () => change({ type: 'complete-all' }),
  clear: () => change({ type: 'clear-completed' }),
  'start-over': async () => {
    stopTimers();
    await outbox;
    await api('/api/reset', {});
    Object.assign(state, { screen: 'welcome', listName: '', todos: [], sync: 'synced', pending: [] });
    render();
  }
};

root.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) actions[button.dataset.action]?.();
});

root.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.getElementById('new-todo');
  const title = input.value.trim();
  if (title) change({ type: 'add', title });
});

root.addEventListener('input', (event) => {
  if (event.target.id === 'list-name') document.querySelector('[data-testid="create-list"]').disabled = !event.target.value.trim();
});

const saved = await api('/api/list');
if (saved.listName) openList(saved.listName, saved.todos);
else {
  state.screen = 'welcome';
  render();
}
