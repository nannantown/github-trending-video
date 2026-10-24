import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'sns-audio-only-test-'));
  mkdirSync(join(dir, 'scripts'));
  for (const name of ['edge-tts.mjs', 'audio-diagnostic-ws.mjs', 'audio-only-diagnostic.mjs']) {
    cpSync(join(root, 'scripts', name), join(dir, 'scripts', name));
  }
  const mockEntry = join(dir, 'fake-ws.mjs');
  cpSync(join(root, 'scripts/fixtures/edge-tts-ws.mjs'), mockEntry);
  const setup = join(dir, 'setup.mjs');
  writeFileSync(setup, `globalThis.ttsSockets=[];globalThis.ttsScenario=${JSON.stringify(scenario)};\n`);
  return {
    dir,
    run(args = []) {
      return spawnSync(process.execPath, ['--import', setup, join(dir, 'scripts/audio-only-diagnostic.mjs'), ...args], {
        cwd: dir, timeout: 2000, encoding: 'utf8',
        env: { PATH: process.env.PATH, AUDIO_WS_ENTRY: mockEntry },
      });
    },
    result() { return JSON.parse(readFileSync(join(dir, 'output/audio-diagnostic/result.json'), 'utf8')); },
    dispose() { rmSync(dir, { recursive: true, force: true }); },
  };
}

for (const status of [200, 403]) {
  test(`diagnostic records HTTP ${status} exactly once and never writes media`, () => {
    const f = fixture(status);
    try {
      const child = f.run();
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1, child.stderr);
      const result = f.result();
      assert.equal(result.outcome, 'failed');
      assert.equal(result.statusCode, status);
      assert.equal(result.connections, 1);
      assert.equal(result.retryCount, 0);
      assert.equal(result.responses[0].statusCode, status);
      assert.equal(existsSync(join(f.dir, 'output/audio-diagnostic/sample.mp3')), false);
    } finally { f.dispose(); }
  });
}

test('diagnostic keeps fake audio pending verification and prevents a second invocation', () => {
  const f = fixture('success');
  try {
    const child = f.run();
    assert.equal(child.status, 0, child.stderr);
    assert.equal(f.result().connections, 1);
    assert.equal(f.result().outcome, 'audio_received_pending_decode');
    assert.equal(f.result().audioBytes, Buffer.byteLength('fixture-audio'));
    const second = f.run();
    assert.equal(second.status, 1);
    assert.match(second.stderr, /EEXIST/);
    assert.equal(f.result().connections, 1);
  } finally { f.dispose(); }
});

test('verification mode rejects an empty audio file without opening a connection', () => {
  const f = fixture('success');
  try {
    assert.equal(f.run().status, 0);
    const out = join(f.dir, 'output/audio-diagnostic');
    writeFileSync(join(out, 'sample.mp3'), '');
    writeFileSync(join(out, 'probe.json'), JSON.stringify({ format: { duration: '0' }, streams: [] }));
    const child = f.run(['--verify']);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Expected nonempty MP3/);
    assert.equal(f.result().outcome, 'audio_received_pending_decode');
  } finally { f.dispose(); }
});
