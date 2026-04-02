import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const BASE_URL = 'https://www.oddballtrip.com'
  const now = new Date()

  return [
    // Home
    { url: `${BASE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },

    // Spain hub
    { url: `${BASE_URL}/espagne`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },

    // City pages — Canary Islands
    { url: `${BASE_URL}/espagne/tenerife`,      lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${BASE_URL}/espagne/gran-canaria`,  lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${BASE_URL}/espagne/lanzarote`,     lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/espagne/fuerteventura`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },

    // City pages — Mainland Spain
    { url: `${BASE_URL}/espagne/palma`,           lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/espagne/saint-jacques`,   lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/espagne/saint-sebastien`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/espagne/salamanque`,      lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/espagne/tolede`,          lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/espagne/gerone`,          lastModified: now, changeFrequency: 'monthly', priority: 0.7 },

    // Individual escape game pages
    { url: `${BASE_URL}/escapes/le-butin-de-la-bateria`,  lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/escapes/le-coffre-des-trois-cles`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/escapes/le-code-dichasagua`,       lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/escapes/les-cendres-de-lame`,      lastModified: now, changeFrequency: 'monthly', priority: 0.9 },

    // Pass / Explorer
    { url: `${BASE_URL}/pass/explorer`,      lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/pass/city/tenerife`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },

    // Static / legal
    { url: `${BASE_URL}/about`,   lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${BASE_URL}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/terms`,   lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
