import 'dotenv/config';
import { getYesterdayWmsDate } from './dates.js';

const parseBatchCycleMinutes = () => {
  const minutesRaw = process.env.BATCH_CYCLE_MINUTES;
  const parsedMinutes = Number.parseInt(minutesRaw || '', 10);
  if (Number.isFinite(parsedMinutes) && parsedMinutes > 0) return parsedMinutes;

  const hoursRaw = process.env.BATCH_CYCLE_HOURS;
  const parsedHours = Number.parseInt(hoursRaw || '', 10);
  if (Number.isFinite(parsedHours) && parsedHours > 0) return parsedHours * 60;

  return 5;
};

export const config = {
  wmsDb: {
    server: process.env.WMS_DB_SERVER || 'FCL-WMS',
    database: process.env.WMS_DB_NAME || 'calibra',
    user: process.env.WMS_DB_USER,
    password: process.env.WMS_DB_PASSWORD,
    port: parseInt(process.env.WMS_DB_PORT || '1433'),
    requestTimeout: parseInt(process.env.WMS_DB_REQUEST_TIMEOUT_MS || '360000'),
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  },
  sync: {
    get startDate() { return getYesterdayWmsDate(); },
    batchCycleMinutes: parseBatchCycleMinutes(),
    defaultLocationCode: process.env.DEFAULT_LOCATION_CODE || '2055',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },
};
