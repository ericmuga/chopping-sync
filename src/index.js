/**
 * WMS to Business Central Sync Service
 * Entry Point
 */

import { config } from './config.js';
import { logger } from './logger.js';
import { closeConnections } from './db.js';
import { runSync } from './sync.js';

const startScheduler = () => {
  const intervalMs = config.sync.batchCycleHours * 60 * 60 * 1000;
  
  logger.info(`Starting scheduler (every ${config.sync.batchCycleHours} hour(s))`);
  
  // Run immediately
  runSync();
  
  // Then run on interval
  setInterval(runSync, intervalMs);
};

const main = async () => {
  logger.info('WMS Sync Service starting...');
  logger.info(`Config: startDate=${config.sync.startDate}, interval=${config.sync.batchCycleHours}h`);
  
  const args = process.argv.slice(2);
  
  if (args.includes('--run-once')) {
    const result = await runSync();
    await closeConnections();
    process.exit(result.success ? 0 : 1);
  } else {
    startScheduler();
    
    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await closeConnections();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
};

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
