import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

let input = '';

for await (const chunk of process.stdin) {
  input += chunk;
}
const request = JSON.parse(input);
const mode = Buffer.from(request.document, 'base64').toString('utf8');

if (mode === 'overflow') {
  process.stdout.write('x'.repeat(64_001));
} else if (mode === 'stall') {
  setInterval(() => undefined, 1000);
} else {
  let rootWriteDenied = false;

  try {
    await writeFile('/etc/extractor-test', 'must-not-write');
  } catch {
    rootWriteDenied = true;
  }
  await writeFile('/tmp/extractor-test', 'selected-fixture');
  const status = await readFile('/proc/self/status', 'utf8');
  const capabilities = /^CapEff:\s*(\w+)$/m.exec(status)?.[1];

  process.stdout.write(
    JSON.stringify({
      uid: process.getuid(),
      rootWriteDenied,
      tmpWritable: true,
      interfaces: Object.keys(networkInterfaces()),
      capabilities,
      ambientSecret: process.env.EXTRACTOR_AMBIENT_SECRET ?? null,
      document: mode,
    }),
  );
}
