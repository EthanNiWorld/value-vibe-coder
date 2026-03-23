import { Header } from '@/components/Header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { stocksData, formatPercent } from '@/data/stockData'
import { Filter, X, ArrowUpDown, ArrowUpRight, Loader2, Wifi, WifiOff, RefreshCw, Sparkles } from 'lucide-react'
import { getCache, setCache, formatCacheAge } from '@/services/cache'

// ── API ──────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8000/api'

interface ScreenerStock {
  code: string
  name: string
  market: string
  industry: string
  price: number
  change: number
  changePercent: number
  marketCap: number
  pe: number
  pb: number
  roe: number
  eps: number
  dividendYield: number
  debtRatio: number
  revenueGrowth: number
  profitGrowth: number
  grossMargin: number
  netMargin: number
  currentRatio: number
  freeCashFlow: number
}

async function fetchScreenerData(): Promise<ScreenerStock[]> {
  const res = await fetch(`${API_BASE}/screener?limit=60`, {
    signal: AbortSignal.timeout(60000), // 首次可能较慢
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  return json.data || []
}

// ── Filter types ─────────────────────────────────────────────
interface FilterCondition {
  field: string
  operator: '>' | '<' | '>=' | '<='
  value: number
  label: string
}

const filterPresets: { label: string; icon: string; conditions: FilterCondition[] }[] = [
  {
    label: '低估值高ROE',
    icon: '💎',
    conditions: [
      { field: 'pe', operator: '<', value: 20, label: 'PE < 20' },
      { field: 'roe', operator: '>', value: 15, label: 'ROE > 15%' },
    ],
  },
  {
    label: '高股息策略',
    icon: '🏦',
    conditions: [
      { field: 'dividendYield', operator: '>', value: 3, label: '股息率 > 3%' },
      { field: 'pe', operator: '<', value: 25, label: 'PE < 25' },
    ],
  },
  {
    label: '成长股筛选',
    icon: '🚀',
    conditions: [
      { field: 'profitGrowth', operator: '>', value: 15, label: '利润增长 > 15%' },
      { field: 'roe', operator: '>', value: 18, label: 'ROE > 18%' },
    ],
  },
  {
    label: '格雷厄姆选股',
    icon: '📖',
    conditions: [
      { field: 'pe', operator: '<', value: 15, label: 'PE < 15' },
      { field: 'pb', operator: '<', value: 1.5, label: 'PB < 1.5' },
      { field: 'currentRatio', operator: '>', value: 1.5, label: '流动比率 > 1.5' },
    ],
  },
]

const filterFields = [
  { value: 'pe', label: 'PE (市盈率)' },
  { value: 'pb', label: 'PB (市净率)' },
  { value: 'roe', label: 'ROE (净资产收益率%)' },
  { value: 'eps', label: 'EPS (每股收益)' },
  { value: 'dividendYield', label: '股息率(%)' },
  { value: 'debtRatio', label: '资产负债率(%)' },
  { value: 'revenueGrowth', label: '营收增长率(%)' },
  { value: 'profitGrowth', label: '利润增长率(%)' },
  { value: 'grossMargin', label: '毛利率(%)' },
  { value: 'netMargin', label: '净利率(%)' },
  { value: 'currentRatio', label: '流动比率' },
  { value: 'marketCap', label: '市值(亿)' },
]

type SortField = string
type SortDir = 'asc' | 'desc'

export function Screener() {
  const navigate = useNavigate()
  const [conditions, setConditions] = useState<FilterCondition[]>([])
  const [sortField, setSortField] = useState<SortField>('roe')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Live data state
  const [liveStocks, setLiveStocks] = useState<ScreenerStock[]>([])
  const [isLive, setIsLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cacheAge, setCacheAge] = useState<string | null>(null)

  // New condition form
  const [newField, setNewField] = useState('pe')
  const [newOp, setNewOp] = useState<'>' | '<'>('<')
  const [newValue, setNewValue] = useState('')

  // Fetch live data with SWR cache
  const loadData = useCallback(async () => {
    // 1. 先显示 localStorage 缓存（瞬间展示）
    const cached = getCache<ScreenerStock[]>('screener_data')
    if (cached && cached.data.length > 0) {
      setLiveStocks(cached.data)
      setCacheAge(formatCacheAge(cached.ts))
      setIsLive(true)
      setLoading(false) // 有缓存就不显示 loading
    }

    // 2. 后台刷新
    try {
      const data = await fetchScreenerData()
      if (data.length > 0) {
        setLiveStocks(data)
        setIsLive(true)
        setCache('screener_data', data)
        setCacheAge('刚刚')
      } else if (!cached) {
        setLiveStocks(Object.values(stocksData).map(s => ({
          ...s, market: 'A', industry: s.industry || '',
          change: s.change || 0, changePercent: s.changePercent || 0,
          freeCashFlow: s.freeCashFlow || 0,
        })))
        setIsLive(false)
      }
    } catch (err) {
      console.warn('[Screener] API 不可用', err)
      if (!cached || cached.data.length === 0) {
        setLiveStocks(Object.values(stocksData).map(s => ({
          ...s, market: 'A', industry: s.industry || '',
          change: s.change || 0, changePercent: s.changePercent || 0,
          freeCashFlow: s.freeCashFlow || 0,
        })))
        setIsLive(false)
        setLoadError('API 不可用，显示本地缓存数据')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const addCondition = () => {
    if (!newValue) return
    const fieldLabel = filterFields.find(f => f.value === newField)?.label || newField
    setConditions(prev => [
      ...prev,
      {
        field: newField,
        operator: newOp,
        value: parseFloat(newValue),
        label: `${fieldLabel} ${newOp} ${newValue}`,
      },
    ])
    setNewValue('')
  }

  const removeCondition = (index: number) => {
    setConditions(prev => prev.filter((_, i) => i !== index))
  }

  const applyPreset = (preset: typeof filterPresets[0]) => {
    setConditions(preset.conditions)
  }

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const results = useMemo(() => {
    let stocks = [...liveStocks]

    // Apply filters
    for (const cond of conditions) {
      stocks = stocks.filter(s => {
        const val = (s as unknown as Record<string, number>)[cond.field]
        if (val === undefined || val === null) return false
        switch (cond.operator) {
          case '>': return val > cond.value
          case '<': return val < cond.value
          case '>=': return val >= cond.value
          case '<=': return val <= cond.value
          default: return true
        }
      })
    }

    // Sort
    stocks.sort((a, b) => {
      const aVal = (a as unknown as Record<string, number>)[sortField] || 0
      const bVal = (b as unknown as Record<string, number>)[sortField] || 0
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })

    return stocks
  }, [liveStocks, conditions, sortField, sortDir])

  const SortableHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="text-right px-5 py-3 text-caption text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors"
      onClick={() => toggleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field && (
          <ArrowUpDown className={`w-3 h-3 ${sortField === field ? 'text-primary' : ''}`} />
        )}
      </span>
    </th>
  )

  return (
    <div className="min-h-screen">
      <Header title="股票筛选" subtitle="按价值指标筛选优质标的" />

      <main className="p-8 space-y-6">
        {/* Data source indicator + Presets */}
        <section className="animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">预设策略</h3>
            </div>
            <div className="flex items-center gap-3">
              {isLive ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-md">
                  <Wifi className="w-3 h-3" /> 实时数据 · {liveStocks.length}只
                  {cacheAge && <span className="text-emerald-400/60">· {cacheAge}</span>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-md">
                  <WifiOff className="w-3 h-3" /> 本地缓存
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={loadData} disabled={loading} className="gap-1.5 h-7 text-xs">
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            {filterPresets.map(preset => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset)}
                className="text-xs gap-1.5"
              >
                <span>{preset.icon}</span>
                {preset.label}
              </Button>
            ))}
          </div>
        </section>

        {/* Custom Filter */}
        <section className="animate-fade-in animation-delay-100">
          <Card>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold text-foreground">自定义筛选条件</h4>
              </div>

              {/* Add condition */}
              <div className="flex items-center gap-2 mb-4">
                <select
                  value={newField}
                  onChange={e => setNewField(e.target.value)}
                  className="input-field w-[200px]"
                >
                  {filterFields.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={newOp}
                  onChange={e => setNewOp(e.target.value as '>' | '<')}
                  className="input-field w-[80px]"
                >
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value=">=">&ge;</option>
                  <option value="<=">&le;</option>
                </select>
                <input
                  type="number"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCondition()}
                  placeholder="数值"
                  className="input-field w-[120px] font-mono"
                />
                <Button size="sm" onClick={addCondition}>添加条件</Button>
              </div>

              {/* Active conditions */}
              {conditions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {conditions.map((cond, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-xs font-medium text-accent-foreground">
                      {cond.label}
                      <button onClick={() => removeCondition(i)} className="hover:text-destructive transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => setConditions([])}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2"
                  >
                    清除全部
                  </button>
                </div>
              )}
            </div>
          </Card>
        </section>

        {/* Error hint */}
        {loadError && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-400/10 border border-amber-400/30 text-xs text-amber-400 animate-fade-in">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            {loadError}
          </div>
        )}

        {/* Results */}
        <section className="animate-fade-in animation-delay-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-caption text-muted-foreground uppercase tracking-wider">
              筛选结果 · {loading ? '加载中...' : `${results.length} 只股票`}
            </h3>
          </div>

          {loading ? (
            <Card>
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">正在获取实时市场数据...</p>
                <p className="text-[11px] text-muted-foreground/60">首次加载约需10-30秒，后续请求使用缓存</p>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-5 py-3 text-caption text-muted-foreground font-medium">股票</th>
                      <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">现价</th>
                      <SortableHeader field="pe" label="PE" />
                      <SortableHeader field="pb" label="PB" />
                      <SortableHeader field="roe" label="ROE(%)" />
                      <SortableHeader field="profitGrowth" label="利润增长(%)" />
                      <SortableHeader field="grossMargin" label="毛利率(%)" />
                      <SortableHeader field="netMargin" label="净利率(%)" />
                      <SortableHeader field="debtRatio" label="负债率(%)" />
                      <SortableHeader field="currentRatio" label="流动比率" />
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(stock => (
                      <tr
                        key={stock.code}
                        onClick={() => navigate(`/stock/${stock.code}`)}
                        className="border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="text-sm font-semibold text-foreground">{stock.name}</div>
                              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                                {stock.code}
                                {stock.changePercent !== 0 && (
                                  <span className={`font-mono ${stock.changePercent >= 0 ? 'text-gain' : 'text-loss'}`}>
                                    {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono text-foreground">
                          {stock.price > 0 ? stock.price.toFixed(2) : '--'}
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono text-foreground">
                          {stock.pe > 0 ? stock.pe.toFixed(1) : '--'}
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono text-foreground">
                          {stock.pb > 0 ? stock.pb.toFixed(2) : '--'}
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono font-medium text-foreground">
                          <span className={stock.roe >= 15 ? 'text-gain' : stock.roe > 0 ? 'text-foreground' : 'text-muted-foreground'}>
                            {stock.roe > 0 ? stock.roe.toFixed(1) : '--'}
                          </span>
                        </td>
                        <td className="text-right px-5 py-3">
                          <span className={`text-sm font-mono font-medium ${stock.profitGrowth >= 0 ? 'text-gain' : 'text-loss'}`}>
                            {stock.profitGrowth !== 0 ? formatPercent(stock.profitGrowth) : '--'}
                          </span>
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono text-foreground">
                          {stock.grossMargin > 0 ? stock.grossMargin.toFixed(1) : '--'}
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono text-foreground">
                          {stock.netMargin > 0 ? stock.netMargin.toFixed(1) : '--'}
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono text-foreground">
                          <span className={stock.debtRatio > 60 ? 'text-loss' : ''}>
                            {stock.debtRatio > 0 ? stock.debtRatio.toFixed(1) : '--'}
                          </span>
                        </td>
                        <td className="text-right px-5 py-3 text-sm font-mono text-foreground">
                          {stock.currentRatio > 0 ? stock.currentRatio.toFixed(2) : '--'}
                        </td>
                        <td className="text-center px-3 py-3">
                          <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                        </td>
                      </tr>
                    ))}
                    {results.length === 0 && (
                      <tr>
                        <td colSpan={11} className="text-center py-12 text-muted-foreground text-sm">
                          没有符合条件的股票，请调整筛选条件
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>
      </main>
    </div>
  )
}
