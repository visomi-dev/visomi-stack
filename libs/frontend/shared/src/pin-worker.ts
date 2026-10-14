import { createPinWorkerHandler } from './lib/vault/pin-worker-handler';

const handle = createPinWorkerHandler(crypto, (response) => postMessage(response));

addEventListener('message', (event: MessageEvent<unknown>) => {
  void handle(event.data);
});
