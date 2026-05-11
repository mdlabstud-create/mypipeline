import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/env';
import logger from '../../shared/logger';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET
});

/**
 * Downloads supplier images and uploads them to Cloudinary.
 */
export async function handleImages(imageUrls: string[]): Promise<string[]> {
  const uploads = await Promise.allSettled(
    imageUrls.map(async (url) => {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 10_000
      });
      const buf = Buffer.from(res.data);
      const base64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
      const up = await cloudinary.uploader.upload(base64, {
        folder: 'dropship-products',
        quality: 'auto',
        fetch_format: 'auto'
      });
      return up.secure_url;
    })
  );

  const urls: string[] = [];
  for (const u of uploads) {
    if (u.status === 'fulfilled') {
      urls.push(u.value);
    } else {
      let reason: Record<string, unknown>;
      if (u.reason instanceof Error) {
        reason = { message: u.reason.message, name: u.reason.name };
      } else if (typeof u.reason === 'object' && u.reason !== null) {
        reason = u.reason as Record<string, unknown>;
      } else {
        reason = { detail: String(u.reason) };
      }
      logger.warn('image upload pipeline step failed', { error: reason });
    }
  }

  if (urls.length > 0) {
    return urls;
  }

  const originals = imageUrls.filter((href) => /^https:\/\//i.test(href));
  if (originals.length === 0) {
    throw new Error('All image uploads failed and no https:// supplier URLs to fall back to');
  }

  logger.warn('cloudinary uploads failed; using original supplier HTTPS URLs for listing images', {
    count: originals.length
  });

  return originals.slice(0, 10);
}
