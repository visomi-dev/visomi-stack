const { appendFileSync } = require('node:fs');
const { join } = require('node:path');

const { SMTPServer } = require('smtp-server');

// Loaded only by the isolated container's test preload. This is never a production transport.
if (process.env.VISOMI_E2E_CONTAINER !== 'true' || !process.env.VISOMI_E2E_TELEMETRY_DIR) {
  throw new Error('isolated_mailbox_required');
}

const server = new SMTPServer({
  logger: false,
  disabledCommands: ['AUTH', 'STARTTLS'],
  onData(stream, session, callback) {
    let raw = '';

    stream.on('data', (chunk) => {
      raw += String(chunk);
    });
    stream.on('end', () => {
      appendFileSync(
        join(process.env.VISOMI_E2E_TELEMETRY_DIR, 'mailbox.jsonl'),
        JSON.stringify({ to: session.envelope.rcptTo[0].address, raw }) + '\n',
      );
      callback();
    });
  },
});

server.listen(2525, '127.0.0.1');
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
