import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { defaultWatchlist, type WatchlistGroup, stocksData } from '@/data/stockData'
import { checkBackendHealth, searchStocks, fetchBatchQuotes, type SearchResult } from '@/services/api'
import { getCache, setCache } from '@/services/cache'

// 共享的行情简报
export interface StockBrief {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
}

interface AppState {
  watchlist: WatchlistGroup[]
  addToWatchlist: (groupId: string, stockCode: string) => void
  removeFromWatchlist: (groupId: string, stockCode: string) => void
  createWatchlistGroup: (name: string) => void
  deleteWatchlistGroup: (groupId: string) => void
  isInWatchlist: (stockCode: string) => boolean
  toast: { message: string; type: 'success' | 'error' | 'info' } | null
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchResults: SearchResult[]
  isBackendOnline: boolean
  getStockName: (code: string) => string
  // 共享行情缓存
  quoteCache: Record<string, StockBrief>
}

const QUOTE_CACHE_KEY = 'watchlist_quotes'
const WATCHLIST_KEY = 'valuelens_watchlist'

// 从 localStorage 恢复 watchlist，失败则使用默认值
function loadWatchlist(): WatchlistGroup[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return defaultWatchlist
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [watchlist, setWatchlist] = useState<WatchlistGroup[]>(loadWatchlist)
  const [toast, setToast] = useState<AppState['toast']>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>() // toast 清理 ref
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isBackendOnline, setIsBackendOnline] = useState(false)
  const [stockNameCache, setStockNameCache] = useState<Record<string, string>>({})
  const [quoteCache, setQuoteCache] = useState<Record<string, StockBrief>>({})

  // Watchlist 变更时持久化到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist))
    } catch { /* ignore quota errors */ }
  }, [watchlist])

  // 启动时从 localStorage 恢复行情缓存
  useEffect(() => {
    const cached = getCache<Record<string, StockBrief>>(QUOTE_CACHE_KEY)
    if (cached) {
      setQuoteCache(cached.data)
    }
  }, [])

  // Check backend health on mount
  useEffect(() => {
    checkBackendHealth().then(online => {
      setIsBackendOnline(online)
      if (online) {
        console.log('[ValueLens] 后端已连接，使用实时数据')
      } else {
        console.log('[ValueLens] 后端未连接，使用本地模拟数据')
      }
    })
    const interval = setInterval(() => {
      checkBackendHealth().then(setIsBackendOnline)
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // 获取自选股实时行情并共享到 quoteCache
  const allWatchCodes = [...new Set(watchlist.flatMap(g => g.stocks))]
  useEffect(() => {
    if (!isBackendOnline || allWatchCodes.length === 0) return
    let cancelled = false

    async function fetchQuotes() {
      try {
        const batch = await fetchBatchQuotes(allWatchCodes)
        if (cancelled) return
        const map: Record<string, StockBrief> = {}
        batch.forEach(s => {
          if (s.price > 0) {
            map[s.code] = {
              code: s.code,
              name: s.name,
              price: s.price,
              change: s.change,
              changePercent: s.changePercent,
            }
          }
        })
        setQuoteCache(prev => {
          const merged = { ...prev, ...map }
          setCache(QUOTE_CACHE_KEY, merged)
          return merged
        })
        // 同步名称缓存
        const names: Record<string, string> = {}
        batch.forEach(s => { if (s.name) names[s.code] = s.name })
        setStockNameCache(prev => ({ ...prev, ...names }))
      } catch (e) {
        console.warn('[AppContext] 行情刷新失败', e)
      }
    }

    fetchQuotes()
    const interval = setInterval(fetchQuotes, 30000)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBackendOnline, allWatchCodes.join(',')])

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      if (isBackendOnline) {
        const results = await searchStocks(searchQuery.trim())
        setSearchResults(results)
        const newNames: Record<string, string> = {}
        results.forEach(r => { newNames[r.code] = r.name })
        setStockNameCache(prev => ({ ...prev, ...newNames }))
      } else {
        const q = searchQuery.trim().toLowerCase()
        const local = Object.values(stocksData)
          .filter(s => s.code.includes(q) || s.name.toLowerCase().includes(q))
          .map(s => ({
            code: s.code,
            name: s.name,
            price: s.price,
            change: s.change,
            changePercent: s.changePercent,
          }))
        setSearchResults(local)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, isBackendOnline])

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    clearTimeout(toastTimerRef.current)
    setToast({ message, type })
    toastTimerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  const getStockName = useCallback((code: string): string => {
    return stockNameCache[code] || stocksData[code]?.name || code
  }, [stockNameCache])

  const addToWatchlist = useCallback((groupId: string, stockCode: string) => {
    setWatchlist(prev => {
      // 如果目标分组不存在（空 watchlist 或 id 不匹配），自动创建默认分组并添加
      const targetGroup = prev.find(g => g.id === groupId)
      if (!targetGroup) {
        const newGroup: WatchlistGroup = {
          id: groupId || Date.now().toString(),
          name: '我的自选',
          stocks: [stockCode],
        }
        return [...prev, newGroup]
      }
      return prev.map(g => {
        if (g.id === groupId && !g.stocks.includes(stockCode)) {
          return { ...g, stocks: [...g.stocks, stockCode] }
        }
        return g
      })
    })
    const name = getStockName(stockCode)
    showToast(`已将 ${name} 添加到自选`)
  }, [showToast, getStockName])

  const removeFromWatchlist = useCallback((groupId: string, stockCode: string) => {
    setWatchlist(prev => prev.map(g => {
      if (g.id === groupId) {
        return { ...g, stocks: g.stocks.filter(s => s !== stockCode) }
      }
      return g
    }))
    const name = getStockName(stockCode)
    showToast(`已将 ${name} 从自选中移除`, 'info')
  }, [showToast, getStockName])

  const createWatchlistGroup = useCallback((name: string) => {
    const newGroup: WatchlistGroup = {
      id: Date.now().toString(),
      name,
      stocks: [],
    }
    setWatchlist(prev => [...prev, newGroup])
    showToast(`已创建分组「${name}」`)
  }, [showToast])

  const deleteWatchlistGroup = useCallback((groupId: string) => {
    setWatchlist(prev => prev.filter(g => g.id !== groupId))
    showToast('分组已删除', 'info')
  }, [showToast])

  const isInWatchlist = useCallback((stockCode: string) => {
    return watchlist.some(g => g.stocks.includes(stockCode))
  }, [watchlist])

  // 用 useMemo 稳定 context value，仅当依赖项变化时才创建新对象
  const contextValue = useMemo<AppState>(() => ({
    watchlist, addToWatchlist, removeFromWatchlist,
    createWatchlistGroup, deleteWatchlistGroup, isInWatchlist,
    toast, showToast,
    searchQuery, setSearchQuery, searchResults,
    isBackendOnline, getStockName,
    quoteCache,
  }), [
    watchlist, addToWatchlist, removeFromWatchlist,
    createWatchlistGroup, deleteWatchlistGroup, isInWatchlist,
    toast, showToast,
    searchQuery, searchResults,
    isBackendOnline, getStockName,
    quoteCache,
  ])

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
