import { createLogger, transports } from 'winston';

const LOG_LEVEL = process.env['LOG_LEVEL'] ?? 'debug';

export const logger = createLogger({
  level: LOG_LEVEL,
  transports: [new transports.Console()],
});
