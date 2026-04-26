// ================================================================
// GLOBALS — destructure from UMD bundles
// ================================================================
const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} = Recharts;

// ================================================================
// STOCK DATABASE  (IPO date · IPO price · GBM params)
// ================================================================
const STOCK_DB = {
  AAPL:  { name: 'Apple Inc.',                         ipoDate: '1980-12-12', ipoPrice: 0.10,  drift: 0.18, vol: 0.28 },
  MSFT:  { name: 'Microsoft Corporation',              ipoDate: '1986-03-13', ipoPrice: 0.09,  drift: 0.22, vol: 0.25 },
  AMZN:  { name: 'Amazon.com Inc.',                    ipoDate: '1997-05-15', ipoPrice: 0.08,  drift: 0.30, vol: 0.42 },
  NVDA:  { name: 'NVIDIA Corporation',                 ipoDate: '1999-01-22', ipoPrice: 0.37,  drift: 0.38, vol: 0.58 },
  GOOGL: { name: 'Alphabet Inc.',                      ipoDate: '2004-08-19', ipoPrice: 42.77, drift: 0.23, vol: 0.26 },
  META:  { name: 'Meta Platforms Inc.',                ipoDate: '2012-05-18', ipoPrice: 38.00, drift: 0.28, vol: 0.38 },
  TSLA:  { name: 'Tesla Inc.',                         ipoDate: '2010-06-29', ipoPrice: 1.60,  drift: 0.40, vol: 0.72 },
  AMD:   { name: 'Advanced Micro Devices',             ipoDate: '1972-09-27', ipoPrice: 0.03,  drift: 0.30, vol: 0.56 },
  SMCI:  { name: 'Super Micro Computer Inc.',          ipoDate: '2007-03-29', ipoPrice: 14.00, drift: 0.35, vol: 0.68 },
  PLTR:  { name: 'Palantir Technologies',              ipoDate: '2020-09-30', ipoPrice: 7.25,  drift: 0.25, vol: 0.62 },
  ARM:   { name: 'Arm Holdings plc',                   ipoDate: '2023-09-14', ipoPrice: 56.10, drift: 0.25, vol: 0.46 },
  SPY:   { name: 'SPDR S&P 500 ETF Trust',            ipoDate: '1993-01-22', ipoPrice: 43.94, drift: 0.10, vol: 0.16 },
  QQQ:   { name: 'Invesco QQQ Trust',                 ipoDate: '1999-03-10', ipoPrice: 48.09, drift: 0.14, vol: 0.22 },
  TQQQ:  { name: 'ProShares UltraPro QQQ (3x)',       ipoDate: '2010-02-09', ipoPrice: 3.60,  drift: 0.28, vol: 0.90 },
  SOXL:  { name: 'Direxion Daily Semis 3x Bull ETF',  ipoDate: '2010-03-11', ipoPrice: 21.00, drift: 0.22, vol: 1.20 },
  NVDL:  { name: 'GraniteShares 2x Long NVDA ETF',    ipoDate: '2022-12-13', ipoPrice: 14.50, drift: 0.65, vol: 1.10 },
  SOFI:  { name: 'SoFi Technologies',                  ipoDate: '2021-06-01', ipoPrice: 22.00, drift: -0.05, vol: 0.56 },
  RIVN:  { name: 'Rivian Automotive',                  ipoDate: '2021-11-10', ipoPrice: 78.00, drift: -0.25, vol: 0.80 },
  LCID:  { name: 'Lucid Group',                        ipoDate: '2021-07-26', ipoPrice: 25.00, drift: -0.30, vol: 0.84 },
  POET:  { name: 'POET Technologies Inc.',              ipoDate: '2021-01-15', ipoPrice: 8.00,  drift: 0.05, vol: 0.88 },
};

// ================================================================
// UTILITIES
// ================================================================
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isBusinessDay(date) {
  const dow = date.getDay();
  return dow !== 0 && dow !== 6;
}

function getBusinessDays(startStr, endStr) {
  const days = [];
  const cur = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  while (cur <= end) {
    if (isBusinessDay(cur)) days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function getDCAPurchaseDates(businessDays, frequency) {
  if (frequency === 'daily') return businessDays;
  const result = [];
  const seen = new Set();
  for (const day of businessDays) {
    let key;
    if (frequency === 'weekly') {
      const dow = day.getDay();
      const daysBack = dow === 0 ? 6 : dow - 1;
      const monday = new Date(day.getTime() - daysBack * 86400000);
      key = formatDate(monday);
    } else {
      key = `${day.getFullYear()}-${day.getMonth()}`;
    }
    if (!seen.has(key)) { seen.add(key); result.push(day); }
  }
  return result;
}

// Mulberry32 seeded PRNG (fast, good quality)
function mulberry32(seed) {
  seed = seed >>> 0;
  return function () {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(rand) {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Geometric Brownian Motion price generator
function generateGBMPrices(ticker, startDateStr, endDateStr) {
  const stock = STOCK_DB[ticker];
  if (!stock) return new Map();

  const { ipoDate, ipoPrice, drift, vol } = stock;
  const dt = 1 / 252;
  const priceMap = new Map();

  const yearsElapsed = Math.max(
    0,
    (parseLocalDate(startDateStr) - parseLocalDate(ipoDate)) / (365.25 * 86400000)
  );

  const seed = hashStr(ticker + startDateStr);
  const rand = mulberry32(seed);

  // Derive plausible starting price via GBM expected value + seeded randomness
  const logMean = (drift - 0.5 * vol * vol) * yearsElapsed;
  const logStd  = vol * Math.sqrt(Math.max(yearsElapsed, 0.5));
  const z0 = boxMuller(rand);
  let price = Math.max(ipoPrice * Math.exp(logMean + logStd * z0 * 0.45), 0.01);

  const cur = parseLocalDate(startDateStr);
  const end = parseLocalDate(endDateStr);
  while (cur <= end) {
    if (isBusinessDay(cur)) {
      const Z = boxMuller(rand);
      price = Math.max(
        price * Math.exp((drift - 0.5 * vol * vol) * dt + vol * Math.sqrt(dt) * Z),
        0.01
      );
      priceMap.set(formatDate(cur), price);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return priceMap;
}

function sampleData(data, maxPts = 300) {
  if (data.length <= maxPts) return data;
  const step = Math.floor(data.length / maxPts);
  return data.filter((_, i) => i % step === 0 || i === data.length - 1);
}

function fmtUSD(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function filterStocks(query) {
  if (!query || !query.trim()) return [];
  const q = query.toUpperCase().trim();
  return Object.entries(STOCK_DB)
    .filter(([t, s]) => t.includes(q) || s.name.toUpperCase().includes(q))
    .slice(0, 9);
}

// ================================================================
// INLINE SVG ICONS
// ================================================================
const SearchIcon = ({ size = 16, cls = '' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const TrendUp = ({ size = 20, cls = '' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);
const TrendDown = ({ size = 20, cls = '' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
    <polyline points="16 17 22 17 22 11" />
  </svg>
);
const DollarIcon = ({ size = 18, cls = '' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const CalIcon = ({ size = 16, cls = '' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const ChartIcon = ({ size = 20, cls = '' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

// ================================================================
// COMPONENT — StockSearch
// ================================================================
function StockSearch({ selectedTicker, onSelect }) {
  const [query, setQuery]   = useState(selectedTicker || '');
  const [open, setOpen]     = useState(false);
  const containerRef        = useRef(null);

  useEffect(() => { setQuery(selectedTicker || ''); }, [selectedTicker]);

  useEffect(() => {
    function onOut(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  const suggestions = useMemo(() => filterStocks(query), [query]);
  const stockInfo   = selectedTicker ? STOCK_DB[selectedTicker] : null;

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    if (!STOCK_DB[val.toUpperCase().trim()]) onSelect(null);
  }

  function handleSelect(ticker) {
    setQuery(ticker);
    onSelect(ticker);
    setOpen(false);
  }

  const inputBase = 'w-full bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-all text-sm font-mono tracking-wide';

  return (
    <div ref={containerRef} className="relative">
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
        <SearchIcon size={12} />투자 종목
      </label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          placeholder="티커 입력  (예: AAPL, NVDA)"
          className={inputBase}
          autoComplete="off"
          spellCheck="false"
        />
        {selectedTicker && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">✓</span>
        )}
      </div>
      {stockInfo && (
        <p className="text-xs text-slate-500 mt-1 truncate">{stockInfo.name}&nbsp;·&nbsp;상장: {stockInfo.ipoDate}</p>
      )}
      {open && suggestions.length > 0 && (
        <div className="dropdown-animate absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
          {suggestions.map(([ticker, s]) => (
            <button
              key={ticker}
              onMouseDown={e => { e.preventDefault(); handleSelect(ticker); }}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-700/80 transition-colors text-left border-b border-slate-700/40 last:border-0"
            >
              <span className="font-mono font-bold text-emerald-400 text-sm w-14 shrink-0">{ticker}</span>
              <span className="text-slate-300 text-xs truncate">{s.name}</span>
              <span className="text-slate-600 text-xs ml-auto shrink-0">{s.ipoDate.slice(0, 4)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================
// COMPONENT — ResultCard
// ================================================================
function ResultCard({ title, subtitle, value, type, icon, fmt }) {
  const colors = {
    neutral:  { text: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-500/20'    },
    positive: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-500/20' },
    negative: { text: 'text-red-400',     bg: 'bg-red-400/10',     border: 'border-red-500/20'     },
  };
  const c = colors[type] || colors.neutral;
  return (
    <div className={`result-card bg-slate-900 rounded-2xl border ${c.border} p-5 flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-sm font-medium">{title}</span>
        <div className={`${c.bg} ${c.text} p-2 rounded-lg`}>{icon}</div>
      </div>
      <div>
        <div className={`text-2xl font-bold font-mono ${c.text}`}>{fmt(value)}</div>
        {subtitle && <div className="text-slate-500 text-xs mt-1">{subtitle}</div>}
      </div>
    </div>
  );
}

// ================================================================
// COMPONENT — CustomTooltip for Recharts
// ================================================================
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const inv = payload.find(p => p.dataKey === 'totalInvested');
  const pf  = payload.find(p => p.dataKey === 'portfolioValue');
  const roi = payload.find(p => p.dataKey === 'roi');
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 16px', minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <p style={{ color: '#64748b', fontSize: 11, marginBottom: 8, fontWeight: 600 }}>{label}</p>
      {inv && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 4 }}>
          <span style={{ color: '#60a5fa', fontSize: 12 }}>누적 투자금액</span>
          <span style={{ color: '#f1f5f9', fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
            ${inv.value.toLocaleString('en-US')}
          </span>
        </div>
      )}
      {pf && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 4 }}>
          <span style={{ color: '#34d399', fontSize: 12 }}>평가 금액</span>
          <span style={{ color: '#f1f5f9', fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
            ${pf.value.toLocaleString('en-US')}
          </span>
        </div>
      )}
      {roi && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, borderTop: '1px solid #1e293b', paddingTop: 6, marginTop: 4 }}>
          <span style={{ color: '#fbbf24', fontSize: 12 }}>수익률 (ROI)</span>
          <span style={{ color: roi.value >= 0 ? '#10b981' : '#f87171', fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>
            {roi.value >= 0 ? '+' : ''}{roi.value.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}

// ================================================================
// COMPONENT — DCAChart
// ================================================================
function DCAChart({ data, ticker }) {
  const fmtX = useCallback((dateStr) => {
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }, []);

  const fmtLeft  = v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v}`;
  const fmtRight = v => `${v.toFixed(0)}%`;

  const tickInterval = useMemo(
    () => (data.length <= 12 ? 0 : Math.max(1, Math.floor(data.length / 8) - 1)),
    [data.length]
  );

  const legendFormatter = name => {
    const labels = { totalInvested: '누적 투자금액', portfolioValue: '평가금액', roi: 'ROI (%)' };
    return <span style={{ color: '#94a3b8', fontSize: 12 }}>{labels[name] || name}</span>;
  };

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6">
      <div className="flex items-center gap-2 mb-6">
        <ChartIcon cls="text-emerald-400" />
        <h3 className="text-white font-semibold">{ticker} — DCA 시뮬레이션 결과</h3>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={data} margin={{ top: 10, right: 60, left: 10, bottom: 10 }}>
          <defs>
            <linearGradient id="gradInvested" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="gradPortfolio" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fill: '#475569', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#1e293b' }}
            interval={tickInterval}
            tickFormatter={fmtX}
          />

          <YAxis
            yAxisId="left"
            tick={{ fill: '#475569', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtLeft}
            width={72}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: '#475569', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtRight}
            width={52}
          />

          <Tooltip content={<CustomTooltip />} />
          <Legend formatter={legendFormatter} wrapperStyle={{ paddingTop: 16 }} />

          <Area
            yAxisId="left"
            type="monotone"
            dataKey="totalInvested"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#gradInvested)"
            dot={false}
            activeDot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="portfolioValue"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#gradPortfolio)"
            dot={false}
            activeDot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="roi"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }}
            strokeDasharray="5 3"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ================================================================
// COMPONENT — App (main)
// ================================================================
function App() {
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [startDate,  setStartDate]  = useState('');
  const [endDate,    setEndDate]    = useState('');
  const [frequency,  setFrequency]  = useState('monthly');
  const [amount,     setAmount]     = useState('500');
  const [results,    setResults]    = useState(null);
  const [chartData,  setChartData]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [buyCount,   setBuyCount]   = useState(0);

  const stock   = selectedTicker ? STOCK_DB[selectedTicker] : null;
  const ipoDate = stock ? stock.ipoDate : '';
  const today   = formatDate(new Date());

  // Auto-clamp start date to IPO date
  useEffect(() => {
    if (ipoDate && startDate && startDate < ipoDate) setStartDate(ipoDate);
  }, [ipoDate, startDate]);

  const handleCalculate = useCallback(() => {
    if (!selectedTicker)               { setError('⚠️ 투자 종목을 선택해주세요.'); return; }
    if (!startDate)                    { setError('⚠️ 투자 시작일을 선택해주세요.'); return; }
    if (!endDate)                      { setError('⚠️ 투자 종료일을 선택해주세요.'); return; }
    if (startDate >= endDate)          { setError('⚠️ 종료일은 시작일보다 이후여야 합니다.'); return; }
    if (ipoDate && startDate < ipoDate){ setError(`⚠️ ${selectedTicker} 상장일(${ipoDate}) 이후부터 투자 가능합니다.`); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0)              { setError('⚠️ 1회 투자 금액을 올바르게 입력해주세요.'); return; }

    setError('');
    setResults(null);
    setLoading(true);

    setTimeout(() => {
      try {
        const priceMap   = generateGBMPrices(selectedTicker, startDate, endDate);
        const bizDays    = getBusinessDays(startDate, endDate);
        const buyDates   = getDCAPurchaseDates(bizDays, frequency);
        const buySet     = new Set(buyDates.map(d => formatDate(d)));

        let shares = 0, invested = 0;
        const raw = [];

        for (const day of bizDays) {
          const ds    = formatDate(day);
          const price = priceMap.get(ds);
          if (price === undefined) continue;

          if (buySet.has(ds)) {
            shares   += amt / price;
            invested += amt;
          }

          if (invested > 0) {
            const pv  = shares * price;
            const roi = ((pv - invested) / invested) * 100;
            raw.push({
              date: ds,
              totalInvested: Math.round(invested),
              portfolioValue: Math.round(pv),
              roi: parseFloat(roi.toFixed(2)),
            });
          }
        }

        if (raw.length === 0) { setError('⚠️ 해당 기간에 산출된 데이터가 없습니다.'); return; }

        const last = raw[raw.length - 1];
        setChartData(sampleData(raw, 300));
        setResults({
          totalInvested: last.totalInvested,
          finalValue:    last.portfolioValue,
          roi:           last.roi,
        });
        setBuyCount(buyDates.length);
      } catch (err) {
        setError('⚠️ 계산 중 오류가 발생했습니다: ' + err.message);
      } finally {
        setLoading(false);
      }
    }, 60);
  }, [selectedTicker, startDate, endDate, frequency, amount, ipoDate]);

  // ── Shared input styles ──
  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-all text-sm';
  const labelCls = 'flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5';

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg,#020617 0%,#0a1628 50%,#020617 100%)' }}>

      {/* ── Header ── */}
      <header style={{ background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(30,41,59,0.8)' }}
              className="sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">
              <TrendUp cls="text-emerald-400" size={22} />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">DCA 계산기</h1>
              <p className="text-slate-500 text-xs">미국 주식 적립식 투자 시뮬레이터</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-1.5">
            <span className="pulse-dot"></span>
            GBM 시뮬레이션
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Input Card ── */}
        <div className="bg-slate-900/80 backdrop-blur rounded-2xl border border-slate-800 p-6 shadow-2xl">
          <h2 className="text-white font-semibold text-base mb-5 flex items-center gap-2">
            <CalIcon cls="text-emerald-400" size={18} />
            투자 조건 설정
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Stock Search */}
            <div className="sm:col-span-2 lg:col-span-1">
              <StockSearch selectedTicker={selectedTicker} onSelect={setSelectedTicker} />
            </div>

            {/* Start Date */}
            <div>
              <label className={labelCls}><CalIcon size={12} />시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                min={ipoDate || '1970-01-01'}
                max={endDate || today}
                className={inputCls}
              />
              {ipoDate && <p className="text-xs text-slate-600 mt-1">최소: {ipoDate}</p>}
            </div>

            {/* End Date */}
            <div>
              <label className={labelCls}><CalIcon size={12} />종료일</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                min={startDate || ipoDate || '1970-01-01'}
                max={today}
                className={inputCls}
              />
            </div>

            {/* Frequency */}
            <div>
              <label className={labelCls}>투자 주기</label>
              <select
                value={frequency}
                onChange={e => setFrequency(e.target.value)}
                className={inputCls}
                style={{
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 14px center',
                }}
              >
                <option value="daily">Daily — 매영업일</option>
                <option value="weekly">Weekly — 매주 첫 거래일</option>
                <option value="monthly">Monthly — 매월 첫 거래일</option>
              </select>
            </div>
          </div>

          {/* Amount + Button */}
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="w-full sm:w-64">
              <label className={labelCls}><DollarIcon size={12} />1회 투자 금액 (USD)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm select-none">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="500"
                  min="1"
                  step="100"
                  className={inputCls + ' pl-8'}
                />
              </div>
            </div>

            <button
              onClick={handleCalculate}
              disabled={loading}
              className="px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all duration-200 whitespace-nowrap active:scale-95"
              style={{
                background: loading ? '#1e293b' : 'linear-gradient(135deg,#10b981,#059669)',
                color: loading ? '#475569' : '#f8fafc',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(16,185,129,0.25)',
                cursor: loading ? 'not-allowed' : 'pointer',
                border: 'none',
              }}
            >
              {loading ? (
                <><span className="loading-spinner" />분석 중...</>
              ) : (
                <><ChartIcon size={18} />분석하기</>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* ── Results ── */}
        {results && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ResultCard
                title="누적 투자 금액"
                subtitle={`${buyCount}회 × $${parseFloat(amount).toLocaleString('en-US')}`}
                value={results.totalInvested}
                type="neutral"
                icon={<DollarIcon size={18} />}
                fmt={v => `$${v.toLocaleString('en-US')}`}
              />
              <ResultCard
                title="최종 평가액"
                subtitle={`${results.finalValue >= results.totalInvested ? '수익' : '손실'}: ${results.finalValue >= results.totalInvested ? '+' : ''}$${(results.finalValue - results.totalInvested).toLocaleString('en-US')}`}
                value={results.finalValue}
                type={results.finalValue >= results.totalInvested ? 'positive' : 'negative'}
                icon={results.finalValue >= results.totalInvested ? <TrendUp size={18} /> : <TrendDown size={18} />}
                fmt={v => `$${v.toLocaleString('en-US')}`}
              />
              <ResultCard
                title="최종 수익률 (ROI)"
                subtitle={results.roi >= 0 ? '투자 수익 달성 🎉' : '투자 손실 발생'}
                value={results.roi}
                type={results.roi >= 0 ? 'positive' : 'negative'}
                icon={results.roi >= 0 ? <TrendUp size={18} /> : <TrendDown size={18} />}
                fmt={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
              />
            </div>

            {/* Chart */}
            {chartData.length > 0 && <DCAChart data={chartData} ticker={selectedTicker} />}

            {/* Disclaimer */}
            <p className="text-center text-slate-700 text-xs pb-2">
              ⚠️ 본 시뮬레이션은 기하브라운운동(GBM) 기반의 모의 데이터이며 실제 투자 결과와 다를 수 있습니다. 투자 결정의 근거로 사용하지 마세요.
            </p>
          </>
        )}

        {/* Empty state */}
        {!results && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600">
            <div className="bg-slate-900/60 border border-slate-800 rounded-full p-8 mb-5">
              <ChartIcon size={44} cls="text-slate-700" />
            </div>
            <p className="text-lg font-semibold text-slate-500">종목과 기간을 설정하고 분석을 시작하세요</p>
            <p className="text-sm mt-2 text-slate-700">GBM 알고리즘으로 DCA 수익률 곡선을 시뮬레이션합니다</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ================================================================
// MOUNT
// ================================================================
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
