import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const fakeUrl = new URL('./fixtures/edge-tts-ws.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'ws' ? { url: fakeUrl, shortCircuit: true } : next(specifier, context);
} });

for (const name of ['shared audio client']) {
  const clientPath = resolve(root, 'scripts/edge-tts.mjs');
  const { synthesizeOnce } = await import(pathToFileURL(clientPath));
  const options = { voice: 'ja-JP-NanamiNeural', timeoutMs: 40 };
  const reset = (scenario) => { globalThis.ttsSockets = []; globalThis.ttsScenario = scenario; };

  for (const status of [200, 301, 400, 401, 403, 404, 426, 408, 429, 500, 503]) {
    test(`${name}: HTTP ${status} rejects once and exposes retry classification`, async () => {
      reset(status);
      await assert.rejects(synthesizeOnce('音声テストです。', options), (err) => {
        assert.equal(err.message, `WebSocket upgrade refused: HTTP ${status}`);
        assert.equal(err.statusCode, status);
        assert.equal(err.retryable, [408, 429, 500, 503].includes(status));
        return true;
      });
      assert.equal(globalThis.ttsSockets.length, 1);
      assert.equal(globalThis.ttsSockets[0].terminated, true);
      assert.deepEqual(globalThis.ttsSockets[0].sent, []);
    });
  }

  test(`${name}: success preserves audio, timing, XML escaping, and cleanup`, async () => {
    reset('success');
    const result = await synthesizeOnce('A & B < C\u0000', options);
    assert.equal(result.audio.toString(), 'fixture-audio');
    assert.deepEqual(result.words, [{ offset: 1, duration: 0.5, text: 'A & B' }]);
    const socket = globalThis.ttsSockets[0];
    assert.equal(socket.terminated, true);
    assert.equal(socket.sent.length, 2);
    assert.match(socket.sent[0], /Path:speech.config/);
    assert.match(socket.sent[1], /A &amp; B &lt; C /);
  });

  for (const [scenario, message] of [
    ['empty', /turn.end without any audio/],
    ['socket-error', /WebSocket error: fixture connection failure/],
    ['close', /connection closed \(code 1006\) before turn.end/],
    ['short-binary', /binary message without header length/],
    ['timeout', /no answer within/],
  ]) {
    test(`${name}: ${scenario} rejects and cleans up`, async () => {
      reset(scenario);
      await assert.rejects(synthesizeOnce('音声テストです。', options), message);
      assert.equal(globalThis.ttsSockets[0].terminated, true);
    });
  }

  test(`${name}: oversized UTF-8 input opens no connection`, async () => {
    reset('success');
    await assert.rejects(synthesizeOnce('声'.repeat(1400), options), /at most 4096/);
    assert.equal(globalThis.ttsSockets.length, 0);
  });

  for (const status of [200, 403]) {
    test(`${name}: audio entrypoint exits 1 after first HTTP ${status}; writes no audio`, () => {
      // Only the audio entrypoint is copied into a temporary directory; no
      // pipeline, rendering, posting module, or actual network is invoked.
      const dir = mkdtempSync(join(tmpdir(), 'sns-tts-regression-'));
      try {
        mkdirSync(join(dir, 'scripts'));
        for (const file of ['edge-tts.mjs', 'generate-audio.mjs']) {
          cpSync(resolve(root, 'scripts', file), join(dir, 'scripts', file));
        }
        const setupPath = join(dir, 'mock-setup.mjs');
        writeFileSync(setupPath,
          `import { registerHooks } from 'node:module';\n` +
          `globalThis.ttsSockets=[];globalThis.ttsScenario=${status};\n` +
          `registerHooks({resolve(s,c,n){return s==='ws'?{url:${JSON.stringify(fakeUrl)},shortCircuit:true}:n(s,c)}});\n` +
          `process.on('exit',()=>console.error('MOCK_CONNECTIONS='+globalThis.ttsSockets.length));\n`);
        const result = spawnSync(process.execPath, ['--import', setupPath, join(dir, 'scripts/generate-audio.mjs')], {
          encoding: 'utf8', timeout: 3000, cwd: dir,
          env: { PATH: process.env.PATH },
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /TTS attempt 1\/4 failed/);
        assert.doesNotMatch(result.stderr, /TTS attempt [234]\/4/);
        assert.match(result.stderr, /MOCK_CONNECTIONS=1/);
        assert.equal(existsSync(join(dir, 'public/audio/opening.mp3')), false);
        assert.equal(existsSync(join(dir, 'output/audio-durations.json')), false);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
}
