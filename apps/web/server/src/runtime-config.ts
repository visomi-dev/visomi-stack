function resolveGatewayPort(environment: NodeJS.ProcessEnv = process.env): number {
  const configuredPort = environment.PORT ?? environment.GATEWAY_PORT;

  if (configuredPort === undefined || configuredPort.trim() === '') {
    return 8080;
  }

  const port = Number(configuredPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid gateway port: '${configuredPort}'.`);
  }

  return port;
}

function resolveTrustProxyHops(environment: NodeJS.ProcessEnv = process.env): number {
  const configuredHops = environment.TRUST_PROXY_HOPS ?? '0';
  const hops = Number(configuredHops);

  if (!Number.isSafeInteger(hops) || hops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a nonnegative integer.');
  }

  return hops;
}

export { resolveGatewayPort, resolveTrustProxyHops };
