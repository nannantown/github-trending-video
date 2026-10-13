/**
 * Minimal Edge TTS (Microsoft Edge "Read aloud") client.
 *
 * Replaces edge-tts-universal@1.4.0, whose host speech.platform.bing.com has
 * answered the synthesis WebSocket with 403 since 2026-10 (US from 10-12/13).
 * Edge 155 synthesizes through api.msedgeservices.com, which accepts the same
 * public token as Ocp-Apim-Subscription-Key plus the legacy Sec-MS-GEC pair.
 * Source: rany2/edge-tts PR #491 / issue #490 (2026-10-12).
 *
 * Unlike the library, every failure (HTTP status on upgrade, socket error,
 * close without audio, no answer within timeoutMs) rejects — the old code
 * awaited an "open" event that never came and the process exited 0 silently.
 */

import WebSocket from "ws";
import { createHash, randomBytes } from "crypto";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const WSS_URL = `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}`;
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

// Sec-MS-GEC: SHA-256 of (Windows file-time ticks rounded down to 5 min + token).
function secMsGec() {
  let ticks = Date.now() / 1000 + 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
  return createHash("sha256")
    .update(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, "ascii")
    .digest("hex")
    .toUpperCase();
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
    const url = `${WSS_URL}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}&ConnectionId=${id()}`;
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
