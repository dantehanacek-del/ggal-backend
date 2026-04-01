const express = require('express');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Stooq: funciona para símbolos US ──
const STOOQ_SYMS = {
  'GGAL':  'ggal.us',
  '^GSPC': '^spx',
  '^IXIC': '^ndq',
  '^DJI':  '^dji',
};

// ── data.json generado por GitHub Actions cada 5 min (Yahoo Finance desde GitHub servers) ──
const DATA_JSON_URL = 'https://raw.githubusercontent.com/dantehanacek-del/ggal-dashboard/main/data.json';
const AR_SYMS = new Set(['GGAL.BA', '^MERV', 'BMA.BA', 'BBAR.BA', 'SUPV.BA']);

const STOOQ_URL = s => `https://stooq.com/q/l/?f=sd2t2ohlcvde&h&e=csv&s=${s}`;

let cache = { data: null, ts: 0 };

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Parser Stooq: columnas reales = Symbol, Time, Open, High, Low, Close, Volume..., Date ──
function parseStooqCsv(text) {
  const lines = text.trim().replace(/\r/g, '').split('\n');
  if (lines.length < 2) throw new Error('CSV vacío');

  const parts = lines[1].split(',').map(v => v.trim());
  const close = parseFloat(parts[5]);
  const open  = parseFloat(parts[2]);

  if (isNaN(close) || close <= 0) throw new Error('N/D o precio inválido');

  // Volume: acumular partes hasta el campo Date (YYYY-MM-DD)
  const volParts = [];
  const dateRe   = /^\d{4}-\d{2}-\d{2}$/;
  for (let i = 6; i < parts.length; i++) {
    if (dateRe.test(parts[i])) break;
    volParts.push(parts[i]);
  }
  const volume = parseInt(volParts.join('').replace(/,/g, '')) || 0;
  const chg    = isNaN(open) ? 0 : close - open;
  const pct    = (!isNaN(open) && open > 0) ? (chg / open) * 100 : 0;

  return { close, open: isNaN(open) ? close : open, chg, pct, volume };
}

async function fetchStooq(ySym, sSym) {
  const r = await fetch(STOOQ_URL(sSym), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const { close, open, chg, pct, volume } = parseStooqCsv(await r.text());
  return {
    symbol: ySym, regularMarketPrice: close, regularMarketChange: chg,
    regularMarketChangePercent: pct, regularMarketVolume: volume, regularMarketOpen: open,
  };
}

// Fetch data.json de GitHub Actions (Yahoo Finance, símbolos argentinos)
async function fetchDataJson() {
  const r = await fetch(DATA_JSON_URL + '?v=' + Date.now(), {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const json = await r.json();
  const results = json?.quoteResponse?.result ?? [];
  return results
    .filter(q => AR_SYMS.has(q.symbol))
    .map(q => ({
      symbol:                     q.symbol,
      regularMarketPrice:         q.regularMarketPrice,
      regularMarketChange:        q.regularMarketChange        ?? 0,
      regularMarketChangePercent: q.regularMarketChangePercent ?? 0,
      regularMarketVolume:        q.regularMarketVolume        ?? 0,
      regularMarketOpen:          q.regularMarketOpen          ?? q.regularMarketPrice,
    }));
}

async function fetchAll() {
  const [stooqResults, arQuotes] = await Promise.all([
    Promise.allSettled(Object.entries(STOOQ_SYMS).map(([y, s]) => fetchStooq(y, s))),
    fetchDataJson().catch(e => { console.warn('[data.json]', e.message); return []; }),
  ]);

  const quotes = [];
  for (const r of stooqResults) {
    if (r.status === 'fulfilled') quotes.push(r.value);
    else console.warn('[stooq]', r.reason?.message);
  }
  quotes.push(...arQuotes);

  if (!quotes.length) throw new Error('sin datos');
  return { quoteResponse: { result: quotes, error: null } };
}

// ── GET /api/market ──────────────────────────────────────
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

// ── GET /debug/stooq?s=ggal.us ───────────────────────────
app.get('/debug/stooq', async (req, res) => {
  const s = req.query.s || 'ggal.us';
  try {
    const r = await fetch(STOOQ_URL(s), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    res.type('text').send(await r.text());
  } catch (e) {
    res.status(500).send(e.message);
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
