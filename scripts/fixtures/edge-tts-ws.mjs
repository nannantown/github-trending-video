import { EventEmitter } from 'node:events';

export default class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.terminated = false;
    globalThis.ttsSockets.push(this);
    queueMicrotask(() => {
      if (Number.isInteger(globalThis.ttsScenario)) {
        this.emit('unexpected-response', {}, { statusCode: globalThis.ttsScenario, headers: {} });
      } else if (globalThis.ttsScenario === 'socket-error') {
        this.emit('error', new Error('fixture connection failure'));
      } else if (globalThis.ttsScenario === 'close') {
        this.emit('close', 1006);
      } else if (globalThis.ttsScenario !== 'timeout') {
        this.emit('open');
        if (globalThis.ttsScenario === 'short-binary') {
          this.emit('message', Buffer.from([0]), true);
        } else {
          if (globalThis.ttsScenario === 'success') {
            const headers = Buffer.from('Path:audio\r\nContent-Type:audio/mpeg\r\n');
            const length = Buffer.alloc(2);
            length.writeUInt16BE(headers.length);
            this.emit('message', Buffer.concat([length, headers, Buffer.from('fixture-audio')]), true);
            const metadata = { Metadata: [{ Type: 'WordBoundary', Data: {
              Offset: 10000000, Duration: 5000000, text: { Text: 'A &amp; B' },
            } }] };
            this.emit('message', Buffer.from('Path:audio.metadata\r\n\r\n' + JSON.stringify(metadata)), false);
          }
          this.emit('message', Buffer.from('Path:turn.end\r\n\r\n'), false);
        }
      }
    });
  }
  send(value) { this.sent.push(value); }
  terminate() { this.terminated = true; }
}
