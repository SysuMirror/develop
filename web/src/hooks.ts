import { useEffect, useState } from 'react';
import { api, messageOf, qs } from './api';
import type { DemandItem, Paged } from './types';

export const DEMAND_PAGE_SIZE = 100;
export const DEMAND_MAX_PAGES = 5;

export function timeOf(value: string | null | undefined): number {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

export function sortByTimeDesc<T>(items: T[], at: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => timeOf(at(b)) - timeOf(at(a)));
}

export function latest<T>(items: T[], at: (item: T) => string | null | undefined, limit: number): T[] {
  return sortByTimeDesc(items, at).slice(0, limit);
}

export interface DemandFeedState {
  items: DemandItem[];
  total: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export interface DemandFeed extends DemandFeedState {
  reload: () => void;
}

// 需求列表没有「按接单人」「按完成时间」的筛选参数，只能分页拉回来在前端切。
// 每页 100 条（接口上限），最多翻 DEMAND_MAX_PAGES 页，避免打开页面就发出无界请求。
export function useDemandFeed(): DemandFeed {
  const [state, setState] = useState<DemandFeedState>({
    items: [],
    total: 0,
    truncated: false,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    (async () => {
      const collected: DemandItem[] = [];
      let total = 0;
      for (let page = 1; page <= DEMAND_MAX_PAGES; page += 1) {
        const data = await api.get<Paged<DemandItem>>(`/demands${qs({ page, pageSize: DEMAND_PAGE_SIZE })}`);
        total = data.total;
        collected.push(...data.items);
        if (data.items.length === 0 || collected.length >= total) break;
      }
      if (alive) {
        setState({
          items: collected,
          total,
          truncated: collected.length < total,
          loading: false,
          error: null,
        });
      }
    })().catch((error: unknown) => {
      if (alive) {
        setState({ items: [], total: 0, truncated: false, loading: false, error: messageOf(error) });
      }
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  return { ...state, reload: () => setTick((value) => value + 1) };
}

export interface UseApiResult<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(path: string): UseApiResult<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    api
      .get<T>(path)
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (alive) setState({ data: null, error: error instanceof Error ? error : new Error(String(error)), loading: false });
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { ...state, reload: () => setTick((value) => value + 1) };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
