const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const acorn = require('acorn');
const esbuild = require('esbuild');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const configuration = JSON.parse(fs.readFileSync(path.join(root, 'src/hub/config/services.json'), 'utf8'));
const iconRoot = path.dirname(require.resolve('lucide-static/package.json'));
const icons = {};
const selectedIcons = ['search', 'star', 'star-off', 'settings', 'refresh-cw', 'play', 'pause', 'arrow-left', 'arrow-up', 'arrow-down', 'x', 'check', 'delete', 'house', 'video', 'history'].concat(configuration.filter(entry => entry.enabled && entry.icon).map(entry => entry.icon));
for (const name of new Set(selectedIcons)) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Nombre de icono invalido');
  icons[name] = fs.readFileSync(path.join(iconRoot, 'icons', name + '.svg'), 'utf8');
}

execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.hub.json')], { stdio: 'inherit' });
const modules = fs.readdirSync(path.join(root, 'src/hub/services')).filter(name => /^[a-z][a-z0-9-]*$/.test(name) && fs.existsSync(path.join(root, 'src/hub/services', name, 'module.ts'))).sort();
const imports = modules.map((name, index) => `import { createModule as factory${index} } from './src/hub/services/${name}/module';`).join('\n');
const factories = modules.map((name, index) => `${JSON.stringify(name)}: factory${index}`).join(',');
const hubCode = esbuild.buildSync({
  stdin: { contents: `import { startHub } from './src/hub/bootstrap/root';\n${imports}\nstartHub(${JSON.stringify(configuration)}, {${factories}});`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'iife', target: 'es2015', platform: 'browser'
}).outputFiles[0].text;

for (const entry of [{ source: 'app.js', output: 'bundle.js' }, { source: 'tv.js', output: 'tv.bundle.js' }]) {
const input = (entry.source === 'tv.js' ? hubCode + '\n' : '') + fs.readFileSync(path.join(root, 'src', entry.source), 'utf8');
const result = babel.transformSync(input, {
  babelrc: false,
  configFile: false,
  sourceType: 'script',
  comments: false,
  shouldPrintComment: value => /@license|@preserve|@copyright/.test(value),
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

const notices = [
  'js-sha256\n' + fs.readFileSync(path.join(root, 'node_modules/js-sha256/LICENSE.txt'), 'utf8'),
  'lucide-static\n' + fs.readFileSync(path.join(iconRoot, 'LICENSE'), 'utf8')
];
fs.writeFileSync(path.join(root, 'app/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));