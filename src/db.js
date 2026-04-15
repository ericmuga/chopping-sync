import sql from 'mssql';
import { config } from './config.js';
import { logger } from './logger.js';

let wmsPool = null;

export const connectWms = async () => {
  if (!wmsPool) {
    wmsPool = await sql.connect(config.wmsDb);
    logger.info('Connected to WMS database', { server: config.wmsDb.server });
  }
  return wmsPool;
};

export const closeConnections = async () => {
  if (wmsPool) {
    await wmsPool.close();
    wmsPool = null;
    logger.info('Database connections closed');
  }
};

export { sql };
