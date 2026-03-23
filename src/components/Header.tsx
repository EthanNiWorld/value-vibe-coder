import { useApp } from '@/context/AppContext'
import { useNavigate } from 'react-router-dom'
import { Search, X, Wifi, WifiOff } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const { searchQuery, setSearchQuery, searchResults, isBackendOnline } = useApp()
  const [isFocused, setIsFocused] = useState(false)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const results = searchResults.slice(0, 8)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <header className="flex items-center justify-between h-[60px] px-8 border-b border-border bg-card/50 glass sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-subheading text-foreground">{title}</h2>
          {subtitle && <p className="text-caption text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      {/* Search */}
      <div className="relative" ref={dropdownRef}>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
          isFocused ? 'border-primary bg-card shadow-sm w-[320px]' : 'border-border bg-secondary/50 w-[260px]'
        }`}>
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            placeholder="搜索股票代码或名称..."
            className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          />
          {isBackendOnline ? (
            <Wifi className="w-3 h-3 text-gain shrink-0" />
          ) : (
            <WifiOff className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); inputRef.current?.focus() }}
              className="p-0.5 rounded hover:bg-secondary text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {isFocused && results.length > 0 && (
          <div className="absolute top-full mt-2 right-0 w-[360px] bg-card border border-border rounded-lg overflow-hidden animate-fade-in"
            style={{ boxShadow: 'var(--shadow-elevated)' }}>
            {isBackendOnline && (
              <div className="px-4 py-1.5 border-b border-border bg-accent/30">
                <span className="text-[10px] text-muted-foreground">
                  全市场搜索 · 共 {searchResults.length} 条结果
                </span>
              </div>
            )}
            {results.map(stock => {
              const market = (stock as unknown as Record<string, string>).market
              const isHK = market === 'HK' || (!market && stock.code.length === 5 && stock.code.startsWith('0'))
              const isUS = market === 'US' || (!market && /^[A-Z]{1,5}$/.test(stock.code))
              const marketLabel = isUS ? 'US' : isHK ? '港' : 'A'
              const marketColor = isUS ? 'bg-blue-500/15 text-blue-400' : isHK ? 'bg-orange-500/15 text-orange-400' : 'bg-primary/15 text-primary'
              const currencySymbol = isUS ? '$' : isHK ? 'HK$' : '¥'
              return (
                <button
                  key={stock.code}
                  onClick={() => {
                    navigate(`/stock/${stock.code}`)
                    setSearchQuery('')
                    setIsFocused(false)
                  }}
                  className="flex items-center justify-between w-full px-4 py-3 hover:bg-accent/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${marketColor}`}>
                      {marketLabel}
                    </span>
                    <span className="text-sm font-medium text-foreground">{stock.name}</span>
                    <span className="text-xs text-muted-foreground">{stock.code}</span>
                  </div>
                  {stock.price > 0 ? (
                    <div className="text-right">
                      <span className="text-sm font-medium text-foreground">{currencySymbol}{stock.price.toFixed(2)}</span>
                      <span className={`ml-2 text-xs font-medium ${stock.change >= 0 ? 'text-gain' : 'text-loss'}`}>
                        {stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">点击查看</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </header>
  )
}
