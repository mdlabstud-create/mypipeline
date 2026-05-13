export type TrendingProductSource = 'tiktok' | 'amazon' | 'both';
export type ViabilityStatus = 'unchecked' | 'viable' | 'marginal' | 'rejected';
export type SlaStatus = 'unknown' | 'fast' | 'acceptable' | 'slow' | 'disqualified';
export type AdCreativeStatus = 'draft' | 'approved' | 'used';
export type TrendingProductStatus =
  | 'pending_research'
  | 'researching'
  | 'pending_content'
  | 'generating'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'duplicate'
  | 'error';

/**
 * DB model: trending_products.
 */
export interface TrendingProduct {
  id: string;
  keyword: string;
  source: TrendingProductSource;
  tiktokScore?: number | null;
  tiktokViews?: number | null;
  tiktokHashtag?: string | null;
  /** TikTok scrape-time retail when payload or caption exposes a USD price */
  tiktokRetailUsd?: number | null;
  amazonAsin?: string | null;
  amazonBsr?: number | null;
  amazonScore?: number | null;
  /** Amazon scrape-time retail when Scrapingdog returns a price */
  amazonRetailUsd?: number | null;
  trendScore: number;
  status: TrendingProductStatus;
  createdAt: string;
  updatedAt: string;
}

export type SupplierPlatform = 'aliexpress' | 'alibaba' | '1688' | 'amazon';

/**
 * DB model: suppliers.
 */
export interface Supplier {
  id: string;
  productId: string;
  platform: SupplierPlatform;
  supplierUrl: string;
  productTitle?: string | null;
  priceUsd: number;
  priceCny?: number | null;
  moq: number;
  rating?: number | null;
  reviewCount?: number | null;
  shippingDays?: number | null;
  fastShip?: boolean | null;
  supplierScore?: number | null;
  images: unknown[];
  vetted: boolean;
  rank?: number | null;
  createdAt: string;
}

/**
 * Research-time supplier candidate (not yet persisted).
 */
export interface SupplierCandidate {
  platform: SupplierPlatform;
  supplierUrl: string;
  productTitle?: string | null;
  priceUsd: number;
  priceCny?: number | null;
  moq: number;
  rating?: number | null;
  reviewCount?: number | null;
  shippingDays?: number | null;
  fastShip?: boolean | null;
  images: string[];
}

export type ProductListingStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'duplicate'
  | 'error'
  | 'superseded';

/**
 * DB model: product_listings.
 */
export interface ProductListing {
  id: string;
  productId: string;
  supplierId: string;
  title: string;
  description: string;
  bulletPoints: string[];
  tags: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  images: string[];
  costUsd: number;
  retailUsd: number;
  marginPct: number;
  shopifyId?: string | null;
  shopifyHandle?: string | null;
  status: ProductListingStatus;
  reviewNotes?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PipelineEventStatus = 'ok' | 'warn' | 'error';

/**
 * DB model: pipeline_events.
 */
export interface PipelineEvent {
  id: string;
  stage: string;
  status: PipelineEventStatus;
  message: string;
  productId?: string | null;
  payload?: unknown;
  createdAt: string;
}

/**
 * Raw TikTok item shape after parsing.
 */
export interface TikTokRawProduct {
  id: string;
  desc: string;
  playCount: number;
  /** Parsed from actor payload commerce fields or `$X.XX` in caption when present */
  tiktokRetailUsd?: number;
  diggCount?: number;
  shareCount?: number;
  commentCount?: number;
  author?: string;
  url?: string;
}

/**
 * Raw Amazon item shape after parsing.
 */
export interface AmazonRawProduct {
  asin: string;
  title: string;
  price?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  bestSellerRank: number;
  imageUrl?: string | null;
}

/**
 * Validated JSON output from GPT content generation.
 */
export interface GPTListingOutput {
  title: string;
  description: string;
  bullet_points: string[];
  tags: string[];
  seo_title: string;
  seo_description: string;
}

/**
 * Product input shape used to create products via Shopify GraphQL.
 */
export interface ShopifyProductInput {
  title: string;
  descriptionHtml: string;
  tags: string[];
  images: Array<{ src: string }>;
  seo?: { title?: string; description?: string };
}

/**
 * Normalized line item from a Shopify orders/create webhook.
 * Each item points at a Shopify product (which we'll map to one of our
 * `product_listings` rows, and from there to a supplier).
 */
export interface IncomingOrderLineItem {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
}

/**
 * Normalized shipping address for the AliExpress place-order request.
 * Snake-case match to AE API to keep mapping straightforward.
 */
export interface ShippingAddress {
  fullName: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  zip: string;
  country: string; // ISO-3166 alpha-2 (e.g. "US")
  phone: string;
  phoneCountry: string | null; // dialing prefix without "+", e.g. "1"
  email: string | null;
}

/**
 * Normalized inbound order — output of the Shopify webhook parser.
 */
export interface IncomingOrder {
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  email: string | null;
  currency: string;
  totalPriceUsd: number | null;
  shippingAddress: ShippingAddress | null;
  lineItems: IncomingOrderLineItem[];
}

export type ForwardedOrderStatus =
  | 'pending'
  | 'placed'
  | 'dry_run'
  | 'manual_review'
  | 'error';

export interface ViabilityBreakdown {
  marginScore: number;
  competitionScore: number;
  demandScore: number;
  wowScore: number;
  estimatedMarginPct: number;
  competingStores: number | null;
  demandAverage: number | null;
  hardReject: string | null;
}

export interface AdCreative {
  id: string;
  listingId: string;
  productId: string;
  angles: unknown[];
  hooks: unknown[];
  imageAdPrompts: unknown[];
  videoScripts: unknown[];
  hashtags: Record<string, string[]>;
  platformCopies: Record<string, unknown>;
  generatedAt: string;
  status: AdCreativeStatus;
}
