import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRegisteredOrderNo, getProductionOrderNo } from '../src/orderNumbers.js';
import { sql } from '../src/db.js';

test('full BIGINT range stays within 20 characters without rounding or truncation', () => {
  const ids = ['1', '35', '36', '9007199254740992', '9007199254740993', '9223372036854775806', '9223372036854775807'];
  const numbers = ids.flatMap(id => ['P18', 'P17'].map(type => formatRegisteredOrderNo(type, id)));
  assert.equal(new Set(numbers).size, numbers.length);
  for (const number of numbers) assert.ok(number.length <= 20);
  assert.throws(() => formatRegisteredOrderNo('P18', '9223372036854775808'));
  assert.throws(() => formatRegisteredOrderNo('P18', '0'));
});

test('reruns reuse identity; different output items and P17 parents stay distinct', async () => {
  const originalTransaction = sql.Transaction;
  const originalRequest = sql.Request;
  const registry = new Map();
  sql.Transaction = class { async begin() {} async commit() {} async rollback() {} };
  sql.Request = class {
    input(name, type, key) { this.key = key; return this; }
    async query() {
      if (!registry.has(this.key)) registry.set(this.key, String(registry.size + 1));
      return { recordset: [{ registry_id: registry.get(this.key) }] };
    }
  };
  try {
    const identity = ['333787', '1230K31', '2026-10-04', 'G2159'];
    const first = await getProductionOrderNo({}, 'P18', identity);
    assert.equal(await getProductionOrderNo({}, 'P18', identity), first);
    const other = await getProductionOrderNo({}, 'P18', [...identity.slice(0, 3), 'G2160']);
    assert.notEqual(other, first);
    const premix = await getProductionOrderNo({}, 'P17', [first, 'G8900']);
    assert.equal(await getProductionOrderNo({}, 'P17', [first, 'G8900']), premix);
    assert.notEqual(await getProductionOrderNo({}, 'P17', [other, 'G8900']), premix);
  } finally {
    sql.Transaction = originalTransaction;
    sql.Request = originalRequest;
  }
});
