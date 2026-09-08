import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createTextWebFetchExecutor } from '/mnt/dev/web/Blame/packages/agent-runtime/dist/web-fetch.js';

const samples = [
  { name: 'text', type: 'text/plain', body: 'Actual destination content' },
  { name: 'declared binary', type: 'application/zip', body: Buffer.from([0, 1, 2]) },
  { name: 'detected binary', type: 'text/plain', body: Buffer.from([0, 1, 2, 3]) },
];

for (const sample of samples) {
  test(`redirected ${sample.name} reports the actual response URL`, async () => {
    const server = createServer((request, response) => {
      if (request.url === '/source') {
        response.writeHead(302, { location: '/destination' }).end();
        return;
      }
      response.writeHead(200, { 'content-type': sample.type }).end(sample.body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const result = await createTextWebFetchExecutor()(`${origin}/source`, 'inspect', {});
      assert.equal(result.split('\n')[0], `URL: ${origin}/destination`);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
