const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// ── Mapeo símbolo Yahoo → Stooq ──
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

let cache = { data: null, ts: 0 };

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

async function fetchStooq(ySym, sSym) {
  const url = `https://stooq.com/q/l/?f=sd2t2ohlcvde&h&e=csv&s=${sSym}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
  const chgF  = parseFloat(row['Change']);
  const pctF  = parseFloat(row['Change%']);

  if (isNaN(close) || close <= 0) throw new Error('precio inválido');

  const change = !isNaN(chgF) ? chgF : (close - open);
  const pct    = !isNaN(pctF) ? pctF : (open > 0 ? (change / open) * 100 : 0);

  return {
    symbol: ySym,
    regularMarketPrice:         close,
    regularMarketChange:        change,
    regularMarketChangePercent: pct,
    regularMarketVolume:        parseInt(row['Volume'] || '0'),
    regularMarketOpen:          open,
  };
}

async function fetchAllMarket() {
  const results = await Promise.allSettled(
    Object.entries(SYMBOLS).map(([ySym, sSym]) => fetchStooq(ySym, sSym))
  );

  const quotes = [];
  for (const r of results) {
    if (r.status === 'fulfilled') quotes.push(r.value);
    else console.warn('[stooq] fallo:', r.reason?.message);
  }

  if (!quotes.length) throw new Error('sin datos de Stooq');
  return { quoteResponse: { result: quotes, error: null } };
}

// ── GET /api/market ──────────────────────────────────────
app.get('/api/market', async (req, res) => {
  try {
    const data = await fetchAllMarket();
    cache = { data, ts: Date.now() };
    res.json({ ...data, _ts: cache.ts, _cached: false });
  } catch (e) {
    console.error('[api/market]', e.message);
    if (cache.data) {
      const age = Date.now() - cache.ts;
      console.warn('usando cache de', Math.round(age / 1000), 's atrás');
      res.json({ ...cache.data, _ts: cache.ts, _cached: true, _age: age });
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
    cacheAge:  cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'sin datos',
  });
});

app.listen(PORT, () => console.log(`ggal-backend en puerto ${PORT}`));
