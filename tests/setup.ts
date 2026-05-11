const requiredEnv: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_KEY: 'test-service-key',
  DATABASE_URL: 'postgres://dropship:dropship@localhost:5432/dropship',
  REDIS_URL: 'redis://localhost:6379',
  APIFY_API_TOKEN: 'test-apify',
  SCRAPINGDOG_API_KEY: 'test-scrapingdog',
  WEBSHARE_PROXY_SERVER: 'http://proxy.webshare.io:80',
  WEBSHARE_PROXY_USERNAME: 'test-webshare-user',
  WEBSHARE_PROXY_PASSWORD: 'test-webshare-pass',
  OXYLABS_USERNAME: 'test-oxylabs-user',
  OXYLABS_PASSWORD: 'test-oxylabs-pass',
  ALIEXPRESS_APP_KEY: 'test-ali-key',
  ALIEXPRESS_APP_SECRET: 'test-ali-secret',
  ALIEXPRESS_TRACKING_ID: 'test-tracking',
  OPENAI_API_KEY: 'test-openai',
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-cloud-key',
  CLOUDINARY_API_SECRET: 'test-cloud-secret',
  SHOPIFY_STORE_URL: 'example.myshopify.com',
  SHOPIFY_ADMIN_TOKEN: 'test-shopify-token',
  SHOPIFY_WEBHOOK_SECRET: 'test-shopify-webhook-secret',
  EXCHANGE_RATE_API_KEY: 'test-exchange-rate'
};

for (const [k, v] of Object.entries(requiredEnv)) {
  process.env[k] ||= v;
}

process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'false';

