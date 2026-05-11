import { useQuery } from '@tanstack/react-query';
import { getProducts } from '../lib/api';

export function useProducts(params: { status: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: ['products', params],
    queryFn: () => getProducts(params),
    refetchInterval: 60000
  });
}
