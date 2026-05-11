import 'dotenv/config';
import {
  searchAliExpress,
  scoreTitleRelevance,
  costFloorForKeyword
} from '../modules/researcher/aliexpress';

async function probe(keyword: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('\n=== keyword:', JSON.stringify(keyword), '===');
  // eslint-disable-next-line no-console
  console.log('cost_floor:', costFloorForKeyword(keyword));
  const out = await searchAliExpress(keyword);
  // eslint-disable-next-line no-console
  console.log('passing candidates:', out.length);
  for (const c of out.slice(0, 3)) {
    // eslint-disable-next-line no-console
    console.log(
      '  -',
      `score=${scoreTitleRelevance(c.productTitle ?? '', keyword).toFixed(2)}`,
      `cost=$${c.priceUsd}`,
      `imgs=${c.images?.length ?? 0}`,
      '|',
      (c.productTitle ?? '').slice(0, 80)
    );
  }
}

async function main(): Promise<void> {
  await probe('lidar robot vacuum and');
  await probe('bluetooth speaker waterproof gift');
}

void main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
