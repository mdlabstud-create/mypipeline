import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db', () => {
  return {
    query: vi.fn(() => Promise.resolve([]))
  };
});

vi.mock('../../src/modules/content-generator/images', () => {
  return {
    handleImages: vi.fn(() => Promise.resolve(['https://cdn.example.com/img1.jpg']))
  };
});

vi.mock('openai', () => {
  class OpenAI {
    public chat = {
      completions: {
        create: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Amazing Product',
                    description:
                      'A great product for everyday use.\n\nSecond paragraph benefits.',
                    bullet_points: [
                      'Improve your day with ease and comfort',
                      'Enjoy durable design built to last',
                      'Save time with simple, intuitive use',
                      'Experience reliable performance anywhere',
                      'Gift-ready and perfect for all ages'
                    ],
                    tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag8'],
                    seo_title: 'Amazing Product',
                    seo_description: 'Amazing product description'
                  })
                }
              }
            ]
          })
      }
    };
  }
  return { default: OpenAI };
});

import { parseGptJson } from '../../src/modules/content-generator/content.service';

describe('content.service', () => {
  it('parseGptJson validates and returns parsed content', () => {
    const raw = JSON.stringify({
      title: 'T'.repeat(10),
      description: 'A'.repeat(150),
      bullet_points: ['a', 'b', 'c', 'd', 'e'],
      tags: ['t1', 't2', 't3', 't4', 't5'],
      seo_title: 'seo',
      seo_description: 'desc'
    });

    const out = parseGptJson(raw);
    expect(out.title).toBeTruthy();
    expect(out.bullet_points).toHaveLength(5);
  });

  it('parseGptJson throws on invalid JSON', () => {
    expect(() => parseGptJson('{bad json')).toThrow();
  });
});

