import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exams, loadExam } from './content';

async function bundledClient(): Promise<string> {
  const result = await build({
    entryPoints: ['src/client/app.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
  });
  return result.outputFiles[0].text;
}
const appJs = await bundledClient();
const appCss = await readFile('src/client/app.css', 'utf8');
const html = await readFile('src/client/index.html', 'utf8');
const sources = await readFile('docs/SOURCES.md', 'utf8');
for (const exam of exams) {
  const { config, syllabus, questions } = await loadExam(exam);
  const manifest = JSON.stringify({
    name: config.appTitle,
    short_name: config.shortName,
    start_url: '/',
    display: 'standalone',
    theme_color: config.themeColor,
    background_color: '#ffffff',
  });
  const result = await build({
    entryPoints: ['src/worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    minify: true,
    define: {
      __EXAM__: JSON.stringify(exam),
      __HTML__: JSON.stringify(
        html.replaceAll('__TITLE__', config.appTitle).replace('__THEME__', config.themeColor),
      ),
      __APP_JS__: JSON.stringify(appJs),
      __APP_CSS__: JSON.stringify(appCss.replace('#1e6fd9', config.themeColor)),
      __MANIFEST__: JSON.stringify(manifest),
      __SOURCES__: JSON.stringify(sources),
      __CONTENT__: JSON.stringify({
        exam: config,
        syllabus,
        questions: questions.filter((q) => q.status === 'verified'),
      }),
    },
  });
  const code = result.outputFiles[0].contents;
  if (code.byteLength >= 1_000_000) throw new Error(`${exam}: Worker が 1 MB を超えました`);
  const dir = join('dist', exam);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'worker.js'), code);
  console.log(
    `${exam}: worker.js ${code.byteLength} bytes (app.js ${new TextEncoder().encode(appJs).byteLength}, app.css ${new TextEncoder().encode(appCss).byteLength}, 検証済み問題 ${questions.filter((q) => q.status === 'verified').length}問)`,
  );
}
