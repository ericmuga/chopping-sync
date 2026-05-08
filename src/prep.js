/**
 * Daily chopping_lines prep
 *
 * Runs before each batching/sync cycle. Processes ALL CLOSED choppings from
 * @paramWorkDate onwards (default: config.sync.startDate).
 * 
 * For each closed chopping, this:
 * - Reconstructs water/intake item lines from template_lines
 * - Updates existing water/intake lines with recalculated weights
 * - Inserts missing water/intake lines
 * - Removes duplicate lines
 * - Deletes and recreates ALL output lines with fresh calculations
 * 
 * IMPORTANT: This retroactively fixes historical data from the start date forward.
 * Only processes choppings where closed_by IS NOT NULL.
 */

import { logger } from './logger.js';
import { sql } from './db.js';
import { config } from './config.js';

const PREP_SQL = `
DECLARE @WorkDate date = @paramWorkDate;

IF OBJECT_ID('tempdb..#WaterQuery') IS NOT NULL
    DROP TABLE #WaterQuery;

IF OBJECT_ID('tempdb..#OutputItems') IS NOT NULL
    DROP TABLE #OutputItems;

IF OBJECT_ID('tempdb..#ClosedChoppings') IS NOT NULL
    DROP TABLE #ClosedChoppings;


-- First, get all closed choppings for the work date (performance optimization)
SELECT DISTINCT [chopping_id]
INTO #ClosedChoppings
FROM [calibra].[dbo].[choppings]
WHERE [created_at] >= @WorkDate
  AND [closed_by] IS NOT NULL;

CREATE CLUSTERED INDEX IX_ClosedChoppings_ID ON #ClosedChoppings([chopping_id]);


;WITH WaterQueryRaw AS (
    SELECT
        a.[chopping_id],
        b.[item_code],
        CAST(b.[units_per_100] * 2 AS decimal(8,2)) AS [weight]
    FROM [calibra].[dbo].[chopping_lines] AS a
    INNER JOIN #ClosedChoppings AS cc
        ON a.[chopping_id] = cc.[chopping_id]
    INNER JOIN [calibra].[dbo].[template_lines] AS b
        ON LEFT(a.[chopping_id], 7) = b.[template_no]
       AND b.[main_product] = 'No'
       AND b.[item_code] NOT IN (
            'G1321','G1335','G1938','G1940','G1975','G1980','G2001','G2002',
            'G2004','G2005','G2007','G2008','G2009','G2019','G2021','G2022',
            'G2024','G2025','G2038','G2042','G2044','G2054','G2055','G2060',
            'G2150','G2159','G2175','G2179','G2180','G2247','G5513','G5702',
            'G5703','G5707','G2061'
       )
    WHERE
        a.[created_at] >= @WorkDate
        AND (
            LEFT(a.[item_code], 1) IN ('G','H')
            OR b.[item_code] IN (
                'G2103','G2107','G2109','G2110','G2111','G2113','G2114','G2115',
                'G2116','G2117','G2118','G2119','G2120','G2121','G2122','G2123',
                'G2125','G2126','G2127','G2128','G2129','G2130','G2131','G2132',
                'G2133','G2137','G2139','G2140','G2141','G2142','G2143','G2145',
                'G2146','G2147','G2148','G2151','G2157','G2158','G2162','G2165',
                'G2166','G2167','G2172','G2173','G2174','G2176','D213021','G2181'
            )
        )
        AND NOT EXISTS (
            SELECT 1
            FROM [calibra].[dbo].[template_lines] AS c
            WHERE LOWER(c.[type]) <> 'intake'
              AND c.[item_code] = a.[item_code]
        )

    UNION

    SELECT
        a.[chopping_id],
        b.[item_code],
        CAST(b.[units_per_100] * 2 AS decimal(8,2)) AS [weight]
    FROM [calibra].[dbo].[chopping_lines] AS a
    INNER JOIN #ClosedChoppings AS cc
        ON a.[chopping_id] = cc.[chopping_id]
    INNER JOIN [calibra].[dbo].[template_lines] AS b
        ON LEFT(a.[chopping_id], 7) = b.[template_no]
       AND b.[main_product] = 'No'
       AND b.[item_code] NOT IN (
            'G1321','G1335','G1938','G1940','G1975','G1980','G2001','G2002',
            'G2004','G2005','G2007','G2008','G2009','G2019','G2021','G2022',
            'G2024','G2025','G2038','G2042','G2044','G2054','G2055','G2060',
            'G2150','G2159','G2175','G2179','G2180','G2247','G5513','G5702',
            'G5703','G5707','G2061'
       )
    WHERE
        a.[created_at] >= @WorkDate
        AND b.[item_code] IN (
            'G2103','G2107','G2109','G2110','G2111','G2113','G2114','G2115',
            'G2116','G2117','G2118','G2119','G2120','G2121','G2122','G2123',
            'G2125','G2126','G2127','G2128','G2129','G2130','G2131','G2132',
            'G2133','G2137','G2139','G2140','G2141','G2142','G2143','G2145',
            'G2146','G2147','G2148','G2151','G2157','G2158','G2162','G2165',
            'G2166','G2167','G2172','G2173','G2174','G2176','D213021','G2181'
        )
)
SELECT
    [chopping_id],
    [item_code],
    MAX([weight]) AS [weight]
INTO #WaterQuery
FROM WaterQueryRaw
GROUP BY
    [chopping_id],
    [item_code];

CREATE CLUSTERED INDEX IX_WaterQuery_ChoppingItem ON #WaterQuery([chopping_id], [item_code]);


-- update existing item lines for the work date
UPDATE target
SET
    target.[weight] = source.[weight],
    target.[updated_at] = GETDATE()
FROM [calibra].[dbo].[chopping_lines] AS target
INNER JOIN #ClosedChoppings AS cc
    ON target.[chopping_id] = cc.[chopping_id]
INNER JOIN #WaterQuery AS source
    ON target.[chopping_id] = source.[chopping_id]
   AND target.[item_code] = source.[item_code]
WHERE target.[created_at] >= @WorkDate;


-- insert missing item lines for the work date
INSERT INTO [calibra].[dbo].[chopping_lines] (
    [chopping_id],
    [item_code],
    [weight],
    [output],
    [batch_no],
    [created_at],
    [updated_at]
)
SELECT
    source.[chopping_id],
    source.[item_code],
    source.[weight],
    0,
    NULL,
    GETDATE(),
    GETDATE()
FROM #WaterQuery AS source
INNER JOIN #ClosedChoppings AS cc
    ON source.[chopping_id] = cc.[chopping_id]
WHERE NOT EXISTS (
    SELECT 1
    FROM [calibra].[dbo].[chopping_lines] AS target WITH (UPDLOCK, HOLDLOCK)
    WHERE target.[chopping_id] = source.[chopping_id]
      AND target.[item_code] = source.[item_code]
      AND target.[created_at] >= @WorkDate
);


-- remove duplicate item lines before calculating output
;WITH DuplicateLines AS (
    SELECT
        cl.[id],
        ROW_NUMBER() OVER (
            PARTITION BY
                cl.[chopping_id],
                cl.[item_code],
                CAST(cl.[created_at] AS date)
            ORDER BY cl.[id] ASC
        ) AS rn
    FROM [calibra].[dbo].[chopping_lines] AS cl
    INNER JOIN #ClosedChoppings AS cc
        ON cl.[chopping_id] = cc.[chopping_id]
    WHERE cl.[created_at] >= @WorkDate
)
DELETE FROM DuplicateLines
WHERE rn > 1;


-- build output lines after duplicates are removed
SELECT
    cl.[chopping_id],
    CAST(cl.[created_at] AS date) AS [chopping_date],
    tl.[item_code],
    CAST(SUM(ISNULL(cl.[weight], 0)) AS decimal(8,2)) AS [weight]
INTO #OutputItems
FROM [calibra].[dbo].[chopping_lines] AS cl
INNER JOIN #ClosedChoppings AS cc
    ON cl.[chopping_id] = cc.[chopping_id]
INNER JOIN [calibra].[dbo].[template_lines] AS tl
    ON LEFT(cl.[chopping_id], 7) = tl.[template_no]
   AND tl.[main_product] = 'Yes'
   AND LOWER(tl.[type]) <> 'intake'
WHERE
    cl.[created_at] >= @WorkDate
    AND cl.[item_code] NOT IN ('H221187', 'H221188')
    AND cl.[item_code] <> tl.[item_code]
GROUP BY
    cl.[chopping_id],
    CAST(cl.[created_at] AS date),
    tl.[item_code];

CREATE CLUSTERED INDEX IX_OutputItems_ChoppingItem ON #OutputItems([chopping_id], [chopping_date], [item_code]);


-- delete existing output lines for closed choppings before reinserting
DELETE target
FROM [calibra].[dbo].[chopping_lines] AS target
INNER JOIN #ClosedChoppings AS cc
    ON target.[chopping_id] = cc.[chopping_id]
INNER JOIN #OutputItems AS source
    ON target.[chopping_id] = source.[chopping_id]
   AND CAST(target.[created_at] AS date) = source.[chopping_date]
   AND target.[item_code] = source.[item_code]
WHERE target.[created_at] >= @WorkDate
  AND target.[output] = 1;


-- insert output lines for closed choppings
INSERT INTO [calibra].[dbo].[chopping_lines] (
    [chopping_id],
    [item_code],
    [weight],
    [output],
    [batch_no],
    [created_at],
    [updated_at]
)
SELECT
    source.[chopping_id],
    source.[item_code],
    source.[weight],
    1,
    NULL,
    source.[chopping_date],
    GETDATE()
FROM #OutputItems AS source
INNER JOIN #ClosedChoppings AS cc
    ON source.[chopping_id] = cc.[chopping_id];
`;

export const prepChoppingLines = async (pool, workDate = null) => {
  // Default: config.sync.startDate — processes and amends ALL closed choppings
  // from the configured start date onwards. This retroactively fixes historical
  // data each run. Caller can pass an explicit date to override.
  let date;
  if (workDate) {
    date = workDate instanceof Date ? workDate : new Date(workDate);
  } else {
    date = new Date(config.sync.startDate);
  }
  const dateStr = date.toISOString().split('T')[0];

  logger.info(`Running chopping_lines prep from ${dateStr} onwards`);

  await pool.request()
    .input('paramWorkDate', sql.Date, date)
    .query(PREP_SQL);

  logger.info(`Chopping_lines prep complete (from ${dateStr} onwards)`);
};
