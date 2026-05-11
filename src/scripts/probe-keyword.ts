import 'dotenv/config';
import {
  searchAliExpress,
  costFloorForKeyword
} from '../modules/researcher/aliexpress';

async function probe(keyword: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('\n=== ', JSON.stringify(keyword), ' floor=', costFloorForKeyword(keyword));
  const out = await searchAliExpress(keyword);
  // eslint-disable-next-line no-console
  console.log('passing =', out.length);
  for (const c of out.slice(0, 3)) {
    // eslint-disable-next-line no-console
    console.log('  - $', c.priceUsd, '|', (c.productTitle ?? '').slice(0, 90));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keywords = args.length > 0
    ? args
    : [
        'scalp massag shampoo brush',
        'liquid eyebrow pencil color',
        'travel shower kit valu',
        'piec silicon spatula set',
        'induct speaker 5-in-1 bluetooth',
        'wave music system espresso'
      ];
  for (const k of keywords) await probe(k);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
