import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { config } from './config.js';

const { combine, timestamp, printf } = winston.format;

const logFormat = printf(({ timestamp, level, message, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
});

export const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.DailyRotateFile({
      filename: path.join(config.logging.dir, 'wms-sync-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
    }),
  ],
});
