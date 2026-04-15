-- ============================================================================
-- WMS Sync Service - Database Setup
-- Run this on the WMS server (calibra database)
-- ============================================================================

USE [calibra]
GO

-- 1. Batch tracking table
IF OBJECT_ID('[dbo].[wms_sync_batch]', 'U') IS NULL
CREATE TABLE [dbo].[wms_sync_batch] (
    batch_id BIGINT IDENTITY(1,1) PRIMARY KEY,
    batch_date DATE NOT NULL,
    batch_hour INT NOT NULL,
    status NVARCHAR(20) DEFAULT 'pending',
    choppings_processed INT DEFAULT 0,
    headers_created INT DEFAULT 0,
    lines_created INT DEFAULT 0,
    started_at DATETIME2 DEFAULT GETDATE(),
    completed_at DATETIME2 NULL,
    error_message NVARCHAR(MAX) NULL
);
GO

-- 2. Production header table
IF OBJECT_ID('[dbo].[wms_production_header]', 'U') IS NULL
CREATE TABLE [dbo].[wms_production_header] (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    production_order_no NVARCHAR(50) NOT NULL UNIQUE,
    item_no NVARCHAR(20) NOT NULL,
    quantity DECIMAL(18,4) NOT NULL,
    uom NVARCHAR(10) DEFAULT 'KG',
    location_code NVARCHAR(20),
    line_no INT DEFAULT 1000,
    routing NVARCHAR(50) DEFAULT 'Chopping',
    order_type NVARCHAR(10) DEFAULT 'P18',
    production_date DATE,
    status INT DEFAULT 0,
    synced_to_bc_at DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    created_by NVARCHAR(50) DEFAULT 'wms_sync'
);
GO

-- 3. Production line table
IF OBJECT_ID('[dbo].[wms_production_line]', 'U') IS NULL
CREATE TABLE [dbo].[wms_production_line] (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    production_order_no NVARCHAR(50) NOT NULL,
    line_no INT NOT NULL,
    item_no NVARCHAR(20) NOT NULL,
    quantity DECIMAL(18,4) NOT NULL,
    uom NVARCHAR(10) DEFAULT 'KG',
    location_code NVARCHAR(20),
    bin_code NVARCHAR(20) DEFAULT '',
    entry_type INT NOT NULL,  -- 0 = output, 1 = input
    order_type NVARCHAR(10) DEFAULT 'P18',
    production_date DATE,
    status INT DEFAULT 0,
    synced_to_bc_at DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    created_by NVARCHAR(50) DEFAULT 'wms_sync'
);
GO

-- 4. Add sync_id to choppings if missing
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('[dbo].[choppings]') AND name = 'sync_id')
    ALTER TABLE [dbo].[choppings] ADD sync_id BIGINT NULL;
GO

-- 5. Item code mapping table
IF OBJECT_ID('[dbo].[wms_item_code_mapping]', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[wms_item_code_mapping] (
        id INT IDENTITY(1,1) PRIMARY KEY,
        source_item_code NVARCHAR(20) NOT NULL UNIQUE,
        target_item_code NVARCHAR(20) NOT NULL,
        is_active BIT DEFAULT 1,
        created_at DATETIME2 DEFAULT GETDATE()
    );
    INSERT INTO [dbo].[wms_item_code_mapping] (source_item_code, target_item_code) VALUES ('G2011', 'G2009');
END
GO

-- 6. Mark old records as synced
PRINT 'To mark old records as synced, run:';
PRINT 'UPDATE [dbo].[choppings] SET sync_id = -1 WHERE sync_id IS NULL AND created_at < ''2026-04-14'';';
GO
