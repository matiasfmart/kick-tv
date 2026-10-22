const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');
const iconRoot = path.dirname(require.resolve('lucide-static/package.json'));
const icons = {};
for (const name of ['search', 'star', 'star-off', 'settings', 'refresh-cw', 'play', 'pause', 'arrow-left', 'arrow-up', 'arrow-down', 'x', 'check', 'delete']) {
  icons[name] = fs.readFileSync(path.join(iconRoot, 'icons', name + '.svg'), 'utf8');
}

for (const entry of [{ source: 'app.js', output: 'bundle.js' }, { source: 'tv.js', output: 'tv.bundle.js' }]) {
const result = babel.transformFileSync(path.join(root, 'src', entry.source), {
  babelrc: false,
  configFile: false,
  sourceType: 'script',
  comments: false,
  presets: [[require.resolve('@babel/preset-env'), {
    targets: { ie: '11' },
    modules: false,
    useBuiltIns: false
  }]]
});

const code = (entry.source === 'tv.js' ? 'window.KickTVIcons = ' + JSON.stringify(icons) + ';\n' : '') + result.code;
acorn.parse(code, { ecmaVersion: 5 });
fs.writeFileSync(path.join(root, 'app', entry.output), code + '\n');
console.log('Build OK: app/' + entry.output + ' validado con gramatica ES5.');
}