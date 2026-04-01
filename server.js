const express = require('express');
const yahooFinance = require('yahoo-finance2').default;

const app  = express();
const PORT = process.env.PORT || 3000;

const SYMBOLS = ['GGAL', 'GGAL.BA', '^GSPC', '^IXIC', '^DJI', '^MERV', 'BMA.BA', 'BBAR.BA', 'SUPV.BA'];

let cache = { data: null, ts: 0 };

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

async function fetchAllMarket() {
  const results = await Promise.allSettled(
    SYMBOLS.map(s => yahooFinance.quote(s, {}, { validateResult: false }))
  );

  const quotes = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      const q = r.value;
      quotes.push({
        symbol:                     q.symbol,
        regularMarketPrice:         q.regularMarketPrice,
        regularMarketChange:        q.regularMarketChange,
        regularMarketChangePercent: q.regularMarketChangePercent,
        regularMarketVolume:        q.regularMarketVolume,
        regularMarketOpen:          q.regularMarketOpen,
      });
    } else {
      console.warn('[yahoo-finance2]', SYMBOLS[i], r.reason?.message || r.reason);
    }
  }

  if (!quotes.length) throw new Error('sin datos de Yahoo Finance');
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
