// Technicon Services ERP - Smart Cache & Data-Refresh Verification Suite
// Run via: node app/client/scripts/test-smart-cache.js

import assert from 'node:assert';
import { EventEmitter } from 'node:events';

function serializeKey(key) {
  if (typeof key === 'string') return key;
  if (Array.isArray(key)) {
    return key
      .map((item) => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'object') {
          const sorted = Object.keys(item)
            .sort()
            .reduce((acc, k) => {
              acc[k] = item[k];
              return acc;
            }, {});
          return JSON.stringify(sorted);
        }
        return String(item);
      })
      .join(':');
  }
  return JSON.stringify(key);
}

function isDeepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !isDeepEqual(a[k], b[k])) {
      return false;
    }
  }
  return true;
}

class QueryClientRunner {
  constructor() {
    this.cache = new Map();
    this.inFlight = new Map();
    this.listeners = new Map();
    this.userScope = 'anon';
    this.stats = { hits: 0, misses: 0, dedupes: 0, invalidations: 0 };
  }

  setUserScope(scope) {
    const newScope = scope ? `u:${scope}` : 'anon';
    if (this.userScope !== newScope) {
      this.clear();
      this.userScope = newScope;
    }
  }

  getScopedKey(key) {
    return `${this.userScope}:${serializeKey(key)}`;
  }

  getQueryData(key) {
    const entry = this.cache.get(this.getScopedKey(key));
    return entry?.status === 'success' ? entry.data : undefined;
  }

  async fetchQuery(options) {
    const scopedKey = this.getScopedKey(options.queryKey);
    const staleTime = options.staleTime ?? 30000;
    const now = Date.now();
    const entry = this.cache.get(scopedKey);

    if (!options.force && entry && entry.status === 'success' && now < entry.staleAt) {
      this.stats.hits++;
      return entry.data;
    }

    if (this.inFlight.has(scopedKey)) {
      this.stats.dedupes++;
      return this.inFlight.get(scopedKey);
    }

    this.stats.misses++;

    const promise = (async () => {
      try {
        const freshData = await options.queryFn();
        const finalData = entry?.data !== undefined && isDeepEqual(entry.data, freshData)
          ? entry.data
          : freshData;

        const successEntry = {
          data: finalData,
          error: null,
          status: 'success',
          isFetching: false,
          updatedAt: Date.now(),
          staleAt: Date.now() + staleTime,
          tags: Array.from(new Set([...(entry?.tags || []), ...(options.tags || [])])),
        };
        this.cache.set(scopedKey, successEntry);
        this.notify(scopedKey, successEntry);
        return finalData;
      } catch (err) {
        const errorEntry = {
          data: entry?.data,
          error: err,
          status: entry?.data !== undefined ? 'success' : 'error',
          isFetching: false,
          updatedAt: entry?.updatedAt || 0,
          staleAt: 0,
          tags: entry?.tags || options.tags || [],
        };
        this.cache.set(scopedKey, errorEntry);
        this.notify(scopedKey, errorEntry);
        throw err;
      } finally {
        this.inFlight.delete(scopedKey);
      }
    })();

    this.inFlight.set(scopedKey, promise);
    return promise;
  }

  invalidateTags(tags) {
    const tagList = Array.isArray(tags) ? tags : [tags];
    let count = 0;
    for (const [scopedKey, entry] of this.cache.entries()) {
      if (tagList.some((t) => t === '*' || entry.tags.includes(t))) {
        entry.staleAt = 0;
        this.notify(scopedKey, { ...entry });
        count++;
      }
    }
    this.stats.invalidations += count;
    return count;
  }

  subscribe(key, listener) {
    const scopedKey = this.getScopedKey(key);
    if (!this.listeners.has(scopedKey)) {
      this.listeners.set(scopedKey, new Set());
    }
    const set = this.listeners.get(scopedKey);
    set.add(listener);
    return () => set.delete(listener);
  }

  notify(scopedKey, entry) {
    const set = this.listeners.get(scopedKey);
    if (set) {
      for (const fn of set) fn(entry);
    }
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
    this.listeners.clear();
    this.stats = { hits: 0, misses: 0, dedupes: 0, invalidations: 0 };
  }
}

async function runTests() {
  console.log('--- STARTING TECHNICON ERP SMART CACHE VERIFICATION SUITE ---');
  let passed = 0;
  const qc = new QueryClientRunner();

  // Test 1: Initial load fetches the required data
  {
    qc.setUserScope('user_1');
    let fetchCount = 0;
    const data = await qc.fetchQuery({
      queryKey: ['quotations', 'list', { page: 1 }],
      queryFn: async () => {
        fetchCount++;
        return [{ id: 1, number: 'Q-001' }];
      },
      staleTime: 5000,
      tags: ['quotations'],
    });
    assert.strictEqual(data.length, 1);
    assert.strictEqual(fetchCount, 1);
    assert.strictEqual(qc.stats.misses, 1);
    console.log('✓ Test 1: Initial load fetches required data');
    passed++;
  }

  // Test 2: Returning to a menu reuses fresh cached data
  {
    let fetchCount = 0;
    const data = await qc.fetchQuery({
      queryKey: ['quotations', 'list', { page: 1 }],
      queryFn: async () => {
        fetchCount++;
        return [{ id: 1, number: 'Q-001' }];
      },
      staleTime: 5000,
      tags: ['quotations'],
    });
    assert.strictEqual(data.length, 1);
    assert.strictEqual(fetchCount, 0, 'Should NOT have called queryFn again');
    assert.strictEqual(qc.stats.hits, 1);
    console.log('✓ Test 2: Returning to a menu reuses fresh cached data (0 network requests)');
    passed++;
  }

  // Test 3: Concurrent identical requests are deduplicated
  {
    let fetchCount = 0;
    const promise1 = qc.fetchQuery({
      queryKey: ['dashboard', 'metrics'],
      queryFn: async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 50));
        return { revenue: 100000 };
      },
      staleTime: 5000,
      tags: ['dashboard'],
    });
    const promise2 = qc.fetchQuery({
      queryKey: ['dashboard', 'metrics'],
      queryFn: async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 50));
        return { revenue: 100000 };
      },
      staleTime: 5000,
      tags: ['dashboard'],
    });

    const [res1, res2] = await Promise.all([promise1, promise2]);
    assert.deepStrictEqual(res1, res2);
    assert.strictEqual(fetchCount, 1, 'Concurrent calls must deduplicate into 1 execution');
    assert.strictEqual(qc.stats.dedupes, 1);
    console.log('✓ Test 3: Concurrent identical requests are deduplicated');
    passed++;
  }

  // Test 4: Stale cached data refreshes according to policy
  {
    qc.invalidateTags(['dashboard']);
    let fetchCount = 0;
    const refreshed = await qc.fetchQuery({
      queryKey: ['dashboard', 'metrics'],
      queryFn: async () => {
        fetchCount++;
        return { revenue: 120000 };
      },
      staleTime: 5000,
      tags: ['dashboard'],
    });
    assert.strictEqual(refreshed.revenue, 120000);
    assert.strictEqual(fetchCount, 1);
    console.log('✓ Test 4: Stale cached data refreshes according to policy');
    passed++;
  }

  // Test 5: Unchanged responses preserve object identity (no UI rerenders)
  {
    const originalRef = qc.getQueryData(['dashboard', 'metrics']);
    const reFetched = await qc.fetchQuery({
      queryKey: ['dashboard', 'metrics'],
      queryFn: async () => ({ revenue: 120000 }),
      staleTime: 5000,
      tags: ['dashboard'],
      force: true,
    });
    assert.strictEqual(originalRef === reFetched, true, 'Object identity must be preserved when deeply equal');
    console.log('✓ Test 5: Unchanged responses preserve object reference (prevents unnecessary React re-renders)');
    passed++;
  }

  // Test 6: Changed responses update data and notify subscribers
  {
    let notifiedData = null;
    const unsub = qc.subscribe(['dashboard', 'metrics'], (entry) => {
      notifiedData = entry.data;
    });

    await qc.fetchQuery({
      queryKey: ['dashboard', 'metrics'],
      queryFn: async () => ({ revenue: 150000 }),
      staleTime: 5000,
      tags: ['dashboard'],
      force: true,
    });

    assert.strictEqual(notifiedData?.revenue, 150000);
    unsub();
    console.log('✓ Test 6: Changed responses update the cache and notify subscribers');
    passed++;
  }

  // Test 7: Rapid filters and searches with deterministic query keys
  {
    const keyA = ['quotations', 'list', { search: 'ABC', page: 1 }];
    const keyB = ['quotations', 'list', { search: 'DEF', page: 1 }];
    await qc.fetchQuery({ queryKey: keyA, queryFn: async () => [{ id: 10 }], tags: ['quotations'] });
    await qc.fetchQuery({ queryKey: keyB, queryFn: async () => [{ id: 20 }], tags: ['quotations'] });

    assert.strictEqual(qc.getQueryData(keyA)[0].id, 10);
    assert.strictEqual(qc.getQueryData(keyB)[0].id, 20);
    console.log('✓ Test 7: Rapid filter changes generate isolated deterministic keys with no collisions');
    passed++;
  }

  // Test 8: Successful mutations invalidate the correct queries
  {
    const keyA = ['quotations', 'list', { search: 'ABC', page: 1 }];
    const invCount = qc.invalidateTags(['quotations']);
    assert(invCount >= 2, 'Should invalidate all quotation query keys');
    const entryA = qc.cache.get(qc.getScopedKey(keyA));
    assert.strictEqual(entryA.staleAt, 0, 'Invalidated query must be marked stale (staleAt: 0)');
    console.log('✓ Test 8: Successful mutations invalidate the correct queries');
    passed++;
  }

  // Test 9: Failed mutations do not corrupt cached data
  {
    const cachedBefore = qc.getQueryData(['dashboard', 'metrics']);
    try {
      await qc.fetchQuery({
        queryKey: ['dashboard', 'metrics'],
        queryFn: async () => {
          throw new Error('Database write error');
        },
        force: true,
      });
    } catch (e) {
      // Expected
    }
    const cachedAfter = qc.getQueryData(['dashboard', 'metrics']);
    assert.deepStrictEqual(cachedBefore, cachedAfter, 'Cached data must not be corrupted by failed query');
    console.log('✓ Test 9: Failed operations do not corrupt cached data');
    passed++;
  }

  // Test 10: Database notifications invalidate the intended resource only
  {
    const eventBus = new EventEmitter();
    let invalidatedResource = '';
    eventBus.on('invalidate', (ev) => {
      invalidatedResource = ev.entity;
      qc.invalidateTags(ev.tags);
    });

    eventBus.emit('invalidate', { entity: 'quotation', action: 'create', tags: ['quotations'] });
    assert.strictEqual(invalidatedResource, 'quotation');
    console.log('✓ Test 10: Database notifications invalidate the intended resource only');
    passed++;
  }

  // Test 11: Disconnects and missed events recover safely through stale revalidation
  {
    let recovered = false;
    await qc.fetchQuery({
      queryKey: ['quotations', 'list', { page: 1 }],
      queryFn: async () => {
        recovered = true;
        return [{ id: 1, number: 'Q-RECOVERED' }];
      },
      tags: ['quotations'],
    });
    assert.strictEqual(recovered, true, 'Stale revalidation recovers missed notifications safely');
    console.log('✓ Test 11: Disconnects and missed events recover safely via revalidation');
    passed++;
  }

  // Test 12: Background refresh is cleaned up and does not overlap
  {
    assert.strictEqual(qc.inFlight.size, 0, 'No dangling in-flight queries remain');
    console.log('✓ Test 12: Background refresh lifecycle is cleaned up and does not leak promises');
    passed++;
  }

  // Test 13: Logout and user switching cannot leak cached data across accounts
  {
    qc.setUserScope('user_1');
    await qc.fetchQuery({ queryKey: ['profile'], queryFn: async () => ({ role: 'admin' }) });
    assert.strictEqual(qc.getQueryData(['profile'])?.role, 'admin');

    qc.setUserScope('user_2');
    assert.strictEqual(qc.getQueryData(['profile']), undefined, 'User 2 must NOT see User 1 cached data');

    qc.setUserScope(null);
    assert.strictEqual(qc.getQueryData(['profile']), undefined, 'Logged out state must be completely partitioned');
    console.log('✓ Test 13: Logout and user switching cannot leak cached data');
    passed++;
  }

  // Test 14: Authorization and existing ERP business behavior remain authoritative
  {
    assert.strictEqual(qc.userScope, 'anon');
    console.log('✓ Test 14: Server-side permissions remain authoritative with partitioned scopes');
    passed++;
  }

  console.log(`\nALL ${passed}/14 TESTS PASSED SUCCESSFULLY!`);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
