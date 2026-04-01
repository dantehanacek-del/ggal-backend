const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const SYMBOLS = 'GGAL,GGAL.BA,^GSPC,^IXIC,^DJI,^MERV,BMA.BA,BBAR.BA,SUPV.BA';
const YF_ENDPOINTS = [
  `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${encodeURIComponent(SYMBOLS)}`,
  `https://query2.finance.yahoo.com/v8/finance/quote?symbols=${encodeURIComponent(SYMBOLS)}`,
];
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

let cache = { data: null, ts: 0 };

// ── CORS: allow any origin (frontend on GitHub Pages) ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

async function fetchYahoo() {
  for (const url of YF_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        headers: YF_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (!data?.quoteResponse?.result?.length) throw new Error('respuesta vacía');
      return data;
    } catch (e) {
      console.warn('[yahoo]', e.message);
    }
  }
  throw new Error('todos los endpoints de Yahoo fallaron');
}

// ── GET /api/market ──────────────────────────────────────
// Devuelve quotes de Yahoo Finance. Si falla, devuelve cache con _cached:true
app.get('/api/market', async (req, res) => {
  try {
    const data = await fetchYahoo();
    cache = { data, ts: Date.now() };
    res.json({ ...data, _ts: cache.ts, _cached: false });
  } catch (e) {
    if (cache.data) {
      console.warn('[api/market] usando cache de', Math.round((Date.now() - cache.ts) / 1000), 's atrás');
      res.json({ ...cache.data, _ts: cache.ts, _cached: true, _age: Date.now() - cache.ts });
    } else {
      res.status(503).json({ error: e.message });
    }
  }
});

// ── GET /health ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    lastFetch: cache.ts ? new Date(cache.ts).toISOString() : null,
    cacheAge: cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'sin datos',
  });
});

app.listen(PORT, () => console.log(`ggal-backend corriendo en puerto ${PORT}`));
