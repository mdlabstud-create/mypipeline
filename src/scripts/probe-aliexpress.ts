import 'dotenv/config';
import { searchAliExpress } from '../modules/researcher/aliexpress';
import { getFreshAliExpressSession } from '../modules/researcher/aliexpress.session';

async function main(): Promise<void> {
  const sk = await getFreshAliExpressSession();
  // eslint-disable-next-line no-console
  console.log('session_key.length =', sk.length);
  const out = await searchAliExpress('bluetooth speaker waterproof');
  // eslint-disable-next-line no-console
  console.log('candidates =', out.length);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out.slice(0, 3), null, 2));
}

void main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
