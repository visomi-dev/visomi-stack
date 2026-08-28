import { resolveGatewayPort } from './runtime-config';

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
