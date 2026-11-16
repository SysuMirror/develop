import { useEffect, useState } from 'react';
import { api } from './api.js';

export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    api
      .get(path)
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (alive) setState({ data: null, error, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { ...state, reload: () => setTick((value) => value + 1) };
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
