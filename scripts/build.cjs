const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');
const result = babel.transformFileSync(path.join(root, 'src/app.js'), {
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

acorn.parse(result.code, { ecmaVersion: 5 });
fs.writeFileSync(path.join(root, 'app/bundle.js'), result.code + '\n');
console.log('Build OK: app/bundle.js validado con gramatica ES5.');