import { Header } from '@/components/Header'
import { useApp } from '@/context/AppContext'
import { useNavigate } from 'react-router-dom'
import { stocksData, marketIndices as localIndices, formatPercent } from '@/data/stockData'
import { fetchIndices, fetchBatchQuotes, fetchFundamentals, importStocksFromFile, type IndexData, type SearchResult, type Fundamentals } from '@/services/api'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, TrendingDown, ArrowUpRight, Wifi, WifiOff, X, Upload, Loader2, Check } from 'lucide-react'
import { useEffect, useState, useRef, useCallback } from 'react'

export function Dashboard() {
  const { watchlist, isBackendOnline, removeFromWatchlist, showToast, addToWatchlist, isInWatchlist } = useApp()
  const navigate = useNavigate()

  const [indices, setIndices] = useState<IndexData[]>(localIndices)
  const [watchStocks, setWatchStocks] = useState<SearchResult[]>([])
  const [fundMap, setFundMap] = useState<Record<string, Fundamentals>>({})
  const [loading, setLoading] = useState(true)

  // 图片导入状态
  const [importing, setImporting] = useState(false)
  const [importResults, setImportResults] = useState<{ code: string; name: string; market: string }[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const isVideo = file.type.startsWith('video/')
    const maxSize = isVideo ? 50 * 1024 * 1024 : 20 * 1024 * 1024
    const label = isVideo ? '视频' : file.type === 'application/pdf' ? 'PDF' : '图片'

    if (file.size > maxSize) {
      showToast(`${label}太大，请限制在${maxSize / (1024 * 1024)}MB以内`, 'error')
      return
    }

    setImporting(true)
    setImportResults(null)

    try {
      const stocks = await importStocksFromFile(file)
      if (stocks.length === 0) {
        showToast(`未在${label}中识别到股票信息`, 'info')
      } else {
        setImportResults(stocks)
        showToast(`从${label}中识别到 ${stocks.length} 只股票`, 'success')
      }
    } catch {
      showToast(`${label}识别失败，请重试`, 'error')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [showToast])

  const handleImportConfirm = useCallback(() => {
    if (!importResults) return
    const groupId = watchlist[0]?.id || '1'
    let added = 0
    importResults.forEach(s => {
      if (!isInWatchlist(s.code)) {
        addToWatchlist(groupId, s.code)
        added++
      }
    })
    showToast(added > 0 ? `已添加 ${added} 只新股票到自选` : '所有股票已在自选中', added > 0 ? 'success' : 'info')
    setImportResults(null)
  }, [importResults, watchlist, isInWatchlist, addToWatchlist, showToast])

  const allWatchCodes = [...new Set(watchlist.flatMap(g => g.stocks))]
  const codesKey = allWatchCodes.join(',')
  const prevCodesRef = useRef(codesKey)

  useEffect(() => {
    prevCodesRef.current = codesKey
  }, [codesKey])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      const idxData = await fetchIndices(localIndices)
      if (!cancelled) setIndices(idxData)

      if (allWatchCodes.length > 0) {
        if (isBackendOnline) {
          const batchData = await fetchBatchQuotes(allWatchCodes)
          if (!cancelled) setWatchStocks(batchData)

          // 并行获取每只股票的基本面指标（PE/PB/ROE）
          const fundResults = await Promise.allSettled(
            allWatchCodes.map(code => fetchFundamentals(code, {}))
          )
          if (!cancelled) {
            const map: Record<string, Fundamentals> = {}
            fundResults.forEach((r, i) => {
              if (r.status === 'fulfilled' && r.value) map[allWatchCodes[i]] = r.value
            })
            setFundMap(map)
          }
        } else {
          const local = allWatchCodes
            .map(code => stocksData[code])
            .filter(Boolean)
            .map(s => ({
              code: s.code, name: s.name, price: s.price,
              change: s.change, changePercent: s.changePercent,
            }))
          if (!cancelled) setWatchStocks(local)
        }
      } else {
        if (!cancelled) setWatchStocks([])
      }

      if (!cancelled) setLoading(false)
    }

    load()

    const interval = isBackendOnline ? setInterval(load, 30000) : undefined
    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, isBackendOnline])

  // 用实时数据构建排行用的股票列表（优先 fundMap，fallback 到静态数据）
  const rankStocks = allWatchCodes
    .map(code => {
      const fund = fundMap[code]
      const live = watchStocks.find(s => s.code === code)
      const local = stocksData[code]
      if (!fund && !local) return null
      const rIsHK = code.length === 5 && /^\d{5}$/.test(code)
      const rIsUS = /^[A-Z]{1,5}(\.[A-Z])?$/.test(code)
      const rSuffix = rIsUS ? '(US)' : rIsHK ? '(HK)' : ''
      return {
        code,
        name: (live?.name || local?.name || code) + rSuffix,
        pe: fund?.pe ?? local?.pe ?? 0,
        roe: fund?.roe ?? local?.roe ?? 0,
        dividendYield: fund?.dividendYield ?? local?.dividendYield ?? 0,
      }
    })
    .filter(Boolean) as { code: string; name: string; pe: number; roe: number; dividendYield: number }[]

  return (
    <div className="min-h-screen">
      <Header title="仪表盘" subtitle="市场概览与自选股分析" />

      <main className="p-8 space-y-8">
        {/* Connection Status */}
        <div className="flex items-center gap-2 animate-fade-in">
          {isBackendOnline ? (
            <span className="flex items-center gap-1.5 text-[11px] text-gain font-medium px-2.5 py-1 rounded-full badge-gain">
              <Wifi className="w-3 h-3" /> 实时数据
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium px-2.5 py-1 rounded-full bg-secondary">
              <WifiOff className="w-3 h-3" /> 模拟数据
            </span>
          )}
          {isBackendOnline && (
            <span className="text-[10px] text-muted-foreground">每30秒自动刷新</span>
          )}
        </div>

        {/* Market Indices */}
        <section className="animate-fade-in">
          <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">市场指数</h3>
          <div className="grid grid-cols-4 gap-4">
            {indices.map(idx => (
              <Card key={idx.code} className="card-interactive cursor-default">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-body text-muted-foreground">{idx.name}</span>
                    {idx.change >= 0
                      ? <TrendingUp className="w-4 h-4 text-gain" />
                      : <TrendingDown className="w-4 h-4 text-loss" />
                    }
                  </div>
                  <div className="text-metric-sm text-foreground">{idx.value.toLocaleString()}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-caption font-semibold ${idx.change >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {idx.change >= 0 ? '+' : ''}{idx.change.toFixed(2)}
                    </span>
                    <span className={`badge text-[10px] ${idx.change >= 0 ? 'badge-gain' : 'badge-loss'}`}>
                      {formatPercent(idx.changePercent)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Watchlist Overview */}
        <section className="animate-fade-in animation-delay-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-caption text-muted-foreground uppercase tracking-wider">自选股概览</h3>
            <div className="flex items-center gap-3">
              {isBackendOnline && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,video/mp4,video/quicktime,video/webm"
                    className="hidden"
                    onChange={handleImageImport}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    className="flex items-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                  >
                    {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {importing ? '识别中...' : '导入'}
                  </button>
                </>
              )}
              <span className="text-caption text-muted-foreground">
                {loading ? '加载中...' : `${watchStocks.length} 只股票`}
              </span>
            </div>
          </div>

          {/* 图片识别结果面板 */}
          {importResults && importResults.length > 0 && (
            <Card className="mb-4 border-primary/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-foreground">
                    识别到 {importResults.length} 只股票
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleImportConfirm}
                      className="flex items-center gap-1 text-[11px] font-medium text-gain bg-gain/10 hover:bg-gain/20 px-3 py-1.5 rounded-md transition-colors"
                    >
                      <Check className="w-3 h-3" /> 全部添加
                    </button>
                    <button
                      onClick={() => setImportResults(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {importResults.map(s => {
                    const alreadyIn = isInWatchlist(s.code)
                    const mColor = s.market === 'US' ? 'bg-blue-500/15 text-blue-400' : s.market === 'HK' ? 'bg-orange-500/15 text-orange-400' : 'bg-primary/15 text-primary'
                    return (
                      <div
                        key={s.code}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                          alreadyIn
                            ? 'border-border/50 bg-secondary/30 text-muted-foreground'
                            : 'border-primary/30 bg-card hover:bg-accent/30 text-foreground'
                        }`}
                      >
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${mColor}`}>
                          {s.market === 'US' ? 'US' : s.market === 'HK' ? '港' : 'A'}
                        </span>
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground">{s.code}</span>
                        {alreadyIn && <span className="text-[10px] text-muted-foreground">(已有)</span>}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-3 text-caption text-muted-foreground font-medium">股票</th>
                    <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">现价</th>
                    <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">涨跌幅</th>
                    <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">PE (TTM)</th>
                    <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">PB</th>
                    <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">ROE</th>
                    <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">股息率</th>
                    <th className="text-right px-5 py-3 text-caption text-muted-foreground font-medium">市值(亿RMB)</th>
                    <th className="text-center px-5 py-3 text-caption text-muted-foreground font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {watchStocks.map((stock, i) => {
                    const local = stocksData[stock.code]
                    const fund = fundMap[stock.code]
                    const pe = fund?.pe ?? (stock as unknown as Record<string, number>).pe ?? local?.pe ?? 0
                    const pb = fund?.pb ?? (stock as unknown as Record<string, number>).pb ?? local?.pb ?? 0
                    const roe = fund?.roe ?? local?.roe ?? 0
                    const divYield = fund?.dividendYield ?? local?.dividendYield ?? 0
                    const mktCap = (stock as unknown as Record<string, number>).marketCap || fund?.marketCap || local?.marketCap || 0

                    // 市场检测
                    const sIsHK = stock.code.length === 5 && /^\d{5}$/.test(stock.code)
                    const sIsUS = /^[A-Z]{1,5}(\.[A-Z])?$/.test(stock.code)
                    const sCurrencySymbol = sIsUS ? '$' : sIsHK ? 'HK$' : '¥'
                    const sMarketSuffix = sIsUS ? '(US)' : sIsHK ? '(HK)' : ''
                    const sMarketBadge = sIsUS ? 'US' : sIsHK ? '港' : 'A'
                    const sMarketColor = sIsUS ? 'bg-blue-500/15 text-blue-400' : sIsHK ? 'bg-orange-500/15 text-orange-400' : 'bg-primary/15 text-primary'

                    return (
                      <tr
                        key={stock.code}
                        onClick={() => navigate(`/stock/${stock.code}`)}
                        className="border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors"
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                              <span className={`text-[9px] font-bold ${sMarketColor} px-1 py-0.5 rounded`}>{sMarketBadge}</span>
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-foreground">{stock.name}{sMarketSuffix}</div>
                              <div className="text-[11px] text-muted-foreground">{stock.code}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-right px-5 py-4">
                          <span className="text-sm font-semibold text-foreground font-mono">{sCurrencySymbol}{stock.price.toFixed(2)}</span>
                        </td>
                        <td className="text-right px-5 py-4">
                          <span className={`badge text-xs ${stock.changePercent >= 0 ? 'badge-gain' : 'badge-loss'}`}>
                            {formatPercent(stock.changePercent)}
                          </span>
                        </td>
                        <td className="text-right px-5 py-4 text-sm text-foreground font-mono">{pe > 0 ? pe.toFixed(1) : '--'}</td>
                        <td className="text-right px-5 py-4 text-sm text-foreground font-mono">{pb > 0 ? pb.toFixed(2) : '--'}</td>
                        <td className="text-right px-5 py-4">
                          <span className="text-sm font-medium text-foreground font-mono">{roe > 0 ? roe.toFixed(1) + '%' : '--'}</span>
                        </td>
                        <td className="text-right px-5 py-4 text-sm text-foreground font-mono">{divYield > 0 ? divYield.toFixed(1) + '%' : '--'}</td>
                        <td className="text-right px-5 py-4 text-sm text-muted-foreground font-mono">{mktCap > 0 ? '¥' + mktCap.toLocaleString() : '--'}</td>
                        <td className="text-center px-5 py-4">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                // 从所有包含该股票的分组中移除
                                const groups = watchlist.filter(g => g.stocks.includes(stock.code))
                                groups.forEach(g => removeFromWatchlist(g.id, stock.code))
                              }}
                              className="p-1 rounded-md hover:bg-loss/10 text-muted-foreground hover:text-loss transition-colors"
                              title="取消自选"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {!loading && watchStocks.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                        暂无自选股，通过搜索添加你关注的股票
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm animate-pulse-subtle">
                        加载中...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* Key Metrics Summary */}
        <section className="animate-fade-in animation-delay-200">
          <h3 className="text-caption text-muted-foreground uppercase tracking-wider mb-4">价值指标排行</h3>
          <div className="grid grid-cols-3 gap-4">
            <Card className="card-interactive">
              <CardContent className="p-5">
                <h4 className="text-caption text-muted-foreground mb-3">ROE 最高</h4>
                <div className="space-y-2.5">
                  {[...rankStocks].sort((a, b) => b.roe - a.roe).slice(0, 3).map((s, i) => (
                    <div key={s.code} className="flex items-center justify-between cursor-pointer hover:bg-accent/30 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => navigate(`/stock/${s.code}`)}>
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-accent-foreground">{i + 1}</span>
                        <span className="text-sm font-medium text-foreground">{s.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground font-mono">{s.roe.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="card-interactive">
              <CardContent className="p-5">
                <h4 className="text-caption text-muted-foreground mb-3">PE 最低（低估值）</h4>
                <div className="space-y-2.5">
                  {[...rankStocks].filter(a => a.pe > 0).sort((a, b) => a.pe - b.pe).slice(0, 3).map((s, i) => (
                    <div key={s.code} className="flex items-center justify-between cursor-pointer hover:bg-accent/30 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => navigate(`/stock/${s.code}`)}>
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-accent-foreground">{i + 1}</span>
                        <span className="text-sm font-medium text-foreground">{s.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground font-mono">{s.pe.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="card-interactive">
              <CardContent className="p-5">
                <h4 className="text-caption text-muted-foreground mb-3">股息率最高</h4>
                <div className="space-y-2.5">
                  {[...rankStocks].sort((a, b) => b.dividendYield - a.dividendYield).slice(0, 3).map((s, i) => (
                    <div key={s.code} className="flex items-center justify-between cursor-pointer hover:bg-accent/30 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => navigate(`/stock/${s.code}`)}>
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-accent-foreground">{i + 1}</span>
                        <span className="text-sm font-medium text-foreground">{s.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground font-mono">{s.dividendYield.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  )
}
