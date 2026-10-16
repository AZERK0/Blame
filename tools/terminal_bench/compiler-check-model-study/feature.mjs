import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import axios from '../index.js';
import FormData from 'form-data';

const task = JSON.parse(readFileSync(new URL('./task.json', import.meta.url), 'utf8')).id;
if (!['clear-count', 'form-length'].includes(task)) throw Error('Unknown study feature');
if (task === 'clear-count') {
  for (const side of ['request', 'response']) {
    test(`${side}: clear counts live handlers, not holes, and resets ids`, () => {
      const manager = axios.create().interceptors[side];
      assert.equal(manager.clear(), 0);
      const a = manager.use(value => value), b = manager.use(value => value), c = manager.use(value => value);
      manager.eject(b); manager.eject(b); manager.eject(999);
      assert.equal(manager.clear(), 2); assert.equal(manager.clear(), 0);
      assert.equal(manager.use(value => value), 0);
      assert.equal(manager.clear(), 1); assert.equal(a, 0); assert.equal(c, 2);
    });
    test(`${side}: ejected-only storage clears to zero`, () => {
      const manager = axios.create().interceptors[side];
      manager.eject(manager.use(value => value)); assert.equal(manager.clear(), 0);
    });
  }
  test('clearing one instance preserves another instance and subsequent request order', async () => {
    const client = axios.create(), other = axios.create(), seen = [];
    other.interceptors.request.use(config => { seen.push('other'); return config; });
    client.interceptors.request.use(config => { seen.push('removed'); return config; });
    assert.equal(client.interceptors.request.clear(), 1);
    client.interceptors.request.use(config => { seen.push('first'); return config; });
    client.interceptors.request.use(config => { seen.push('second'); return config; });
    const adapter = async config => ({ data: 'ok', status: 200, statusText: 'OK', headers: {}, config });
    await client.get('/local', { adapter }); await other.get('/local', { adapter });
    assert.deepEqual(seen, ['second', 'first', 'other']);
  });
} else {
  function setup(error, length, config = {}) {
    const form = new FormData(); form.append('field', 'payload');
    const state = { lengthCalls: 0, transportCalls: 0, options: null };
    form.getLength = callback => { state.lengthCalls++; setImmediate(() => callback(error, length)); };
    const transport = { request(options, callback) {
      state.transportCalls++; state.options = options;
      const request = new Writable({ autoDestroy: false, write(_chunk, _encoding, done) { done(); } });
      request.on('finish', () => {
        const response = Readable.from(['ok']); response.statusCode = 200; response.statusMessage = 'OK';
        response.headers = {}; response.req = request; callback(response);
      });
      return request;
    } };
    return { state, form, transport, run: () => axios.post('http://example.invalid/upload', form,
      { proxy: false, transport, requireFormDataLength: true, ...config }) };
  }
  for (const length of [0, 7, 1024]) test(`strict form-data length ${length} is discovered before transport`, async () => {
    const input = setup(null, length); const result = await input.run();
    assert.equal(result.status, 200); assert.equal(input.state.lengthCalls, 1); assert.equal(input.state.transportCalls, 1);
    assert.equal(String(input.state.options.headers['Content-Length']), String(length));
  });
  test('strict form-data checks length even with caller header and preserves that header', async () => {
    const input = setup(null, 7, { headers: { 'Content-Length': '99' }, maxBodyLength: 123 });
    await input.run(); assert.equal(input.state.lengthCalls, 1);
    assert.equal(String(input.state.options.headers['Content-Length']), '99');
    assert.equal(input.state.options.maxBodyLength, 123);
  });
  for (const length of [-1, NaN, Infinity, undefined, '8']) test(`invalid discovered length ${String(length)} rejects without transport`, async () => {
    const input = setup(null, length);
    await assert.rejects(input.run(), error => axios.isAxiosError(error));
    assert.equal(input.state.lengthCalls, 1); assert.equal(input.state.transportCalls, 0);
  });
  test('callback failure rejects through Axios without sending, including an explicit length header', async () => {
    for (const headers of [{}, { 'Content-Length': 8 }]) {
      const input = setup(Error('length unavailable'), null, { headers });
      await assert.rejects(input.run(), error => axios.isAxiosError(error));
      assert.equal(input.state.transportCalls, 0);
    }
  });
  test('default and false preserve best-effort length failure behavior', async () => {
    for (const requireFormDataLength of [undefined, false]) {
      const input = setup(Error('unknown stream length'), null, { requireFormDataLength });
      assert.equal((await input.run()).status, 200); assert.equal(input.state.transportCalls, 1);
    }
  });
  test('native spec FormData is unaffected by the legacy-only option', async () => {
    const input = setup(null, 0), native = new globalThis.FormData(); native.append('field', 'payload');
    const result = await axios.post('http://example.invalid/upload', native,
      { proxy: false, transport: input.transport, requireFormDataLength: true });
    assert.equal(result.status, 200); assert.equal(input.state.lengthCalls, 0); assert.equal(input.state.transportCalls, 1);
  });
  test('cancellation while awaiting length rejects and does not send', async () => {
    const input = setup(null, 7), controller = new AbortController();
    input.form.getLength = callback => setTimeout(() => callback(null, 7), 35);
    const pending = axios.post('http://example.invalid/upload', input.form,
      { proxy: false, transport: input.transport, requireFormDataLength: true, signal: controller.signal });
    controller.abort(); await assert.rejects(pending, error => axios.isCancel(error));
    await new Promise(resolve => setTimeout(resolve, 45));
    assert.equal(input.state.transportCalls, 0);
  });
}
