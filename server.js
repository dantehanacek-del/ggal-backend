const express = require('express');
const app  = express();
const PORT = process.env.PORT || 3000;

const SYMBOLS = {
  'GGAL':    'ggal.us',
  'GGAL.BA': 'ggal.ba',
  '^GSPC':   '^spx',
  '^IXIC':   '^ndq',
  '^DJI':    '^dji',
  '^MERV':   '^merv',
  'BMA.BA':  'bma.ba',
  'BBAR.BA': 'bbar.ba',
  'SUPV.BA': 'supv.ba',
};

const STOOQ_URL = s => `https://stooq.com/q/l/?f=sd2t2ohlcvde&h&e=csv&s=${s}`;

let cache = { data: null, ts: 0 };

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Parsea el CSV de Stooq.
// El orden REAL de los datos es: Symbol, Time, Open, High, Low, Close, Volume..., Date
// (Stooq devuelve Date al final aunque los headers digan otra cosa)
// Volume puede tener comas internas → detectamos el campo Date por patrón YYYY-MM-DD
function parseStooqCsv(text) {
  const lines = text.trim().replace(/\r/g, '').split('\n');
  if (lines.length < 2) throw new Error('CSV vacío');

  const parts = lines[1].split(',').map(v => v.trim());
  // parts[0] = Symbol
  // parts[1] = Time
  // parts[2] = Open
  // parts[3] = High
  // parts[4] = Low
  // parts[5] = Close  ← precio real
  // parts[6..n-1] = Volume (puede estar partido por comas)
  // parts[n] = Date (YYYY-MM-DD)

  const close = parseFloat(parts[5]);
  const open  = parseFloat(parts[2]);

  if (isNaN(close) || close <= 0) throw new Error('precio inválido, raw: ' + lines[1]);

  // Acumular partes de Volume hasta encontrar el campo Date (YYYY-MM-DD)
  const volParts = [];
  const dateRe   = /^\d{4}-\d{2}-\d{2}$/;
  for (let i = 6; i < parts.length; i++) {
    if (dateRe.test(parts[i])) break;
    volParts.push(parts[i]);
  }
  const volume = parseInt(volParts.join('').replace(/,/g, '')) || 0;

  const chg = isNaN(open) ? 0 : close - open;
  const pct = (!isNaN(open) && open > 0) ? (chg / open) * 100 : 0;

  return { close, open: isNaN(open) ? close : open, chg, pct, volume };
}

async function fetchStooq(ySym, sSym) {
  const r = await fetch(STOOQ_URL(sSym), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  const { close, open, chg, pct, volume } = parseStooqCsv(text);

  return {
    symbol:                     ySym,
    regularMarketPrice:         close,
    regularMarketChange:        chg,
    regularMarketChangePercent: pct,
    regularMarketVolume:        volume,
    regularMarketOpen:          open,
  };
}

async function fetchAll() {
  const results = await Promise.allSettled(
    Object.entries(SYMBOLS).map(([ySym, sSym]) => fetchStooq(ySym, sSym))
  );

  const quotes = [];
  for (const r of results) {
    if (r.status === 'fulfilled') quotes.push(r.value);
    else console.warn('[stooq]', r.reason?.message);
  }

  if (!quotes.length) throw new Error('sin datos');
  return { quoteResponse: { result: quotes, error: null } };
}

app.get('/api/market', async (req, res) => {
  try {
    const data = await fetchAll();
    cache = { data, ts: Date.now() };
    res.json({ ...data, _ts: cache.ts, _cached: false });
  } catch (e) {
    console.error('[api/market]', e.message);
    if (cache.data) {
      const age = Date.now() - cache.ts;
      res.json({ ...cache.data, _ts: cache.ts, _cached: true, _age: age });
    } else {
      res.status(503).json({ error: e.message });
    }
  }
});

// ── GET /debug/stooq?s=ggal.us — ver CSV crudo ──────────
app.get('/debug/stooq', async (req, res) => {
  const s = req.query.s || 'ggal.us';
  try {
    const r = await fetch(STOOQ_URL(s), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    res.type('text').send(text);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    lastFetch: cache.ts ? new Date(cache.ts).toISOString() : null,
    cacheAge:  cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'sin datos',
  });
});

app.listen(PORT, () => console.log(`ggal-backend en puerto ${PORT}`));
