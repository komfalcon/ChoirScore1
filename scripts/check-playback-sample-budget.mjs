import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checkBuiltOutput = process.argv.includes('--built');
const sampleRoot = resolve(
  repoRoot,
  checkBuiltOutput
    ? 'apps/web/dist/assets'
    : 'apps/web/src/features/playback/assets'
);
const budgetBytes = 3 * 1024 * 1024;
const audioExtensions = new Set([
  '.aac',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
]);

async function collectAudioFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectAudioFiles(path)));
    } else if (
      entry.isFile() &&
      audioExtensions.has(extname(entry.name).toLowerCase())
    ) {
      files.push(path);
    }
  }
  return files;
}

let files;
try {
  files = (await collectAudioFiles(sampleRoot)).sort();
} catch (error) {
  console.error(`Could not read playback audio assets under ${sampleRoot}.`);
  console.error(error);
  process.exitCode = 1;
}

if (files?.length === 0) {
  console.error(`No playback audio assets found under ${sampleRoot}`);
  process.exitCode = 1;
} else if (files?.length) {
  const details = await Promise.all(
    files.map(async (path) => ({
      path: relative(repoRoot, path),
      bytes: (await stat(path)).size,
    }))
  );
  const totalBytes = details.reduce((sum, file) => sum + file.bytes, 0);
  const artifactLabel = checkBuiltOutput ? 'Built' : 'Source';
  console.log(
    `${artifactLabel} playback sample budget: ${totalBytes.toLocaleString()} / ${budgetBytes.toLocaleString()} bytes (${details.length} audio files).`
  );
  for (const file of details) {
    console.log(`  ${file.bytes.toLocaleString()}  ${file.path}`);
  }
  if (totalBytes > budgetBytes) {
    console.error(`Playback samples exceed the ${budgetBytes}-byte limit.`);
    process.exitCode = 1;
  }
}
