import { useParams, useNavigate } from 'react-router-dom'
import { Header } from '@/components/Header'
import { useApp } from '@/context/AppContext'
import { stocksData, getFinancialHistory as getLocalFinancials, formatPercent, type Stock } from '@/data/stockData'
import { fetchStockQuote, fetchFundamentals, fetchFinancialHistory, getCachedFinancialHistory, type FinancialRecord } from '@/services/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Star, StarOff, ArrowLeft, TrendingUp, TrendingDown, Loader2, Target, AlertTriangle, CheckCircle2, BarChart3 } from 'lucide-react'
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

type ChartTab = 'revenue' | 'profit' | 'cashflow' | 'margins'

interface StockInfo {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  marketCap: number
  industry: string
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
  freeCashFlow: number
  currentRatio: number
}

/* --- 机会成本对比 · Opportunity Cost --- */

const BENCHMARKS = [
  { name: '\u7eb3\u65af\u8fbe\u514b100 (QQQ)', cagr: 13.5, years: 30, color: 'hsl(228 60% 50%)', emoji: '\u{1f4c8}' },
  { name: '\u4f2f\u514b\u5e0c\u5c14\u00b7\u54c8\u6492\u97e6 (BRK)', cagr: 19.8, years: 59, color: 'hsl(262 52% 55%)', emoji: '\u{1f3db}\ufe0f' },
]

function calcExpectedReturn(stock: StockInfo) {
  const earningsYield = stock.pe > 0 ? (1 / stock.pe) * 100 : 0
  const growthRate = Math.max(0, ((stock.revenueGrowth ?? 0) + (stock.profitGrowth ?? 0)) / 2)
  const dividend = stock.dividendYield ?? 0
  let rate = earningsYield + growthRate * 0.6 + dividend

  let roeReturn = 0
  if (stock.roe > 0) {
    const payoutRatio = stock.dividendYield && stock.eps > 0 && stock.price > 0
      ? Math.min(1, (stock.dividendYield / 100 * stock.price) / stock.eps)
      : 0.3
    roeReturn = stock.roe * (1 - payoutRatio)
    rate = rate * 0.6 + roeReturn * 0.4
  }

  return {
    rate: Math.min(rate, 40),
    earningsYield: earningsYield.toFixed(1),
    growthContrib: (growthRate * 0.6).toFixed(1),
    dividend: dividend.toFixed(1),
    roeReturn: roeReturn.toFixed(1),
  }
}

function OpportunityCostBenchmark({ stock }: { stock: StockInfo }) {
  const result = calcExpectedReturn(stock)
  const maxRate = Math.max(result.rate, ...BENCHMARKS.map(b => b.cagr), 5)

  type Verdict = 'excellent' | 'good' | 'poor'
  let verdict: Verdict = 'poor'
  if (result.rate >= BENCHMARKS[1].cagr) verdict = 'excellent'
  else if (result.rate >= BENCHMARKS[0].cagr) verdict = 'good'

  const verdictConfig = {
    excellent: {
      icon: <CheckCircle2 className="w-5 h-5 text-gain" />,
      text: '\u8d85\u8d8a\u4f2f\u514b\u5e0c\u5c14\u57fa\u51c6',
      desc: '\u9884\u671f\u6536\u76ca\u7387\u8d85\u8fc7\u5df4\u83f2\u7279\u957f\u671f\u7eaa\u5f55\uff0c\u503c\u5f97\u6df1\u5165\u7814\u7a76',
      bg: 'bg-gain-muted',
      border: 'border-gain/20',
      textColor: 'text-gain',
    },
    good: {
      icon: <Target className="w-5 h-5" style={{ color: 'hsl(228 60% 50%)' }} />,
      text: '\u8dd1\u8d62\u6307\u6570\u57fa\u51c6',
      desc: '\u9884\u671f\u6536\u76ca\u7387\u8d85\u8fc7\u7eb3\u65af\u8fbe\u514b100\uff0c\u4f46\u672a\u8fbe\u5230\u4f2f\u514b\u5e0c\u5c14\u6c34\u51c6',
      bg: 'bg-accent',
      border: 'border-primary/20',
      textColor: 'text-accent-foreground',
    },
    poor: {
      icon: <AlertTriangle className="w-5 h-5 text-loss" />,
      text: '\u4e0d\u53ca\u7eb3\u65af\u8fbe\u514b100',
      desc: '\u9884\u671f\u6536\u76ca\u7387\u4f4e\u4e8e\u6307\u6570\uff0c\u5efa\u8bae\u8003\u8651\u76f4\u63a5\u6295\u8d44\u6307\u6570\u57fa\u91d1',
      bg: 'bg-loss-muted',
      border: 'border-loss/20',
      textColor: 'text-loss',
    },
  }

  const v = verdictConfig[verdict]

  return (
    <section className="animate-fade-in animation-delay-250">
      <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">
        机会成本对比 · Opportunity Cost
      </h3>
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-start gap-4 text-xs text-muted-foreground">
            <div className="flex-1 flex items-center gap-4 flex-wrap">
              <span>盈利收益率 <strong className="text-foreground">{result.earningsYield}%</strong></span>
              <span className="text-muted-foreground/40">+</span>
              <span>成长贡献 <strong className="text-foreground">{result.growthContrib}%</strong></span>
              <span className="text-muted-foreground/40">+</span>
              <span>股息 <strong className="text-foreground">{result.dividend}%</strong></span>
              {parseFloat(result.roeReturn) > 0 && (
                <>
                  <span className="text-muted-foreground/40">x0.6 +</span>
                  <span>ROE留存 <strong className="text-foreground">{result.roeReturn}%</strong> x0.4</span>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{stock.name} 预期年化</span>
                <span className="font-mono font-semibold text-foreground">{result.rate.toFixed(1)}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${Math.max(2, (result.rate / maxRate) * 100)}%`,
                    background: verdict === 'poor'
                      ? 'hsl(0 72% 51%)'
                      : verdict === 'good'
                        ? 'hsl(228 60% 50%)'
                        : 'hsl(142 60% 40%)',
                  }}
                />
              </div>
            </div>

            {BENCHMARKS.map(b => (
              <div key={b.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{b.emoji} {b.name}</span>
                  <span className="font-mono text-muted-foreground">{b.cagr}% <span className="text-[10px]">({b.years}yr CAGR)</span></span>
                </div>
                <div className="h-3 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full opacity-40"
                    style={{
                      width: `${(b.cagr / maxRate) * 100}%`,
                      background: b.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className={`flex items-center gap-3 p-4 rounded-xl border ${v.bg} ${v.border}`}>
            {v.icon}
            <div>
              <div className={`text-sm font-semibold ${v.textColor}`}>{v.text}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{v.desc}</div>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground/60 leading-relaxed">
            {'\u{1f4a1} \u5df4\u83f2\u7279\u7684\u673a\u4f1a\u6210\u672c\u539f\u5219\uff1a\u5982\u679c\u4e00\u53ea\u80a1\u7968\u7684\u9884\u671f\u56de\u62a5\u4f4e\u4e8e\u88ab\u52a8\u6307\u6570\u57fa\u91d1\uff0c\u90a3\u4e48\u4e3b\u52a8\u9009\u80a1\u4e0d\u5982\u76f4\u63a5\u4e70\u5165\u6307\u6570\u3002\u7eb3\u65af\u8fbe\u514b100\u8fd130\u5e74\u5e74\u5316\u7ea613.5%\uff0c\u4f2f\u514b\u5e0c\u5c1459\u5e74\u5e74\u5316\u7ea619.8%\u3002'}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

/* --- Main Component --- */

export function StockDetail() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { watchlist, addToWatchlist, removeFromWatchlist, createWatchlistGroup, isInWatchlist, isBackendOnline } = useApp()
  const [chartTab, setChartTab] = useState<ChartTab>('revenue')
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null)
  const [financials, setFinancials] = useState<FinancialRecord[]>([])
  const [loading, setLoading] = useState(true)

  const inWatchlist = code ? isInWatchlist(code) : false
  const localStock = code ? stocksData[code] : null

  useEffect(() => {
    if (!code) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const local = stocksData[code!] as Stock | undefined

      const info: StockInfo = {
        code: code!,
        name: local?.name || code!,
        price: local?.price ?? 0,
        change: local?.change ?? 0,
        changePercent: local?.changePercent ?? 0,
        marketCap: local?.marketCap ?? 0,
        industry: local?.industry || '',
        pe: local?.pe ?? 0,
        pb: local?.pb ?? 0,
        roe: local?.roe ?? 0,
        eps: local?.eps ?? 0,
        dividendYield: local?.dividendYield ?? 0,
        debtRatio: local?.debtRatio ?? 0,
        revenueGrowth: local?.revenueGrowth ?? 0,
        profitGrowth: local?.profitGrowth ?? 0,
        grossMargin: local?.grossMargin ?? 0,
        netMargin: local?.netMargin ?? 0,
        freeCashFlow: local?.freeCashFlow ?? 0,
        currentRatio: local?.currentRatio ?? 0,
      }

      if (isBackendOnline) {
        const quote = await fetchStockQuote(code!, {
          code: code!, name: info.name, price: info.price,
          change: info.change, changePercent: info.changePercent,
        })
        if (!cancelled && quote) {
          info.price = quote.price || info.price
          info.change = quote.change ?? info.change
          info.changePercent = quote.changePercent ?? info.changePercent
          info.name = quote.name || info.name
          info.marketCap = quote.marketCap || info.marketCap
          info.pe = quote.pe ?? info.pe
          info.pb = quote.pb ?? info.pb
        }

        const fund = await fetchFundamentals(code!, {
          code: code!, roe: info.roe, eps: info.eps,
        })
        if (!cancelled && fund) {
          info.roe = fund.roe ?? info.roe
          info.eps = fund.eps ?? info.eps
          info.dividendYield = fund.dividendYield ?? info.dividendYield
          info.debtRatio = fund.debtRatio ?? info.debtRatio
          info.grossMargin = fund.grossMargin ?? info.grossMargin
          info.netMargin = fund.netMargin ?? info.netMargin
          info.revenueGrowth = fund.revenueGrowth ?? info.revenueGrowth
          info.profitGrowth = fund.profitGrowth ?? info.profitGrowth
          info.currentRatio = fund.currentRatio ?? info.currentRatio
          if (fund.pe) info.pe = fund.pe
          if (fund.pb) info.pb = fund.pb
        }

        // 先用 localStorage 缓存即时展示历年财务数据
        const cachedFin = getCachedFinancialHistory(code!)
        const localFin = getLocalFinancials(code!)
        if (!cancelled && cachedFin.length > 0) {
          setFinancials(cachedFin)
        }

        // 后台增量拉取最新数据并更新
        const hist = await fetchFinancialHistory(code!, localFin)
        if (!cancelled) setFinancials(hist.length > 0 ? hist : localFin)
      } else {
        if (!cancelled) setFinancials(getLocalFinancials(code!))
      }

      if (!cancelled) {
        setStockInfo(info)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [code, isBackendOnline])

  const isHK = code ? (code.length === 5 && /^\d{5}$/.test(code)) : false
  const isUS = code ? /^[A-Z]{1,5}(\.[A-Z])?$/.test(code) : false
  const isNonA = isHK || isUS
  const currencySymbol = isUS ? '$' : isHK ? 'HK$' : '¥'
  const marketSuffix = isUS ? '(US)' : isHK ? '(HK)' : ''

  if (loading && !localStock && !stockInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  const stock = stockInfo || (localStock ? {
    ...localStock,
  } as StockInfo : null)

  if (!stock) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">未找到该股票</p>
          <Button variant="outline" onClick={() => navigate('/')}>返回仪表盘</Button>
        </div>
      </div>
    )
  }

  const marketLabel = isUS ? '美股' : isHK ? '港股' : (stock.industry || 'A股')

  const toggleWatchlist = () => {
    if (inWatchlist) {
      const group = watchlist.find(g => g.stocks.includes(stock.code))
      if (group) removeFromWatchlist(group.id, stock.code)
    } else {
      if (watchlist.length === 0) {
        createWatchlistGroup('我的自选')
      }
      const targetGroupId = watchlist[0]?.id
      if (targetGroupId) {
        addToWatchlist(targetGroupId, stock.code)
      }
    }
  }

  const metrics = [
    { label: 'PE (TTM)', value: stock.pe ? stock.pe.toFixed(1) : '--', desc: '市盈率' },
    { label: 'PB', value: stock.pb ? stock.pb.toFixed(2) : '--', desc: '市净率' },
    { label: 'ROE', value: stock.roe ? stock.roe.toFixed(1) + '%' : '--', desc: '净资产收益率' },
    { label: 'EPS', value: stock.eps ? currencySymbol + stock.eps.toFixed(2) : '--', desc: '每股收益' },
    { label: '股息率', value: stock.dividendYield ? stock.dividendYield.toFixed(1) + '%' : '--', desc: '年化股息' },
    { label: '负债率', value: stock.debtRatio ? stock.debtRatio.toFixed(1) + '%' : '--', desc: '资产负债率' },
    { label: '营收增长', value: stock.revenueGrowth ? formatPercent(stock.revenueGrowth) : '--', desc: '同比增长' },
    { label: '利润增长', value: stock.profitGrowth ? formatPercent(stock.profitGrowth) : '--', desc: '同比增长' },
    { label: '毛利率', value: stock.grossMargin ? stock.grossMargin.toFixed(1) + '%' : '--', desc: '销售毛利率' },
    { label: '净利率', value: stock.netMargin ? stock.netMargin.toFixed(1) + '%' : '--', desc: '销售净利率' },
    { label: '自由现金流', value: stock.freeCashFlow ? stock.freeCashFlow.toFixed(0) + '亿' : '--', desc: '年度FCF' },
    { label: '流动比率', value: stock.currentRatio ? stock.currentRatio.toFixed(1) : '--', desc: '短期偿债' },
  ]

  const chartTabs: { key: ChartTab; label: string }[] = [
    { key: 'revenue', label: '营收与利润' },
    { key: 'profit', label: '盈利能力' },
    { key: 'cashflow', label: '现金流' },
    { key: 'margins', label: '利润率趋势' },
  ]

  const tooltipStyle = {
    background: 'hsl(0 0% 100%)',
    border: '1px solid hsl(220 16% 90%)',
    borderRadius: '8px',
    fontSize: '12px',
    boxShadow: 'var(--shadow-elevated)',
  }
  const tickStyle = { fontSize: 12, fill: 'hsl(220 10% 52%)' }

  const renderChart = () => {
    const commonProps = {
      data: financials,
      margin: { top: 5, right: 20, left: 0, bottom: 5 },
    }

    if (financials.length === 0) {
      return (
        <div className="flex items-center justify-center h-[320px] text-muted-foreground text-sm">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '暂无历史财务数据'}
        </div>
      )
    }

    switch (chartTab) {
      case 'revenue':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 90%)" />
              <XAxis dataKey="year" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="revenue" name="营业收入(亿)" fill="hsl(228 60% 50%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="netProfit" name="净利润(亿)" fill="hsl(262 52% 55%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
      case 'profit':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 90%)" />
              <XAxis dataKey="year" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="eps" name="每股收益(元)" fill="hsl(228 60% 50%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="roe" name="ROE(%)" fill="hsl(32 85% 55%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
      case 'cashflow':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart {...commonProps}>
              <defs>
                <linearGradient id="colorOCF" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(228 60% 50%)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="hsl(228 60% 50%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFCF" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(197 71% 48%)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="hsl(197 71% 48%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 90%)" />
              <XAxis dataKey="year" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Area type="monotone" dataKey="operatingCashFlow" name="经营现金流(亿)" stroke="hsl(228 60% 50%)" fill="url(#colorOCF)" strokeWidth={2} />
              <Area type="monotone" dataKey="freeCashFlow" name="自由现金流(亿)" stroke="hsl(197 71% 48%)" fill="url(#colorFCF)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )
      case 'margins':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart {...commonProps}>
              <defs>
                <linearGradient id="colorGM" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(228 60% 50%)" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="hsl(228 60% 50%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorNM" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(262 52% 55%)" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="hsl(262 52% 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 90%)" />
              <XAxis dataKey="year" tick={tickStyle} />
              <YAxis tick={tickStyle} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => val.toFixed(1) + '%'} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Area type="monotone" dataKey="grossMargin" name="毛利率" stroke="hsl(228 60% 50%)" fill="url(#colorGM)" strokeWidth={2} />
              <Area type="monotone" dataKey="netMargin" name="净利率" stroke="hsl(262 52% 55%)" fill="url(#colorNM)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )
    }
  }

  return (
    <div className="min-h-screen">
      <Header title={`${stock.name}${marketSuffix}`} subtitle={`${stock.code} · ${marketLabel}`} />

      <main className="p-8 space-y-6">
        {/* Top Bar */}
        <div className="flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <span className="text-display text-foreground font-mono">{currencySymbol}{stock.price.toFixed(2)}</span>
                {stock.change >= 0
                  ? <TrendingUp className="w-6 h-6 text-gain" />
                  : <TrendingDown className="w-6 h-6 text-loss" />
                }
                {loading && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-sm font-semibold ${stock.change >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}
                </span>
                <span className={`badge ${stock.change >= 0 ? 'badge-gain' : 'badge-loss'}`}>
                  {formatPercent(stock.changePercent)}
                </span>
                <span className="text-caption text-muted-foreground">
                  市值 {stock.marketCap > 0 ? '¥' + stock.marketCap.toLocaleString() + '亿' : '--'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={inWatchlist ? "secondary" : "default"}
              onClick={toggleWatchlist}
              className="gap-2"
            >
              {inWatchlist ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
              {inWatchlist ? '取消自选' : '加入自选'}
            </Button>
            <Button variant="outline" onClick={() => navigate(`/valuation?code=${stock.code}`)}>
              估值分析
            </Button>
          </div>
        </div>

        {/* Key Metrics Grid */}
        <section className="animate-fade-in animation-delay-100">
          <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">核心指标</h3>
          <div className="grid grid-cols-6 gap-3">
            {metrics.map(m => (
              <Card key={m.label} className="card-interactive">
                <CardContent className="p-4">
                  <div className="text-[11px] text-muted-foreground mb-1">{m.label}</div>
                  <div className="text-metric-sm text-foreground font-mono">{m.value}</div>
                  <div className="text-[10px] text-muted-foreground/60 mt-0.5">{m.desc}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Value Assessment */}
        <section className="animate-fade-in animation-delay-200">
          <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">价值评估速览</h3>
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-4 gap-6">
                <AssessmentItem
                  label="估值水平"
                  value={stock.pe > 0 ? (stock.pe < 15 ? '低估' : stock.pe < 25 ? '合理' : '偏高') : '暂无'}
                  color={stock.pe > 0 ? (stock.pe < 15 ? 'gain' : stock.pe < 25 ? 'primary' : 'loss') : 'primary'}
                  detail={`PE ${stock.pe > 0 ? stock.pe.toFixed(1) : '--'} · PB ${stock.pb > 0 ? stock.pb.toFixed(2) : '--'}`}
                />
                <AssessmentItem
                  label="盈利质量"
                  value={stock.roe > 0 ? (stock.roe > 20 ? '优秀' : stock.roe > 12 ? '良好' : '一般') : '暂无'}
                  color={stock.roe > 0 ? (stock.roe > 20 ? 'gain' : stock.roe > 12 ? 'primary' : 'loss') : 'primary'}
                  detail={stock.roe > 0 ? `ROE ${stock.roe.toFixed(1)}% · 净利率 ${stock.netMargin.toFixed(1)}%` : '--'}
                />
                <AssessmentItem
                  label="成长性"
                  value={stock.profitGrowth !== 0 ? (stock.profitGrowth > 15 ? '高成长' : stock.profitGrowth > 5 ? '稳健' : '放缓') : '暂无'}
                  color={stock.profitGrowth !== 0 ? (stock.profitGrowth > 15 ? 'gain' : stock.profitGrowth > 5 ? 'primary' : 'loss') : 'primary'}
                  detail={stock.profitGrowth !== 0 ? `利润增长 ${formatPercent(stock.profitGrowth)}` : '--'}
                />
                <AssessmentItem
                  label="财务健康"
                  value={stock.debtRatio > 0 ? (stock.debtRatio < 40 ? '健康' : stock.debtRatio < 70 ? '正常' : '偏高') : '暂无'}
                  color={stock.debtRatio > 0 ? (stock.debtRatio < 40 ? 'gain' : stock.debtRatio < 70 ? 'primary' : 'loss') : 'primary'}
                  detail={stock.debtRatio > 0 ? `负债率 ${stock.debtRatio.toFixed(1)}%` : '--'}
                />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 机会成本对比 · Opportunity Cost */}
        <OpportunityCostBenchmark stock={stock} />

        {/* Financial Charts & Table */}
        {isNonA ? (
          <section className="animate-fade-in animation-delay-300">
            <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">财务趋势 & 历年财务数据</h3>
            <Card>
              <CardContent className="p-8 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-accent/50 flex items-center justify-center">
                    <BarChart3 className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {isUS ? '美股' : '港股'}暂不支持历年财务数据展示
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    数据来源（腾讯行情）仅提供实时行情及 PE/PB/股息率/市值等基本指标，历年营收、利润、现金流等数据暂不可用
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : (
          <>
            {/* Financial Charts */}
            <section className="animate-fade-in animation-delay-300">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-caption text-muted-foreground uppercase tracking-wider">财务趋势</h3>
                <div className="flex gap-1">
                  {chartTabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setChartTab(tab.key)}
                      className={`tab-item ${chartTab === tab.key ? 'active' : ''}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <Card>
                <CardContent className="p-6">
                  {renderChart()}
                </CardContent>
              </Card>
            </section>

            {/* Financial Table */}
            <section>
              <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">历年财务数据</h3>
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-5 py-3 text-caption text-muted-foreground font-medium">年份</th>
                        <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">营收(亿)</th>
                        <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">净利(亿)</th>
                        <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">EPS</th>
                        <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">ROE(%)</th>
                        <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">毛利率(%)</th>
                        <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">净利率(%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financials.map(f => (
                        <tr key={f.year} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                          <td className="px-5 py-3 font-medium text-foreground">{f.year}</td>
                          <td className="text-right px-5 py-3 font-mono text-foreground">{f.revenue?.toFixed(1) ?? '--'}</td>
                          <td className="text-right px-5 py-3 font-mono text-foreground">{f.netProfit?.toFixed(1) ?? '--'}</td>
                          <td className="text-right px-5 py-3 font-mono text-foreground">{f.eps?.toFixed(2) ?? '--'}</td>
                          <td className="text-right px-5 py-3 font-mono text-foreground">{f.roe?.toFixed(1) ?? '--'}</td>
                          <td className="text-right px-5 py-3 font-mono text-foreground">{f.grossMargin?.toFixed(1) ?? '--'}</td>
                          <td className="text-right px-5 py-3 font-mono text-foreground">{f.netMargin?.toFixed(1) ?? '--'}</td>
                        </tr>
                      ))}
                      {financials.length === 0 && !loading && (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">暂无历史财务数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function AssessmentItem({ label, value, color, detail }: {
  label: string
  value: string
  color: 'gain' | 'loss' | 'primary'
  detail: string
}) {
  const colorMap = {
    gain: 'text-gain bg-gain-muted',
    loss: 'text-loss bg-loss-muted',
    primary: 'text-accent-foreground bg-accent',
  }
  return (
    <div className="text-center">
      <div className="text-[11px] text-muted-foreground mb-2">{label}</div>
      <div className={`inline-block px-3 py-1 rounded-md text-sm font-semibold ${colorMap[color]}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">{detail}</div>
    </div>
  )
}
