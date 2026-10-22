const fs = require('node:fs');
const path = require('node:path');
const { generate } = require('./generate.cjs');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const options = { config: path.join(root, 'catalog/config.json'), overrides: path.join(root, 'catalog/overrides.json'), state: path.join(root, '.catalog/state.json'), output: path.join(root, 'catalog-output') };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--audit') options.audit = true;
    else if (flag === '--help') {
      console.log('node tools/catalog/cli.cjs [--audit] [--input carpeta] [--environment home-ar|github-hosted] [--max-checks 10] [--state archivo] [--output carpeta] [--config archivo] [--overrides archivo]');
      return;
    } else if (['--input', '--environment', '--max-checks', '--state', '--output', '--config', '--overrides'].includes(flag) && args[index + 1] && !args[index + 1].startsWith('--')) {
      options[flag.slice(2)] = args[++index];
    } else throw new Error('Opcion invalida: ' + flag);
  }
  const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(options.overrides, 'utf8'));
  if (options.environment) config.environment = options.environment;
  if (options['max-checks']) config.maxChecks = Number(options['max-checks']);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await generate({ config, overrides, input: options.input, output: options.output, stateFile: options.state, audit: options.audit, signal: controller.signal,
      onProgress: completed => { if (completed % 5 === 0) console.log('Streams verificados: ' + completed); }
    });
    if (result.audit) console.log(JSON.stringify({ mode: 'audit-only', channels: result.report.selectedChannels, streams: result.report.candidateStreams, report: path.join(path.dirname(options.state), 'audit.json') }, null, 2));
    else console.log(JSON.stringify({ manifest: path.join(options.output, 'manifest.json'), published: result.report.published, verification: result.report.verificationRun }, null, 2));
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

main().catch(error => { console.error((error.code || 'CATALOG_ERROR') + ': ' + error.message); process.exitCode = 1; });