# WMS to Business Central Sync Service (ES6)

Node.js service that processes chopping data from WMS and creates production orders for Business Central.

## Structure

```
wms-sync-service-es6/
├── src/
│   ├── index.js      # Entry point
│   ├── config.js     # Configuration
│   ├── logger.js     # Winston logger
│   ├── db.js         # Database connection
│   ├── helpers.js    # Utility functions
│   └── sync.js       # Main sync logic
├── database/
│   └── setup.sql     # Database tables
├── scripts/
│   ├── install-service.cjs
│   └── uninstall-service.cjs
├── logs/             # Log files (auto-created)
├── .env              # Configuration
└── package.json
```

## Flow

```
1. Get Unsynced Choppings
   └── WHERE closed_by IS NOT NULL AND sync_id IS NULL

2. Process Each Chopping
   └── One closed chopping becomes one batch and one production transaction

   1230G42-1 ─► batch 101 ─► P18_3G42_G2159_260414_001
   1230G42-2 ─► batch 102 ─► P18_3G42_G2159_260414_002

3. Build Production Orders
   └── P18_3G42_G2159_260414_001

4. Insert Headers & Lines
   └── Header: P18_3G42_G2159_260414_001
       ├── Line 1000: G2159 (OUTPUT)
       ├── Line 2000: G2005 (INPUT)
       └── Line 3000: G8900 (INPUT)

5. Mark Choppings as Synced
```

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure
notepad .env

# 3. Create logs folder
mkdir logs

# 4. Run database setup
sqlcmd -S FCL-WMS -d calibra -i database\setup.sql

# 5. Mark old records as synced
sqlcmd -S FCL-WMS -d calibra -Q "UPDATE choppings SET sync_id = -1 WHERE sync_id IS NULL AND created_at < '2026-04-14'"
```

## Usage

```bash
# Test run (single execution)
npm run run-once

# Run continuously
npm start

# Development mode (auto-reload)
npm run dev

# Install as Windows service
npm run service:install

# Uninstall service
npm run service:uninstall
```

## Configuration (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `WMS_DB_SERVER` | FCL-WMS | SQL Server hostname |
| `WMS_DB_NAME` | calibra | Database name |
| `WMS_DB_USER` | - | SQL username |
| `WMS_DB_PASSWORD` | - | SQL password |
| `SYNC_START_DATE` | 2026-04-14 | Only process from this date |
| `BATCH_CYCLE_MINUTES` | 5 | Run interval (minutes). If not set, falls back to `BATCH_CYCLE_HOURS * 60` |
| `DEFAULT_LOCATION_CODE` | 2055 | Default location |
| `LOG_LEVEL` | info | debug/info/warn/error |

## Item Code Mapping

Edit `src/helpers.js`:

```javascript
let itemCodeMapping = {
  'G2011': 'G2009',
  // Add more mappings
};
```

Or add to `wms_item_code_mapping` table in database.

## Logs

- Console output when running interactively
- `logs/wms-sync-YYYY-MM-DD.log` (daily rotation, 30 days)

## Service Management

```cmd
net start "WMS BC Sync Service"
net stop "WMS BC Sync Service"
```

Or use `services.msc`
