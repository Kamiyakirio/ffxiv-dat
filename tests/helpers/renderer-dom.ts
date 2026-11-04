import { JSDOM } from 'jsdom';

// React DOM detects browser event support when it is first imported.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
dom.window.scrollTo = () => {};
dom.window.requestAnimationFrame = (callback) =>
  dom.window.setTimeout(() => callback(Date.now()), 0);
Object.defineProperty(dom.window.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async () => {} },
});
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, writable: true },
});
