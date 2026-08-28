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

export { resolveGatewayPort };
