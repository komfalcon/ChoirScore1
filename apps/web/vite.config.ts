import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const playbackSamplesRoot = resolve(webRoot, 'src/features/playback/assets');

function playbackSampleCacheAssets(): Plugin {
  return {
    name: 'playback-sample-cache-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      const wavAssets = Object.values(bundle).filter(
        (output) => output.type === 'asset' && output.fileName.endsWith('.wav')
      );
      const sourceSamples = readdirSync(playbackSamplesRoot)
        .filter((fileName) => /^choir-c\d+\.wav$/i.test(fileName))
        .sort();
      const samples: string[] = [];
      const urls: Record<string, string> = {};

      for (const sourceName of sourceSamples) {
        const sourceStem = sourceName.slice(0, -'.wav'.length);
        const emittedAsset = wavAssets.find((output) =>
          output.fileName.startsWith(`assets/${sourceStem}-`)
        );
        let sampleUrl: string;
        if (emittedAsset) {
          sampleUrl = `/${emittedAsset.fileName}`;
        } else {
          const source = readFileSync(resolve(playbackSamplesRoot, sourceName));
          const fingerprint = createHash('sha256')
            .update(source)
            .digest('hex')
            .slice(0, 12);
          const fileName = `assets/${sourceStem}-${fingerprint}.wav`;
          this.emitFile({ type: 'asset', fileName, source });
          sampleUrl = `/${fileName}`;
        }
        samples.push(sampleUrl);
        urls[sourceStem.replace(/^choir-/, '').toUpperCase()] = sampleUrl;
      }

      if (samples.length === 0) {
        this.error(
          `No source playback sample assets were found under ${playbackSamplesRoot}.`
        );
      }

      this.emitFile({
        type: 'asset',
        fileName: 'playback-samples.json',
        source: `${JSON.stringify({ samples, urls }, null, 2)}\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: readFileSync(
          resolve(webRoot, 'src/features/playback/playback-sample-sw.js'),
          'utf8'
        ),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), playbackSampleCacheAssets()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, '') || '/',
      },
    },
  },
});
