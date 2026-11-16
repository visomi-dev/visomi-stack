import { proxyConfiguration } from './proxy-configuration';

it.each([undefined, '', '  '])('keeps forwarded headers untrusted when unconfigured (%s)', (value) => {
  expect(proxyConfiguration(value)).toEqual({});
});

it('preserves explicit trusted addresses and CIDRs', () => {
  expect(proxyConfiguration('127.0.0.1, ::1, 192.0.2.0/24')).toEqual({
    trustProxy: ['127.0.0.1', '::1', '192.0.2.0/24'],
  });
});

it('requires an explicit single-hop deployment policy', () => {
  expect(proxyConfiguration(' 1-hop ')).toEqual({ trustProxy: 1 });
  expect(proxyConfiguration('1')).toEqual({ trustProxy: ['1'] });
});
