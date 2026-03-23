import { Header } from '@/components/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { stocksData } from '@/data/stockData'
import { Calculator, Info, RotateCcw, Loader2, Wifi, WifiOff, Sparkles } from 'lucide-react'
import {
  fetchStockQuote,
  fetchFundamentals,
  fetchFinancialHistory,
  getCachedFinancialHistory,
  type StockQuote,
  type Fundamentals,
  type FinancialRecord,
} from '@/services/api'

type ValuationModel = 'dcf' | 'graham' | 'peg'
type Strategy = 'default' | 'buffett' | 'munger' | 'graham_master' | 'lynch' | 'duan'

interface LiveStockData {
  code: string
  name: string
  price: number
  marketCap: number
  pe: number
  pb: number
  eps: number
  profitGrowth: number
  revenueGrowth: number
  roe: number
  netMargin: number
  debtRatio: number
  freeCashFlow: number
  netProfit: number
  currentRatio: number
  sharesOutstanding: number
  isHK: boolean
  isLive: boolean
}

// ============================================================
// Strategy definitions
// ============================================================

interface StrategyDef {
  key: Strategy
  name: string
  nameEn: string
  title: string
  quote: string
  preferredModel: ValuationModel
  color: string
  bgColor: string
  apply: (data: LiveStockData) => {
    dcf: typeof DEFAULT_DCF
    graham: typeof DEFAULT_GRAHAM
    peg: typeof DEFAULT_PEG
  }
  getInsight: (data: LiveStockData) => string
}

const DEFAULT_DCF = { fcf: 100, growthRate: 10, terminalGrowth: 3, discountRate: 10, years: 10, sharesOutstanding: 10 }
const DEFAULT_GRAHAM = { eps: 5, growthRate: 10, aaaYield: 4.5 }
const DEFAULT_PEG = { eps: 5, growthRate: 10, targetPEG: 1 }

const STRATEGIES: StrategyDef[] = [
  {
    key: 'buffett',
    name: '巴菲特',
    nameEn: 'Warren Buffett',
    title: '合理价格买好公司',
    quote: '"以合理的价格买入一家出色的公司，远胜于以出色的价格买入一家平庸的公司。"',
    preferredModel: 'dcf',
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10 border-amber-400/30 hover:border-amber-400/60',
    apply: (d) => {
      const cappedGrowth = Math.min(Math.max(d.profitGrowth, 3), 15)
      // Owner Earnings = Net Profit * 0.85 (D&A - maintenance CapEx)
      const ownerEarnings = d.netProfit > 0
        ? Math.round(d.netProfit * 0.85 * 10) / 10
        : d.freeCashFlow
      return {
        dcf: {
          fcf: ownerEarnings,
          growthRate: Math.round(cappedGrowth * 10) / 10,
          terminalGrowth: 3,
          discountRate: 10, // Buffett's standard: S&P 500 long-term return
          years: 10,
          sharesOutstanding: d.sharesOutstanding,
        },
        graham: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, aaaYield: 4.5 },
        peg: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, targetPEG: 1 },
      }
    },
    getInsight: (d) => {
      const checks: string[] = []
      if (d.roe >= 20) checks.push('ROE优秀')
      else if (d.roe >= 15) checks.push('ROE良好')
      else checks.push('ROE偏低')
      if (d.debtRatio < 40) checks.push('低负债')
      else if (d.debtRatio < 60) checks.push('负债适中')
      else checks.push('高负债')
      if (d.netMargin > 20) checks.push('高利润率')
      return `护城河检测: ${checks.join(' / ')}。折现率10%(机会成本)，增长率保守上限15%。`
    },
  },
  {
    key: 'munger',
    name: '芒格',
    nameEn: 'Charlie Munger',
    title: '好价格买伟大公司',
    quote: '"所有聪明的投资都是价值投资——以低于价值的价格获取更多的价值。"',
    preferredModel: 'dcf',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10 border-emerald-400/30 hover:border-emerald-400/60',
    apply: (d) => {
      // Munger: Quality premium - lower discount rate for quality businesses
      const isQuality = d.roe >= 20 && d.netMargin >= 15 && d.debtRatio < 50
      const discountRate = isQuality ? 9 : 10
      const cappedGrowth = Math.min(Math.max(d.profitGrowth, 3), 20)
      // Quality businesses retain earnings efficiently
      const fcf = d.netProfit > 0
        ? Math.round(d.netProfit * 0.8 * 10) / 10
        : d.freeCashFlow
      return {
        dcf: {
          fcf,
          growthRate: Math.round(cappedGrowth * 10) / 10,
          terminalGrowth: 3,
          discountRate,
          years: 10,
          sharesOutstanding: d.sharesOutstanding,
        },
        graham: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, aaaYield: 4.0 },
        peg: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, targetPEG: 1.2 },
      }
    },
    getInsight: (d) => {
      const isQuality = d.roe >= 20 && d.netMargin >= 15 && d.debtRatio < 50
      const qualityLabel = isQuality ? '"伟大公司"' : '"普通公司"'
      return `品质评级: ${qualityLabel}。${isQuality ? '折现率降至9%(给予品质溢价)' : '折现率10%(未达品质标准)'}，增长率上限20%。`
    },
  },
  {
    key: 'graham_master',
    name: '格雷厄姆',
    nameEn: 'Benjamin Graham',
    title: '安全边际为王',
    quote: '"投资的本质是对未来的预期进行管理。安全边际是投资成功的基石。"',
    preferredModel: 'graham',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10 border-blue-400/30 hover:border-blue-400/60',
    apply: (d) => {
      // Graham: Ultra conservative
      const cappedGrowth = Math.min(Math.max(d.profitGrowth, 2), 8)
      const fcf = d.netProfit > 0
        ? Math.round(d.netProfit * 0.6 * 10) / 10
        : Math.round(d.freeCashFlow * 0.85 * 10) / 10
      return {
        dcf: {
          fcf,
          growthRate: Math.round(cappedGrowth * 10) / 10,
          terminalGrowth: 2,
          discountRate: 12, // Very conservative
          years: 10,
          sharesOutstanding: d.sharesOutstanding,
        },
        graham: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, aaaYield: 4.5 },
        peg: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, targetPEG: 0.8 },
      }
    },
    getInsight: (d) => {
      const safetyChecks: string[] = []
      if (d.currentRatio >= 2) safetyChecks.push('流动比率达标')
      else safetyChecks.push('流动比率偏低')
      if (d.pe > 0 && d.pe < 15) safetyChecks.push('PE估值合理')
      else if (d.pe >= 15) safetyChecks.push('PE偏高')
      if (d.pb > 0 && d.pb < 1.5) safetyChecks.push('PB低于净资产')
      return `安全检测: ${safetyChecks.join(' / ')}。折现率12%，增长率保守上限8%，永续增长仅2%。`
    },
  },
  {
    key: 'lynch',
    name: '彼得·林奇',
    nameEn: 'Peter Lynch',
    title: 'PEG 成长估值',
    quote: '"不做研究就投资和不看牌就玩梭哈扑克一样盲目。"',
    preferredModel: 'peg',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10 border-purple-400/30 hover:border-purple-400/60',
    apply: (d) => {
      const growth = Math.max(d.profitGrowth, 5)
      return {
        dcf: {
          fcf: d.freeCashFlow,
          growthRate: Math.round(growth * 10) / 10,
          terminalGrowth: 3,
          discountRate: 10,
          years: 10,
          sharesOutstanding: d.sharesOutstanding,
        },
        graham: { eps: d.eps, growthRate: Math.round(growth * 10) / 10, aaaYield: 4.5 },
        peg: { eps: d.eps, growthRate: Math.round(growth * 10) / 10, targetPEG: 1 },
      }
    },
    getInsight: (d) => {
      if (d.pe <= 0 || d.profitGrowth <= 0) return 'PEG 无法计算（PE或增长率为负）'
      const peg = d.pe / d.profitGrowth
      let verdict = ''
      if (peg < 0.5) verdict = '极度低估'
      else if (peg < 1) verdict = '低估'
      else if (peg < 1.5) verdict = '合理估值'
      else if (peg < 2) verdict = '偏高'
      else verdict = '显著高估'
      return `当前PEG = ${peg.toFixed(2)}，林奇判定: ${verdict}。PEG<1 是理想买入区间，PEG>1.5 需谨慎。`
    },
  },
  {
    key: 'duan',
    name: '段永平',
    nameEn: 'Yongping Duan',
    title: '买你能看懂的好生意',
    quote: '"买股票就是买公司，买公司就是买其未来现金流的折现值。"',
    preferredModel: 'dcf',
    color: 'text-rose-400',
    bgColor: 'bg-rose-400/10 border-rose-400/30 hover:border-rose-400/60',
    apply: (d) => {
      // Duan: Strong Buffett disciple, extremely selective
      // Only invests in businesses with exceptional cash conversion
      // Very conservative growth (rather miss than be wrong)
      const isGreatBiz = d.roe >= 20 && d.netMargin >= 20 && d.debtRatio < 40
      const cappedGrowth = Math.min(Math.max(d.profitGrowth, 3), 12) // Very conservative cap
      // Great businesses convert nearly all profit to cash
      const fcf = d.netProfit > 0
        ? Math.round(d.netProfit * (isGreatBiz ? 0.9 : 0.75) * 10) / 10
        : d.freeCashFlow
      return {
        dcf: {
          fcf,
          growthRate: Math.round(cappedGrowth * 10) / 10,
          terminalGrowth: 3,
          discountRate: 10,
          years: 10,
          sharesOutstanding: d.sharesOutstanding,
        },
        graham: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, aaaYield: 4.5 },
        peg: { eps: d.eps, growthRate: Math.round(cappedGrowth * 10) / 10, targetPEG: 0.9 },
      }
    },
    getInsight: (d) => {
      const isGreatBiz = d.roe >= 20 && d.netMargin >= 20 && d.debtRatio < 40
      const bizChecks: string[] = []
      if (isGreatBiz) {
        bizChecks.push('好生意')
      } else {
        if (d.roe < 20) bizChecks.push('ROE不达标(<20%)')
        if (d.netMargin < 20) bizChecks.push('利润率不够厚(<20%)')
        if (d.debtRatio >= 40) bizChecks.push('负债偏高(>40%)')
      }
      return `生意模式: ${bizChecks.join(' / ')}。${isGreatBiz ? '现金转化率90%(好生意溢价)' : '现金转化率75%(保守估计)'}，增长率上限12%，宁可错过不要做错。`
    },
  },
]

// Preset stock list for dropdown
const PRESET_STOCKS = [
  { code: '600519', name: '贵州茅台' },
  { code: '000858', name: '五粮液' },
  { code: '000333', name: '美的集团' },
  { code: '300750', name: '宁德时代' },
  { code: '600036', name: '招商银行' },
  { code: '601318', name: '中国平安' },
  { code: '002415', name: '海康威视' },
  { code: '603288', name: '海天味业' },
  { code: '600900', name: '长江电力' },
  { code: '000568', name: '泸州老窖' },
  { code: '002304', name: '洋河股份' },
  { code: '601012', name: '隆基绿能' },
]

export function Valuation() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const codeFromUrl = searchParams.get('code') || '600519'

  const [model, setModel] = useState<ValuationModel>('dcf')
  const [strategy, setStrategy] = useState<Strategy>('default')
  const [loading, setLoading] = useState(false)
  const [liveData, setLiveData] = useState<LiveStockData | null>(null)
  const fetchIdRef = useRef(0) // 竞态保护：丢弃过时的异步结果

  // DCF Model State
  const [dcfParams, setDcfParams] = useState({ ...DEFAULT_DCF })
  // Graham Model State
  const [grahamParams, setGrahamParams] = useState({ ...DEFAULT_GRAHAM })
  // PEG Model State
  const [pegParams, setPegParams] = useState({ ...DEFAULT_PEG })

  // Populate params from live data (default strategy)
  const populateParams = useCallback((data: LiveStockData) => {
    setDcfParams({
      fcf: data.freeCashFlow,
      growthRate: Math.round(data.profitGrowth * 10) / 10,
      terminalGrowth: 3,
      discountRate: 10,
      years: 10,
      sharesOutstanding: data.sharesOutstanding,
    })
    setGrahamParams({
      eps: data.eps,
      growthRate: Math.round(data.profitGrowth * 10) / 10,
      aaaYield: 4.5,
    })
    setPegParams({
      eps: data.eps,
      growthRate: Math.round(data.profitGrowth * 10) / 10,
      targetPEG: 1,
    })
  }, [])

  // Apply a strategy
  const applyStrategy = useCallback((stratKey: Strategy, data: LiveStockData) => {
    setStrategy(stratKey)
    if (stratKey === 'default') {
      populateParams(data)
      return
    }
    const strat = STRATEGIES.find(s => s.key === stratKey)
    if (!strat) return
    const params = strat.apply(data)
    setModel(strat.preferredModel)
    setDcfParams(params.dcf)
    setGrahamParams(params.graham)
    setPegParams(params.peg)
  }, [populateParams])

  // Fetch live data for a stock
  const fetchLiveData = useCallback(async (code: string) => {
    const fetchId = ++fetchIdRef.current // 竞态保护：记录本次请求 ID
    setLoading(true)
    const isHK = code.length === 5 && code.startsWith('0')
    const staticStock = stocksData[code]

    try {
      // 先用缓存的财务数据作为 fallback，加速响应
      const cachedFin = getCachedFinancialHistory(code)

      const [quote, fund, financials] = await Promise.all([
        fetchStockQuote(code, {}),
        fetchFundamentals(code, {}),
        fetchFinancialHistory(code, cachedFin.length > 0 ? cachedFin : []),
      ])

      // 竞态保护：如果在请求期间用户切换了股票，丢弃过时结果
      if (fetchId !== fetchIdRef.current) return

      const quoteData = quote as StockQuote
      const fundData = fund as Fundamentals
      const finData = financials as FinancialRecord[]

      const latestFin = finData.length > 0 ? finData[finData.length - 1] : null
      const eps = latestFin?.eps ?? fundData?.eps ?? staticStock?.eps ?? 1

      let profitGrowth = fundData?.profitGrowth ?? 0
      if (!profitGrowth && finData.length >= 2) {
        const prev = finData[finData.length - 2]
        const curr = finData[finData.length - 1]
        if (prev.netProfit > 0) {
          profitGrowth = ((curr.netProfit - prev.netProfit) / prev.netProfit) * 100
        }
      }
      if (!profitGrowth) profitGrowth = staticStock?.profitGrowth ?? 10

      const price = quoteData?.price || staticStock?.price || 0
      const marketCap = quoteData?.marketCap || staticStock?.marketCap || 0

      const shares = price > 0 && marketCap > 0
        ? Math.round(marketCap / price * 100) / 100
        : (staticStock ? Math.round(staticStock.marketCap / staticStock.price * 100) / 100 : 10)

      const netProfit = latestFin?.netProfit ?? 0
      const fcf = netProfit > 0
        ? Math.round(netProfit * 0.7 * 10) / 10
        : (staticStock?.freeCashFlow || 100)

      const data: LiveStockData = {
        code,
        name: quoteData?.name || staticStock?.name || code,
        price,
        marketCap,
        pe: fundData?.pe ?? quoteData?.pe ?? staticStock?.pe ?? 0,
        pb: fundData?.pb ?? quoteData?.pb ?? staticStock?.pb ?? 0,
        eps,
        profitGrowth,
        revenueGrowth: fundData?.revenueGrowth ?? staticStock?.revenueGrowth ?? 0,
        roe: latestFin?.roe ?? fundData?.roe ?? staticStock?.roe ?? 0,
        netMargin: latestFin?.netMargin ?? fundData?.netMargin ?? staticStock?.netMargin ?? 0,
        debtRatio: fundData?.debtRatio ?? staticStock?.debtRatio ?? 0,
        freeCashFlow: fcf,
        netProfit,
        currentRatio: fundData?.currentRatio ?? staticStock?.currentRatio ?? 0,
        sharesOutstanding: shares,
        isHK,
        isLive: !!(quoteData?.price),
      }

      setLiveData(data)
      // Apply current strategy with new data
      if (strategy !== 'default') {
        applyStrategy(strategy, data)
      } else {
        populateParams(data)
      }
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return // 竞态保护
      console.error('Failed to fetch live data:', err)
      if (staticStock) {
        const data: LiveStockData = {
          code: staticStock.code, name: staticStock.name, price: staticStock.price,
          marketCap: staticStock.marketCap, pe: staticStock.pe, pb: staticStock.pb,
          eps: staticStock.eps, profitGrowth: staticStock.profitGrowth,
          revenueGrowth: staticStock.revenueGrowth, roe: staticStock.roe,
          netMargin: staticStock.netMargin, debtRatio: staticStock.debtRatio,
          freeCashFlow: staticStock.freeCashFlow, netProfit: 0,
          currentRatio: staticStock.currentRatio,
          sharesOutstanding: Math.round(staticStock.marketCap / staticStock.price * 100) / 100,
          isHK: false, isLive: false,
        }
        setLiveData(data)
        populateParams(data)
      }
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false) // 仅最新请求可清除 loading
    }
  }, [populateParams, applyStrategy, strategy])

  useEffect(() => {
    fetchLiveData(codeFromUrl)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl])

  // Calculations
  const calcDCF = () => {
    const { fcf, growthRate, terminalGrowth, discountRate, years, sharesOutstanding } = dcfParams
    if (sharesOutstanding <= 0 || discountRate <= terminalGrowth) return { totalValue: 0, terminalPV: 0, fcfPV: 0, perShare: 0 }
    let totalPV = 0, currentFCF = fcf
    for (let i = 1; i <= years; i++) {
      currentFCF *= (1 + growthRate / 100)
      totalPV += currentFCF / Math.pow(1 + discountRate / 100, i)
    }
    const terminalValue = currentFCF * (1 + terminalGrowth / 100) / (discountRate / 100 - terminalGrowth / 100)
    const terminalPV = terminalValue / Math.pow(1 + discountRate / 100, years)
    const totalValue = totalPV + terminalPV
    return { totalValue, terminalPV, fcfPV: totalPV, perShare: totalValue / sharesOutstanding }
  }

  const calcGraham = () => {
    const { eps, growthRate, aaaYield } = grahamParams
    if (aaaYield <= 0 || eps <= 0) return { value: 0, pe: 0 }
    const value = eps * (8.5 + 2 * growthRate) * 4.4 / aaaYield
    return { value, pe: value / eps }
  }

  const calcPEG = () => {
    const { eps, growthRate, targetPEG } = pegParams
    const targetPE = targetPEG * growthRate
    return { value: eps * targetPE, targetPE }
  }

  const dcfResult = calcDCF()
  const grahamResult = calcGraham()
  const pegResult = calcPEG()

  const models: { key: ValuationModel; label: string; desc: string }[] = [
    { key: 'dcf', label: 'DCF 折现模型', desc: '基于自由现金流折现估值' },
    { key: 'graham', label: '格雷厄姆公式', desc: '本杰明·格雷厄姆经典估值' },
    { key: 'peg', label: 'PEG 估值', desc: '基于增长率的PE估值' },
  ]

  const resetParams = () => {
    setStrategy('default')
    if (liveData) populateParams(liveData)
  }

  const activeStrat = STRATEGIES.find(s => s.key === strategy)
  const currencySymbol = liveData?.isHK ? 'HK$' : '¥'
  const currentPrice = liveData?.price || 0

  return (
    <div className="min-h-screen">
      <Header title="估值计算器" subtitle="多模型估值分析" />

      <main className="p-8 space-y-6">
        {/* Stock selector */}
        <div className="flex items-center gap-4 animate-fade-in">
          <label className="text-sm text-muted-foreground">分析标的</label>
          <select
            value={codeFromUrl}
            onChange={e => navigate(`/valuation?code=${e.target.value}`)}
            className="input-field w-[240px]"
          >
            {PRESET_STOCKS.map(s => (
              <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
            ))}
          </select>

          {loading ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              加载实时数据...
            </span>
          ) : liveData && (
            <span className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                当前价格: <span className="font-semibold text-foreground font-mono">{currencySymbol}{currentPrice.toFixed(2)}</span>
              </span>
              {liveData.pe > 0 && (
                <span>
                  PE: <span className="font-semibold text-foreground font-mono">{liveData.pe.toFixed(1)}</span>
                </span>
              )}
              {liveData.isLive ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
                  <Wifi className="w-3 h-3" /> 实时
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                  <WifiOff className="w-3 h-3" /> 缓存
                </span>
              )}
            </span>
          )}

          <Button variant="ghost" size="sm" onClick={resetParams} className="gap-1.5 ml-auto">
            <RotateCcw className="w-3.5 h-3.5" />
            重置参数
          </Button>
        </div>

        {/* Strategy Presets */}
        <div className="animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">大师策略</h3>
            <span className="text-[10px] text-muted-foreground">选择投资大师的估值哲学，自动调整参数</span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {STRATEGIES.map(s => (
              <button
                key={s.key}
                onClick={() => liveData && applyStrategy(s.key, liveData)}
                disabled={!liveData || loading}
                className={`p-3.5 rounded-lg border text-left transition-all ${
                  strategy === s.key
                    ? `${s.bgColor} border-2`
                    : 'border-border bg-card/50 hover:bg-card hover:border-border/80'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-sm font-bold ${strategy === s.key ? s.color : 'text-foreground'}`}>
                    {s.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{s.nameEn}</span>
                </div>
                <p className={`text-xs font-medium mb-1 ${strategy === s.key ? s.color : 'text-muted-foreground'}`}>
                  {s.title}
                </p>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed line-clamp-2 italic">
                  {s.quote}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Strategy Insight */}
        {activeStrat && liveData && (
          <div className={`flex items-start gap-3 p-3.5 rounded-lg border ${activeStrat.bgColor} animate-fade-in`}>
            <Info className={`w-4 h-4 ${activeStrat.color} mt-0.5 shrink-0`} />
            <div>
              <p className={`text-xs font-medium ${activeStrat.color} mb-0.5`}>
                {activeStrat.name}策略 &middot; {liveData.name}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {activeStrat.getInsight(liveData)}
              </p>
            </div>
          </div>
        )}

        {/* Model Tabs */}
        <div className="flex gap-3 animate-fade-in">
          {models.map(m => (
            <button
              key={m.key}
              onClick={() => setModel(m.key)}
              className={`flex-1 p-4 rounded-lg border text-left transition-all ${
                model === m.key
                  ? 'border-primary bg-accent shadow-sm'
                  : 'border-border bg-card hover:border-primary/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Calculator className={`w-4 h-4 ${model === m.key ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-semibold ${model === m.key ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {m.label}
                </span>
                {activeStrat?.preferredModel === m.key && strategy !== 'default' && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${activeStrat.bgColor} ${activeStrat.color} font-medium`}>
                    {activeStrat.name}推荐
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{m.desc}</p>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-6">
            {/* Parameters */}
            <div className="col-span-3">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h4 className="text-subheading text-foreground">参数设置</h4>
                    <div className="flex items-center gap-2">
                      {activeStrat && (
                        <span className={`text-[10px] px-2 py-0.5 rounded ${activeStrat.bgColor} ${activeStrat.color} font-medium`}>
                          {activeStrat.name}策略
                        </span>
                      )}
                      {liveData && (
                        <span className="text-[10px] text-muted-foreground">
                          {liveData.isLive ? '实时API' : '本地缓存'} &middot; {liveData.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {model === 'dcf' && (
                    <div className="grid grid-cols-2 gap-4">
                      <ParamInput label="当前自由现金流(亿)" value={dcfParams.fcf}
                        onChange={v => setDcfParams(p => ({ ...p, fcf: v }))}
                        hint={activeStrat?.key === 'buffett' ? 'Owner Earnings = 净利润 x 0.85' :
                              activeStrat?.key === 'graham_master' ? '保守估计 = 净利润 x 0.6' :
                              activeStrat?.key === 'munger' ? '品质调整 = 净利润 x 0.8' :
                              activeStrat?.key === 'duan' ? '好生意90%现金转化 / 普通75%' :
                              liveData ? `基于${liveData.name}最新净利润估算` : undefined} />
                      <ParamInput label="预期增长率(%)" value={dcfParams.growthRate}
                        onChange={v => setDcfParams(p => ({ ...p, growthRate: v }))}
                        hint={activeStrat?.key === 'buffett' ? '保守上限15%' :
                              activeStrat?.key === 'graham_master' ? '极度保守，上限8%' :
                              activeStrat?.key === 'munger' ? '品质企业可到20%' :
                              activeStrat?.key === 'duan' ? '宁可错过，上限12%' :
                              liveData?.profitGrowth ? `近一年利润增速 ${liveData.profitGrowth.toFixed(1)}%` : undefined} />
                      <ParamInput label="永续增长率(%)" value={dcfParams.terminalGrowth}
                        onChange={v => setDcfParams(p => ({ ...p, terminalGrowth: v }))} />
                      <ParamInput label="折现率(%)" value={dcfParams.discountRate}
                        onChange={v => setDcfParams(p => ({ ...p, discountRate: v }))}
                        hint={activeStrat?.key === 'buffett' ? '10% = 标普500长期回报' :
                              activeStrat?.key === 'munger' ? '9%~10% 品质溢价' :
                              activeStrat?.key === 'graham_master' ? '12% 极度保守' :
                              activeStrat?.key === 'duan' ? '10% 买公司就是买未来现金流' : undefined} />
                      <ParamInput label="预测年数" value={dcfParams.years}
                        onChange={v => setDcfParams(p => ({ ...p, years: v }))} step={1} />
                      <ParamInput label="总股本(亿股)" value={dcfParams.sharesOutstanding}
                        onChange={v => setDcfParams(p => ({ ...p, sharesOutstanding: v }))}
                        hint={liveData?.marketCap ? `市值${liveData.marketCap.toFixed(0)}亿 / 股价${liveData.price.toFixed(0)}` : undefined} />
                    </div>
                  )}

                  {model === 'graham' && (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/50 mb-4">
                        <Info className="w-4 h-4 text-accent-foreground mt-0.5 shrink-0" />
                        <p className="text-xs text-accent-foreground">
                          格雷厄姆公式: V = EPS x (8.5 + 2g) x 4.4 / Y，其中 g 为预期增长率，Y 为AAA级债券收益率
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <ParamInput label="每股收益 EPS(元)" value={grahamParams.eps}
                          onChange={v => setGrahamParams(p => ({ ...p, eps: v }))}
                          hint={liveData ? `${liveData.name}最新年报 EPS` : undefined} />
                        <ParamInput label="预期增长率 g(%)" value={grahamParams.growthRate}
                          onChange={v => setGrahamParams(p => ({ ...p, growthRate: v }))} />
                        <ParamInput label="AAA级债券收益率 Y(%)" value={grahamParams.aaaYield}
                          onChange={v => setGrahamParams(p => ({ ...p, aaaYield: v }))}
                          hint={activeStrat?.key === 'munger' ? '4.0% 品质企业降低要求' : undefined} />
                      </div>
                    </div>
                  )}

                  {model === 'peg' && (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/50 mb-4">
                        <Info className="w-4 h-4 text-accent-foreground mt-0.5 shrink-0" />
                        <p className="text-xs text-accent-foreground">
                          PEG估值: 合理PE = PEG x 增长率。PEG=1 为合理估值，&lt;1 表示低估，&gt;1 表示偏高
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <ParamInput label="每股收益 EPS(元)" value={pegParams.eps}
                          onChange={v => setPegParams(p => ({ ...p, eps: v }))} />
                        <ParamInput label="预期增长率(%)" value={pegParams.growthRate}
                          onChange={v => setPegParams(p => ({ ...p, growthRate: v }))} />
                        <ParamInput label="目标PEG" value={pegParams.targetPEG}
                          onChange={v => setPegParams(p => ({ ...p, targetPEG: v }))} step={0.1}
                          hint={activeStrat?.key === 'munger' ? 'PEG 1.2 品质溢价' :
                                activeStrat?.key === 'graham_master' ? 'PEG 0.8 安全边际' :
                                activeStrat?.key === 'lynch' ? 'PEG=1 为合理估值' :
                                activeStrat?.key === 'duan' ? 'PEG 0.9 好生意也要好价格' : undefined} />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Results */}
            <div className="col-span-2 space-y-4">
              <Card className="border-primary/20">
                <CardContent className="p-6">
                  <h4 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">估值结果</h4>

                  {model === 'dcf' && (
                    <div className="space-y-4">
                      <div className="text-center py-4">
                        <div className="text-caption text-muted-foreground mb-1">每股内在价值</div>
                        <div className="text-display text-gradient font-mono">{currencySymbol}{dcfResult.perShare.toFixed(2)}</div>
                        {currentPrice > 0 && (
                          <div className={`mt-2 text-sm font-medium ${dcfResult.perShare > currentPrice ? 'text-gain' : 'text-loss'}`}>
                            {dcfResult.perShare > currentPrice ? '低估' : '高估'}{' '}
                            {Math.abs((dcfResult.perShare / currentPrice - 1) * 100).toFixed(1)}%
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 pt-4 border-t border-border">
                        <ResultRow label="企业总价值" value={`${dcfResult.totalValue.toFixed(0)}亿`} />
                        <ResultRow label="现金流折现值" value={`${dcfResult.fcfPV.toFixed(0)}亿`} />
                        <ResultRow label="终值折现" value={`${dcfResult.terminalPV.toFixed(0)}亿`} />
                        {currentPrice > 0 && liveData && (
                          <ResultRow label="当前市值" value={`${liveData.marketCap.toFixed(0)}亿`} />
                        )}
                        {activeStrat?.key === 'buffett' && currentPrice > 0 && (
                          <ResultRow label="安全边际价(75%)" value={`${currencySymbol}${(dcfResult.perShare * 0.75).toFixed(2)}`} highlight />
                        )}
                        {activeStrat?.key === 'graham_master' && currentPrice > 0 && (
                          <ResultRow label="安全边际价(66%)" value={`${currencySymbol}${(dcfResult.perShare * 0.66).toFixed(2)}`} highlight />
                        )}
                        {activeStrat?.key === 'duan' && currentPrice > 0 && (
                          <ResultRow label="好价格(70%)" value={`${currencySymbol}${(dcfResult.perShare * 0.70).toFixed(2)}`} highlight />
                        )}
                        {activeStrat?.key === 'munger' && currentPrice > 0 && (
                          <ResultRow label="品质折价(80%)" value={`${currencySymbol}${(dcfResult.perShare * 0.80).toFixed(2)}`} highlight />
                        )}
                      </div>
                    </div>
                  )}

                  {model === 'graham' && (
                    <div className="space-y-4">
                      <div className="text-center py-4">
                        <div className="text-caption text-muted-foreground mb-1">格雷厄姆内在价值</div>
                        <div className="text-display text-gradient font-mono">{currencySymbol}{grahamResult.value.toFixed(2)}</div>
                        {currentPrice > 0 && (
                          <div className={`mt-2 text-sm font-medium ${grahamResult.value > currentPrice ? 'text-gain' : 'text-loss'}`}>
                            {grahamResult.value > currentPrice ? '低估' : '高估'}{' '}
                            {Math.abs((grahamResult.value / currentPrice - 1) * 100).toFixed(1)}%
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 pt-4 border-t border-border">
                        <ResultRow label="对应PE倍数" value={grahamResult.pe.toFixed(1)} />
                        <ResultRow label="安全边际价格 (70%)" value={`${currencySymbol}${(grahamResult.value * 0.7).toFixed(2)}`} highlight />
                        {currentPrice > 0 && liveData?.pe && liveData.pe > 0 && (
                          <ResultRow label="当前PE" value={liveData.pe.toFixed(1)} />
                        )}
                      </div>
                    </div>
                  )}

                  {model === 'peg' && (
                    <div className="space-y-4">
                      <div className="text-center py-4">
                        <div className="text-caption text-muted-foreground mb-1">PEG合理价格</div>
                        <div className="text-display text-gradient font-mono">{currencySymbol}{pegResult.value.toFixed(2)}</div>
                        {currentPrice > 0 && (
                          <div className={`mt-2 text-sm font-medium ${pegResult.value > currentPrice ? 'text-gain' : 'text-loss'}`}>
                            {pegResult.value > currentPrice ? '低估' : '高估'}{' '}
                            {Math.abs((pegResult.value / currentPrice - 1) * 100).toFixed(1)}%
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 pt-4 border-t border-border">
                        <ResultRow label="目标PE" value={pegResult.targetPE.toFixed(1)} />
                        {liveData?.pe && liveData.pe > 0 && pegParams.growthRate > 0 && (
                          <ResultRow label="当前PEG" value={(liveData.pe / pegParams.growthRate).toFixed(2)} />
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Data summary card */}
              {liveData && (
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <h5 className="text-xs font-medium text-foreground mb-2">关键数据</h5>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      <ResultRow label="股价" value={`${currencySymbol}${liveData.price.toFixed(2)}`} />
                      <ResultRow label="市值" value={`${liveData.marketCap.toFixed(0)}亿`} />
                      {liveData.pe > 0 && <ResultRow label="PE(TTM)" value={liveData.pe.toFixed(1)} />}
                      {liveData.pb > 0 && <ResultRow label="PB" value={liveData.pb.toFixed(2)} />}
                      {liveData.roe > 0 && <ResultRow label="ROE" value={`${liveData.roe.toFixed(1)}%`} />}
                      {liveData.eps > 0 && <ResultRow label="EPS" value={`${currencySymbol}${liveData.eps.toFixed(2)}`} />}
                      {liveData.profitGrowth !== 0 && <ResultRow label="利润增速" value={`${liveData.profitGrowth > 0 ? '+' : ''}${liveData.profitGrowth.toFixed(1)}%`} />}
                      {liveData.netMargin > 0 && <ResultRow label="净利率" value={`${liveData.netMargin.toFixed(1)}%`} />}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Sensitivity hint */}
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">提示：</span>
                    估值结果对参数非常敏感，建议调整关键参数（如折现率、增长率）进行敏感性分析，取值区间的中位数作为参考。
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function ParamInput({ label, value, onChange, step = 0.5, hint }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1.5 block">{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="input-field font-mono"
      />
      {hint && <p className="text-[10px] text-muted-foreground/60 mt-1">{hint}</p>}
    </div>
  )
}

function ResultRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${highlight ? 'text-primary font-medium' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-sm font-semibold font-mono ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</span>
    </div>
  )
}
