// Tests for the quick entry of incoming stock. Run with:  npm --prefix app/client run test:inventory
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { normalizePart, parseQuickLines, matchLines, previewQuickEntry, MAX_LINES } = await import('../quickEntry.js');
const { default: db } = await import('../../db/index.js');

describe('normalizePart', () => {
  test('case, spaces, dashes and leading zeros do not matter', () => {
    assert.equal(normalizePart('09923536'), '9923536');
    assert.equal(normalizePart('9923536'), '9923536');
    assert.equal(normalizePart(' n-8152 473 '), 'N8152473');
    assert.equal(normalizePart('0'), '');
    assert.equal(normalizePart(null), '');
  });
});

describe('parseQuickLines', () => {
  test('tab, comma, semicolon and space separated lines; quantity last; an x or × before it is fine', () => {
    const { lines, problems } = parseQuickLines('N8152473\t5\n00473550, 2\n09923536;10\nB0143019 x3\nN0776090 Baffled Cyclonic 4mm 1.5\nN9308265 ×2');
    assert.deepEqual(lines.map((l) => [l.part, l.qty]), [['N8152473', 5], ['00473550', 2], ['09923536', 10], ['B0143019', 3], ['N0776090', 1.5], ['N9308265', 2]]);
    assert.deepEqual(problems, []);
  });

  test('headings and blank lines are ignored; a line with no quantity or a bad one is reported, not guessed', () => {
    const { lines, problems } = parseQuickLines('Part No\tQty\n\nN8152473\n09923536 0\n00473550 -2\nN0770610 4');
    assert.deepEqual(lines.map((l) => l.part), ['N0770610']);
    assert.deepEqual(problems.map((p) => [p.line, p.problem]), [[3, 'no quantity'], [4, 'bad quantity'], [5, 'no quantity']]);
  });

  test('the same part on two lines (even typed with and without the leading zero) is added up', () => {
    const { lines } = parseQuickLines('09923536 4\n9923536 6\nN8152473 1');
    assert.equal(lines.length, 2);
    assert.deepEqual([lines[0].part, lines[0].qty, lines[0].merged], ['09923536', 10, 1]);
  });

  test('Windows line endings, quotes and a long list', () => {
    assert.deepEqual(parseQuickLines('"N8152473","5"\r\n"09923536","2"\r\n').lines.map((l) => [l.part, l.qty]), [['N8152473', 5], ['09923536', 2]]);
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => `P${i + 1} 1`).join('\n');
    assert.throws(() => parseQuickLines(many), (e) => e.status === 400 && /at most 500/.test(e.message));
    assert.throws(() => parseQuickLines('x'.repeat(70000)), (e) => e.status === 400);
  });
});

describe('matchLines', () => {
  const P = (id, part_no) => ({ id, part_no, description: `d${id}`, unit: 'Nos', make: null });
  const byKey = new Map([['9923536', [P(1, '09923536')]], ['473550', [P(2, '00473550'), P(3, '473550')]], ['X1', [P(4, 'X-1'), P(5, 'X1.')]]]);
  const run = (text) => matchLines(parseQuickLines(text).lines, byKey);

  test('one product: matched, even without the leading zero', () => {
    const r = run('9923536 5');
    assert.deepEqual([r[0].status, r[0].product.id], ['matched', 1]);
  });
  test('several products: the one with exactly that part number wins; otherwise it is ambiguous', () => {
    assert.deepEqual(run('473550 1').map((x) => [x.status, x.product?.id]), [['matched', 3]]);
    assert.deepEqual(run('00473550 1').map((x) => [x.status, x.product?.id]), [['matched', 2]]);
    const amb = run('x1 1')[0];
    assert.equal(amb.status, 'ambiguous');
    assert.deepEqual(amb.candidates.map((c) => c.id), [4, 5]);
  });
  test('unknown parts are reported as not found', () => {
    assert.equal(run('ZZZ999 3')[0].status, 'not_found');
  });
});

describe('previewQuickEntry with a fake database', () => {
  let params;
  beforeEach(() => {
    db.prepare = (sql) => ({
      all: async (...p) => {
        params = p;
        assert.equal((sql.replace(/'[^']*'/g, '').match(/\?/g) || []).length, p.length, 'parameter count');
        return [{ id: 1, part_no: '09923536', description: 'PVC Tubing', unit: 'Nos', make: 'PerkinElmer' }, { id: 2, part_no: 'N8152473', description: 'Quartz', unit: 'Nos', make: 'PerkinElmer' }];
      },
    });
  });

  test('lines are matched and counted; the part numbers go to the database as one bound array', async () => {
    const r = await previewQuickEntry('9923536 5\nN8152473, 2\nUNKNOWN1 4\nBAD123');
    assert.deepEqual(r.summary, { lines: 3, matched: 2, ambiguous: 0, not_found: 1, units: 11 });
    assert.deepEqual(r.lines.map((l) => [l.part, l.status]), [['9923536', 'matched'], ['N8152473', 'matched'], ['UNKNOWN1', 'not_found']]);
    assert.deepEqual(r.problems.map((p) => p.problem), ['no quantity']);
    assert.deepEqual(params, ['{"9923536","N8152473","UNKNOWN1"}']);
  });

  test('a hostile line cannot reach the SQL: part numbers are reduced to letters and digits first', async () => {
    await previewQuickEntry(`X'); DROP TABLE product;-- 5`);
    assert.ok(!String(params[0]).includes('DROP TABLE'), 'only A-Z and 0-9 are sent');
    assert.match(String(params[0]), /^\{"[A-Z0-9]+"\}$/);
  });

  test('nothing pasted: nothing is queried', async () => {
    params = undefined;
    const r = await previewQuickEntry('   \n');
    assert.equal(params, undefined);
    assert.deepEqual(r.summary, { lines: 0, matched: 0, ambiguous: 0, not_found: 0, units: 0 });
  });
});
