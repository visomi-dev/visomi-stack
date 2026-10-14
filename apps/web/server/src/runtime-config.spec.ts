import { resolveGatewayPort, resolveTrustProxyHops } from './runtime-config';

describe('resolveGatewayPort', () => {
  it('prefers Railway PORT over the compatibility GATEWAY_PORT', () => {
    expect(resolveGatewayPort({ PORT: '49152', GATEWAY_PORT: '8080' })).toBe(49152);
  });

  it('supports GATEWAY_PORT when PORT is not provided', () => {
    expect(resolveGatewayPort({ GATEWAY_PORT: '8081' })).toBe(8081);
  });

  it('uses the local default when neither variable is set', () => {
    expect(resolveGatewayPort({})).toBe(8080);
  });

  it('rejects invalid ports', () => {
    expect(() => resolveGatewayPort({ PORT: 'not-a-port' })).toThrow('Invalid gateway port');
  });
});

describe('resolveTrustProxyHops', () => {
  it('does not trust forwarded headers without deployment configuration', () => {
    expect(resolveTrustProxyHops({})).toBe(0);
  });

  it('supports a single TLS-terminating ingress proxy', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '1' })).toBe(1);
  });

  it.each(['true', '-1', '1.5', 'Infinity'])('rejects an invalid proxy hop count: %s', (value) => {
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: value })).toThrow('TRUST_PROXY_HOPS');
  });
});
