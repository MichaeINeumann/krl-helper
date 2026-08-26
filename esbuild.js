const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function problemMatcherPlugin(label) {
  return {
    name: `esbuild-problem-matcher-${label}`,
    setup(build) {
      build.onStart(() => console.log(`[${label}] build started`));
      build.onEnd(result => {
        for (const error of result.errors) {
          const location = error.location;
          console.error(`✘ [ERROR] ${error.text}`);
          if (location) {
            console.error(`    ${location.file}:${location.line}:${location.column}`);
          }
        }
        console.log(`[${label}] build finished`);
      });
    }
  };
}

async function createBuildContext(entryPoint, outputFile, label) {
  return esbuild.context({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: outputFile,
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [problemMatcherPlugin(label)]
  });
}

async function main() {
  const contexts = await Promise.all([
    createBuildContext('src/extension.ts', 'dist/extension.js', 'extension')
  ]);

  if (watch) {
    await Promise.all(contexts.map(context => context.watch()));
    return;
  }

  await Promise.all(contexts.map(context => context.rebuild()));
  await Promise.all(contexts.map(context => context.dispose()));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
