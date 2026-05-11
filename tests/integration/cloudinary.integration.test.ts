import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';

const itIntegration = process.env.RUN_INTEGRATION === '1' ? it : it.skip;

function hasCreds(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

describe('cloudinary integration', () => {
  itIntegration('handleImages uploads and returns CDN URLs', async () => {
    if (!hasCreds()) return;
    const { handleImages } = await import('../../src/modules/content-generator/images');
    const urls = await handleImages([
      // small placeholder image
      'https://via.placeholder.com/300.jpg'
    ]);
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(urls[0]).toContain('cloudinary');
  }, 120_000);
});

