// Shared fetch leg for desks.
//
// One hook, used by every panel that pulls an /api payload, so the failure
// surface is identical across the terminal. It exists because the naive
// `res.json()` turns three different server misbehaviours into one opaque
// browser string; `readBody` classifies them first and the hook surfaces the
// reason with a retry.

"use client";

import { useEffect, useRef, useState } from "react";
import { readBody } from "@/lib/readResponse";

export interface Leg<T> {
  data: T | null;
  err: string;
  loading: boolean;
  reload: () => void;
}

export function useDeskFetch<T>(url: string | null): Leg<T> {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(!!url);
  const [nonce, setNonce] = useState(0);
  // `seq` stops a slow earlier response from overwriting a newer one — switching
  // subject faster than a registry answers is the normal way these desks are used.
  const seq = useRef(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      setErr("");
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setErr("");
    (async () => {
      let res: Response;
      try {
        res = await fetch(url);
      } catch {
        if (my === seq.current) {
          setErr("COULD NOT REACH THE SERVER — CHECK THE CONNECTION AND HIT RETRY.");
          setLoading(false);
        }
        return;
      }
      const body = await readBody(res);
      if (my !== seq.current) return;
      if (!body.ok) setErr(body.note ?? `HTTP ${res.status}`);
      else if (body.json?.ok === false) setErr(String(body.json.error ?? `HTTP ${res.status}`));
      else setData(body.json as T);
      setLoading(false);
    })();
  }, [url, nonce]);

  return { data, err, loading, reload: () => setNonce((n) => n + 1) };
}