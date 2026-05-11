import axios from 'axios';
import { env } from '../../config/env';
import logger from '../../shared/logger';
import { signAliExpressParams } from './aliexpress.oauth';
import { getFreshAliExpressSession } from './aliexpress.session';
import type { SupplierCandidate } from '../../shared/types';

const API_BASE = 'https://api-sg.aliexpress.com';

function aliExpressConfigured(): boolean {
  const k = env.ALIEXPRESS_APP_KEY.trim().toLowerCase();
  const s = env.ALIEXPRESS_APP_SECRET.trim().toLowerCase();
  if (k.length === 0 || s.length === 0) return false;
  if (k === 'dummy' || s === 'dummy') return false;
  return true;
}

/**
 * AliExpress Open Platform (api-sg.aliexpress.com) call.
 * - URL: POST /sync
 * - System params: app_key, format=json, method, sign_method=sha256, simplify=true, timestamp(ms), session(access_token)
 * - Sign: HMAC-SHA256(app_secret, sortedKeyValueConcat) → upper hex.
 */
export async function aeCall<T>(method: string, biz: Record<string, string>): Promise<T> {
  // Auto-refreshes via the refresh_token grant when within 24h of expiry.
  // Throws when no session exists or when expired with no refresh token available.
  const session = await getFreshAliExpressSession();

  const params: Record<string, string> = {
    app_key: env.ALIEXPRESS_APP_KEY,
    format: 'json',
    method,
    session,
    sign_method: 'sha256',
    simplify: 'true',
    timestamp: String(Date.now()),
    ...biz
  };
  const sign = signAliExpressParams(params, env.ALIEXPRESS_APP_SECRET);
  const body = new URLSearchParams({ ...params, sign });
  const res = await axios.post<unknown>(`${API_BASE}/sync`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    timeout: 30_000,
    validateStatus: () => true
  });

  const data = res.data;
  if (isObject(data) && isObject(data['error_response'])) {
    const err = data['error_response'];
    logger.warn('aliexpress api error', { method, status: res.status, error: err });
  } else {
    logger.info('aliexpress api ok', {
      method,
      status: res.status,
      topLevelKeys: isObject(data) ? Object.keys(data) : typeof data
    });
  }
  return data as T;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^\d.]+/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseImageList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  if (typeof value === 'string') {
    return value
      .split(/[;,]/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (isObject(value) && Array.isArray(value['string'])) {
    return (value['string'] as unknown[]).filter((x): x is string => typeof x === 'string');
  }
  return [];
}

/**
 * Parses aliexpress.ds.recommend.feed.get into supplier candidates.
 *
 * Handles both response shapes:
 * - new api-sg gateway: { result: { products: [...] | { integer: [...] }, ... }, rsp_code: 200, ... }
 * - legacy taobao gateway: { aliexpress_ds_recommend_feed_get_response: { result: { products: ... } } }
 */
export function parseAliExpressFeedResponse(raw: unknown): SupplierCandidate[] {
  if (!isObject(raw)) return [];
  if (isObject(raw['error_response'])) return [];

  let result: unknown = raw['result'];
  if (!isObject(result)) {
    const wrapped = raw['aliexpress_ds_recommend_feed_get_response'];
    if (isObject(wrapped)) result = wrapped['result'];
  }
  if (!isObject(result)) return [];

  const productsField = result['products'];
  let list: unknown[] = [];
  if (Array.isArray(productsField)) list = productsField;
  else if (isObject(productsField) && Array.isArray(productsField['integer'])) {
    list = productsField['integer'];
  } else if (isObject(productsField) && Array.isArray(productsField['traffic_product_d_t_o'])) {
    list = productsField['traffic_product_d_t_o'];
  }
  if (list.length === 0) return [];

  const out: SupplierCandidate[] = [];
  for (const p of list) {
    if (!isObject(p)) continue;
    const title = typeof p['product_title'] === 'string' ? p['product_title'] : null;
    const url = typeof p['product_detail_url'] === 'string' ? p['product_detail_url'] : null;
    const priceUsd = toNumber(p['target_sale_price']) ?? toNumber(p['sale_price']);
    if (!url || priceUsd === null) continue;

    const shippingDays = toNumber(p['ship_to_days']);
    const ratingRaw = typeof p['evaluate_rate'] === 'string' ? p['evaluate_rate'] : null;
    const ratingPct = ratingRaw ? toNumber(ratingRaw.replace('%', '')) : null;
    const rating = ratingPct === null ? null : Math.round((ratingPct / 20) * 100) / 100;
    const reviewCount = toNumber(p['evaluation_count']) ?? 0;
    const imageUrl =
      typeof p['product_main_image_url'] === 'string' ? p['product_main_image_url'] : null;
    const smalls = parseImageList(p['product_small_image_urls']);
    const images = [imageUrl, ...smalls].filter((x): x is string => typeof x === 'string' && x.length > 0);

    const productIdNum = toNumber(p['product_id']);
    const productId = productIdNum === null ? null : String(Math.trunc(productIdNum));

    const supplierUrl = productId ? `${url}#ae_pid=${encodeURIComponent(productId)}` : url;
    out.push({
      platform: 'aliexpress',
      supplierUrl,
      productTitle: title,
      priceUsd,
      priceCny: null,
      moq: 1,
      rating,
      reviewCount,
      shippingDays,
      fastShip: shippingDays !== null ? shippingDays <= 14 : null,
      images: images.slice(0, 10)
    });
  }

  return out;
}

export function extractAliExpressProductIdFromUrl(url: string): string | null {
  const m = url.match(/\/item\/(\d+)\.html/i);
  if (m && m[1]) return m[1];
  const hash = url.split('#')[1] ?? '';
  const hm = hash.match(/ae_pid=([^&]+)/);
  if (hm && hm[1]) return decodeURIComponent(hm[1]);
  return null;
}

export async function getAliExpressProductDetails(productId: string): Promise<string[]> {
  const data = await aeCall<unknown>('aliexpress.ds.product.get', {
    product_id: productId,
    ship_to_country: 'US',
    target_currency: 'USD',
    target_language: 'EN'
  });
  if (!isObject(data) || isObject(data['error_response'])) return [];

  // Handle both new flat shape ({result: {...}}) and legacy wrapped shape.
  let result: unknown = data['result'];
  if (!isObject(result)) {
    const wrapped = data['aliexpress_ds_product_get_response'];
    if (isObject(wrapped)) result = wrapped['result'];
  }
  if (!isObject(result)) return [];

  const base = isObject(result['ae_item_base_info_dto']) ? result['ae_item_base_info_dto'] : null;
  const candidates: string[] = [];

  if (base) {
    candidates.push(...parseImageList(base['image_urls']));
    candidates.push(...parseImageList(base['product_image_urls']));
  }

  const multimediaObj = result['ae_multimedia_info_dto'];
  const multimedia = isObject(multimediaObj) ? multimediaObj : null;
  if (multimedia) {
    candidates.push(...parseImageList(multimedia['image_urls']));
    candidates.push(...parseImageList(multimedia['image_url_list']));
  }

  // SKU-level images sometimes show up under ae_item_sku_info_dtos.
  const skuDtosWrapper = result['ae_item_sku_info_dtos'];
  const skuList = isObject(skuDtosWrapper) ? skuDtosWrapper['ae_item_sku_info_d_t_o'] : null;
  if (Array.isArray(skuList)) {
    for (const s of skuList) {
      if (isObject(s) && typeof s['sku_image'] === 'string') candidates.push(s['sku_image']);
    }
  }

  return Array.from(new Set(candidates))
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((u) => (u.startsWith('http://') ? u.replace('http://', 'https://') : u));
}

/**
 * Tokenizes free-form text into lowercase alphanumeric tokens of length >= 3.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3);
}

/**
 * Stem-friendly token equality: returns true if `a` and `b` share a 4-char
 * prefix (or one is a prefix of the other for short tokens). Lets us match
 * stemmed TikTok keywords like "massag" → "massage" or "deliveri" → "delivery".
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const n = Math.min(a.length, b.length, 5);
  return a.slice(0, n) === b.slice(0, n);
}

function tokenInSet(token: string, set: Set<string>): boolean {
  if (set.has(token)) return true;
  for (const t of set) if (tokensMatch(token, t)) return true;
  return false;
}

/**
 * Returns a relevance score in [0, 1] indicating how well a candidate title
 * matches the search keyword. Combines unigram overlap (with stem-friendly
 * matching) and a bigram bonus that rewards phrase matches.
 */
export function scoreTitleRelevance(title: string, keyword: string): number {
  const tT = new Set(tokenize(title));
  const tK = tokenize(keyword);
  if (tK.length === 0 || tT.size === 0) return 0;

  let unigramHits = 0;
  for (const k of tK) if (tokenInSet(k, tT)) unigramHits += 1;
  const unigramScore = unigramHits / tK.length;

  let bigramHits = 0;
  let bigramTotal = 0;
  for (let i = 0; i < tK.length - 1; i += 1) {
    bigramTotal += 1;
    const a = tK[i];
    const b = tK[i + 1];
    if (a && b && tokenInSet(a, tT) && tokenInSet(b, tT)) bigramHits += 1;
  }
  const bigramScore = bigramTotal === 0 ? 0 : bigramHits / bigramTotal;

  return Math.min(1, 0.7 * unigramScore + 0.3 * bigramScore);
}

/**
 * Minimum supplier cost (USD) we expect for a real product matching the keyword.
 * Items priced below the floor are almost certainly accessories or unrelated.
 */
export function costFloorForKeyword(keyword: string): number {
  const k = keyword.toLowerCase();
  type Rule = { match: RegExp; floor: number };
  const rules: Rule[] = [
    { match: /robot.{0,5}vacuum|robovac|lidar/, floor: 40 },
    { match: /drone|quadcopter/, floor: 25 },
    { match: /laptop|notebook|chromebook|gaming pc|desktop/, floor: 80 },
    { match: /smartphone|iphone|pixel|galaxy phone|android phone/, floor: 80 },
    { match: /\btv\b|television|monitor|projector/, floor: 40 },
    { match: /fridge|refrigerator|washer|dryer|dishwasher/, floor: 100 },
    { match: /e[- ]?bike|electric bike|electric scooter|hoverboard/, floor: 100 },
    { match: /vr headset|oculus|quest|playstation|xbox|nintendo switch/, floor: 60 },
    { match: /3d printer|sewing machine/, floor: 40 },
    { match: /espresso|coffee machine|coffee maker|stand mixer/, floor: 30 },
    { match: /\bcamera\b|gopro|dslr/, floor: 25 },
    { match: /watch|smartwatch/, floor: 5 }
  ];
  for (const r of rules) if (r.match.test(k)) return r.floor;
  return 0;
}

/**
 * Maps common keyword categories to AE feed-name fragments that are likely to
 * carry matching merchandise. Used to boost relevance of feed selection.
 */
const KEYWORD_FEED_HINTS: Array<{ match: RegExp; hints: string[] }> = [
  {
    match: /speaker|headphone|earbud|earphone|airpod|bluetooth|wireless|charger|usb|cable|adapter|phone|tablet|electronic|gadget|smart ?watch|tv\b|monitor|laptop|keyboard|mouse|projector|drone|camera|microphone|router/,
    hints: ['ConsumerElectronics', 'ElectronicComponents', 'PhoneAccessories', 'ComputerAccessories', 'phones&accessories', 'consumer electronics', 'computer&office']
  },
  {
    match: /vacuum|robovac|cleaner|kitchen|cookware|fridge|knife|blender|mixer|dish|appliance|spatula|silicone|whisk|cutting board|colander|pan|pot|bowl|cup|jug|kettle|toaster|microwave/,
    hints: ['Home&Kitchen', 'home appliances']
  },
  {
    match: /shower|bath|toilet|towel|sink|faucet|bidet|hygien/,
    hints: ['Home&Kitchen', 'Home&Garden', 'home appliances']
  },
  {
    match: /sofa|chair|stool|table|bed|desk|cabinet|lamp|light|furniture/,
    hints: ['Furniture', 'Lighting', 'furniture']
  },
  {
    match: /makeup|skincare|cosmetic|lipstick|lip ?gloss|mascara|perfume|beauty|nail|hair|wig|shampoo|conditioner|moisturizer|serum|cream|foundation|eyebrow|eyeliner|eye ?shadow|blush|concealer|powder|brush|sponge|massag|scalp/,
    hints: ['beauty&health', 'Beauty', 'HairExtensions&Wigs', 'wigs']
  },
  {
    match: /clothes|clothing|apparel|shirt|dress|jacket|pants|jean|legging|underwear|bra|swimwear/,
    hints: ['ApparelAccessories', 'WomenClothing', 'MenClothing', 'Clothing']
  },
  {
    match: /shoe|sneaker|boot|sandal|heel/,
    hints: ['Shoes', 'Shoe']
  },
  {
    match: /toy|doll|game|hobby|puzzle/,
    hints: ['Toys&Hobbies', 'toys', 'Dolls']
  },
  {
    match: /baby|kid|infant|stroller|toddler/,
    hints: ['Mother&Kids', 'Mother & Kids']
  },
  {
    match: /sport|gym|fitness|yoga|outdoor|camping|hiking|bike|cycling|surf|ski/,
    hints: ['Sports&Outdoors', 'Sports-Clothing', 'sports']
  },
  {
    match: /jewelry|watch|necklace|ring|bracelet|earring/,
    hints: ['Jewelry&Watch']
  },
  {
    match: /pet|dog|cat|aquarium/,
    hints: ['pets&supplies']
  },
  {
    match: /car|vehicle|automotive|motorcycle|tire|engine|truck/,
    hints: ['Automobile', 'Automotive', 'car&accessories', 'motorcycle']
  },
  {
    match: /garden|plant|seed|flower|backyard|patio/,
    hints: ['Garden', 'garden']
  },
  {
    match: /tool|drill|saw|wrench|hammer/,
    hints: ['Tool', 'tool']
  },
  {
    match: /christmas|xmas|santa|holiday/,
    hints: ['Christmas']
  }
];

function categoryHintsForKeyword(keyword: string): string[] {
  const k = keyword.toLowerCase();
  for (const rule of KEYWORD_FEED_HINTS) if (rule.match.test(k)) return rule.hints;
  return [];
}

/**
 * Ranks feed names so feeds with category-relevant fragments come first,
 * then US/topseller feeds, with extra weight for keyword-token matches.
 */
export function prioritizeFeedsForKeyword(feeds: string[], keyword: string): string[] {
  const kw = keyword.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  const hints = categoryHintsForKeyword(keyword).map((h) => h.toLowerCase());
  const score = (name: string): number => {
    const n = name.toLowerCase();
    let s = 0;
    for (const h of hints) if (n.includes(h)) s += 8;
    if (/(_us_|us_local| us |^us |usa)/.test(n)) s += 4;
    if (/topseller|bestseller|topsellers|best ?sellers|new ?arrival|hot ?product/.test(n)) s += 4;
    if (/^ds_/.test(n)) s += 3;
    if (/(local stock|3pl|warehouse)/.test(n)) s += 1;
    for (const t of kw) if (n.includes(t)) s += 3;
    if (/(_eg|_sa|_tr|_uk|_de|_fr|_es|_pl|_mx|_br|_iraq|_za|_au)\b/.test(n)) s -= 3;
    return s;
  };
  return [...feeds].sort((a, b) => score(b) - score(a));
}

/**
 * Returns the list of feed names available to this dropshipper account.
 * Cached in-process for the lifetime of the script.
 */
let cachedFeedNames: string[] | null = null;
export async function getAliExpressFeedNames(): Promise<string[]> {
  if (cachedFeedNames) return cachedFeedNames;
  const data = await aeCall<unknown>('aliexpress.ds.feedname.get', {});

  const collect: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }
    if (!isObject(node)) return;
    const fn =
      (typeof node['promo_name'] === 'string' && node['promo_name']) ||
      (typeof node['promo_desc'] === 'string' && node['promo_desc']) ||
      (typeof node['name'] === 'string' && node['name']) ||
      null;
    if (fn) collect.push(fn);
    for (const k of Object.keys(node)) walk(node[k]);
  };
  walk(data);

  cachedFeedNames = Array.from(new Set(collect));
  logger.info('aliexpress feed names discovered', { count: cachedFeedNames.length, names: cachedFeedNames });
  return cachedFeedNames;
}

/**
 * Searches AliExpress for suppliers matching a keyword.
 *
 * Note: aliexpress.ds.recommend.feed.get is a curated-feed API (not keyword search),
 * so the `keyword` is best-effort filtered post-hoc when present.
 */
export async function searchAliExpress(keyword: string): Promise<SupplierCandidate[]> {
  if (!aliExpressConfigured()) {
    logger.info('aliexpress search skipped (credentials not configured)', { keyword });
    return [];
  }

  let allFeeds: string[] = [];
  try {
    allFeeds = await getAliExpressFeedNames();
  } catch (e) {
    logger.warn('aliexpress feedname.get failed', { error: String(e) });
  }

  // Prefer feeds likely relevant to a US-shipping dropship store, in priority order.
  const preferred = prioritizeFeedsForKeyword(allFeeds, keyword);

  // Search several feeds and aggregate candidates so keyword matching has more to work with.
  const aggregate: SupplierCandidate[] = [];
  const usedFeeds: string[] = [];
  const cap = 6; // number of feeds to query (curated feeds are narrow; cast a wider net)
  for (const fn of preferred.slice(0, cap)) {
    const raw = await aeCall<unknown>('aliexpress.ds.recommend.feed.get', {
      country: 'US',
      target_currency: 'USD',
      target_language: 'EN',
      page_size: '20',
      page_no: '1',
      sort: 'volumeDesc',
      feed_name: fn
    });
    const parsed = parseAliExpressFeedResponse(raw);
    logger.info('aliexpress feed parsed', { keyword, feed_name: fn, candidates: parsed.length });
    if (parsed.length > 0) {
      aggregate.push(...parsed);
      usedFeeds.push(fn);
    }
    if (aggregate.length >= 60) break;
  }

  if (aggregate.length === 0) {
    logger.warn('aliexpress: no feeds returned products', { keyword, tried: preferred.slice(0, cap) });
    return [];
  }

  // Dedupe by AliExpress product_id (multiple feeds + tracking-param URL noise create dupes).
  const dedup = new Map<string, SupplierCandidate>();
  for (const c of aggregate) {
    const pid = extractAliExpressProductIdFromUrl(c.supplierUrl) ?? c.supplierUrl;
    if (!dedup.has(pid)) dedup.set(pid, c);
  }

  // Score each candidate by title relevance and apply cost-floor for "expensive-by-default" categories.
  // Threshold is adaptive: longer keywords (TikTok scrapes are noisy) just need 1 unigram hit;
  // short, specific keywords need a higher hit-rate.
  const kwTokens = tokenize(keyword);
  const costFloor = costFloorForKeyword(keyword);
  const defaultMinRelevance =
    kwTokens.length >= 5 ? 0.15 : kwTokens.length === 4 ? 0.18 : kwTokens.length === 3 ? 0.24 : 0.34;
  // Safety clamp: allow override for noisy keywords but avoid accepting total junk.
  const minRelevanceOverride = env.ALIEXPRESS_MIN_RELEVANCE;
  const minRelevance =
    typeof minRelevanceOverride === 'number' && Number.isFinite(minRelevanceOverride)
      ? Math.min(0.9, Math.max(0.05, minRelevanceOverride))
      : defaultMinRelevance;

  type Scored = SupplierCandidate & { _score: number };
  const all: Scored[] = Array.from(dedup.values()).map((c) => ({
    ...c,
    _score: scoreTitleRelevance(c.productTitle ?? '', keyword)
  }));

  let rejectedByCost = 0;
  let rejectedByRelevance = 0;
  const passing = all.filter((c) => {
    if (costFloor > 0 && (c.priceUsd ?? 0) < costFloor) {
      rejectedByCost += 1;
      return false;
    }
    if (c._score < minRelevance) {
      rejectedByRelevance += 1;
      return false;
    }
    return true;
  });

  passing.sort((a, b) => b._score - a._score);

  logger.info('aliexpress search ranked', {
    keyword,
    usedFeeds,
    aggregated: aggregate.length,
    afterDedupe: dedup.size,
    costFloor,
    minRelevance,
    rejectedByCost,
    rejectedByRelevance,
    passing: passing.length,
    topScores: passing.slice(0, 5).map((c) => ({
      score: Number(c._score.toFixed(2)),
      cost: c.priceUsd,
      title: c.productTitle?.slice(0, 80)
    }))
  });

  if (passing.length === 0) {
    logger.warn('aliexpress: all candidates rejected by quality guards', {
      keyword,
      costFloor,
      minRelevance
    });
    return [];
  }

  // Strip the internal _score field before returning.
  const candidates: SupplierCandidate[] = passing.map((c) => {
    const { _score: _ignored, ...rest } = c;
    void _ignored;
    return rest;
  });

  // Enrich top few with full image_urls for >=4 images.
  const enriched: SupplierCandidate[] = [];
  for (const c of candidates.slice(0, 8)) {
    const pid = extractAliExpressProductIdFromUrl(c.supplierUrl);
    if (!pid) {
      enriched.push(c);
      continue;
    }
    const moreImgs = await getAliExpressProductDetails(pid);
    const merged = [...(c.images ?? []), ...moreImgs]
      .map((u) => (u.startsWith('http://') ? u.replace('http://', 'https://') : u))
      .filter((u) => /^https?:\/\//i.test(u));
    enriched.push({ ...c, images: Array.from(new Set(merged)).slice(0, 12) });
  }

  return enriched;
}
