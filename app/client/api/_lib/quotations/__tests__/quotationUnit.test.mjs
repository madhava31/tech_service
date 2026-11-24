// The unit of a quotation line (migration 015). Run with:  npm --prefix app/client run test:po   (no database: queries are stubbed)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { cleanUnit, itemUnitSql, quotationItemsWithUnit, MAX_UNIT_LENGTH } = await import('../quotationUnit.js');
const { default: db } = await import('../../db/index.js');

describe('cleanUnit', () => {
  test('tidies what was typed; empty means "use the product unit"', () => {
    assert.equal(cleanUnit('  Pack   of 100 '), 'Pack of 100');
    assert.equal(cleanUnit('Kg'), 'Kg');
    assert.equal(cleanUnit(''), null);
    assert.equal(cleanUnit('   '), null);
    assert.equal(cleanUnit(undefined), null);
    assert.equal(cleanUnit(null), null);
    assert.equal(cleanUnit('x'.repeat(50)).length, MAX_UNIT_LENGTH);
    assert.equal(cleanUnit('Box\nof 10'), 'Box of 10');
  });
});

describe('reading the unit', () => {
  test('before migration 015 the product unit is read; after it, the line unit wins', async () => {
    let columnExists = false;
    const seen = [];
    db.prepare = (sql) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        all: async (...p) => {
          if (/information_schema/.test(q)) return columnExists ? [{ table_name: 'quotation_item', column_name: 'unit' }] : [];
          seen.push({ q, p });
          return [];
        },
        get: async () => undefined,
        run: async () => ({ changes: 0 }),
      };
    };
    assert.equal(await itemUnitSql(), 'p.unit');
    await quotationItemsWithUnit(7);
    assert.match(seen.at(-1).q, /p\.unit AS unit/);
    assert.deepEqual(seen.at(-1).p, [7]);
    columnExists = true;
    assert.equal(await itemUnitSql(), 'COALESCE(qi.unit, p.unit)');
    await quotationItemsWithUnit(7);
    assert.match(seen.at(-1).q, /COALESCE\(qi\.unit, p\.unit\) AS unit/);
  });
});
