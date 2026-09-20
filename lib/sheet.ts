import { SHEET_CACHE_TTL_MS } from './constants';

interface SheetCache {
  csv: string;
  fetchedAt: number;
}

let cache: SheetCache | null = null;

export async function getFaqCsv(): Promise<string> {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < SHEET_CACHE_TTL_MS) {
    return cache.csv;
  }

  const sheetUrl = process.env.SHEET_CSV_URL;
  if (!sheetUrl) {
    if (cache) return cache.csv;
    throw new Error('SHEET_CSV_URL is not set');
  }

  try {
    const res = await fetch(sheetUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Sheet fetch failed with status ${res.status}`);
    }
    const csv = await res.text();
    cache = { csv, fetchedAt: now };
    return csv;
  } catch (err) {
    if (cache) {
      console.error('sheet: fetch failed, serving stale cache', err);
      return cache.csv;
    }
    throw err;
  }
}
