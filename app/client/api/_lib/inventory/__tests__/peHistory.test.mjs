// Tests for reading the PE stock workbook. Run with:  npm --prefix app/client run test:inventory
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
const { sheetMonth, findDayRuns, readSheet, summarise } = await import('../peHistory.js');

const days = (n) => Array.from({ length: n }, (_, i) => i + 1);
// columns: 0 Part No, 1 Description, 2 Balance, 3.. in days (30), 33 Instock, 34.. out days (30), 64 Outstock
const header = ['Part No', 'Discription/Material', 'October', ...days(30), 'Instock', ...days(30), 'Outstock'];
const row = (part, bal, ins = {}, outs = {}) => {
  const r = [part, 'Thing', bal, ...days(30).map((d) => ins[d] ?? null), null, ...days(30).map((d) => outs[d] ?? null), null];
  return r;
};

describe('sheetMonth', () => {
  test('the different sheet names', () => {
    assert.deepEqual(sheetMonth('Nov-2026'), { year: 2026, month: 11 });
    assert.deepEqual(sheetMonth('June 26'), { year: 2026, month: 6 });
    assert.deepEqual(sheetMonth('January 26'), { year: 2026, month: 1 });
    assert.equal(sheetMonth('Summary'), null);
  });
});

describe('readSheet', () => {
  test('in and out blocks are found by their day numbers', () => {
    assert.equal(findDayRuns([header]).length, 2);
    const s = readSheet([['Consumables'], header, row('A1', 1, { 4: 5 }, { 6: 3 }), row('B2', 0), [null]], 'Nov-2026');
    assert.equal(s.lines.length, 2);
    assert.deepEqual(s.lines[0].moves, [{ day: 4, type: 'IN', qty: 5 }, { day: 6, type: 'OUT', qty: 3 }]);
    assert.equal(s.lines[0].opening, 1);
    assert.equal(s.lines[0].description, 'Thing');
  });
  test('day numbers on the first row and labels on the second still work', () => {
    const top = [null, null, null, ...days(30), null, ...days(30)];
    const labels = ['Part No', 'Discription', 'August'];
    const s = readSheet([top, labels, row('A1', 0, { 2: 1 }, { 3: 1 })], 'Sep-2026');
    assert.equal(s.problem, null);
    assert.equal(s.lines[0].moves.length, 2);
  });
  test('formula results and text numbers are read; blanks and words are not movements', () => {
    const r = row('A1', 0);
    r[3 + 1] = { formula: 'x', result: 2 };
    r[3 + 2] = '4';
    r[3 + 3] = 'n/a';
    const s = readSheet([header, r], 'Nov-2026');
    assert.deepEqual(s.lines[0].moves.map((m) => m.qty), [2, 4]);
  });
  test('a sheet without the blocks is reported, not guessed', () => {
    assert.match(readSheet([['Part No', 'x']], 'Nov-2026').problem, /expected an in block/);
  });
  test('summary adds up per month', () => {
    const s = readSheet([header, row('A1', 0, { 1: 5 }, { 2: 3 })], 'Nov-2026');
    const [t] = summarise([s]);
    assert.equal(t.inUnits, 5);
    assert.equal(t.outUnits, 3);
    assert.equal(t.partsThatMoved, 1);
  });
});
