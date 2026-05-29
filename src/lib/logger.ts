import pino from 'pino';
import { env } from '../config/env';

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: label => ({ level: label }),
  },
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
  redact: {
    paths: [
      'access_token',
      'accessToken',
      'META_ACCESS_TOKEN',
      'TELEGRAM_BOT_TOKEN',
      '*.password',
      '*.token',
      'headers.authorization',
    ],
    censor: '[REDACTED]',
  },
});
