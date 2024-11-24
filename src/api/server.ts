import express from 'express';

import bootstrap from './main';

async function main() {
  const server = await bootstrap(express());

  server.listen(3000, () => {
    console.log('Listening on port 3000');
  });
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
