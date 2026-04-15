-- ===========================================
-- PURGE DATA FROM 2026-04-14 TO NOW
-- Run this to reset and start fresh
-- ===========================================
USE [calibra]
GO -- 1. Clear production lines
DELETE FROM [dbo].[wms_production_line]
WHERE production_date >= '2026-04-14';
PRINT 'Deleted production lines: ' + CAST(@@ROWCOUNT AS VARCHAR);
-- 2. Clear production headers
DELETE FROM [dbo].[wms_production_header]
WHERE production_date >= '2026-04-14';
PRINT 'Deleted production headers: ' + CAST(@@ROWCOUNT AS VARCHAR);
-- 3. Clear staging (must be before sync_batch due to FK)
DELETE FROM [dbo].[wms_choppings_staging]
WHERE batch_id IN (
        SELECT batch_id
        FROM [dbo].[wms_sync_batch]
        WHERE batch_date >= '2026-04-14'
    );
PRINT 'Deleted staging records: ' + CAST(@@ROWCOUNT AS VARCHAR);
-- 4. Clear sync batches
DELETE FROM [dbo].[wms_sync_batch]
WHERE batch_date >= '2026-04-14';
PRINT 'Deleted sync batches: ' + CAST(@@ROWCOUNT AS VARCHAR);
-- 5. Reset sync_id on choppings (so they can be reprocessed)
UPDATE [dbo].[choppings]
SET sync_id = NULL
WHERE CAST(created_at AS DATE) >= '2026-04-14'
    AND sync_id IS NOT NULL;
PRINT 'Reset choppings sync_id: ' + CAST(@@ROWCOUNT AS VARCHAR);
PRINT '';
PRINT 'Purge complete. Ready to re-run sync.';
GO