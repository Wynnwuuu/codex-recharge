import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the production React pointer handlers with inert rendering/effects.
// Native first-click delivery is separately supplied by CompanionWebView.
function companion() {
  const messages = [];
  let root;
  const element = (type, props) => ({type, props});
  const react = {useEffect() {}, useRef: current => ({current}), useState: value => [value, () => {}]};
  const module = {exports: {}};
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }}).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    document: {getElementById: () => ({})},
    window: {codexDesktop: true, webkit: {messageHandlers: {codex: {postMessage: data => messages.push(data)}}}},
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return {jsx: element, jsxs: element};
      if (name === 'react-dom/client') return {createRoot: () => ({render: value => {root = value;}})};
      if (name === '@remotion/player') return {Player: () => null};
      if (name === './Composition') return {RechargeComposition: () => null};
      if (name === './style.css') return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const tree = root.type();
  function find(node) {
    if (node?.props?.className === 'pet') return node;
    for (const child of [node?.props?.children].flat().filter(Boolean)) {
      const result = find(child);
      if (result) return result;
    }
  }
  const handlers = find(tree).props;
  const captured = new Set();
  const target = {
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
    getBoundingClientRect: () => ({left: 0, top: 0, right: 180, bottom: 135}),
  };
  const event = (extra = {}) => ({pointerId: 1, isPrimary: true, button: 0,
    screenX: 300, screenY: 300, clientX: 90, clientY: 65, currentTarget: target, ...extra});
  const opens = () => messages.filter(message => message.action === 'openCodex').length;
  return {handlers, event, messages, opens};
}

test('one primary press/release opens Codex exactly once, including capture loss after release', () => {
  const c = companion();
  c.handlers.onPointerDown(c.event());
  c.handlers.onPointerUp(c.event());
  c.handlers.onLostPointerCapture(c.event());
  c.handlers.onPointerUp(c.event());
  assert.equal(c.opens(), 1);
  assert.deepEqual(c.messages.map(message => message.action), ['drag', 'drag', 'openCodex']);
  assert.equal(c.messages[0].phase, 'start');
  assert.equal(c.messages[1].phase, 'end');
});

test('a drag past the threshold cannot open even after returning to the original point', () => {
  const c = companion();
  c.handlers.onPointerDown(c.event());
  c.handlers.onPointerMove(c.event({screenX: 320}));
  c.handlers.onPointerMove(c.event());
  c.handlers.onPointerUp(c.event());
  assert.equal(c.opens(), 0);
});

test('a drag detected only on release cannot open', () => {
  const c = companion();
  c.handlers.onPointerDown(c.event());
  c.handlers.onPointerUp(c.event({screenX: 310}));
  assert.equal(c.opens(), 0);
});

test('release outside the button and cancellation both prevent opening', () => {
  const outside = companion();
  outside.handlers.onPointerDown(outside.event());
  outside.handlers.onPointerUp(outside.event({clientX: -1}));
  assert.equal(outside.opens(), 0);
  const cancelled = companion();
  cancelled.handlers.onPointerDown(cancelled.event());
  cancelled.handlers.onPointerCancel(cancelled.event());
  cancelled.handlers.onPointerUp(cancelled.event());
  assert.equal(cancelled.opens(), 0);
  assert.equal(cancelled.messages.at(-1).phase, 'end');
});

test('non-primary buttons and unrelated releases cannot open', () => {
  const c = companion();
  c.handlers.onPointerDown(c.event({button: 2}));
  c.handlers.onPointerUp(c.event({button: 2}));
  c.handlers.onPointerDown(c.event({isPrimary: false, pointerId: 2}));
  c.handlers.onPointerUp(c.event({pointerId: 2}));
  assert.equal(c.opens(), 0);
  assert.equal(c.messages.length, 0);
});

test('keyboard activation opens once and ignores key repeat', () => {
  const c = companion();
  let prevented = 0;
  c.handlers.onKeyDown({key: 'Enter', repeat: false, preventDefault: () => prevented++});
  c.handlers.onKeyDown({key: 'Enter', repeat: true, preventDefault: () => prevented++});
  assert.equal(c.opens(), 1);
  assert.equal(prevented, 2);
});
