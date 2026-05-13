/**
 * WMS to Business Central Sync Service
 *
 * Key features:
 * - Processes each hour separately
 * - Joins chopping_lines using BOTH chopping_id AND created date because chopping_id repeats daily
 * - Only processes closed choppings: closed_by IS NOT NULL
 * - Normal run only processes choppings where sync_id IS NULL
 * - After successful processing, marks processed choppings with sync_id = batch_id
 * - Exports rerunTodaySync() to rebuild today's data, including choppings created yesterday but closed today
 */

import { config } from './config.js';
import { logger } from './logger.js';
import { connectWms, sql } from './db.js';
import { prepChoppingLines } from './prep.js';
import {
  mapItemCode,
  getLocationCode,
  getRecipePrefix,
  buildProductionOrderNo,
  loadItemMappings,
  loadItemLocations,
} from './helpers.js';

const toSqlDateString = (value) => {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
};

/**
 * Reset today's generated sync data.
 * Includes:
 * - normal today choppings: created_at = today
 * - midnight/missed cases: created_at may be yesterday, updated_at = today
 */
const resetTodaySyncData = async (pool) => {
  logger.warn('Resetting today sync data before rerun...');

  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const request = () => new sql.Request(transaction);

    await request().query(`
      DECLARE @today DATE = CAST(GETDATE() AS DATE);

      DELETE l
      FROM [dbo].[wms_production_line] l
      INNER JOIN [dbo].[wms_sync_batch] b
        ON l.batch_id = b.batch_id
      WHERE b.batch_date = @today;
    `);

    await request().query(`
      DECLARE @today DATE = CAST(GETDATE() AS DATE);

      DELETE h
      FROM [dbo].[wms_production_header] h
      INNER JOIN [dbo].[wms_sync_batch] b
        ON h.batch_id = b.batch_id
      WHERE b.batch_date = @today;
    `);

    await request().query(`
      DECLARE @today DATE = CAST(GETDATE() AS DATE);

      DELETE FROM [dbo].[wms_sync_batch]
      WHERE batch_date = @today;
    `);

    const resetResult = await request().query(`
      DECLARE @today DATE = CAST(GETDATE() AS DATE);

      UPDATE [dbo].[choppings]
      SET sync_id = NULL
      WHERE closed_by IS NOT NULL
        AND (
          CAST(created_at AS DATE) = @today
          OR CAST(updated_at AS DATE) = @today
        );
    `);

    await transaction.commit();

    const rowsAffected = resetResult.rowsAffected?.[0] || 0;
    logger.warn(`Reset ${rowsAffected} today choppings for rerun`);

    return rowsAffected;
  } catch (err) {
    await transaction.rollback();
    logger.error(`Failed to reset today sync data: ${err.message}`);
    throw err;
  }
};

/**
 * Get hours that need processing.
 * Normal mode: only sync_id IS NULL.
 */
const getHoursToProcess = async (pool) => {
  logger.info('Getting hours to process...');

  const syncStartDate = config.sync.startDate;

  const result = await pool.request()
    .input('syncStartDate', sql.Date, syncStartDate)
    .query(`
      WITH ChoppingDates AS (
        SELECT
          chopping_id,
          CASE
            WHEN CAST(updated_at AS DATE) > CAST(created_at AS DATE)
            THEN CAST(updated_at AS DATE)
            ELSE CAST(created_at AS DATE)
          END AS production_date,
          CASE
            WHEN CAST(updated_at AS DATE) > CAST(created_at AS DATE)
            THEN 0
            ELSE DATEPART(HOUR, created_at)
          END AS production_hour
        FROM [dbo].[choppings]
        WHERE closed_by IS NOT NULL
          AND sync_id IS NULL
      ),
      Hours AS (
        SELECT DISTINCT production_date, production_hour
        FROM ChoppingDates
        WHERE production_date >= @syncStartDate
      )
      SELECT
        h.production_date,
        h.production_hour,
        (
          SELECT COUNT(*)
          FROM ChoppingDates c
          WHERE c.production_date = h.production_date
            AND c.production_hour = h.production_hour
        ) AS chopping_count
      FROM Hours h
      ORDER BY h.production_date, h.production_hour;
    `);

  logger.info(`Found ${result.recordset.length} hours to process`);
  return result.recordset;
};

/**
 * Get unsynced choppings for a specific production date/hour.
 */
const getChoppingsForHour = async (pool, productionDate, productionHour) => {
  const result = await pool.request()
    .input('productionDate', sql.Date, productionDate)
    .input('productionHour', sql.Int, productionHour)
    .query(`
      SELECT
        chopping_id,
        CAST(created_at AS DATE) AS created_date,
        CAST(updated_at AS DATE) AS closed_date,
        CASE
          WHEN CAST(updated_at AS DATE) > CAST(created_at AS DATE)
          THEN CAST(updated_at AS DATE)
          ELSE CAST(created_at AS DATE)
        END AS production_date,
        CASE
          WHEN CAST(updated_at AS DATE) > CAST(created_at AS DATE)
          THEN 0
          ELSE DATEPART(HOUR, created_at)
        END AS production_hour
      FROM [dbo].[choppings]
      WHERE closed_by IS NOT NULL
        AND sync_id IS NULL
        AND (
          (
            CAST(updated_at AS DATE) = CAST(created_at AS DATE)
            AND CAST(created_at AS DATE) = @productionDate
            AND DATEPART(HOUR, created_at) = @productionHour
          )
          OR
          (
            CAST(updated_at AS DATE) > CAST(created_at AS DATE)
            AND CAST(updated_at AS DATE) = @productionDate
            AND @productionHour = 0
          )
        )
      ORDER BY chopping_id;
    `);

  return result.recordset;
};

/**
 * Get and group chopping lines for specific choppings.
 */
const getGroupedChoppingLines = async (pool, choppings) => {
  if (!choppings.length) return { outputs: [], inputs: [] };

  const values = choppings.map((_, index) => `(@choppingId${index}, @createdDate${index})`).join(', ');

  const request = pool.request();

  choppings.forEach((chopping, index) => {
    request
      .input(`choppingId${index}`, sql.NVarChar, String(chopping.chopping_id))
      .input(`createdDate${index}`, sql.Date, toSqlDateString(chopping.created_date));
  });

  const result = await request.query(`
    SELECT
      cl.chopping_id,
      cl.item_code,
      cl.weight,
      cl.output
    FROM [dbo].[chopping_lines] cl
    INNER JOIN (VALUES ${values}) AS v(chopping_id, created_date)
      ON cl.chopping_id = v.chopping_id
     AND CAST(cl.created_at AS DATE) = v.created_date;
  `);

  logger.debug(`Retrieved ${result.recordset.length} chopping lines`);

  const grouped = new Map();

  for (const line of result.recordset) {
    const recipePrefix = getRecipePrefix(line.chopping_id);
    const mappedItem = mapItemCode(line.item_code);
    const key = `${recipePrefix}|${mappedItem}|${line.output}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        recipePrefix,
        itemCode: mappedItem,
        output: line.output,
        totalWeight: 0,
        lineCount: 0,
      });
    }

    const entry = grouped.get(key);
    entry.totalWeight += parseFloat(line.weight) || 0;
    entry.lineCount += 1;
  }

  const outputs = [];
  const inputs = [];

  for (const data of grouped.values()) {
    if (data.output === true || data.output === 1) outputs.push(data);
    else inputs.push(data);
  }

  return { outputs, inputs };
};

const getBatchDailySeq = async (pool, productionDate, batchId) => {
  const result = await pool.request()
    .input('batchDate', sql.Date, productionDate)
    .input('batchId', sql.BigInt, batchId)
    .query(`
      SELECT COUNT(*) AS seq
      FROM [dbo].[wms_sync_batch]
      WHERE batch_date = @batchDate
        AND batch_id <= @batchId;
    `);

  return result.recordset[0].seq;
};

const getOrCreateBatch = async (pool, productionDate, productionHour) => {
  const existing = await pool.request()
    .input('batchDate', sql.Date, productionDate)
    .input('batchHour', sql.Int, productionHour)
    .query(`
      SELECT batch_id
      FROM [dbo].[wms_sync_batch]
      WHERE batch_date = @batchDate
        AND batch_hour = @batchHour;
    `);

  if (existing.recordset.length > 0) {
    const batchId = existing.recordset[0].batch_id;
    const dailySeq = await getBatchDailySeq(pool, productionDate, batchId);
    logger.info(`Using existing batch ${batchId} for ${productionDate} hour ${productionHour} (seq: ${dailySeq})`);
    return { batchId, dailySeq, isNew: false };
  }

  try {
    const insertResult = await pool.request()
      .input('batchDate', sql.Date, productionDate)
      .input('batchHour', sql.Int, productionHour)
      .input('batchCycle', sql.Int, 1)
      .input('status', sql.TinyInt, 0)
      .query(`
        INSERT INTO [dbo].[wms_sync_batch] (batch_date, batch_hour, batch_cycle, status)
        OUTPUT INSERTED.batch_id
        VALUES (@batchDate, @batchHour, @batchCycle, @status);
      `);

    const batchId = insertResult.recordset[0].batch_id;
    const dailySeq = await getBatchDailySeq(pool, productionDate, batchId);
    logger.info(`Created batch ${batchId} for ${productionDate} hour ${productionHour} (seq: ${dailySeq})`);
    return { batchId, dailySeq, isNew: true };
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      logger.warn(`Concurrent batch insert detected for ${productionDate} hour ${productionHour}. Reading existing batch.`);

      const retry = await pool.request()
        .input('batchDate', sql.Date, productionDate)
        .input('batchHour', sql.Int, productionHour)
        .query(`
          SELECT batch_id
          FROM [dbo].[wms_sync_batch]
          WHERE batch_date = @batchDate
            AND batch_hour = @batchHour;
        `);

      if (retry.recordset.length > 0) {
        const batchId = retry.recordset[0].batch_id;
        const dailySeq = await getBatchDailySeq(pool, productionDate, batchId);
        return { batchId, dailySeq, isNew: false };
      }
    }

    logger.error(`Failed to create batch: ${err.message}`);
    throw err;
  }
};

const buildProductionOrders = (outputs, productionDate, dailySeq) => {
  const prodDateStr = toSqlDateString(productionDate);

  return outputs.map((output) => ({
    recipePrefix: output.recipePrefix,
    productionDate: prodDateStr,
    outputItem: output.itemCode,
    outputWeight: output.totalWeight,
    productionOrderNo: buildProductionOrderNo(
      output.recipePrefix,
      output.itemCode,
      prodDateStr,
      dailySeq
    ),
  }));
};

const insertProductionHeaders = async (pool, orders, batchId) => {
  let inserted = 0;

  for (const order of orders) {
    const locationCode = getLocationCode(order.outputItem);

    try {
      const exists = await pool.request()
        .input('productionOrderNo', sql.NVarChar, order.productionOrderNo)
        .query(`
          SELECT 1
          FROM [dbo].[wms_production_header]
          WHERE production_order_no = @productionOrderNo;
        `);

      if (exists.recordset.length > 0) {
        logger.debug(`Header ${order.productionOrderNo} already exists, skipping`);
        continue;
      }

      await pool.request()
        .input('batchId', sql.BigInt, batchId)
        .input('productionOrderNo', sql.NVarChar, order.productionOrderNo)
        .input('itemNo', sql.NVarChar, order.outputItem)
        .input('quantity', sql.Decimal(18, 4), order.outputWeight)
        .input('uom', sql.NVarChar, 'KG')
        .input('locationCode', sql.NVarChar, locationCode)
        .input('lineNo', sql.Int, 1000)
        .input('routing', sql.NVarChar, 'Chopping')
        .input('orderType', sql.NVarChar, 'P18')
        .input('productionDate', sql.Date, order.productionDate)
        .input('createdBy', sql.NVarChar, 'wms_sync')
        .query(`
          INSERT INTO [dbo].[wms_production_header] (
            batch_id,
            production_order_no,
            item_no,
            quantity,
            uom,
            location_code,
            line_no,
            routing,
            order_type,
            production_date,
            created_by
          ) VALUES (
            @batchId,
            @productionOrderNo,
            @itemNo,
            @quantity,
            @uom,
            @locationCode,
            @lineNo,
            @routing,
            @orderType,
            @productionDate,
            @createdBy
          );
        `);

      inserted++;
    } catch (err) {
      logger.error(
        `Failed to insert header ${order.productionOrderNo} ` +
        `(batchId=${batchId}, itemNo=${order.outputItem}, qty=${order.outputWeight}, ` +
        `locationCode=${locationCode}, productionDate=${order.productionDate}): ${err.message}`
      );
      throw err;
    }
  }

  return inserted;
};

const insertProductionLines = async (pool, orders, inputs, batchId) => {
  let outputLines = 0;
  let inputLines = 0;

  const orderMap = new Map(orders.map((order) => [order.recipePrefix, order]));

  for (const order of orders) {
    const locationCode = getLocationCode(order.outputItem);

    try {
      const exists = await pool.request()
        .input('productionOrderNo', sql.NVarChar, order.productionOrderNo)
        .input('lineNo', sql.Int, 1000)
        .query(`
          SELECT 1
          FROM [dbo].[wms_production_line]
          WHERE production_order_no = @productionOrderNo
            AND line_no = @lineNo;
        `);

      if (exists.recordset.length > 0) continue;

      await pool.request()
        .input('batchId', sql.BigInt, batchId)
        .input('productionOrderNo', sql.NVarChar, order.productionOrderNo)
        .input('lineNo', sql.Int, 1000)
        .input('itemNo', sql.NVarChar, order.outputItem)
        .input('quantity', sql.Decimal(18, 4), order.outputWeight)
        .input('uom', sql.NVarChar, 'KG')
        .input('locationCode', sql.NVarChar, locationCode)
        .input('entryType', sql.Int, 0)
        .input('orderType', sql.NVarChar, 'P18')
        .input('productionDate', sql.Date, order.productionDate)
        .input('createdBy', sql.NVarChar, 'wms_sync')
        .query(`
          INSERT INTO [dbo].[wms_production_line] (
            batch_id,
            production_order_no,
            line_no,
            item_no,
            quantity,
            uom,
            location_code,
            entry_type,
            order_type,
            production_date,
            created_by
          ) VALUES (
            @batchId,
            @productionOrderNo,
            @lineNo,
            @itemNo,
            @quantity,
            @uom,
            @locationCode,
            @entryType,
            @orderType,
            @productionDate,
            @createdBy
          );
        `);

      outputLines++;
    } catch (err) {
      logger.error(`Failed to insert output line ${order.productionOrderNo}/1000: ${err.message}`);
      throw err;
    }
  }

  const inputsByOrder = new Map();

  for (const input of inputs) {
    const order = orderMap.get(input.recipePrefix);

    if (!order) {
      logger.warn(`No matching order for input recipe: ${input.recipePrefix}`);
      continue;
    }

    if (input.itemCode === order.outputItem) continue;

    if (!inputsByOrder.has(order.productionOrderNo)) {
      inputsByOrder.set(order.productionOrderNo, []);
    }

    inputsByOrder.get(order.productionOrderNo).push({
      ...input,
      productionOrderNo: order.productionOrderNo,
      productionDate: order.productionDate,
    });
  }

  for (const [productionOrderNo, inputList] of inputsByOrder) {
    inputList.sort((a, b) => a.itemCode.localeCompare(b.itemCode));

    let lineNo = 2000;

    for (const input of inputList) {
      const locationCode = getLocationCode(input.itemCode);

      try {
        const exists = await pool.request()
          .input('productionOrderNo', sql.NVarChar, productionOrderNo)
          .input('itemNo', sql.NVarChar, input.itemCode)
          .input('entryType', sql.Int, 1)
          .query(`
            SELECT 1
            FROM [dbo].[wms_production_line]
            WHERE production_order_no = @productionOrderNo
              AND item_no = @itemNo
              AND entry_type = @entryType;
          `);

        if (exists.recordset.length > 0) {
          lineNo += 1000;
          continue;
        }

        await pool.request()
          .input('batchId', sql.BigInt, batchId)
          .input('productionOrderNo', sql.NVarChar, productionOrderNo)
          .input('lineNo', sql.Int, lineNo)
          .input('itemNo', sql.NVarChar, input.itemCode)
          .input('quantity', sql.Decimal(18, 4), input.totalWeight)
          .input('uom', sql.NVarChar, 'KG')
          .input('locationCode', sql.NVarChar, locationCode)
          .input('entryType', sql.Int, 1)
          .input('orderType', sql.NVarChar, 'P18')
          .input('productionDate', sql.Date, input.productionDate)
          .input('createdBy', sql.NVarChar, 'wms_sync')
          .query(`
            INSERT INTO [dbo].[wms_production_line] (
              batch_id,
              production_order_no,
              line_no,
              item_no,
              quantity,
              uom,
              location_code,
              entry_type,
              order_type,
              production_date,
              created_by
            ) VALUES (
              @batchId,
              @productionOrderNo,
              @lineNo,
              @itemNo,
              @quantity,
              @uom,
              @locationCode,
              @entryType,
              @orderType,
              @productionDate,
              @createdBy
            );
          `);

        inputLines++;
        lineNo += 1000;
      } catch (err) {
        logger.error(`Failed to insert input line ${productionOrderNo}/${lineNo}: ${err.message}`);
        throw err;
      }
    }
  }

  return { outputLines, inputLines };
};

const buildP17OrderNo = (p18OrderNo, itemNo) => {
  return `P17_${String(p18OrderNo).replace(/^P18_/, '')}_${itemNo}`;
};

const getSpicePremixRecipe = async (pool, itemCode) => {
  if (!String(itemCode).startsWith('G')) return null;

  const countResult = await pool.request()
    .input('itemCode', sql.NVarChar, itemCode)
    .query(`
      SELECT
        COUNT(DISTINCT ISNULL(recipe, 0)) AS recipe_count,
        MAX(output_item_location) AS output_location,
        MAX(batch_size) AS batch_size
      FROM [dbo].[RecipeData]
      WHERE output_item = @itemCode
        AND [Process] = 'Spice premixing';
    `);

  const row = countResult.recordset[0];
  if (!row || row.recipe_count !== 1) return null;

  const ingredientsResult = await pool.request()
    .input('itemCode', sql.NVarChar, itemCode)
    .query(`
      SELECT
        input_item,
        input_item_qt_per,
        input_item_location,
        input_item_uom,
        batch_size,
        recipe
      FROM [dbo].[RecipeData]
      WHERE output_item = @itemCode
        AND [Process] = 'Spice premixing'
      ORDER BY input_item;
    `);

  return {
    ingredients: ingredientsResult.recordset,
    outputLocation: row.output_location,
    batchSize: row.batch_size,
  };
};

const getQualifiedP18GItems = async (pool, batchId) => {
  const result = await pool.request()
    .input('batchId', sql.BigInt, batchId)
    .query(`
      ;WITH CandidateLines AS (
        SELECT
          l.production_order_no,
          l.item_no,
          l.quantity,
          l.location_code,
          l.production_date,
          l.created_by,
          h.routing,
          h.order_type
        FROM [dbo].[wms_production_line] l
        INNER JOIN [dbo].[wms_production_header] h
          ON l.production_order_no = h.production_order_no
        WHERE l.batch_id = @batchId
          AND h.batch_id = @batchId
          AND h.order_type = 'P18'
          AND h.routing = 'Chopping'
          AND l.entry_type = 1
          AND LEFT(l.item_no, 1) = 'G'
      ),
      QualifiedRecipes AS (
        SELECT
          c.production_order_no,
          c.item_no,
          c.quantity,
          c.location_code,
          c.production_date,
          c.created_by,
          COUNT(DISTINCT ISNULL(r.recipe, 0)) AS recipe_count,
          MAX(r.output_item_location) AS output_item_location
        FROM CandidateLines c
        INNER JOIN [dbo].[RecipeData] r
          ON c.item_no = r.output_item
         AND r.[Process] = 'Spice premixing'
        GROUP BY
          c.production_order_no,
          c.item_no,
          c.quantity,
          c.location_code,
          c.production_date,
          c.created_by
      )
      SELECT
        q.production_order_no,
        q.item_no,
        q.quantity,
        q.location_code,
        q.production_date,
        q.created_by,
        q.output_item_location
      FROM QualifiedRecipes q
      WHERE q.recipe_count = 1
        AND NOT EXISTS (
          SELECT 1
          FROM [dbo].[wms_production_header] h2
          WHERE h2.production_order_no = CONCAT('P17_', REPLACE(q.production_order_no, 'P18_', ''), '_', q.item_no)
            AND h2.order_type = 'P17'
        )
      ORDER BY q.production_order_no, q.item_no;
    `);

  return result.recordset;
};

const generateP17Orders = async (pool, batchId) => {
  logger.info('Generating P17 orders...');

  let p17HeadersCreated = 0;
  let p17LinesCreated = 0;

  const qualifyingRows = await getQualifiedP18GItems(pool, batchId);
  logger.info(`Qualifying P18 G-items for P17: ${qualifyingRows.length}`);

  for (const row of qualifyingRows) {
    const p17OrderNo = buildP17OrderNo(row.production_order_no, row.item_no);

    try {
      const recipe = await getSpicePremixRecipe(pool, row.item_no);
      if (!recipe) {
        logger.debug(`Skipping ${row.production_order_no}/${row.item_no}: no single Spice-Premix recipe`);
        continue;
      }

      const outputLocation =
        row.output_item_location ||
        recipe.outputLocation ||
        row.location_code ||
        getLocationCode(row.item_no);

      const headerExists = await pool.request()
        .input('productionOrderNo', sql.NVarChar, p17OrderNo)
        .query(`
          SELECT 1
          FROM [dbo].[wms_production_header]
          WHERE production_order_no = @productionOrderNo
            AND order_type = 'P17';
        `);

      if (headerExists.recordset.length > 0) {
        logger.debug(`P17 ${p17OrderNo} already exists, skipping`);
        continue;
      }

      await pool.request()
        .input('batchId', sql.BigInt, batchId)
        .input('productionOrderNo', sql.NVarChar, p17OrderNo)
        .input('itemNo', sql.NVarChar, row.item_no)
        .input('quantity', sql.Decimal(18, 4), row.quantity)
        .input('uom', sql.NVarChar, 'KG')
        .input('locationCode', sql.NVarChar, outputLocation)
        .input('lineNo', sql.Int, 1000)
        .input('routing', sql.NVarChar, 'Spice-Premix')
        .input('orderType', sql.NVarChar, 'P17')
        .input('productionDate', sql.Date, row.production_date)
        .input('createdBy', sql.NVarChar, 'wms_sync')
        .query(`
          INSERT INTO [dbo].[wms_production_header] (
            batch_id,
            production_order_no,
            item_no,
            quantity,
            uom,
            location_code,
            line_no,
            routing,
            order_type,
            production_date,
            created_by
          ) VALUES (
            @batchId,
            @productionOrderNo,
            @itemNo,
            @quantity,
            @uom,
            @locationCode,
            @lineNo,
            @routing,
            @orderType,
            @productionDate,
            @createdBy
          );
        `);

      p17HeadersCreated++;

      await pool.request()
        .input('batchId', sql.BigInt, batchId)
        .input('productionOrderNo', sql.NVarChar, p17OrderNo)
        .input('lineNo', sql.Int, 1000)
        .input('itemNo', sql.NVarChar, row.item_no)
        .input('quantity', sql.Decimal(18, 4), row.quantity)
        .input('uom', sql.NVarChar, 'KG')
        .input('locationCode', sql.NVarChar, outputLocation)
        .input('entryType', sql.Int, 0)
        .input('orderType', sql.NVarChar, 'P17')
        .input('productionDate', sql.Date, row.production_date)
        .input('createdBy', sql.NVarChar, 'wms_sync')
        .query(`
          INSERT INTO [dbo].[wms_production_line] (
            batch_id,
            production_order_no,
            line_no,
            item_no,
            quantity,
            uom,
            location_code,
            entry_type,
            order_type,
            production_date,
            created_by
          ) VALUES (
            @batchId,
            @productionOrderNo,
            @lineNo,
            @itemNo,
            @quantity,
            @uom,
            @locationCode,
            @entryType,
            @orderType,
            @productionDate,
            @createdBy
          );
        `);

      p17LinesCreated++;

      let lineNo = 3000;
      const ingredients = [...recipe.ingredients].sort((a, b) =>
        String(a.input_item).localeCompare(String(b.input_item))
      );

      for (const ingredient of ingredients) {
        const batchSize = parseFloat(ingredient.batch_size || recipe.batchSize || 0);
        const inputQtyPer = parseFloat(ingredient.input_item_qt_per || 0);

        if (!batchSize) {
          logger.warn(`Skipping ingredient ${ingredient.input_item} for ${p17OrderNo}: invalid batch_size`);
          continue;
        }

        const inputQty = (parseFloat(row.quantity) / batchSize) * inputQtyPer;
        const inputLocation = ingredient.input_item_location || getLocationCode(ingredient.input_item);
        const inputUom = ingredient.input_item_uom || 'KG';

        const lineExists = await pool.request()
          .input('productionOrderNo', sql.NVarChar, p17OrderNo)
          .input('itemNo', sql.NVarChar, ingredient.input_item)
          .input('entryType', sql.Int, 1)
          .query(`
            SELECT 1
            FROM [dbo].[wms_production_line]
            WHERE production_order_no = @productionOrderNo
              AND item_no = @itemNo
              AND entry_type = @entryType;
          `);

        if (lineExists.recordset.length > 0) {
          lineNo += 1000;
          continue;
        }

        await pool.request()
          .input('batchId', sql.BigInt, batchId)
          .input('productionOrderNo', sql.NVarChar, p17OrderNo)
          .input('lineNo', sql.Int, lineNo)
          .input('itemNo', sql.NVarChar, ingredient.input_item)
          .input('quantity', sql.Decimal(18, 4), inputQty)
          .input('uom', sql.NVarChar, inputUom)
          .input('locationCode', sql.NVarChar, inputLocation)
          .input('entryType', sql.Int, 1)
          .input('orderType', sql.NVarChar, 'P17')
          .input('productionDate', sql.Date, row.production_date)
          .input('createdBy', sql.NVarChar, 'wms_sync')
          .query(`
            INSERT INTO [dbo].[wms_production_line] (
              batch_id,
              production_order_no,
              line_no,
              item_no,
              quantity,
              uom,
              location_code,
              entry_type,
              order_type,
              production_date,
              created_by
            ) VALUES (
              @batchId,
              @productionOrderNo,
              @lineNo,
              @itemNo,
              @quantity,
              @uom,
              @locationCode,
              @entryType,
              @orderType,
              @productionDate,
              @createdBy
            );
          `);

        p17LinesCreated++;
        lineNo += 1000;
      }

      logger.debug(`Created P17 ${p17OrderNo} with ${ingredients.length} ingredient rows`);
    } catch (err) {
      logger.error(`Failed to create P17 for ${row.production_order_no}/${row.item_no}: ${err.message}`);
      throw err;
    }
  }

  logger.info(`P17 created: ${p17HeadersCreated} headers, ${p17LinesCreated} lines`);
  return { p17HeadersCreated, p17LinesCreated };
};

/**
 * Mark processed choppings as synced using batchId.
 */
const markChoppingsAsSynced = async (pool, choppings, batchId) => {
  if (!choppings.length) return 0;

  const values = choppings.map((_, index) => `(@choppingId${index}, @createdDate${index})`).join(', ');

  const request = pool.request().input('batchId', sql.BigInt, batchId);

  choppings.forEach((chopping, index) => {
    request
      .input(`choppingId${index}`, sql.NVarChar, String(chopping.chopping_id))
      .input(`createdDate${index}`, sql.Date, toSqlDateString(chopping.created_date));
  });

  const result = await request.query(`
    UPDATE c
    SET c.sync_id = @batchId
    FROM [dbo].[choppings] c
    INNER JOIN (VALUES ${values}) AS v(chopping_id, created_date)
      ON c.chopping_id = v.chopping_id
     AND CAST(c.created_at AS DATE) = v.created_date
    WHERE c.closed_by IS NOT NULL
      AND c.sync_id IS NULL;
  `);

  const rowsAffected = result.rowsAffected?.[0] || 0;
  logger.info(`Marked ${rowsAffected} choppings as synced with sync_id=${batchId}`);

  return rowsAffected;
};

const processPendingSync = async (pool) => {
  await prepChoppingLines(pool);
  await loadItemMappings(pool);
  await loadItemLocations(pool);

  const hoursToProcess = await getHoursToProcess(pool);

  for (const { production_date, production_hour, chopping_count } of hoursToProcess) {
    logger.info(`Processing ${production_date} hour ${production_hour} (${chopping_count} choppings)`);

    const choppings = await getChoppingsForHour(pool, production_date, production_hour);
    if (!choppings.length) continue;

    const { outputs, inputs } = await getGroupedChoppingLines(pool, choppings);

    if (!outputs.length) {
      logger.warn(`No output lines found for ${production_date} hour ${production_hour}; skipping sync_id update`);
      continue;
    }

    const { batchId, dailySeq } = await getOrCreateBatch(pool, production_date, production_hour);
    const orders = buildProductionOrders(outputs, production_date, dailySeq);

    const headersInserted = await insertProductionHeaders(pool, orders, batchId);
    const { outputLines, inputLines } = await insertProductionLines(pool, orders, inputs, batchId);

    logger.info(
      `Batch ${batchId}: Inserted ${headersInserted} headers, ${outputLines} output lines, ${inputLines} input lines`
    );

    await generateP17Orders(pool, batchId);

    await markChoppingsAsSynced(pool, choppings, batchId);
  }

  return { success: true, processedHours: hoursToProcess.length };
};

/**
 * Normal sync.
 * Processes only choppings where sync_id IS NULL.
 */
export const runSync = async () => {
  const pool = await connectWms();

  try {
    return await processPendingSync(pool);
  } catch (err) {
    logger.error('Error during sync:', err);
    return { success: false, error: err };
  }
};

/**
 * Full rebuild for today's production date.
 * Use this when you want to rerun all of today, including missed midnight cases.
 */
export const rerunTodaySync = async () => {
  const pool = await connectWms();

  try {
    const resetChoppings = await resetTodaySyncData(pool);
    const result = await processPendingSync(pool);

    return {
      ...result,
      rerunToday: true,
      resetChoppings,
    };
  } catch (err) {
    logger.error('Error during today rerun sync:', err);
    return { success: false, rerunToday: true, error: err };
  }
};
