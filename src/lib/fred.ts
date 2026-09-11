// FRED keyed API helpers — free key at https://fred.stlouisfed.org/docs/api/api_key.html
// Keyless CSVs (used by /api/macro values) keep working without one; the key
// unlocks series search + official metadata (titles, units, frequency).

export function fredKey(paramKey?: string | null): string {
  return (paramKey || process.env.FRED_API_KEY || "").trim();
}

export interface FredSeriesMeta {
  id: string;
  title: string;
  units: string;
  frequency: string;
  seasonal: string;
  lastUpdated?: string;
}

export async function fredSearch(query: string, apiKey: string): Promise<FredSeriesMeta[]> {
  const r = await fetch(
    `https://api.stlouisfed.org/fred/series/search?search_text=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&limit=10&order_by=popularity&sort_order=desc`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 86400 } }
  );
  if (!r.ok) throw new Error(`fred search ${r.status}`);
  const j = await r.json();
  return ((j?.seriess ?? []) as any[]).map((s) => ({
    id: String(s.id),
    title: String(s.title ?? s.id),
    units: String(s.units ?? ""),
    frequency: String(s.frequency ?? ""),
    seasonal: String(s.seasonal_adjustment ?? ""),
    lastUpdated: s.last_updated ? String(s.last_updated) : undefined,
  }));
}

export async function fredMeta(id: string, apiKey: string): Promise<FredSeriesMeta> {  const r = await fetch(
    `https://api.stlouisfed.org/fred/series?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(apiKey)}&file_type=json`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 86400 } }
  );
  if (!r.ok) throw new Error(`fred meta ${r.status}`);
  const j = await r.json();
  const s = ((j?.seriess ?? []) as any[])[0] ?? {};
  return {
    id,
    title: String(s.title ?? id),
    units: String(s.units ?? ""),
    frequency: String(s.frequency ?? ""),
    seasonal: String(s.seasonal_adjustment ?? ""),
    lastUpdated: s.last_updated ? String(s.last_updated) : undefined,
  };
}

// --- Economic calendar primitives (all need an API key) ---

export interface FredObs { date: string; value: number }

// Latest observations, newest first.
export async function fredObservations(seriesId: string, apiKey: string, limit = 6): Promise<FredObs[]> {
  const r = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&limit=${limit}&sort_order=desc`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 21600 } }
  );
  if (!r.ok) throw new Error(`fred obs ${seriesId} ${r.status}`);
  const j = await r.json();
  return (((j?.observations ?? []) as any[])
    .filter((o) => o?.value !== "." && o?.value !== undefined)
    .map((o) => ({ date: String(o.date).slice(0, 10), value: Number(o.value) }))
    .filter((o) => o.date.length >= 8 && isFinite(o.value)));
}

const releaseIdCache = new Map<string, { ts: number; id: number; name: string }>();

// Resolve a series to its FRED release (which owns the release calendar).
export async function fredSeriesRelease(seriesId: string, apiKey: string): Promise<{ id: number; name: string }> {
  const hit = releaseIdCache.get(seriesId);
  if (hit && Date.now() - hit.ts < 7 * 86400000) return { id: hit.id, name: hit.name };
  const r = await fetch(
    `https://api.stlouisfed.org/fred/series/release?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 86400 } }
  );
  if (!r.ok) throw new Error(`fred release ${seriesId} ${r.status}`);
  const j = await r.json();
  const rel = ((j?.releases ?? []) as any[])[0];
  if (!rel?.id) throw new Error(`fred no release ${seriesId}`);
  const out = { id: Number(rel.id), name: String(rel.name ?? "") };
  releaseIdCache.set(seriesId, { ts: Date.now(), ...out });
  return out;
}

// Release dates (past + scheduled), newest first. FRED has no times —
// attach typical ET release times per event on the caller side.
export async function fredReleaseDates(releaseId: number, apiKey: string, limit = 40): Promise<string[]> {
  const r = await fetch(
    `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${encodeURIComponent(apiKey)}&file_type=json&include_release_dates_with_no_data=true&limit=${limit}&sort_order=desc`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 21600 } }
  );
  if (!r.ok) throw new Error(`fred dates ${releaseId} ${r.status}`);
  const j = await r.json();
  return (((j?.release_dates ?? []) as any[])
    .map((d) => String(d.date ?? "").slice(0, 10))
    .filter((d: string) => d.length >= 8));
}
