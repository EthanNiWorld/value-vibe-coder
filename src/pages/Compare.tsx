import { Header } from '@/components/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState, useEffect, useCallback } from 'react'
import { stocksData } from '@/data/stockData'
import { fetchStockQuote, fetchFundamentals, type Fundamentals } from '@/services/api'
import { getCache, setCache, formatCacheAge } from '@/services/cache'
import { Plus, X, GitCompareArrows, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'

const CHART_COLORS = [
  'hsl(228 60% 50%)',
  'hsl(262 52% 55%)',
  'hsl(197 71% 48%)',
  'hsl(32 85% 55%)',
  'hsl(340 65% 52%)',
]

// 用于对比的完整股票数据
interface CompareStock {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  pe: number
  pb: number
  roe: number
  eps: number
  marketCap: number
  dividendYield: number
  debtRatio: number
  revenueGrowth: number
  profitGrowth: number
  freeCashFlow: number
  grossMargin: number
  netMargin: number
  currentRatio: number
  isLive: boolean
}

const CACHE_KEY = 'compare_stocks'

// 可选股票池（同 Screener 池 + 本地 stocksData）
const STOCK_POOL = [
  { code: '600519', name: '贵州茅台' }, { code: '000858', name: '五粮液' },
  { code: '000568', name: '泸州老窖' }, { code: '002304', name: '洋河股份' },
  { code: '600036', name: '招商银行' }, { code: '601318', name: '中国平安' },
  { code: '000333', name: '美的集团' }, { code: '000651', name: '格力电器' },
  { code: '300750', name: '宁德时代' }, { code: '002415', name: '海康威视' },
  { code: '603288', name: '海天味业' }, { code: '600900', name: '长江电力' },
  { code: '600276', name: '恒瑞医药' }, { code: '300760', name: '迈瑞医疗' },
  { code: '002594', name: '比亚迪' },   { code: '601012', name: '隆基绿能' },
  { code: '600887', name: '伊利股份' }, { code: '000538', name: '云南白药' },
  { code: '002475', name: '立讯精密' }, { code: '600585', name: '海螺水泥' },
  { code: '600809', name: '山西汾酒' }, { code: '000661', name: '长春高新' },
  { code: '002714', name: '牧原股份' }, { code: '601888', name: '中国中免' },
]

export function Compare() {
  const [selectedCodes, setSelectedCodes] = useState<string[]>(['600519', '000858', '000568'])
  const [addCode, setAddCode] = useState('')
  const [stockMap, setStockMap] = useState<Record<string, CompareStock>>({})
  const [loading, setLoading] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [cacheAge, setCacheAge] = useState<string | null>(null)

  // 加载单只股票数据
  const fetchOneStock = useCallback(async (code: string): Promise<CompareStock> => {
    const localStock = stocksData[code]
    try {
      const [quote, fund] = await Promise.all([
        fetchStockQuote(code, {}),
        fetchFundamentals(code, {}),
      ])
      const f = fund as Fundamentals
      return {
        code,
        name: quote.name || localStock?.name || code,
        price: quote.price || localStock?.price || 0,
        change: quote.change ?? 0,
        changePercent: quote.changePercent ?? 0,
        pe: f?.pe ?? quote.pe ?? localStock?.pe ?? 0,
        pb: f?.pb ?? quote.pb ?? localStock?.pb ?? 0,
        roe: f?.roe ?? localStock?.roe ?? 0,
        eps: f?.eps ?? localStock?.eps ?? 0,
        marketCap: quote.marketCap || localStock?.marketCap || 0,
        dividendYield: f?.dividendYield ?? localStock?.dividendYield ?? 0,
        debtRatio: f?.debtRatio ?? localStock?.debtRatio ?? 0,
        revenueGrowth: f?.revenueGrowth ?? localStock?.revenueGrowth ?? 0,
        profitGrowth: f?.profitGrowth ?? localStock?.profitGrowth ?? 0,
        freeCashFlow: f?.freeCashFlow ?? localStock?.freeCashFlow ?? 0,
        grossMargin: f?.grossMargin ?? localStock?.grossMargin ?? 0,
        netMargin: f?.netMargin ?? localStock?.netMargin ?? 0,
        currentRatio: f?.currentRatio ?? localStock?.currentRatio ?? 0,
        isLive: !!(quote.price && quote.price > 0),
      }
    } catch {
      // 降级到静态数据
      if (localStock) {
        return { ...localStock, isLive: false }
      }
      return {
        code, name: code, price: 0, change: 0, changePercent: 0,
        pe: 0, pb: 0, roe: 0, eps: 0, marketCap: 0, dividendYield: 0,
        debtRatio: 0, revenueGrowth: 0, profitGrowth: 0, freeCashFlow: 0,
        grossMargin: 0, netMargin: 0, currentRatio: 0, isLive: false,
      }
    }
  }, [])

  // 批量加载
  const loadStocks = useCallback(async (codes: string[], forceRefresh = false) => {
    if (codes.length === 0) return

    // 1. 先显示缓存
    if (!forceRefresh) {
      const cached = getCache<Record<string, CompareStock>>(CACHE_KEY)
      if (cached) {
        setStockMap(prev => ({ ...prev, ...cached.data }))
        setCacheAge(formatCacheAge(cached.ts))
      }
    }

    // 2. 后台刷新
    setLoading(true)
    const results = await Promise.allSettled(codes.map(c => fetchOneStock(c)))
    const newMap: Record<string, CompareStock> = {}
    let anyLive = false
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        newMap[codes[i]] = r.value
        if (r.value.isLive) anyLive = true
      }
    })

    setStockMap(prev => {
      const merged = { ...prev, ...newMap }
      // 写入缓存
      setCache(CACHE_KEY, merged)
      return merged
    })
    setIsLive(anyLive)
    setCacheAge('刚刚')
    setLoading(false)
  }, [fetchOneStock])

  // 初次加载 + codes 变化时刷新
  useEffect(() => {
    loadStocks(selectedCodes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCodes.join(',')])

  const selectedStocks = selectedCodes
    .map(c => stockMap[c])
    .filter(Boolean) as CompareStock[]

  const handleAdd = () => {
    if (addCode && !selectedCodes.includes(addCode) && selectedCodes.length < 5) {
      setSelectedCodes(prev => [...prev, addCode])
      setAddCode('')
    }
  }

  const handleRemove = (code: string) => {
    setSelectedCodes(prev => prev.filter(c => c !== code))
  }

  // Radar chart data
  const radarData = selectedStocks.length > 0 ? [
    {
      metric: 'ROE',
      ...Object.fromEntries(selectedStocks.map(s => [s.name, Math.min(s.roe / 40 * 100, 100)])),
    },
    {
      metric: '毛利率',
      ...Object.fromEntries(selectedStocks.map(s => [s.name, Math.min(s.grossMargin / 100 * 100, 100)])),
    },
    {
      metric: '净利率',
      ...Object.fromEntries(selectedStocks.map(s => [s.name, Math.min(s.netMargin / 60 * 100, 100)])),
    },
    {
      metric: '股息率',
      ...Object.fromEntries(selectedStocks.map(s => [s.name, Math.min(s.dividendYield / 6 * 100, 100)])),
    },
    {
      metric: '成长性',
      ...Object.fromEntries(selectedStocks.map(s => [s.name, Math.min(Math.max(s.profitGrowth + 10, 0) / 40 * 100, 100)])),
    },
    {
      metric: '低负债',
      ...Object.fromEntries(selectedStocks.map(s => [s.name, Math.max(100 - s.debtRatio, 0)])),
    },
  ] : []

  // Bar comparison
  const comparisonMetrics = [
    { key: 'pe', label: 'PE' },
    { key: 'pb', label: 'PB' },
    { key: 'roe', label: 'ROE' },
    { key: 'dividendYield', label: '股息率' },
    { key: 'grossMargin', label: '毛利率' },
    { key: 'netMargin', label: '净利率' },
    { key: 'debtRatio', label: '负债率' },
    { key: 'profitGrowth', label: '利润增长' },
  ]

  const barData = comparisonMetrics.map(m => ({
    metric: m.label,
    ...Object.fromEntries(selectedStocks.map(s => [
      s.name,
      (s as unknown as Record<string, number>)[m.key] ?? 0,
    ])),
  }))

  return (
    <div className="min-h-screen">
      <Header title="股票对比" subtitle="多维度横向比较" />

      <main className="p-8 space-y-6">
        {/* Stock Selector */}
        <section className="animate-fade-in">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <GitCompareArrows className="w-4 h-4 text-primary" />
                  <h4 className="text-sm font-semibold text-foreground">选择对比股票（最多5只）</h4>
                </div>
                <div className="flex items-center gap-3">
                  {isLive ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-md">
                      <Wifi className="w-3 h-3" /> 实时数据
                      {cacheAge && <span className="text-emerald-400/60">· {cacheAge}</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-md">
                      <WifiOff className="w-3 h-3" /> 本地缓存
                      {cacheAge && <span className="text-amber-400/60">· {cacheAge}</span>}
                    </span>
                  )}
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => loadStocks(selectedCodes, true)}
                    disabled={loading}
                    className="gap-1.5 h-7 text-xs"
                  >
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    刷新
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedStocks.map((stock, i) => (
                  <span
                    key={stock.code}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium"
                    style={{
                      borderColor: CHART_COLORS[i % CHART_COLORS.length],
                      background: CHART_COLORS[i % CHART_COLORS.length] + '10',
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-foreground">{stock.name}</span>
                    <span className="text-muted-foreground text-xs font-mono">{stock.code}</span>
                    {stock.price > 0 && (
                      <span className="text-muted-foreground text-xs font-mono">¥{stock.price.toFixed(2)}</span>
                    )}
                    <button
                      onClick={() => handleRemove(stock.code)}
                      className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}

                {loading && selectedStocks.length < selectedCodes.length && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载中...
                  </span>
                )}

                {selectedCodes.length < 5 && (
                  <div className="flex items-center gap-1">
                    <select
                      value={addCode}
                      onChange={e => setAddCode(e.target.value)}
                      className="input-field w-[180px] text-sm"
                    >
                      <option value="">选择股票...</option>
                      {STOCK_POOL
                        .filter(s => !selectedCodes.includes(s.code))
                        .map(s => (
                          <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                        ))
                      }
                    </select>
                    <Button size="sm" onClick={handleAdd} disabled={!addCode}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {selectedStocks.length >= 2 && (
          <>
            {/* Radar Chart */}
            <section className="animate-fade-in animation-delay-100">
              <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">综合能力雷达图</h3>
              <Card>
                <CardContent className="p-6 flex justify-center">
                  <ResponsiveContainer width="100%" height={400}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="hsl(220 16% 90%)" />
                      <PolarAngleAxis
                        dataKey="metric"
                        tick={{ fontSize: 12, fill: 'hsl(220 10% 52%)' }}
                      />
                      <PolarRadiusAxis
                        angle={30}
                        domain={[0, 100]}
                        tick={{ fontSize: 10, fill: 'hsl(220 10% 52%)' }}
                      />
                      {selectedStocks.map((s, i) => (
                        <Radar
                          key={s.code}
                          name={s.name}
                          dataKey={s.name}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                          fillOpacity={0.1}
                          strokeWidth={2}
                        />
                      ))}
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(0 0% 100%)',
                          border: '1px solid hsl(220 16% 90%)',
                          borderRadius: '8px',
                          fontSize: '12px',
                          boxShadow: 'var(--shadow-elevated)',
                        }}
                        formatter={(val: number) => val.toFixed(0) + '分'}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>

            {/* Bar Comparison */}
            <section className="animate-fade-in animation-delay-200">
              <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">指标对比</h3>
              <Card>
                <CardContent className="p-6">
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 90%)" />
                      <XAxis dataKey="metric" tick={{ fontSize: 12, fill: 'hsl(220 10% 52%)' }} />
                      <YAxis tick={{ fontSize: 12, fill: 'hsl(220 10% 52%)' }} />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(0 0% 100%)',
                          border: '1px solid hsl(220 16% 90%)',
                          borderRadius: '8px',
                          fontSize: '12px',
                          boxShadow: 'var(--shadow-elevated)',
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {selectedStocks.map((s, i) => (
                        <Bar
                          key={s.code}
                          dataKey={s.name}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                          radius={[4, 4, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>

            {/* Data Table Comparison */}
            <section className="animate-fade-in animation-delay-300">
              <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">详细数据对比</h3>
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-5 py-3 text-caption text-muted-foreground font-medium w-[140px]">指标</th>
                        {selectedStocks.map((s, i) => (
                          <th key={s.code} className="text-right px-5 py-3 text-caption font-medium" style={{ color: CHART_COLORS[i] }}>
                            {s.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: '现价', get: (s: CompareStock) => s.price > 0 ? '¥' + s.price.toFixed(2) : '--' },
                        { label: '市值(亿)', get: (s: CompareStock) => s.marketCap > 0 ? s.marketCap.toLocaleString() : '--' },
                        { label: 'PE (TTM)', get: (s: CompareStock) => s.pe > 0 ? s.pe.toFixed(1) : '--' },
                        { label: 'PB', get: (s: CompareStock) => s.pb > 0 ? s.pb.toFixed(2) : '--' },
                        { label: 'ROE(%)', get: (s: CompareStock) => s.roe > 0 ? s.roe.toFixed(1) : '--' },
                        { label: 'EPS', get: (s: CompareStock) => s.eps > 0 ? '¥' + s.eps.toFixed(2) : '--' },
                        { label: '股息率(%)', get: (s: CompareStock) => s.dividendYield > 0 ? s.dividendYield.toFixed(1) : '--' },
                        { label: '毛利率(%)', get: (s: CompareStock) => s.grossMargin > 0 ? s.grossMargin.toFixed(1) : '--' },
                        { label: '净利率(%)', get: (s: CompareStock) => s.netMargin > 0 ? s.netMargin.toFixed(1) : '--' },
                        { label: '负债率(%)', get: (s: CompareStock) => s.debtRatio > 0 ? s.debtRatio.toFixed(1) : '--' },
                        { label: '营收增长(%)', get: (s: CompareStock) => s.revenueGrowth !== 0 ? (s.revenueGrowth >= 0 ? '+' : '') + s.revenueGrowth.toFixed(1) : '--' },
                        { label: '利润增长(%)', get: (s: CompareStock) => s.profitGrowth !== 0 ? (s.profitGrowth >= 0 ? '+' : '') + s.profitGrowth.toFixed(1) : '--' },
                        { label: '自由现金流(亿)', get: (s: CompareStock) => s.freeCashFlow > 0 ? s.freeCashFlow.toFixed(1) : '--' },
                        { label: '流动比率', get: (s: CompareStock) => s.currentRatio > 0 ? s.currentRatio.toFixed(2) : '--' },
                      ].map(row => (
                        <tr key={row.label} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                          <td className="px-5 py-3 text-sm text-muted-foreground">{row.label}</td>
                          {selectedStocks.map(s => (
                            <td key={s.code} className="text-right px-5 py-3 text-sm font-mono font-medium text-foreground">
                              {row.get(s)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          </>
        )}

        {selectedStocks.length < 2 && !loading && (
          <div className="flex items-center justify-center py-20">
            <p className="text-muted-foreground text-sm">请至少选择 2 只股票进行对比</p>
          </div>
        )}

        {loading && selectedStocks.length < 2 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">正在获取实时数据...</p>
          </div>
        )}
      </main>
    </div>
  )
}
