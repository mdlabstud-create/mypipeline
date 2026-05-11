import 'dotenv/config';

import { runAliExpressReauthAlertCheck } from '../modules/notify/aliexpress-reauth-alert';

void runAliExpressReauthAlertCheck().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

