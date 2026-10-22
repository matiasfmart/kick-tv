const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '../src/tv.js'), 'utf8');
const program = acorn.parse(source, { ecmaVersion: 5 });
const spatial = program.body[0].expression.callee.body.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'spatial');
assert.ok(spatial, 'La funcion de foco espacial debe existir');

function navigation(definitions, currentId) {
  const document = {};
  const nodes = definitions.map(definition => {
    const [id, left, top, width, height, disabled = false] = definition;
    return {
      id,
      disabled,
      getBoundingClientRect() { return { left, top, width, height, right: left + width, bottom: top + height }; },
      focus() { document.activeElement = this; },
      scrollIntoView() { this.scrolled = true; }
    };
  });
  document.activeElement = nodes.find(node => node.id === currentId);
  const context = { document, window: { innerHeight: 1080 }, scope() { return { querySelectorAll() { return nodes; } }; } };
  vm.createContext(context);
  vm.runInContext(source.slice(spatial.start, spatial.end), context);
  return {
    move(code) { context.spatial(code); return document.activeElement; },
    focus(id) { document.activeElement = nodes.find(node => node.id === id); }
  };
}

test('campo ancho y lupa se conectan con derecha e izquierda, sin saltar al teclado', () => {
  const nav = navigation([
    ['search-input', 60, 288, 598, 68],
    ['run-search', 674, 288, 68, 68],
    ['key-middle', 360, 384, 62, 62],
    ['key-right', 680, 384, 62, 62]
  ], 'search-input');
  assert.equal(nav.move(39).id, 'run-search');
  assert.equal(nav.move(37).id, 'search-input');
  nav.focus('key-right');
  assert.equal(nav.move(38).id, 'run-search');
});

test('foco vertical prioriza la misma columna e ignora controles ocultos y deshabilitados', () => {
  const nav = navigation([
    ['current', 100, 100, 60, 60],
    ['aligned', 100, 300, 60, 60],
    ['diagonal', 170, 170, 60, 60],
    ['disabled', 100, 180, 60, 60, true],
    ['hidden', 100, 170, 0, 0]
  ], 'current');
  assert.equal(nav.move(40).id, 'aligned');
});

test('sin candidatos alineados mantiene alternativa diagonal y hace scroll', () => {
  const nav = navigation([
    ['current', 100, 900, 60, 60],
    ['diagonal', 180, 1100, 60, 60]
  ], 'current');
  const next = nav.move(40);
  assert.equal(next.id, 'diagonal');
  assert.equal(next.scrolled, true);
});