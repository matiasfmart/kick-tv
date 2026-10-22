const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const acorn = require('acorn');
const esbuild = require('esbuild');
const sass = require('sass');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const configuration = JSON.parse(fs.readFileSync(path.join(root, 'src/hub/config/services.json'), 'utf8'));
const iconRoot = path.dirname(require.resolve('lucide-static/package.json'));
const icons = {};
const selectedIcons = ['search', 'star', 'star-off', 'settings', 'refresh-cw', 'play', 'pause', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'x', 'check', 'delete', 'house', 'video', 'history', 'user', 'moon', 'sun', 'pencil', 'lock', 'radio', 'log-out'].concat(configuration.filter(entry => entry.enabled && entry.icon).map(entry => entry.icon));
for (const name of new Set(selectedIcons)) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Nombre de icono invalido');
  icons[name] = name === 'kick'
    ? fs.readFileSync(path.join(root, 'src/hub/assets/kick-mark.svg'), 'utf8')
    : fs.readFileSync(path.join(iconRoot, 'icons', name + '.svg'), 'utf8');
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
  'lucide-static\n' + fs.readFileSync(path.join(iconRoot, 'LICENSE'), 'utf8'),
  'Poppins (SIL Open Font License)\n' + fs.readFileSync(path.join(root, 'node_modules/@fontsource/poppins/LICENSE'), 'utf8')
];
fs.writeFileSync(path.join(root, 'app/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));

const appStyleSource = path.join(root, 'src/styles/app.scss');
const appStyleCss = sass.compile(appStyleSource, { style: 'expanded' }).css;
const appStyleResult = postcss([autoprefixer({ overrideBrowserslist: ['chrome 47'] })])
  .process(appStyleCss, { from: appStyleSource, to: path.join(root, 'app/tv.css') });
const prefixedAppCss = appStyleResult.css;
for (const unsupported of [/\bvar\s*\(/i, /display\s*:\s*grid/i, /\bgap\s*:/i, /aspect-ratio\s*:/i, /backdrop-filter\s*:/i, /:focus-visible/i, /\bclamp\s*\(/i, /\bmin\s*\(/i, /\bmax\s*\(/i]) {
  if (unsupported.test(prefixedAppCss)) throw new Error('CSS de app no compatible con Chrome 47: ' + unsupported);
}
fs.writeFileSync(path.join(root, 'app/tv.css'), prefixedAppCss);

const styleGuideSource = path.join(root, 'src/styles/style-guide.scss');
const styleGuideCss = sass.compile(styleGuideSource, { style: 'expanded' }).css;
const guideResult = postcss([autoprefixer({ overrideBrowserslist: ['chrome 47'] })])
  .process(styleGuideCss, { from: styleGuideSource, to: path.join(root, 'app/style-guide.css') });
const prefixedStyleGuide = guideResult.css;
if (!prefixedStyleGuide || !prefixedStyleGuide.includes('.guide-shell')) throw new Error('No se genero CSS para la style guide.');
for (const unsupported of [/\bvar\s*\(/i, /display\s*:\s*grid/i, /\bgap\s*:/i, /aspect-ratio\s*:/i, /backdrop-filter\s*:/i, /:focus-visible/i, /\bclamp\s*\(/i, /\bmin\s*\(/i, /\bmax\s*\(/i]) {
  if (unsupported.test(prefixedStyleGuide)) throw new Error('CSS no compatible con Chrome 47: ' + unsupported);
}
fs.writeFileSync(path.join(root, 'app/style-guide.css'), prefixedStyleGuide);

const fontSource = path.join(root, 'node_modules/@fontsource/poppins/files');
const fontOutput = path.join(root, 'app/assets');
fs.mkdirSync(fontOutput, { recursive: true });
for (const weight of [400, 500, 600, 800]) {
  fs.copyFileSync(path.join(fontSource, 'poppins-latin-' + weight + '-normal.woff2'), path.join(fontOutput, 'poppins-' + weight + '.woff2'));
}

const styleGuideHtml = fs.readFileSync(path.join(root, 'src/styles/style-guide.html'), 'utf8').replace(/\{\{ICON:([a-z0-9-]+)\}\}/g, (placeholder, name) => {
  if (!icons[name]) throw new Error('Icono no disponible para style guide: ' + name);
  return icons[name];
});
fs.writeFileSync(path.join(root, 'app/style-guide.html'), styleGuideHtml);
console.log('Style guide OK: app/style-guide.html + CSS con Autoprefixer Chrome 47.');