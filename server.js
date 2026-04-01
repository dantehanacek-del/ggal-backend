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

// Parsea el CSV de Stooq manejando comas dentro del campo Volume
function parseStooqCsv(text) {
  const lines = text.trim().replace(/\r/g, '').split('\n');
  if (lines.length < 2) throw new Error('CSV vacío');

  const headers = lines[0].split(',').map(h => h.trim());
  const rawVals = lines[1].split(',').map(v => v.trim());

  // Volume puede tener comas internas (ej: "1,234,567") que generan columnas extra
  const extra  = rawVals.length - headers.length;
  const volIdx = headers.indexOf('Volume');

  // Reconstruir valores fusionando las partes extra en el campo Volume
  const vals = [];
  let ri = 0;
  for (let hi = 0; hi < headers.length; hi++) {
    if (hi === volIdx && extra > 0) {
      vals.push(rawVals.slice(ri, ri + extra + 1).join(''));
      ri += extra + 1;
    } else {
      vals.push(rawVals[ri++]);
    }
  }

  const row = {};
  headers.forEach((h, i) => row[h] = vals[i]);

  const close = parseFloat(row['Close']);
  const open  = parseFloat(row['Open']);
  const chg   = parseFloat(row['Change']);
  const pct   = parseFloat(row['Change%']);

  if (isNaN(close) || close <= 0) throw new Error('precio inválido: ' + JSON.stringify(row));

  return {
    close,
    open:   isNaN(open) ? close : open,
    chg:    isNaN(chg)  ? 0     : chg,
    pct:    isNaN(pct)  ? 0     : pct,
    volume: parseInt((row['Volume'] || '0').replace(/,/g, '')) || 0,
  };
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

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    lastFetch: cache.ts ? new Date(cache.ts).toISOString() : null,
    cacheAge:  cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'sin datos',
  });
});

app.listen(PORT, () => console.log(`ggal-backend en puerto ${PORT}`));
