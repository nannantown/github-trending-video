import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const out = new URL('../output/audio-diagnostic/', import.meta.url);
const resultUrl = new URL('result.json', out);

// Verification mode never imports the client or opens a connection.
if (process.argv.includes('--verify')) {
  const probe = JSON.parse(readFileSync(new URL('probe.json', out), 'utf8'));
  const bytes = statSync(new URL('sample.mp3', out)).size;
  if (!bytes || !(Number(probe.format.duration) > 0) || !probe.streams.some(s => s.codec_name === 'mp3')) {
    throw new Error('Expected nonempty MP3 audio with positive duration');
  }
  const result = JSON.parse(readFileSync(resultUrl, 'utf8'));
  result.outcome = 'success_verified_decodable_audio';
  result.verification = { nonempty: true, fullDecodeExitCode: 0, ...probe };
  writeFileSync(resultUrl, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} else {
  mkdirSync(out, { recursive: true });
  const sampleText = 'これは音声の動作確認です。';
  const base = {
    startedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY ?? 'local-offline-check',
    commit: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    node: process.version,
    endpoint: 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1',
    conditions: 'Existing endpoint, headers, v1 proof, and public client token unchanged',
    sampleText, voice: 'ja-JP-NanamiNeural', rate: '+30%', pitch: '+0Hz', volume: '+0%',
    requestLimit: 1, retryCount: 0, clientTimeoutMs: 12000, processCapSeconds: 15,
  };
  writeFileSync(new URL('attempt.json', out), JSON.stringify(base, null, 2) + '\n', { flag: 'wx' });
  const start = performance.now();
  const { responses, connections: _initialConnections } = await import('./audio-diagnostic-ws.mjs');
  const traceUrl = new URL('./audio-diagnostic-ws.mjs', import.meta.url).href;
  registerHooks({ resolve(specifier, context, next) {
    return specifier === 'ws' ? { url: traceUrl, shortCircuit: true } : next(specifier, context);
  } });
  const { synthesizeOnce } = await import('./edge-tts.mjs');
  let result;
  try {
    const { audio, words } = await synthesizeOnce(sampleText, {
      voice: base.voice, rate: base.rate, pitch: base.pitch, volume: base.volume, timeoutMs: base.clientTimeoutMs,
    });
    if (!audio.length) throw new Error('Empty audio result');
    writeFileSync(new URL('sample.mp3', out), audio, { flag: 'wx' });
    result = {
      ...base, outcome: 'audio_received_pending_decode', elapsedMs: Math.round(performance.now() - start),
      audioBytes: audio.length, wordBoundaries: words.length,
      sha256: createHash('sha256').update(audio).digest('hex'), responses,
    };
  } catch (err) {
    result = {
      ...base, outcome: 'failed', elapsedMs: Math.round(performance.now() - start),
      audioBytes: 0, statusCode: err.statusCode ?? null, retryable: err.retryable ?? null,
      error: String(err.message).replace(/wss?:\/\/\S+/g, '[service URL redacted]'), responses,
    };
    process.exitCode = 1;
  }
  const { connections } = await import('./audio-diagnostic-ws.mjs');
  result.connections = connections;
  writeFileSync(resultUrl, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
