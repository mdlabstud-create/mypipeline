export type MetricsResponse = {
  productsFoundToday: number;
  pendingReview: number;
  publishedToday: number;
  avgMarginPct: number;
};

export type Supplier = {
  id: string;
  platform: 'aliexpress' | 'alibaba' | '1688';
  supplierUrl: string;
  priceUsd: number;
  moq: number;
  rating?: number | null;
  shippingDays?: number | null;
  supplierScore?: number | null;
  rank?: number | null;
};

export type ProductListing = {
  id: string;
  productId: string;
  supplierId: string;
  title: string;
  description: string;
  tags: string[];
  images: string[];
  costUsd: number;
  retailUsd: number;
  marginPct: number;
  status: string;
  suppliers?: Supplier[];
  source?: string | null;
  trendScore?: number | null;
};

export type ProductsResponse = {
  items: ProductListing[];
};

export type AnalyticsResponse = {
  dailyProducts: Array<{ date: string; count: number }>;
  approvalRate: number;
  avgMarginByCategory: Array<{ tag: string; avgMargin: number }>;
  sourceBreakdown: Record<string, number>;
};

export type SettingsResponse = Record<string, string>;

export type PipelineEvent = {
  id: string;
  stage: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  created_at?: string;
};

function apiAuthHeaders(): Record<string, string> {
  const token = import.meta.env.VITE_API_BEARER_TOKEN ?? 'local-dev';
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: apiAuthHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function apiSend<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getMetrics(): Promise<MetricsResponse> {
  return await apiGet<MetricsResponse>('/api/metrics');
}

export async function getProducts(params: {
  status: string;
  limit: number;
  offset: number;
}): Promise<ProductsResponse> {
  const qs = new URLSearchParams({
    status: params.status,
    limit: String(params.limit),
    offset: String(params.offset)
  });
  return await apiGet<ProductsResponse>(`/api/products?${qs.toString()}`);
}

export async function approveListing(listingId: string, reviewedBy: string): Promise<{ success: boolean }> {
  return await apiSend(`/api/products/${listingId}/approve`, 'POST', { reviewedBy });
}

export async function rejectListing(listingId: string, reviewedBy: string, reason: string): Promise<{ success: boolean }> {
  return await apiSend(`/api/products/${listingId}/reject`, 'POST', { reviewedBy, reason });
}

export async function updateListing(
  listingId: string,
  patch: Partial<{ title: string; description: string; retailUsd: number; tags: string[] }>
): Promise<ProductListing> {
  return await apiSend<ProductListing>(`/api/products/${listingId}`, 'PUT', patch);
}

export async function getSettings(): Promise<SettingsResponse> {
  return await apiGet<SettingsResponse>('/api/settings');
}

export async function updateSettings(patch: Partial<{ markupMultiplier: number }>): Promise<SettingsResponse> {
  return await apiSend<SettingsResponse>('/api/settings', 'PUT', patch);
}

export async function getAnalytics(): Promise<AnalyticsResponse> {
  return await apiGet<AnalyticsResponse>('/api/analytics');
}

export async function triggerPipeline(): Promise<{ ok: boolean }> {
  // This endpoint is protected by bearer auth (via the Vite proxy),
  // but does not require a request body.
  const res = await fetch('/api/admin/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
    body: '{}'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { ok: boolean };
}
