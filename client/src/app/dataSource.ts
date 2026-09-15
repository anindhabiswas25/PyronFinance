import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { readEnv, resolveDataSource, type DataSource } from '../config/env';

export function useDataSource(): DataSource {
  const { search } = useLocation();
  return useMemo(() => resolveDataSource(search, readEnv()), [search]);
}
