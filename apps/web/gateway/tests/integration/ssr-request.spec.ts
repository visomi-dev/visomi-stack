import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import '@angular/compiler';
import { describe, expect, it } from 'vitest';

// Exercise the app's Node adapter in the Node test runner, outside the browser-only Angular runner.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createSsrRequest } from '../../../app/src/ssr-request';

function incoming(method = 'GET') {
  const request = new IncomingMessage(new Socket());

  request.method = method;
  request.url = '/app/en/auth/sign-in?locale=en';
  request.headers = {
    host: 'app.example.test',
    'x-forwarded-host': 'app.example.test',
    'x-forwarded-proto': 'https',
    cookie: 'synthetic=owner',
    authorization: 'Bearer synthetic',
    accept: 'text/html',
    'accept-language': 'es',
    'content-type': 'text/plain',
    forwarded: 'for=192.0.2.123;host=attacker.invalid;proto=http',
    'x-forwarded-for': '192.0.2.123, 198.51.100.1',
    'x-real-ip': '192.0.2.123',
    'x-client-ip': '192.0.2.123',
    'x-cluster-client-ip': '192.0.2.123',
    'true-client-ip': '192.0.2.123',
    'cf-connecting-ip': '192.0.2.123',
    'cf-connecting-ipv6': '2001:db8::1',
    'cf-pseudo-ipv4': '192.0.2.123',
    'cf-ipcountry': 'XX',
    'fastly-client-ip': '192.0.2.123',
    'fly-client-ip': '192.0.2.123',
  };

  request.rawHeaders = Object.entries(request.headers).flatMap(([name, value]) => [name, String(value)]);

  return request;
}

const proxyHeaders = ['x-forwarded-host', 'x-forwarded-proto'];

describe('Angular request privacy boundary', () => {
  it('copies only render metadata and credentials without changing the Node request', () => {
    const request = incoming();
    const headers = structuredClone(request.headers);
    const rawHeaders = [...request.rawHeaders];
    const socket = request.socket;
    const rendered = createSsrRequest(request, proxyHeaders);

    expect(rendered.url).toBe('https://app.example.test/app/en/auth/sign-in?locale=en');
    expect(Object.fromEntries(rendered.headers)).toEqual({
      host: 'app.example.test',
      'x-forwarded-host': 'app.example.test',
      'x-forwarded-proto': 'https',
      cookie: 'synthetic=owner',
      authorization: 'Bearer synthetic',
      accept: 'text/html',
      'accept-language': 'es',
      'content-type': 'text/plain',
    });
    rendered.headers.set('cookie', 'synthetic=changed');

    expect(request.headers).toEqual(headers);
    expect(request.rawHeaders).toEqual(rawHeaders);
    expect(request.socket).toBe(socket);
    expect(request.url).toBe('/app/en/auth/sign-in?locale=en');
  });

  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])('preserves %s and its body semantics', async (method) => {
    const request = incoming(method);

    request.push(Buffer.from('synthetic-body'));
    request.push(null);
    const rendered = createSsrRequest(request, proxyHeaders);

    expect(rendered.method).toBe(method);
    const body = await rendered.text();

    expect(body).toBe(['GET', 'HEAD'].includes(method) ? '' : 'synthetic-body');
  });

  it('ignores forwarded URL claims without an explicit canonical policy', () => {
    const rendered = createSsrRequest(incoming());

    expect(rendered.url).toBe('http://app.example.test/app/en/auth/sign-in?locale=en');
  });

  it('preserves cancellation from the original request', () => {
    const request = incoming();
    const rendered = createSsrRequest(request, proxyHeaders);

    expect(rendered.signal.aborted).toBe(false);
    request.emit('aborted');
    expect(rendered.signal.aborted).toBe(true);
    request.emit('close');
  });
});
