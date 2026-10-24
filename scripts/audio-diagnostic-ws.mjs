import { pathToFileURL } from 'node:url';

// Observe only response metadata. Constructor arguments and outgoing messages
// are passed through unchanged to the already-used ws@8.22.0 implementation.
const { default: WebSocket } = await import(pathToFileURL(process.env.AUDIO_WS_ENTRY).href);
export const responses = [];
export let connections = 0;
const allowedHeaders = ['date', 'server', 'content-type', 'content-length', 'connection', 'upgrade', 'retry-after'];

export default class DiagnosticWebSocket extends WebSocket {
  constructor(...args) {
    super(...args);
    connections++;
    const record = (kind, response) => {
      const headers = {};
      for (const key of allowedHeaders) {
        if (response.headers[key] !== undefined) headers[key] = response.headers[key];
      }
      responses.push({ kind, statusCode: response.statusCode, statusMessage: response.statusMessage, headers });
    };
    this.on('upgrade', (response) => record('upgrade', response));
    this.on('unexpected-response', (_request, response) => record('unexpected-response', response));
  }
}
