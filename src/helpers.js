import { config } from './config.js';
import { logger } from './logger.js';

// Item code mapping (loaded from DB or defaults)
let itemCodeMapping = {
  'G2011': 'G2009',
};

// Item location cache (loaded from DB)
let itemLocationCache = {};

/**
 * Map item code using the mapping table
 */
export const mapItemCode = (itemCode) => itemCodeMapping[itemCode] || itemCode;

/**
 * Get location code for an item
 */
export const getLocationCode = (itemCode) => 
  itemLocationCache[itemCode] || config.sync.defaultLocationCode;

/**
 * Extract recipe prefix from chopping_id
 * "1230K31-1" -> "1230K31"
 */
export const getRecipePrefix = (choppingId) => {
  const dashIndex = choppingId.indexOf('-');
  return dashIndex > 0 ? choppingId.substring(0, dashIndex) : choppingId;
};

/**
 * Build short recipe code
 * "1230K31" -> "3K31", "1240K72" -> "4K72"
 */
export const getShortRecipeCode = (recipePrefix) => {
  const prefix4 = recipePrefix.substring(0, 4);
  const remainder = recipePrefix.substring(4);
  
  const shortPrefix = prefix4 === '1230' ? '3' 
    : prefix4 === '1240' ? '4' 
    : prefix4;
  
  return `${shortPrefix}${remainder}`;
};

/**
 * Format date as YYMMDD
 */
export const formatDateYYMMDD = (date) => {
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
};

/**
 * Build production order number
 * Format: P18_3K31_H231034_260414_001
 */
export const buildProductionOrderNo = (recipePrefix, outputItem, productionDate, batchSeq) => {
  const shortRecipe = getShortRecipeCode(recipePrefix);
  const dateStr = formatDateYYMMDD(productionDate);
  const seqStr = String(batchSeq).padStart(3, '0');
  return `P18_${shortRecipe}_${dateStr}_${seqStr}`;
};

/**
 * Load item code mappings from database
 */
export const loadItemMappings = async (pool) => {
  try {
    const result = await pool.request().query(`
      SELECT source_item_code, target_item_code
      FROM [dbo].[wms_item_code_mapping]
      WHERE is_active = 1
    `);
    
    result.recordset.forEach(({ source_item_code, target_item_code }) => {
      itemCodeMapping[source_item_code] = target_item_code;
    });
    
    logger.info(`Loaded ${result.recordset.length} item code mappings`);
  } catch (err) {
    logger.warn('Could not load item mappings from DB, using defaults:', err.message);
  }
};

/**
 * Load item locations from database
 */
export const loadItemLocations = async (pool) => {
  try {
    const result = await pool.request().query(`
      SELECT [Item No_], [Location Code]
      FROM [dbo].[Item_Location_Lookup]
    `);
    
    result.recordset.forEach((row) => {
      itemLocationCache[row['Item No_']] = row['Location Code'];
    });
    
    logger.info(`Loaded ${result.recordset.length} item locations`);
  } catch (err) {
    logger.warn('Could not load item locations from DB, using default:', err.message);
  }
};

