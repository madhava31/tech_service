// The Quotations list filter by firm (number series: TSQOT, TSAPQOT, ...). Run with:  npm --prefix app/client run test:po
// No database: queries are stubbed and recorded.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router, seriesPattern } = await import('../../routes/quotations.js');
const { default: db } = await import('../../db/index.js');

const NUMBERS = ['TSQOT2627/12', 'TSQOT2627/13', 'TSAPQOT2627/3', 'TSQOTX2627/1', 'TSQOT/2627/9', 'TSMO2627/1'];

describe('seriesPattern', () => {
  const re = (p) => new RegExp(p, 'i');

  test('TSQOT means the TSQOT series only, not TSAPQOT or a longer prefix', () => {
    const p = re(seriesPattern('TSQOT'));
    assert.deepEqual(NUMBERS.filter((n) => p.test(n)), ['TSQOT2627/12', 'TSQOT2627/13', 'TSQOT/2627/9']);
    const ap = re(seriesPattern('TSAPQOT'));
    assert.deepEqual(NUMBERS.filter((n) => ap.test(n)), ['TSAPQOT2627/3']);
  });

  test('case and spaces do not matter, and a prefix with a hyphen or underscore works', () => {
    assert.ok(re(seriesPattern(' tsqot ')).test('TSQOT2627/1'));
    assert.ok(re(seriesPattern('TS-QOT_1')).test('TS-QOT_12627/1'));
  });

  test('anything that is not a plain prefix is ignored (no pattern, so no filter and no injection)', () => {
    for (const bad of ['', '   ', undefined, null, 42, ['TSQOT'], 'TS QOT', "TSQOT'; DROP TABLE quotation;--", '.*', 'a|b', '(x)', 'x'.repeat(21)]) {
      assert.equal(seriesPattern(bad), null, JSON.stringify(bad));
    }
  });
});

describe('GET /api/quotations with series', () => {
  let queries;
  beforeEach(() => {
    queries = [];
    db.prepare = (sql) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      const record = (p) => { queries.push({ q, p }); };
      return {
        get: async (...p) => { record(p); if (/COUNT\(\*\) AS count FROM quotation q/.test(q)) return { count: 2 }; throw new Error(`unexpected get: ${q.slice(0, 80)}`); },
        all: async (...p) => {
          record(p);
          if (/GROUP BY status/.test(q)) return [{ status: 'draft', count: 1 }, { status: 'sent', count: 1 }];
          if (/FROM quotation q JOIN company c/.test(q)) return [{ id: 1, number: 'TSQOT2627/12' }, { id: 2, number: 'TSQOT2627/13' }];
          throw new Error(`unexpected all: ${q.slice(0, 80)}`);
        },
        run: async (...p) => { record(p); return {}; },
      };
    };
  });

  async function list(query, role = 'admin') {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 5, role }; next(); });
    app.use('/api/quotations', router);
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/quotations?paginated=true&page=1&pageSize=25${query}`);
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
  const listQuery = () => queries.find((x) => /^SELECT q\.\*/.test(x.q));
  const countQuery = () => queries.find((x) => /SELECT COUNT\(\*\) AS count FROM quotation q/.test(x.q));
  const stageQuery = () => queries.find((x) => /GROUP BY status/.test(x.q));
  const placeholders = (x) => (x.q.match(/\?/g) || []).length;

  test('the list, its count and the stage counts all use the same series filter', async () => {
    const r = await list('&series=TSQOT');
    assert.equal(r.status, 200);
    for (const x of [listQuery(), countQuery()]) {
      assert.match(x.q, /q\.number ~\* \?/);
      assert.ok(x.p.includes('^TSQOT([^A-Za-z]|$)'), 'the pattern is passed as a parameter, not written into the SQL');
      assert.equal(placeholders(x), x.p.length, 'placeholders match the parameters');
    }
    const st = stageQuery();
    assert.match(st.q, /WHERE number ~\* \?/);
    assert.deepEqual(st.p, ['^TSQOT([^A-Za-z]|$)']);
    assert.equal(r.body.stageCounts.All, 2);
    assert.equal(r.body.total, 2);
  });

  test('without a series nothing changes: no number filter anywhere', async () => {
    await list('');
    assert.ok(![listQuery(), countQuery(), stageQuery()].some((x) => /number ~\*/.test(x.q)));
    assert.doesNotMatch(stageQuery().q, /WHERE/);
  });

  test('a series together with other filters, and a staff user sees only their own quotations', async () => {
    await list('&series=TSAPQOT&status=sent&searchCompany=acme', 'staff');
    const x = listQuery();
    assert.match(x.q, /q\.created_by_user_id = \?/);
    assert.match(x.q, /q\.number ~\* \?/);
    assert.match(x.q, /q\.status = \?/);
    assert.equal(placeholders(x), x.p.length);
    const st = stageQuery();
    assert.match(st.q, /WHERE created_by_user_id = \? AND number ~\* \?/);
    assert.deepEqual(st.p, [5, '^TSAPQOT([^A-Za-z]|$)']);
  });

  test('a bad series value is ignored, not an error', async () => {
    const r = await list('&series=' + encodeURIComponent("x'; DROP TABLE quotation;--"));
    assert.equal(r.status, 200);
    assert.ok(![listQuery(), countQuery(), stageQuery()].some((x) => /number ~\*/.test(x.q)));
  });
});
