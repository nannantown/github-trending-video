/**
 * Minimal Edge TTS (Microsoft Edge "Read aloud") client.
 *
 * Follows rany2/edge-tts 7.3.1 (2026-10-13): host speech.platform.bing.com with
 * TrustedClientToken, and the Sec-MS-GEC **v2** token (version prefix "2-").
 * The v1 token (plain SHA-256) started to be refused in 2026-10: first 403 on
 * the bing host (10-12/13), then on 10-24 GitHub Actions got "upgrade refused:
 * HTTP 200" from api.msedgeservices.com with v1 as well.
 * Sources: rany2/edge-tts PR #492 (merged 2026-10-13, commit ba61d94) and
 * src/edge_tts/drm.py generate_sec_ms_gec_v2 / constants.py at v7.3.1.
 *
 * Unlike the old library, every failure (HTTP status on upgrade, socket error,
 * close without audio, no answer within timeoutMs) rejects.
 */

import WebSocket from "ws";
import { randomBytes } from "crypto";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
};
// One SSML message carries at most this many bytes of text (same as edge-tts).
const MAX_TEXT_BYTES = 4096;

// ---- Sec-MS-GEC v2 = "<CS64 16 hex>-<SHA-256 variant 64 hex>" (port of edge-tts drm.py) ----
// The SHA-256 variant starts from a precomputed mid-block state, so it is NOT
// crypto's sha256. All arithmetic is mod 2^32 (>>> 0 / Math.imul).
const SHA_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2];
const SHA_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0,
  0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA_ADJUSTMENT = 0xc9dc06a7;
const K_BLOCK = [...K.slice(0, 14), SHA_ADJUSTMENT, ...K.slice(15)];
const SIGMA0_ADJUSTMENT = 0x059c0b80;
const SIGMA1_ADJUSTMENT = 0x000b92c0;
const CS64_COEFFICIENTS = [
  [0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d], [0x3beb65bc, 0x29514038], [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5], [0x314ef5d5, 0x26e55f3c], [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da], [0xda79fa60, 0x207cc464], [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const u32 = (x) => x >>> 0;
const mul = (a, b) => Math.imul(a, b) >>> 0;
const rotr = (x, n) => u32((x >>> n) | (x << (32 - n)));
const rol16 = (x) => u32((x << 16) | (x >>> 16));
const sigma0 = (x) => u32(rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3));
const sigma1 = (x) => u32(rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10));

function shaRounds(state, w, firstRound = 0) {
  const k = firstRound === 14 ? K_BLOCK : K;
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = firstRound; i < 64; i++) {
    const t1 = u32(h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + (g ^ (e & (f ^ g))) + k[i] + w[i]);
    const t2 = u32((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b))));
    [a, b, c, d, e, f, g, h] = [u32(t1 + t2), a, b, c, u32(d + t1), e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(w, firstWord = 16) {
  for (let i = firstWord; i < 64; i++) w.push(u32(sigma1(w[i - 2]) + w[i - 7] + sigma0(w[i - 15]) + w[i - 16]));
}

function shaInit(data7) {
  const w = [...Array(14).fill(0), data7.readUIntBE(0, 3), data7.readUInt32BE(3)];
  for (let i = 16; i < 30; i++) {
    let v = SHA_SCHEDULE[i - 16];
    if (i - 2 >= 14) v += i === 16 ? u32(sigma1(w[i - 2]) ^ SIGMA1_ADJUSTMENT) : sigma1(w[i - 2]);
    if (i - 7 >= 14) v += w[i - 7];
    if (i - 15 >= 14) v += i === 29 ? u32(sigma0(w[i - 15]) ^ SIGMA0_ADJUSTMENT) : sigma0(w[i - 15]);
    w.push(u32(v));
  }
  w.push(u32(sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + SHA_ADJUSTMENT - K[14]));
  expandSchedule(w, 31);
  const working = shaRounds(SHA_STATE, w, 14);
  return SHA_INITIAL.map((x, i) => u32(x + working[i]));
}

function shaDigest(data) {
  const length = 57 + data.length;
  const pad = (((55 - length) % 64) + 64) % 64;
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64BE(BigInt(length * 8));
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(pad), lenBuf]);
  let state = shaInit(data.subarray(0, 7));
  for (let off = 0; off < padded.length; off += 64) {
    const w = Array.from({ length: 16 }, (_, i) => padded.readUInt32BE(off + i * 4));
    expandSchedule(w);
    const working = shaRounds(state, w);
    state = state.map((x, i) => u32(x + working[i]));
  }
  const out = Buffer.alloc(32);
  state.forEach((x, i) => out.writeUInt32BE(x, i * 4));
  return out;
}

function cs64Digest(data, digest) {
  const keyA = u32(digest.readUInt32LE(0) | 1);
  const keyB = u32(digest.readUInt32LE(4) | 1);
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coef], i) => mul(coef, factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, off]) => off);
  // little-endian 32-bit words of 0x00 + data, zero-padded to an even word count
  const bytes = Buffer.concat([Buffer.from([0]), data]);
  const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
  const words = Array.from({ length: padded.length / 4 }, (_, i) => padded.readUInt32LE(i * 4));
  if (words.length % 2) words.push(0);
  words.forEach((word, i) => {
    let term = mul(word, i % 2 === 0 ? keyA : keyB);
    let offset = mul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term = u32(term + mul(CS64_ADJUSTMENT0, factors[0]));
      offset = u32(offset + CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let q = mul(rol16(u32(offsets[i] + x)), 0x76f50f34);
    swapAcc = u32(swapAcc + u32(mul(rol16(q), 0xc3efea97) + q));
    q = mul(rol16(u32(offsets[i + 1] + y)), 0x1881ce3c);
    swapLast = u32(mul(rol16(q), 0x35bd1ec9) + q);
    swapAcc = u32(swapAcc + swapLast);

    state = u32(mul(state, keyA) + x);
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = u32(acc + state);
    let t = u32(mul(state, keyB) + y);
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = u32(acc + state);
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

// Ticks = Windows file time (100 ns) rounded down to 5 minutes, then hashed with the token.
export function secMsGecV2(unixSeconds = Date.now() / 1000) {
  let ticks = unixSeconds + 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const data = Buffer.from(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, "ascii");
  const digest = shaDigest(data);
  const [lo, hi] = cs64Digest(data, digest);
  const cs = Buffer.alloc(8);
  cs.writeUInt32LE(lo, 0);
  cs.writeUInt32LE(hi, 4);
  return `${cs.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}

const id = () => randomBytes(16).toString("hex");
const xmlEscape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const xmlUnescape = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const timestamp = () => new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");

// "ja-JP-NanamiNeural" -> "Microsoft Server Speech Text to Speech Voice (ja-JP, NanamiNeural)"
function longVoiceName(voice) {
  const m = /^([a-z]{2,}-[A-Z]{2,})-(.+)$/.exec(voice);
  return m ? `Microsoft Server Speech Text to Speech Voice (${m[1]}, ${m[2]})` : voice;
}

function headersOf(buf) {
  const headers = {};
  for (const line of buf.toString("utf-8").split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return headers;
}

/**
 * Synthesize `text` once. Resolves { audio: Buffer, words: [{offset, duration, text}] }
 * (offset/duration in seconds). Rejects on any failure or after timeoutMs.
 */
export function synthesizeOnce(text, { voice, rate = "+0%", pitch = "+0Hz", volume = "+0%", timeoutMs = 30000 }) {
  const escaped = xmlEscape(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " "));
  // ponytail: no splitting — narrations are a few hundred bytes. Split like edge-tts if this ever trips.
  if (Buffer.byteLength(escaped) > MAX_TEXT_BYTES) {
    return Promise.reject(new Error(`text is ${Buffer.byteLength(escaped)} bytes; Edge TTS takes at most ${MAX_TEXT_BYTES} per request`));
  }

  return new Promise((resolve, reject) => {
    const url = `${WSS_URL}&ConnectionId=${id()}&Sec-MS-GEC=${secMsGecV2()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const ws = new WebSocket(url, {
      headers: { ...HEADERS, Cookie: `muid=${id().toUpperCase()};` },
      handshakeTimeout: timeoutMs,
    });
    const audio = [];
    const words = [];
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on("error", () => {}); // late socket errors after we gave up
      ws.terminate();
      if (err) reject(err);
      else resolve({ audio: Buffer.concat(audio), words });
    };
    const timer = setTimeout(
      () => finish(new Error(`no answer within ${timeoutMs / 1000}s (${audio.length} audio chunks so far)`)),
      timeoutMs,
    );

    ws.on("unexpected-response", (_req, res) =>
      finish(new Error(`WebSocket upgrade refused: HTTP ${res.statusCode}`)),
    );
    ws.on("error", (err) => finish(new Error(`WebSocket error: ${err.message}`)));
    ws.on("close", (code) => finish(new Error(`connection closed (code ${code}) before turn.end; ${audio.length} audio chunks`)));

    ws.on("open", () => {
      ws.send(
        `X-Timestamp:${timestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
      );
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${longVoiceName(voice)}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escaped}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${id()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (data.length < 2) return finish(new Error("binary message without header length"));
        const headerLength = data.readUInt16BE(0);
        const headers = headersOf(data.subarray(2, 2 + headerLength));
        const body = data.subarray(2 + headerLength);
        if (headers.Path === "audio" && headers["Content-Type"] === "audio/mpeg" && body.length > 0) audio.push(body);
        return;
      }
      const sep = data.indexOf("\r\n\r\n");
      const headers = headersOf(data.subarray(0, sep));
      if (headers.Path === "audio.metadata") {
        for (const meta of JSON.parse(data.subarray(sep + 4).toString("utf-8")).Metadata) {
          if (meta.Type === "WordBoundary") {
            words.push({
              // 100-nanosecond units -> seconds
              offset: meta.Data.Offset / 10_000_000,
              duration: meta.Data.Duration / 10_000_000,
              text: xmlUnescape(meta.Data.text.Text),
            });
          }
        }
      } else if (headers.Path === "turn.end") {
        finish(audio.length ? null : new Error("turn.end without any audio"));
      }
    });
  });
}
