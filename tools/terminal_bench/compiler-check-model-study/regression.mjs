import assert from 'node:assert/strict';
import test from 'node:test';
import axios from '../index.js';
const adapter = async config => ({ data: config.data ?? 'ok', status: 200, statusText: 'OK', headers: {}, config });
test('request interceptors remain reverse ordered; response interceptors remain forward ordered', async () => {
  const client = axios.create(), order = [];
  for (const label of ['a', 'b']) {
    client.interceptors.request.use(config => { order.push(`q${label}`); return config; });
    client.interceptors.response.use(response => { order.push(`r${label}`); return response; });
  }
  await client.get('/local', { adapter }); assert.deepEqual(order, ['qb', 'qa', 'ra', 'rb']);
});
test('ejected interceptors stay skipped', async () => {
  const client = axios.create(); let called = 0;
  const id = client.interceptors.request.use(config => { called++; return config; });
  client.interceptors.request.eject(id); await client.get('/local', { adapter }); assert.equal(called, 0);
});
test('header normalization and URI generation preserve public behavior', () => {
  const headers = axios.AxiosHeaders.from({ 'content-type': 'application/json' });
  headers.set('CONTENT-TYPE', 'text/plain'); assert.equal(headers.get('Content-Type'), 'text/plain');
  assert.equal(axios.getUri({ url: '/local', params: { a: ['x', 'y'] } }), '/local?a%5B%5D=x&a%5B%5D=y');
});
test('configuration merge leaves inputs unchanged', () => {
  const first = { headers: { test: 'one' } }, second = { headers: { other: 'two' } };
  const merged = axios.mergeConfig(first, second); assert.equal(merged.headers.test, 'one');
  assert.deepEqual(first, { headers: { test: 'one' } }); assert.deepEqual(second, { headers: { other: 'two' } });
});
test('pre-cancellation prevents adapter invocation', async () => {
  const cancel = axios.CancelToken.source(); cancel.cancel('stop'); let called = false;
  await assert.rejects(axios.get('/local', { cancelToken: cancel.token, adapter: async config => { called = true; return adapter(config); } }), error => axios.isCancel(error));
  assert.equal(called, false);
});
test('default request transformation preserves JSON encoding', async () => {
  const response = await axios.post('/local', { field: 2 }, { adapter });
  assert.deepEqual(response.data, { field: 2 });
  assert.equal(response.config.headers.get('Content-Type'), 'application/json');
});
