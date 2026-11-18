// Tests for several sales people on one quotation. Run with:  npm --prefix app/client run test:po
// No database: a dummy DATABASE_URL is set only because the module imports the database module; nothing connects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { equalShares, validateTeam, SalesTeamError } = await import('../salesTeam.js');

describe('equalShares', () => {
  test('splits 100 equally and always adds up to exactly 100', () => {
    assert.deepEqual(equalShares(2), [50, 50]);
    assert.deepEqual(equalShares(4), [25, 25, 25, 25]);
    for (const n of [1, 2, 3, 5, 7, 9, 10]) {
      const sum = Math.round(equalShares(n).reduce((a, b) => a + b, 0) * 100) / 100;
      assert.equal(sum, 100, `n=${n}`);
    }
    assert.deepEqual(equalShares(3), [33.34, 33.33, 33.33]);
    assert.deepEqual(equalShares(0), []);
  });
});

describe('validateTeam', () => {
  const ok = [{ sales_engineer_id: 1, share_percent: 60 }, { sales_engineer_id: 2, share_percent: 40 }];

  test('a valid team passes and is cleaned', () => {
    assert.deepEqual(validateTeam(ok, 1), ok);
    assert.deepEqual(validateTeam([{ sales_engineer_id: '1', share_percent: '60.004' }, { sales_engineer_id: 2, share_percent: '39.996' }], 1).map((m) => m.sales_engineer_id), [1, 2]);
  });

  test('the shares must add up to 100', () => {
    assert.throws(() => validateTeam([{ sales_engineer_id: 1, share_percent: 60 }, { sales_engineer_id: 2, share_percent: 30 }], 1), /add up to 90%/);
  });

  test('the main sales person must be on the team, nobody twice, shares above 0', () => {
    assert.throws(() => validateTeam(ok, 3), /must be on the team/);
    assert.throws(() => validateTeam([{ sales_engineer_id: 1, share_percent: 50 }, { sales_engineer_id: 1, share_percent: 50 }], 1), /only once/);
    assert.throws(() => validateTeam([{ sales_engineer_id: 1, share_percent: 100 }, { sales_engineer_id: 2, share_percent: 0 }], 1), /above 0%/);
    assert.throws(() => validateTeam([{ sales_engineer_id: 1, share_percent: -5 }, { sales_engineer_id: 2, share_percent: 105 }], 1), /above 0%/);
    assert.throws(() => validateTeam([{ sales_engineer_id: 'x', share_percent: 100 }], null), /Choose a sales person/);
  });

  test('empty, too large and one-person teams', () => {
    assert.throws(() => validateTeam([], 1), SalesTeamError);
    assert.throws(() => validateTeam(undefined, 1), SalesTeamError);
    assert.throws(() => validateTeam(Array.from({ length: 11 }, (_, i) => ({ sales_engineer_id: i + 1, share_percent: 9 })), null), /At most 10/);
    assert.deepEqual(validateTeam([{ sales_engineer_id: 1, share_percent: 100 }], 1), [{ sales_engineer_id: 1, share_percent: 100 }]);
  });

  test('the error carries status 400 so the route shows its message', () => {
    try { validateTeam([], 1); } catch (e) { assert.equal(e.status, 400); }
  });
});
