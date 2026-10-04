import { sql } from './db.js';

// Kept separately from staging tables so reset/rebuild never changes an identity.
export const ensureOrderNumberRegistry = async (pool) => {
  await pool.request().query(`
    IF OBJECT_ID('dbo.wms_order_number_registry', 'U') IS NULL
      CREATE TABLE dbo.wms_order_number_registry (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        source_key NVARCHAR(450) NOT NULL UNIQUE
      );
  `);
};

export const formatRegisteredOrderNo = (type, id) => {
  if (!['P18', 'P17'].includes(type)) throw new Error('Invalid production order type');
  const value = BigInt(id);
  if (value <= 0n || value > 9223372036854775807n) throw new Error('Invalid order registry ID');
  // Full SQL BIGINT range fits in 13 base-36 digits: at most 16 characters total.
  return type + value.toString(36).toUpperCase();
};

export const getProductionOrderNo = async (pool, type, identity) => {
  const key = JSON.stringify([type, ...identity]);
  if (key.length > 450) throw new Error('Production order identity exceeds registry capacity');
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('sourceKey', sql.NVarChar(450), key)
      .query(`
        DECLARE @id BIGINT;
        SELECT @id = id FROM dbo.wms_order_number_registry WITH (UPDLOCK, HOLDLOCK)
        WHERE source_key = @sourceKey;
        IF @id IS NULL
        BEGIN
          INSERT INTO dbo.wms_order_number_registry (source_key) VALUES (@sourceKey);
          SET @id = SCOPE_IDENTITY();
        END;
        SELECT CONVERT(VARCHAR(20), @id) AS registry_id;
      `);
    await transaction.commit();
    return formatRegisteredOrderNo(type, result.recordset[0].registry_id);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
