// Response-body reader for desk fetches.
//
// `res.json()` is wrong in three ways that all reach the user as the same
// opaque browser string — "Failed to execute 'json' on 'Response': Unexpected
// end of JSON input" — which is not a desk message and tells a trader nothing:
//
//   1. a route cut off by `maxDuration` answers 200 with an EMPTY body;
//   2. a proxy or a route that died before answering sends an HTML page;
//   3. a body cut mid-stream fails to parse and is reported as if it were empty.
//
// So the body is read as text and CLASSIFIED before anything is parsed. A leg
// that cannot be read gets a named reason and a retry; it never gets a raw
// runtime error, and it never gets an empty panel that reads like "no rows".
//
// Framework-free and side-effect-free so it can be unit-tested without a DOM.

export interface BodyRead {
  ok: boolean;
  json: any;
  /** Why the body could not be used, when `ok` is false. */
  note?: string;
}

export async function readBody(res: Response): Promise<BodyRead> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, json: null, note: "THE CONNECTION DROPPED PART-WAY THROUGH THE RESPONSE" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      json: null,
      note: res.ok
        ? "THE SERVER RETURNED AN EMPTY RESPONSE — THE REQUEST WAS CUT OFF MID-SCAN. HIT RETRY; IF IT REPEATS, THE SCAN IS EXCEEDING ITS TIME BUDGET."
        : `THE SERVER RETURNED NOTHING (HTTP ${res.status}).`,
    };
  }
  if (trimmed.startsWith("<")) {
    return {
      ok: false,
      json: null,
      note: `THE SERVER RETURNED AN HTML PAGE, NOT DATA (HTTP ${res.status}) — THE ROUTE FAILED BEFORE IT ANSWERED.`,
    };
  }
  try {
    return { ok: true, json: JSON.parse(trimmed) };
  } catch {
    return {
      ok: false,
      json: null,
      note: "THE RESPONSE WAS CUT OFF MID-BODY AND COULD NOT BE PARSED. HIT RETRY; A PARTIAL PAYLOAD IS NEVER RENDERED AS DATA.",
    };
  }
}