import { createServer } from './server';

const host = process.env['HOST'] ?? 'localhost';

const port = process.env['PORT'] ? Number(process.env['PORT']) : 4300;

createServer().then((app) => {
  app.listen(port, host, () => {
    console.log(`[ ui-designer ] http://${host}:${port}`);
  });
});
