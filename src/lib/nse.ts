// NSE session helper — TypeScript port of NseCore's cookie dance,
// rate limiter, and 401-refresh logic. Server-side only.

const NSE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";

let cookies = "";
let lastFetch = 0;

async function throttle() {
  const wait = 800 - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
}

function mergeCookies(res: Response) {
  const h = res.headers as any;
  const raw: string[] =
    typeof h.getSetCookie === "function"
      ? h.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=[^;,]+=[^;,]+;)/);
  const jar = new Map<string, string>();
  for (const c of cookies.split("; ").filter(Boolean)) {
    const i = c.indexOf("=");
    if (i > 0) jar.set(c.slice(0, i), c.slice(i + 1));
  }
  for (const c of raw.map((x) => x.split(";")[0]).filter(Boolean)) {
    const i = c.indexOf("=");
    if (i > 0) jar.set(c.slice(0, i), c.slice(i + 1));
  }
  cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function nseHeaders(): Record<string, string> {
  return {
    "user-agent": NSE_UA,
    "accept-language": "en,gu;q=0.9,hi;q=0.8",
    accept: "*/*",
    ...(cookies ? { cookie: cookies } : {}),
  };
}

export async function nseRefresh(): Promise<void> {
  const r = await fetch("https://www.nseindia.com/option-chain", {
    headers: nseHeaders(),
    signal: AbortSignal.timeout(12000),
  });
  mergeCookies(r);
  if (!r.ok && r.status !== 200) throw new Error(`nse home ${r.status}`);
}

export async function nseGet(url: string): Promise<Response> {
  await throttle();
  let r = await fetch(url, {
    headers: nseHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401) {
    await nseRefresh();
    await throttle();
    r = await fetch(url, {
      headers: nseHeaders(),
      signal: AbortSignal.timeout(15000),
    });
  }
  return r;
}
