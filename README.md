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
| `SYNC_START_DATE` | Ignored | Processes from 3 October 2026 at 00:00 WMS time onward |
| `BATCH_CYCLE_MINUTES` | 5 | Run interval (minutes). If not set, falls back to `BATCH_CYCLE_HOURS * 60` |
| `DEFAULT_LOCATION_CODE` | 2055 | Default location |
| `LOG_LEVEL` | info | debug/info/warn/error |

## Item Code Mapping

Production order numbers use the original format
`P18_<short recipe>_<YYMMDD>_<output item>_<chopping row ID>`, restricted to its
first 30 characters. P17 uses the same recipe/date segments with the premix output
item and is also restricted to 30 characters. The date segment contains no time
of day, as in the original format. Truncation may cut the output item and removes
all or part of the row ID in longer names, so different orders can have the same number.
The registry is no longer used; existing database records are not renamed.

Prep preserves `created_at` and `updated_at` on existing WMS chopping lines.
It updates changed weights in place and inserts missing outputs rather than
deleting and recreating them. New rows still receive timestamps; duplicate cleanup
continues to keep the oldest row by ID. Sync updates chopping sync markers without
explicitly changing chopping timestamps.

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
