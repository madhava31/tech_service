import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { queryClient, QueryKey, QueryEntry } from './queryClient';

export interface UseQueryOptions<T> {
  queryKey: QueryKey;
  queryFn: (signal?: AbortSignal) => Promise<T>;
  staleTime?: number; // ms, default 30,000ms
  cacheTime?: number; // ms, default 300,000ms
  tags?: string[];
  enabled?: boolean;
  refetchInterval?: number; // ms interval for background refresh
  refetchOnWindowFocus?: boolean; // default true
  initialData?: T;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  isFetching: boolean;
  isStale: boolean;
  refetch: (force?: boolean) => Promise<T | undefined>;
}

export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const {
    queryKey,
    queryFn,
    staleTime = 30000,
    cacheTime = 300000,
    tags = [],
    enabled = true,
    refetchInterval,
    refetchOnWindowFocus = true,
    initialData,
  } = options;

  // Stable reference to options functions
  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  // Retrieve current cache entry synchronously on mount/render
  const existingEntry = queryClient.getQueryEntry<T>(queryKey);

  const [state, setState] = useState<QueryEntry<T>>(() => {
    if (existingEntry) {
      return existingEntry;
    }
    return {
      data: initialData,
      error: null,
      status: initialData !== undefined ? 'success' : 'idle',
      isFetching: false,
      updatedAt: 0,
      staleAt: 0,
      tags,
    };
  });

  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  // Execute fetch through shared client
  const executeFetch = useCallback(
    async (force = false): Promise<T | undefined> => {
      if (!enabled) return undefined;
      try {
        return await queryClient.fetchQuery<T>({
          queryKey: queryKeyRef.current,
          queryFn: (signal) => queryFnRef.current(signal),
          staleTime,
          cacheTime,
          tags,
          force,
        });
      } catch (err) {
        // Error is captured in QueryEntry and propagated via subscription
        return undefined;
      }
    },
    [enabled, staleTime, cacheTime, tags]
  );

  // Subscribe to query client updates for this query key
  useEffect(() => {
    const unsubscribe = queryClient.subscribe<T>(queryKey, (newEntry) => {
      setState((prev) => {
        // Avoid state update if exact same object or status
        if (
          prev.data === newEntry.data &&
          prev.status === newEntry.status &&
          prev.isFetching === newEntry.isFetching &&
          prev.staleAt === newEntry.staleAt
        ) {
          return prev;
        }
        return newEntry;
      });

      // If marked stale while mounted, automatically revalidate in background
      if (newEntry.staleAt === 0 && !newEntry.isFetching && enabled) {
        executeFetch(true);
      }
    });

    return unsubscribe;
  }, [queryKey, enabled, executeFetch]);

  // Initial mount or key change effect
  useEffect(() => {
    if (!enabled) return;

    const current = queryClient.getQueryEntry<T>(queryKey);
    const isCurrentlyStale = !current || current.status !== 'success' || Date.now() >= current.staleAt;

    if (isCurrentlyStale) {
      executeFetch(false);
    }
  }, [queryKey, enabled, executeFetch]);

  // Background refresh interval with tab visibility detection
  useEffect(() => {
    if (!refetchInterval || refetchInterval <= 0 || !enabled) return;

    const timer = setInterval(() => {
      // Pause refresh if document is hidden to conserve bandwidth and DB capacity
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      executeFetch(true);
    }, refetchInterval);

    return () => clearInterval(timer);
  }, [refetchInterval, enabled, executeFetch]);

  // Window focus revalidation
  useEffect(() => {
    if (!refetchOnWindowFocus || !enabled) return;

    const onFocus = () => {
      const current = queryClient.getQueryEntry<T>(queryKeyRef.current);
      if (current && Date.now() >= current.staleAt) {
        executeFetch(false);
      }
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetchOnWindowFocus, enabled, executeFetch]);

  const isStale = useMemo(() => {
    return !state.updatedAt || Date.now() >= state.staleAt;
  }, [state.updatedAt, state.staleAt]);

  const loading = state.status === 'loading' || (state.status === 'idle' && enabled && !state.data);

  return {
    data: state.data,
    error: state.error || null,
    loading,
    isFetching: state.isFetching,
    isStale,
    refetch: executeFetch,
  };
}

export interface UseMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables) => void | Promise<void>;
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void | Promise<void>;
  invalidateTags?: string[];
}

export interface UseMutationResult<TData, TVariables> {
  mutate: (variables: TVariables) => Promise<TData>;
  loading: boolean;
  error: Error | null;
  data: TData | undefined;
  reset: () => void;
}

export function useMutation<TData = unknown, TVariables = void>(
  options: UseMutationOptions<TData, TVariables>
): UseMutationResult<TData, TVariables> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TData | undefined>(undefined);

  const mutate = useCallback(
    async (variables: TVariables): Promise<TData> => {
      // Prevent concurrent duplicate executions of the exact same mutation instance
      if (loading) {
        throw new Error('A mutation is already in progress.');
      }

      setLoading(true);
      setError(null);

      try {
        const result = await options.mutationFn(variables);
        setData(result);

        if (options.invalidateTags && options.invalidateTags.length > 0) {
          queryClient.invalidateTags(options.invalidateTags);
        }

        if (options.onSuccess) {
          await options.onSuccess(result, variables);
        }
        if (options.onSettled) {
          await options.onSettled(result, null, variables);
        }
        return result;
      } catch (err: any) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);

        if (options.onError) {
          await options.onError(errorObj, variables);
        }
        if (options.onSettled) {
          await options.onSettled(undefined, errorObj, variables);
        }
        throw errorObj;
      } finally {
        setLoading(false);
      }
    },
    [loading, options]
  );

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(undefined);
  }, []);

  return { mutate, loading, error, data, reset };
}

export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
