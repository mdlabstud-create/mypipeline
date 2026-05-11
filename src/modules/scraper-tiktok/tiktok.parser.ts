import type { TikTokRawProduct } from '../../shared/types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickCaption(item: Record<string, unknown>): string | null {
  const desc = item['desc'];
  if (typeof desc === 'string' && desc.length > 0) return desc;
  const text = item['text'];
  if (typeof text === 'string' && text.length > 0) return text;
  return null;
}

function pickPlayCount(item: Record<string, unknown>): number | null {
  const stats = item['stats'];
  if (isObject(stats)) {
    const fromStats =
      toFiniteNumber(stats['playCount']) ??
      toFiniteNumber(stats['viewCount']) ??
      toFiniteNumber(stats['play_count']);
    if (fromStats !== null) return fromStats;
  }
  return (
    toFiniteNumber(item['playCount']) ??
    toFiniteNumber(item['play_count']) ??
    toFiniteNumber(item['viewCount'])
  );
}

function pickStat(
  item: Record<string, unknown>,
  stats: Record<string, unknown> | null,
  key: string
): number | undefined {
  const fromTop = toFiniteNumber(item[key]);
  if (fromTop !== null) return fromTop;
  if (stats) {
    const fromStats = toFiniteNumber(stats[key]);
    if (fromStats !== null) return fromStats;
  }
  return undefined;
}

const PRICE_LIKE_KEYS = new Set([
  'price',
  'salePrice',
  'discountPrice',
  'originalPrice',
  'minPrice',
  'maxPrice',
  'regularPrice'
]);

/** Accepts numeric dollars or short money strings like "$12.99" or "USD 15". */
function coerceUsdRetail(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const v = Math.round(value * 100) / 100;
    return v >= 0.01 && v <= 99_999 ? v : null;
  }
  if (typeof value === 'string') {
    const s = value.trim().replace(/,/g, '');
    const m = s.match(/(\d{1,5}(?:\.\d{1,2})?)/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0.01 || n > 99_999) return null;
    return Math.round(n * 100) / 100;
  }
  if (isObject(value)) {
    return (
      coerceUsdRetail(value['value']) ??
      coerceUsdRetail(value['amount']) ??
      coerceUsdRetail(value['price'])
    );
  }
  return null;
}

/**
 * Walks Apify / TikTok JSON for common commerce `price` keys (bounded depth).
 */
function scanForStructuredRetailUsd(root: unknown, depth: number, seen: WeakSet<object>): number | null {
  if (depth <= 0 || !isObject(root)) return null;
  if (seen.has(root)) return null;
  seen.add(root);

  for (const [k, child] of Object.entries(root)) {
    if (PRICE_LIKE_KEYS.has(k)) {
      const n = coerceUsdRetail(child);
      if (n !== null) return n;
    }
  }
  for (const child of Object.values(root)) {
    if (child != null && typeof child === 'object') {
      const n = scanForStructuredRetailUsd(child, depth - 1, seen);
      if (n !== null) return n;
    }
  }
  return null;
}

/** First `$` + dollars in caption (conservative range). */
function retailUsdFromCaption(caption: string): number | null {
  const m = caption.match(/\$\s*(\d{1,4}(?:\.\d{1,2})?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0.5 || n > 4999) return null;
  return Math.round(n * 100) / 100;
}

export function extractTikTokRetailUsd(item: Record<string, unknown>, caption: string): number | null {
  const structured = scanForStructuredRetailUsd(item, 6, new WeakSet<object>());
  if (structured !== null) return structured;
  return retailUsdFromCaption(caption);
}

/**
 * Parses raw Apify dataset items into typed TikTok products.
 * Supports `clockworks/tiktok-hashtag-scraper` (text + top-level counts) and legacy `{ desc, stats }` shapes.
 */
export function parseTikTokItems(rawItems: unknown[]): TikTokRawProduct[] {
  const out: TikTokRawProduct[] = [];
  for (const item of rawItems) {
    if (!isObject(item)) continue;
    const idRaw = item['id'];
    const id =
      typeof idRaw === 'string'
        ? idRaw
        : typeof idRaw === 'number' && Number.isFinite(idRaw)
          ? String(idRaw)
          : typeof idRaw === 'bigint'
            ? String(idRaw)
            : '';
    if (!id) continue;

    const desc = pickCaption(item);
    if (!desc) continue;

    const playCount = pickPlayCount(item);
    if (playCount === null || playCount < 0) continue;

    const statsObj = item['stats'];
    const stats = isObject(statsObj) ? statsObj : null;

    const diggCount = pickStat(item, stats, 'diggCount');
    const shareCount = pickStat(item, stats, 'shareCount');
    const commentCount = pickStat(item, stats, 'commentCount');

    const authorMeta = item['authorMeta'];
    const author =
      typeof item['author'] === 'string'
        ? item['author']
        : isObject(authorMeta) && typeof authorMeta['name'] === 'string'
          ? authorMeta['name']
          : undefined;

    const url = typeof item['webVideoUrl'] === 'string' ? item['webVideoUrl'] : undefined;

    const tiktokRetailUsd = extractTikTokRetailUsd(item, desc);

    out.push({
      id,
      desc,
      playCount,
      ...(tiktokRetailUsd !== null ? { tiktokRetailUsd } : {}),
      ...(diggCount !== undefined ? { diggCount } : {}),
      ...(shareCount !== undefined ? { shareCount } : {}),
      ...(commentCount !== undefined ? { commentCount } : {}),
      ...(author !== undefined ? { author } : {}),
      ...(url !== undefined ? { url } : {})
    });
  }
  return out;
}

/**
 * Normalizes a TikTok caption into a keyword phrase.
 */
export function normalizeTikTokKeyword(caption: string): string {
  const cleaned = caption
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#]\w+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Common English words that are not product keywords (original lowercase forms, no stemming).
  const stop = new Set([
    // articles / conjunctions / prepositions
    'the','and','for','with','from','that','this','those','these','then',
    'into','onto','upon','about','above','after','before','below','between',
    // pronouns
    'you','your','our','their','them','which','what','who','its','mine',
    // auxiliaries / common verbs
    'is','are','was','were','be','been','have','has','had','do','does','did',
    'will','would','could','should','may','might','must','shall','can',
    'get','got','go','gone','come','went','came','give','gave','given',
    'make','made','take','took','taken','put','set','let','keep','kept',
    'see','saw','seen','know','knew','known','think','thought','feel','felt',
    'want','need','use','try','look','show','tell','told','call',
    'work','play','run','ran','move','live','leave','turn','start','stop',
    'buy','sell','pay','hold','help','watch','wait','hear','read','write',
    'eat','cook','drink','sleep','sit','stand','walk','talk','speak','ask',
    'seem','appear','happen','allow','believe','reply','maybe','actually',
    // adjectives that are never product keywords
    'good','bad','best','better','worst','great','nice','new','old','big',
    'little','small','large','high','low','long','short','just','only',
    'free','real','true','false','hard','easy','fast','slow','quick',
    'cold','clean','funny','cute','pretty','amazing','awesome','epic',
    'viral','trending','popular','famous','secret','special','unique',
    // time / people / place
    'time','day','days','week','month','year','hour','minute','second',
    'today','tomorrow','yesterday','now','soon','already','always','never',
    'life','world','home','house','place','thing','way','part','fact',
    'man','woman','girl','boy','kid','people','person','friend','family',
    'movie','song','music','video','photo','picture','story','news',
    // TikTok-specific filler
    'lol','omg','pov','fyp','xyzbca','blowthisup','follow','like',
    'love','hate','miss','hope','wish','dream','joke','fun','wow',
    'can','one','two','not','but','all','got','out','her','him',
    'they','also','very','here','there','when','where','more','most'
  ]);

  const baseTokens = cleaned.split(/\s+/);

  const seen = new Set<string>();
  const tokens = baseTokens
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3)
    .filter((t) => !stop.has(t));
  const deduped: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    deduped.push(t);
  }

  // Require at least 2 meaningful stems — single-word results are too noisy.
  if (deduped.length < 2) return '';

  const phrase = deduped.slice(0, 3).join(' ').trim();
  return phrase.length > 0 ? phrase : '';
}

/**
 * Calculates normalized TikTok trend score from views.
 */
export function calculateTikTokScore(playCount: number): number {
  if (!Number.isFinite(playCount) || playCount <= 0) return 0;
  const max = 10_000_000;
  const score = Math.log10(playCount) / Math.log10(max);
  return Math.min(Math.max(score, 0), 1);
}