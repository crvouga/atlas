import { Window } from 'happy-dom';
const browser = new Window({ url: 'http://localhost/#/specs' });
Object.assign(globalThis, { window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, DOMParser: browser.DOMParser, HashChangeEvent: browser.HashChangeEvent, Event: browser.Event, KeyboardEvent: browser.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true });
class LocalEventSource {
  addEventListener() {}
  close() {}
  onerror: unknown;
}
Object.assign(globalThis, { EventSource: LocalEventSource });
