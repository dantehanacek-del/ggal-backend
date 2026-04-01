const express = require('express');
const app  = express();
const PORT = process.env.PORT || 3000;

// Mapeo símbolo (formato Yahoo) → símbolo Stooq
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

// Formato sin volumen (v) para evitar comas en números que rompen el CSV
// f=sd2ohlcde → Symbol, Date, Open, High, Low, Close, Change, Change%
const STOOQ_URL = s => `https://stooq.com/q/l/?f=sd2ohlcde&h&e=csv&s=${s}`;

let cache = { data: null, ts: 0 };

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

async function fetchStooq(ySym, sSym) {
  const r = await fetch(STOOQ_URL(sSym), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();

  const lines = text.trim().replace(/\r/g, '').split('\n');
  if (lines.length < 2) throw new Error('CSV vacío');

  const headers = lines[0].split(',').map(h => h.trim());
  const vals    = lines[1].split(',').map(v => v.trim());

  const row = {};
  headers.forEach((h, i) => row[h] = vals[i]);

  const close = parseFloat(row['Close']);
  const open  = parseFloat(row['Open']);
  const chg   = parseFloat(row['Change']);
  const pct   = parseFloat(row['Change%']);

  if (isNaN(close) || close <= 0) throw new Error('precio inválido: ' + JSON.stringify(row));

  return {
    symbol:                     ySym,
    regularMarketPrice:         close,
    regularMarketChange:        isNaN(chg) ? 0 : chg,
    regularMarketChangePercent: isNaN(pct) ? 0 : pct,
    regularMarketVolume:        0,
    regularMarketOpen:          isNaN(open) ? close : open,
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

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    lastFetch: cache.ts ? new Date(cache.ts).toISOString() : null,
    cacheAge:  cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'sin datos',
  });
});

app.listen(PORT, () => console.log(`ggal-backend en puerto ${PORT}`));
