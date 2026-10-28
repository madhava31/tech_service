// Technicon ERP Smart Shared Query & Cache Engine
// Provides deterministic query keys, user-scoped partitioning, in-flight deduplication,
// configurable TTL & stale-while-revalidate, structural equality comparison, and tag-based invalidation.

export type QueryKey = string | readonly unknown[];

// After a failed fetch, the entry counts as fresh for this long so subscribers do not hammer a failing
// endpoint (e.g. while the database pooler is saturated).
const ERROR_RETRY_DELAY_MS = 10000;

export function serializeKey(key: QueryKey): string {
  if (typeof key === 'string') return key;
  if (Array.isArray(key)) {
    return key
      .map((item) => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'object') {
          const sorted = Object.keys(item)
            .sort()
            .reduce((acc, k) => {
              acc[k] = (item as Record<string, unknown>)[k];
              return acc;
            }, {} as Record<string, unknown>);
          return JSON.stringify(sorted);
        }
        return String(item);
      })
      .join(':');
  }
  return JSON.stringify(key);
}

export function isDeepEqual(a: any, b: any): boolean {
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

export interface QueryEntry<T = any> {
  data?: T;
  error?: Error | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  isFetching: boolean;
  updatedAt: number;
  staleAt: number;
  tags: string[];
}

export type QueryListener<T = any> = (entry: QueryEntry<T>) => void;

export interface QueryFetchOptions<T = any> {
  queryKey: QueryKey;
  queryFn: (signal?: AbortSignal) => Promise<T>;
  staleTime?: number; // ms during which data is fresh (default 30,000ms)
  cacheTime?: number; // ms before garbage collected if unused (default 300,000ms)
  tags?: string[];
  force?: boolean; // bypass fresh check and refetch
}

export class QueryClient {
  private cache = new Map<string, QueryEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Map<string, Set<QueryListener<any>>>();
  private gcTimers = new Map<string, NodeJS.Timeout>();
  private userScope: string = 'anon';

  public stats = {
    hits: 0,
    misses: 0,
    dedupes: 0,
    invalidations: 0,
  };

  public setUserScope(scope: string | number | null | undefined) {
    const newScope = scope ? `u:${scope}` : 'anon';
    if (this.userScope !== newScope) {
      // Partition boundary change: clear previous session cache completely to avoid cross-user data leakage
      this.clear();
      this.userScope = newScope;
    }
  }

  public getScopedKey(key: QueryKey): string {
    const raw = serializeKey(key);
    return `${this.userScope}:${raw}`;
  }

  public getQueryData<T>(key: QueryKey): T | undefined {
    const scopedKey = this.getScopedKey(key);
    const entry = this.cache.get(scopedKey);
    return entry?.status === 'success' ? (entry.data as T) : undefined;
  }

  public getQueryEntry<T>(key: QueryKey): QueryEntry<T> | undefined {
    const scopedKey = this.getScopedKey(key);
    return this.cache.get(scopedKey);
  }

  public setQueryData<T>(key: QueryKey, data: T | ((prev: T | undefined) => T), tags: string[] = []): void {
    const scopedKey = this.getScopedKey(key);
    const existing = this.cache.get(scopedKey);
    const newData = typeof data === 'function' ? (data as any)(existing?.data) : data;

    // Use structural equality: if data is identical, keep existing reference
    if (existing && existing.status === 'success' && isDeepEqual(existing.data, newData)) {
      return;
    }

    const updatedEntry: QueryEntry<T> = {
      data: newData,
      error: null,
      status: 'success',
      isFetching: false,
      updatedAt: Date.now(),
      staleAt: Date.now() + 30000,
      tags: Array.from(new Set([...(existing?.tags || []), ...tags])),
    };

    this.cache.set(scopedKey, updatedEntry);
    this.notify(scopedKey, updatedEntry);
  }

  public async fetchQuery<T>(options: QueryFetchOptions<T>): Promise<T> {
    const scopedKey = this.getScopedKey(options.queryKey);
    const staleTime = options.staleTime ?? 30000;
    const now = Date.now();
    const entry = this.cache.get(scopedKey);

    // Cancel any scheduled garbage collection
    if (this.gcTimers.has(scopedKey)) {
      clearTimeout(this.gcTimers.get(scopedKey)!);
      this.gcTimers.delete(scopedKey);
    }

    // 1. Fresh Cache Hit
    if (!options.force && entry && entry.status === 'success' && now < entry.staleAt) {
      this.stats.hits++;
      return entry.data as T;
    }

    // 2. Request Deduplication: if an identical query is already in-flight, return the existing Promise
    if (this.inFlight.has(scopedKey)) {
      this.stats.dedupes++;
      return this.inFlight.get(scopedKey)!;
    }

    this.stats.misses++;

    // Prepare AbortController
    const controller = new AbortController();
    this.abortControllers.set(scopedKey, controller);

    // Update state to fetching
    const fetchingEntry: QueryEntry<T> = {
      data: entry?.data,
      error: entry?.error || null,
      status: entry?.data !== undefined ? 'success' : 'loading',
      isFetching: true,
      updatedAt: entry?.updatedAt || 0,
      staleAt: entry?.staleAt || 0,
      tags: Array.from(new Set([...(entry?.tags || []), ...(options.tags || [])])),
    };
    this.cache.set(scopedKey, fetchingEntry);

    const promise = (async () => {
      // Start the request only after inFlight is registered below, even if queryFn throws synchronously.
      await Promise.resolve();
      try {
        const freshData = await options.queryFn(controller.signal);

        // Structural equality check: if fresh data is deeply equal to existing cached data,
        // preserve the exact existing object reference so React components do not re-render!
        const finalData = entry?.data !== undefined && isDeepEqual(entry.data, freshData)
          ? entry.data
          : freshData;

        const successEntry: QueryEntry<T> = {
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
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          // Query was aborted, return cached data if available
          return entry?.data as T;
        }

        const errorEntry: QueryEntry<T> = {
          data: entry?.data,
          error: err instanceof Error ? err : new Error(String(err)),
          status: entry?.data !== undefined ? 'success' : 'error',
          isFetching: false,
          updatedAt: entry?.updatedAt || 0,
          // staleAt 0 means "invalidated, refetch now" to subscribers, which turned a failing endpoint
          // into an immediate retry loop. Back off instead; polling, focus or navigation retries later.
          staleAt: Date.now() + ERROR_RETRY_DELAY_MS,
          tags: entry?.tags || options.tags || [],
        };

        this.cache.set(scopedKey, errorEntry);
        this.notify(scopedKey, errorEntry);
        throw err;
      } finally {
        this.inFlight.delete(scopedKey);
        this.abortControllers.delete(scopedKey);
      }
    })();

    // Register the in-flight promise BEFORE notifying: subscribers may react to this notification by
    // calling fetchQuery again synchronously, and that call must be deduplicated onto this request.
    // Notifying first caused unbounded re-entrant fetches (a request storm) after any invalidation.
    this.inFlight.set(scopedKey, promise);
    this.notify(scopedKey, fetchingEntry);
    return promise;
  }

  public getActiveSubscribers(key: QueryKey): number {
    const scopedKey = this.getScopedKey(key);
    return this.listeners.get(scopedKey)?.size || 0;
  }

  public cancelQuery(key: QueryKey, force = false): boolean {
    const scopedKey = this.getScopedKey(key);
    const activeSubscribers = this.listeners.get(scopedKey)?.size || 0;

    // Avoid aborting a shared in-flight request while another active subscriber still needs it unless forced
    if (!force && activeSubscribers > 0) {
      return false;
    }

    const controller = this.abortControllers.get(scopedKey);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(scopedKey);
      this.inFlight.delete(scopedKey);
      return true;
    }
    this.inFlight.delete(scopedKey);
    return false;
  }

  public invalidateKey(key: QueryKey): void {
    const scopedKey = this.getScopedKey(key);
    const entry = this.cache.get(scopedKey);
    if (entry) {
      entry.staleAt = 0; // Mark stale immediately
      this.notify(scopedKey, { ...entry });
      this.stats.invalidations++;
    }
  }

  public invalidateTags(tags: string[] | string): number {
    const tagList = Array.isArray(tags) ? tags : [tags];
    let invalidatedCount = 0;

    for (const [scopedKey, entry] of this.cache.entries()) {
      const matches = tagList.some((t) => t === '*' || entry.tags.includes(t));
      if (matches) {
        entry.staleAt = 0; // Mark stale immediately
        this.notify(scopedKey, { ...entry });
        invalidatedCount++;
      }
    }

    this.stats.invalidations += invalidatedCount;
    return invalidatedCount;
  }

  public subscribe<T>(key: QueryKey, listener: QueryListener<T>): () => void {
    const scopedKey = this.getScopedKey(key);
    if (!this.listeners.has(scopedKey)) {
      this.listeners.set(scopedKey, new Set());
    }
    const set = this.listeners.get(scopedKey)!;
    set.add(listener);

    // Cancel garbage collection timer if active
    if (this.gcTimers.has(scopedKey)) {
      clearTimeout(this.gcTimers.get(scopedKey)!);
      this.gcTimers.delete(scopedKey);
    }

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(scopedKey);
        // Schedule garbage collection after 5 minutes of no subscribers
        const timer = setTimeout(() => {
          this.cache.delete(scopedKey);
          this.gcTimers.delete(scopedKey);
        }, 300000);
        this.gcTimers.set(scopedKey, timer);
      }
    };
  }

  private notify(scopedKey: string, entry: QueryEntry<any>): void {
    const set = this.listeners.get(scopedKey);
    if (set) {
      for (const listener of set) {
        listener(entry);
      }
    }
  }

  public clear(): void {
    // Abort all in-flight queries
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.inFlight.clear();

    for (const timer of this.gcTimers.values()) {
      clearTimeout(timer);
    }
    this.gcTimers.clear();

    this.cache.clear();
    this.listeners.clear();
    this.stats = { hits: 0, misses: 0, dedupes: 0, invalidations: 0 };
  }
}

// Global Singleton Query Client Instance
export const queryClient = new QueryClient();
export default queryClient;
