import 'dotenv/config';

export const config = {
  wmsDb: {
    server: process.env.WMS_DB_SERVER || 'FCL-WMS',
    database: process.env.WMS_DB_NAME || 'calibra',
    user: process.env.WMS_DB_USER,
    password: process.env.WMS_DB_PASSWORD,
    port: parseInt(process.env.WMS_DB_PORT || '1433'),
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  },
  sync: {
    startDate: process.env.SYNC_START_DATE || '2026-04-14',
    batchCycleHours: parseInt(process.env.BATCH_CYCLE_HOURS || '1'),
    defaultLocationCode: process.env.DEFAULT_LOCATION_CODE || '2055',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },
};
