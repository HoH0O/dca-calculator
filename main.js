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
// DATE UTILITIES
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
function today() { return formatDate(new Date()); }

// DCA purchase-date logic (works on the real trading-day array from yfinance)
function getDCAPurchaseDates(tradingDays, frequency) {
  if (frequency === 'daily') return tradingDays;
  const result = [];
  const seen   = new Set();
  for (const day of tradingDays) {
    let key;
    if (frequency === 'weekly') {
      const dow      = day.getDay();
      const daysBack = dow === 0 ? 6 : dow - 1;
      const monday   = new Date(day.getTime() - daysBack * 86400000);
      key = formatDate(monday);
    } else {
      key = `${day.getFullYear()}-${day.getMonth()}`;
    }
    if (!seen.has(key)) { seen.add(key); result.push(day); }
  }
  return result;
}

function sampleData(arr, maxPts = 300) {
  if (arr.length <= maxPts) return arr;
  const step = Math.floor(arr.length / maxPts);
  return arr.filter((_, i) => i % step === 0 || i === arr.length - 1);
}

// ================================================================
// API CLIENT
// ================================================================
async function apiSearch(q) {
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('검색 실패');
  return r.json(); // [{ticker, name, exchange, type}]
}

async function apiInfo(ticker) {
  const r = await fetch(`/api/info?ticker=${encodeURIComponent(ticker)}`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || '종목 정보 조회 실패');
  return json; // {ticker, name, firstDate, lastDate, currency}
}

async function apiHistory(ticker, start, end) {
  const url = `/api/history?ticker=${encodeURIComponent(ticker)}&start=${start}&end=${end}`;
  const r = await fetch(url);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || '가격 데이터 조회 실패');
  return json.data; // [{date, close}]
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ================================================================
// INLINE SVG ICONS
// ================================================================
const SearchIcon   = ({ size=16, cls='' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const TrendUp      = ({ size=20, cls='' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>
);
const TrendDown    = ({ size=20, cls='' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/>
    <polyline points="16 17 22 17 22 11"/>
  </svg>
);
const DollarIcon   = ({ size=18, cls='' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"/>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
);
const CalIcon      = ({ size=16, cls='' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const ChartIcon    = ({ size=20, cls='' }) => (
  <svg width={size} height={size} className={cls} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const SpinnerIcon  = ({ size=16, cls='' }) => (
  <svg width={size} height={size} className={`animate-spin ${cls}`} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
  </svg>
);

// ================================================================
// COMPONENT — StockSearch (real API)
// ================================================================
function StockSearch({ selectedTicker, tickerInfo, onSelect, onInfoLoaded }) {
  const [query,       setQuery]       = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching,   setSearching]   = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const [open,        setOpen]        = useState(false);
  const containerRef = useRef(null);
  const debouncedSearch = useMemo(
    () => debounce(async (q) => {
      if (!q.trim()) { setSuggestions([]); setSearching(false); return; }
      try {
        const data = await apiSearch(q);
        setSuggestions(Array.isArray(data) ? data : []);
      } catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 320),
    []
  );

  useEffect(() => {
    function onOut(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  // Keep input text in sync when ticker is cleared externally
  useEffect(() => {
    if (!selectedTicker) setQuery('');
  }, [selectedTicker]);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    onSelect(null);
    onInfoLoaded(null);
    if (val.trim()) {
      setSearching(true);
      debouncedSearch(val);
    } else {
      setSuggestions([]);
      setSearching(false);
    }
  }

  async function handleSelect(item) {
    setQuery(item.ticker);
    setSuggestions([]);
    setOpen(false);
    onSelect(item.ticker);
    setInfoLoading(true);
    try {
      const info = await apiInfo(item.ticker);
      onInfoLoaded(info);
    } catch { onInfoLoaded(null); }
    finally { setInfoLoading(false); }
  }

  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-4 pr-10 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-all text-sm font-mono tracking-wide';

  return (
    <div ref={containerRef} className="relative">
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
        <SearchIcon size={12}/>투자 종목 검색
      </label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => { if (suggestions.length) setOpen(true); }}
          placeholder="티커·종목명 입력  (예: AAPL, Tesla)"
          className={inputCls}
          autoComplete="off"
          spellCheck="false"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          {(searching || infoLoading) ? <SpinnerIcon size={15} cls="text-emerald-400"/> : selectedTicker ? <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">✓</span> : null}
        </span>
      </div>
      {tickerInfo && (
        <p className="text-xs text-slate-500 mt-1 truncate">
          {tickerInfo.name}&nbsp;·&nbsp;첫 거래일: {tickerInfo.firstDate}
        </p>
      )}
      {open && suggestions.length > 0 && (
        <div className="dropdown-animate absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s.ticker}
              onMouseDown={e => { e.preventDefault(); handleSelect(s); }}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-700/80 transition-colors text-left border-b border-slate-700/40 last:border-0"
            >
              <span className="font-mono font-bold text-emerald-400 text-sm w-20 shrink-0">{s.ticker}</span>
              <span className="text-slate-300 text-xs truncate flex-1">{s.name}</span>
              <span className="text-slate-600 text-xs shrink-0 ml-auto">{s.type}&nbsp;·&nbsp;{s.exchange}</span>
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
  const C = {
    neutral:  { text: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-500/20'    },
    positive: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-500/20' },
    negative: { text: 'text-red-400',     bg: 'bg-red-400/10',     border: 'border-red-500/20'     },
  }[type] || {};
  return (
    <div className={`result-card bg-slate-900 rounded-2xl border ${C.border} p-5 flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-sm font-medium">{title}</span>
        <div className={`${C.bg} ${C.text} p-2 rounded-lg`}>{icon}</div>
      </div>
      <div>
        <div className={`text-2xl font-bold font-mono ${C.text}`}>{fmt(value)}</div>
        {subtitle && <div className="text-slate-500 text-xs mt-1">{subtitle}</div>}
      </div>
    </div>
  );
}

// ================================================================
// COMPONENT — CustomTooltip
// ================================================================
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const inv = payload.find(p => p.dataKey === 'totalInvested');
  const pf  = payload.find(p => p.dataKey === 'portfolioValue');
  const roi = payload.find(p => p.dataKey === 'roi');
  return (
    <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:'12px 16px', minWidth:210, boxShadow:'0 8px 32px rgba(0,0,0,0.5)' }}>
      <p style={{ color:'#64748b', fontSize:11, marginBottom:8, fontWeight:600 }}>{label}</p>
      {inv && <div style={{ display:'flex', justifyContent:'space-between', gap:24, marginBottom:4 }}>
        <span style={{ color:'#60a5fa', fontSize:12 }}>누적 투자금액</span>
        <span style={{ color:'#f1f5f9', fontSize:12, fontFamily:'monospace', fontWeight:600 }}>${inv.value.toLocaleString('en-US')}</span>
      </div>}
      {pf && <div style={{ display:'flex', justifyContent:'space-between', gap:24, marginBottom:4 }}>
        <span style={{ color:'#34d399', fontSize:12 }}>평가 금액</span>
        <span style={{ color:'#f1f5f9', fontSize:12, fontFamily:'monospace', fontWeight:600 }}>${pf.value.toLocaleString('en-US')}</span>
      </div>}
      {roi && <div style={{ display:'flex', justifyContent:'space-between', gap:24, borderTop:'1px solid #1e293b', paddingTop:6, marginTop:4 }}>
        <span style={{ color:'#fbbf24', fontSize:12 }}>수익률 (ROI)</span>
        <span style={{ color: roi.value>=0?'#10b981':'#f87171', fontSize:12, fontFamily:'monospace', fontWeight:700 }}>
          {roi.value>=0?'+':''}{roi.value.toFixed(2)}%
        </span>
      </div>}
    </div>
  );
}

// ================================================================
// COMPONENT — DCAChart
// ================================================================
function DCAChart({ data, ticker, currency }) {
  const fmtX = useCallback((ds) => {
    const d = parseLocalDate(ds);
    return d.toLocaleDateString('en-US', { month:'short', year:'2-digit' });
  }, []);

  const sym     = currency === 'USD' ? '$' : (currency + ' ');
  const fmtLeft = v => v >= 1e6 ? `${sym}${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${sym}${(v/1e3).toFixed(0)}K` : `${sym}${v}`;
  const fmtRight= v => `${v.toFixed(0)}%`;
  const tickInterval = useMemo(() => data.length <= 12 ? 0 : Math.max(1, Math.floor(data.length/8)-1), [data.length]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6">
      <div className="flex items-center gap-2 mb-6">
        <ChartIcon cls="text-emerald-400"/>
        <h3 className="text-white font-semibold">{ticker} — 실제 가격 기반 DCA 결과</h3>
        <span className="ml-auto text-xs text-slate-600 bg-slate-800 px-2 py-1 rounded-lg">Yahoo Finance</span>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={data} margin={{ top:10, right:65, left:10, bottom:10 }}>
          <defs>
            <linearGradient id="gradInv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35}/>
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02}/>
            </linearGradient>
            <linearGradient id="gradPf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
          <XAxis dataKey="date" tick={{ fill:'#475569', fontSize:11 }} tickLine={false}
            axisLine={{ stroke:'#1e293b' }} interval={tickInterval} tickFormatter={fmtX}/>
          <YAxis yAxisId="left"  tick={{ fill:'#475569', fontSize:11 }} tickLine={false}
            axisLine={false} tickFormatter={fmtLeft}  width={72}/>
          <YAxis yAxisId="right" orientation="right" tick={{ fill:'#475569', fontSize:11 }}
            tickLine={false} axisLine={false} tickFormatter={fmtRight} width={52}/>
          <Tooltip content={<CustomTooltip/>}/>
          <Legend formatter={name => {
            const L = { totalInvested:'누적 투자금액', portfolioValue:'평가금액', roi:'ROI (%)' };
            return <span style={{ color:'#94a3b8', fontSize:12 }}>{L[name]||name}</span>;
          }} wrapperStyle={{ paddingTop:16 }}/>
          <Area yAxisId="left"  type="monotone" dataKey="totalInvested"  stroke="#3b82f6" strokeWidth={2}
            fill="url(#gradInv)" dot={false} activeDot={{ r:4, fill:'#3b82f6', strokeWidth:0 }}/>
          <Area yAxisId="left"  type="monotone" dataKey="portfolioValue" stroke="#10b981" strokeWidth={2}
            fill="url(#gradPf)"  dot={false} activeDot={{ r:4, fill:'#10b981', strokeWidth:0 }}/>
          <Line yAxisId="right" type="monotone" dataKey="roi" stroke="#f59e0b" strokeWidth={2}
            dot={false} activeDot={{ r:4, fill:'#f59e0b', strokeWidth:0 }} strokeDasharray="5 3"/>
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
  const [tickerInfo,     setTickerInfo]     = useState(null); // {name,firstDate,lastDate,currency}
  const [startDate,      setStartDate]      = useState('');
  const [endDate,        setEndDate]        = useState('');
  const [frequency,      setFrequency]      = useState('monthly');
  const [amount,         setAmount]         = useState('500');
  const [results,        setResults]        = useState(null);
  const [chartData,      setChartData]      = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const [buyCount,       setBuyCount]       = useState(0);
  const [dataPoints,     setDataPoints]     = useState(0);

  const firstDate = tickerInfo?.firstDate || '';
  const todayStr  = today();

  // Auto-clamp start date to IPO/first-trade date
  useEffect(() => {
    if (firstDate && startDate && startDate < firstDate) setStartDate(firstDate);
  }, [firstDate, startDate]);

  const handleCalculate = useCallback(async () => {
    if (!selectedTicker)              { setError('⚠️ 투자 종목을 선택해주세요.'); return; }
    if (!startDate)                   { setError('⚠️ 투자 시작일을 선택해주세요.'); return; }
    if (!endDate)                     { setError('⚠️ 투자 종료일을 선택해주세요.'); return; }
    if (startDate >= endDate)         { setError('⚠️ 종료일은 시작일보다 이후여야 합니다.'); return; }
    if (firstDate && startDate < firstDate) {
      setError(`⚠️ ${selectedTicker}의 첫 거래일(${firstDate}) 이후부터 선택 가능합니다.`);
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0)             { setError('⚠️ 1회 투자 금액을 올바르게 입력해주세요.'); return; }

    setError('');
    setResults(null);
    setLoading(true);

    try {
      // Fetch real prices from Yahoo Finance via Flask backend
      const priceData = await apiHistory(selectedTicker, startDate, endDate);

      if (!priceData || priceData.length === 0) {
        setError('⚠️ 해당 기간의 가격 데이터가 없습니다.');
        return;
      }

      setDataPoints(priceData.length);

      // Build trading-day Date array for DCA date selection
      const tradingDays   = priceData.map(d => parseLocalDate(d.date));
      const purchaseDates = getDCAPurchaseDates(tradingDays, frequency);
      const purchaseSet   = new Set(purchaseDates.map(d => formatDate(d)));

      // DCA simulation over real closing prices
      let shares = 0, invested = 0;
      const raw = [];

      for (const { date, close } of priceData) {
        if (purchaseSet.has(date)) {
          shares   += amt / close;
          invested += amt;
        }
        if (invested > 0) {
          const pv  = shares * close;
          const roi = ((pv - invested) / invested) * 100;
          raw.push({
            date,
            totalInvested:  Math.round(invested),
            portfolioValue: Math.round(pv),
            roi: parseFloat(roi.toFixed(2)),
          });
        }
      }

      if (raw.length === 0) {
        setError('⚠️ 해당 기간에 매수 기록이 없습니다. 투자 주기나 날짜를 확인해주세요.');
        return;
      }

      const last = raw[raw.length - 1];
      setChartData(sampleData(raw, 300));
      setResults({
        totalInvested: last.totalInvested,
        finalValue:    last.portfolioValue,
        roi:           last.roi,
      });
      setBuyCount(purchaseDates.length);

    } catch (err) {
      setError('⚠️ ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedTicker, startDate, endDate, frequency, amount, firstDate]);

  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-all text-sm';
  const labelCls = 'flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5';

  return (
    <div className="min-h-screen" style={{ background:'linear-gradient(160deg,#020617 0%,#0a1628 50%,#020617 100%)' }}>

      {/* ── Header ── */}
      <header style={{ background:'rgba(2,6,23,0.85)', backdropFilter:'blur(20px)', borderBottom:'1px solid rgba(30,41,59,0.8)' }}
              className="sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">
              <TrendUp cls="text-emerald-400" size={22}/>
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">DCA 계산기</h1>
              <p className="text-slate-500 text-xs">미국 주식 적립식 투자 — 실제 가격 데이터</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-1.5">
            <span className="pulse-dot"></span>
            Yahoo Finance (yfinance)
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Input Card ── */}
        <div className="bg-slate-900/80 backdrop-blur rounded-2xl border border-slate-800 p-6 shadow-2xl">
          <h2 className="text-white font-semibold text-base mb-5 flex items-center gap-2">
            <CalIcon cls="text-emerald-400" size={18}/>
            투자 조건 설정
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

            {/* Stock Search — spans 2 cols on large screens */}
            <div className="sm:col-span-2 lg:col-span-2">
              <StockSearch
                selectedTicker={selectedTicker}
                tickerInfo={tickerInfo}
                onSelect={ticker => { setSelectedTicker(ticker); setResults(null); }}
                onInfoLoaded={info => setTickerInfo(info)}
              />
            </div>

            {/* Start Date */}
            <div>
              <label className={labelCls}><CalIcon size={12}/>시작일</label>
              <input type="date" value={startDate}
                onChange={e => setStartDate(e.target.value)}
                min={firstDate || '1970-01-01'} max={endDate || todayStr}
                className={inputCls}/>
              {firstDate && <p className="text-xs text-slate-600 mt-1">최소: {firstDate}</p>}
            </div>

            {/* End Date */}
            <div>
              <label className={labelCls}><CalIcon size={12}/>종료일</label>
              <input type="date" value={endDate}
                onChange={e => setEndDate(e.target.value)}
                min={startDate || firstDate || '1970-01-01'} max={todayStr}
                className={inputCls}/>
            </div>
          </div>

          {/* Second row: frequency + amount + button */}
          <div className="flex flex-col sm:flex-row gap-4 items-end">

            {/* Frequency */}
            <div className="w-full sm:w-52">
              <label className={labelCls}>투자 주기</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value)}
                className={inputCls}
                style={{ cursor:'pointer', appearance:'none',
                  backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                  backgroundRepeat:'no-repeat', backgroundPosition:'right 14px center' }}>
                <option value="daily">Daily — 매 거래일</option>
                <option value="weekly">Weekly — 매주 첫 거래일</option>
                <option value="monthly">Monthly — 매월 첫 거래일</option>
              </select>
            </div>

            {/* Amount */}
            <div className="w-full sm:w-52">
              <label className={labelCls}><DollarIcon size={12}/>1회 투자 금액</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm select-none">
                  {tickerInfo?.currency === 'USD' ? '$' : (tickerInfo?.currency || '$')}
                </span>
                <input type="number" value={amount} min="1" step="100"
                  onChange={e => setAmount(e.target.value)}
                  placeholder="500" className={inputCls + ' pl-8'}/>
              </div>
            </div>

            <button onClick={handleCalculate} disabled={loading}
              className="px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all duration-200 whitespace-nowrap active:scale-95"
              style={{
                background: loading ? '#1e293b' : 'linear-gradient(135deg,#10b981,#059669)',
                color: loading ? '#475569' : '#f8fafc',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(16,185,129,0.25)',
                cursor: loading ? 'not-allowed' : 'pointer', border:'none',
              }}>
              {loading
                ? <><span className="loading-spinner"/>Yahoo Finance 조회 중...</>
                : <><ChartIcon size={18}/>분석하기</>}
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
            {/* Meta info bar */}
            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              <span className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
                📊 실제 가격 데이터 {dataPoints.toLocaleString()}일
              </span>
              <span className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
                🗓 매수 {buyCount}회 × {tickerInfo?.currency === 'USD' ? '$' : ''}{parseFloat(amount).toLocaleString()}
              </span>
              <span className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
                ⚡ Yahoo Finance · yfinance
              </span>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ResultCard
                title="누적 투자 금액"
                subtitle={`${buyCount}회 합산`}
                value={results.totalInvested}
                type="neutral"
                icon={<DollarIcon size={18}/>}
                fmt={v => `$${v.toLocaleString('en-US')}`}
              />
              <ResultCard
                title="최종 평가액"
                subtitle={`${results.finalValue >= results.totalInvested ? '+' : ''}$${(results.finalValue - results.totalInvested).toLocaleString('en-US')} 손익`}
                value={results.finalValue}
                type={results.finalValue >= results.totalInvested ? 'positive' : 'negative'}
                icon={results.finalValue >= results.totalInvested ? <TrendUp size={18}/> : <TrendDown size={18}/>}
                fmt={v => `$${v.toLocaleString('en-US')}`}
              />
              <ResultCard
                title="최종 수익률 (ROI)"
                subtitle={results.roi >= 0 ? '수익 달성 🎉' : '손실 발생'}
                value={results.roi}
                type={results.roi >= 0 ? 'positive' : 'negative'}
                icon={results.roi >= 0 ? <TrendUp size={18}/> : <TrendDown size={18}/>}
                fmt={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
              />
            </div>

            {chartData.length > 0 && (
              <DCAChart data={chartData} ticker={selectedTicker} currency={tickerInfo?.currency || 'USD'}/>
            )}

            <p className="text-center text-slate-700 text-xs pb-2">
              ※ Yahoo Finance 제공 실제 종가(수정주가 기준) 데이터를 사용합니다. 배당 재투자는 반영되지 않습니다.
            </p>
          </>
        )}

        {/* Empty state */}
        {!results && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600">
            <div className="bg-slate-900/60 border border-slate-800 rounded-full p-8 mb-5">
              <ChartIcon size={44} cls="text-slate-700"/>
            </div>
            <p className="text-lg font-semibold text-slate-500">종목과 기간을 설정하고 분석을 시작하세요</p>
            <p className="text-sm mt-2 text-slate-700">미국 상장 모든 주식·ETF의 실제 가격 데이터를 사용합니다</p>
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
