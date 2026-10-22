// Antigravity In-Memory Cache Engine for High-Performance API Responses
// Provides explicit TTLs, concurrent in-flight request deduplication,
// and granular tag-based mutation invalidation.

class ApiCache {
  constructor() {
    this.store = new Map();
    this.inFlight = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0,
    };
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.data;
  }

  delete(key) {
    return this.store.delete(key);
  }

  set(key, data, ttlSeconds = 30, tags = []) {
    // Bound memory growth by pruning expired items or oldest entry when size exceeds 1,000
    if (this.store.size >= 1000) {
      const now = Date.now();
      for (const [k, v] of this.store.entries()) {
        if (now > v.expiresAt) {
          this.store.delete(k);
        }
      }
      if (this.store.size >= 1000) {
        const firstKey = this.store.keys().next().value;
        if (firstKey) this.store.delete(firstKey);
      }
    }

    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
      tags: Array.isArray(tags) ? tags : [tags],
    });
  }

  invalidateTag(tag) {
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.tags.includes(tag) || tag === '*') {
        this.store.delete(key);
        count++;
      }
    }
    this.stats.invalidations += count;
    return count;
  }

  invalidateTags(tags) {
    for (const tag of tags) {
      this.invalidateTag(tag);
    }
  }

  // Deduplicates concurrent identical async database queries
  async fetchOrCompute(key, computeFn, ttlSeconds = 30, tags = []) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        const data = await computeFn();
        this.set(key, data, ttlSeconds, tags);
        return data;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  getStats() {
    return {
      ...this.stats,
      size: this.store.size,
      hitRate: this.stats.hits + this.stats.misses > 0 
        ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 1000) / 10 
        : 0,
    };
  }

  clear() {
    this.store.clear();
    this.inFlight.clear();
  }
}

export const apiCache = new ApiCache();
export default apiCache;
