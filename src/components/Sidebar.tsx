import { NavLink, useLocation } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { stocksData } from '@/data/stockData'
import {
  LayoutDashboard,
  Calculator,
  GitCompareArrows,
  Filter,
  TrendingUp,
  Star,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '仪表盘' },
  { to: '/screener', icon: Filter, label: '股票筛选' },
  { to: '/valuation', icon: Calculator, label: '估值计算' },
  { to: '/compare', icon: GitCompareArrows, label: '股票对比' },
]

export function Sidebar() {
  const location = useLocation()
  const { watchlist, createWatchlistGroup, removeFromWatchlist, quoteCache, getStockName } = useApp()
  const [expandedGroups, setExpandedGroups] = useState<string[]>(["1"])
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    )
  }

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      createWatchlistGroup(newGroupName.trim())
      setNewGroupName('')
      setShowNewGroup(false)
    }
  }

  return (
    <aside className="w-[240px] h-screen flex flex-col bg-sidebar border-r border-sidebar-border fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-[60px] border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--gradient-primary)' }}>
          <TrendingUp className="w-4.5 h-4.5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-primary-foreground">ValueLens</h1>
          <p className="text-[10px] text-sidebar-foreground/50">价值投资分析</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-4 space-y-0.5">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={() => {
              const isActive = item.to === '/' 
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to)
              return `nav-item ${isActive ? 'active' : ''}`
            }}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-4 border-t border-sidebar-border" />

      {/* Watchlist */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex items-center justify-between px-3 mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
            自选股
          </span>
          <button
            onClick={() => setShowNewGroup(true)}
            className="p-0.5 rounded hover:bg-sidebar-foreground/10 text-sidebar-foreground/40 hover:text-sidebar-foreground/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {showNewGroup && (
          <div className="px-2 mb-2 animate-fade-in">
            <div className="flex gap-1">
              <input
                autoFocus
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
                placeholder="分组名称"
                className="flex-1 px-2 py-1 text-xs bg-sidebar-foreground/5 border border-sidebar-border rounded text-primary-foreground placeholder:text-sidebar-foreground/30 focus:outline-none focus:border-sidebar-active"
              />
              <button onClick={handleCreateGroup} className="p-1 rounded text-sidebar-foreground/60 hover:text-primary-foreground">
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setShowNewGroup(false); setNewGroupName('') }} className="p-1 rounded text-sidebar-foreground/60 hover:text-primary-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {watchlist.map(group => (
          <div key={group.id} className="mb-1">
            <button
              onClick={() => toggleGroup(group.id)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors rounded"
            >
              {expandedGroups.includes(group.id)
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />
              }
              <Star className="w-3 h-3" />
              <span>{group.name}</span>
              <span className="ml-auto text-[10px] text-sidebar-foreground/30">{group.stocks.length}</span>
            </button>
            {expandedGroups.includes(group.id) && (
              <div className="ml-4 space-y-px animate-fade-in">
                {group.stocks.map(code => {
                  // 优先用实时行情缓存，fallback 到静态数据
                  const live = quoteCache[code]
                  const local = stocksData[code]
                  const name = live?.name || getStockName(code)
                  const changePercent = live?.changePercent ?? local?.changePercent ?? 0
                  const change = live?.change ?? local?.change ?? 0

                  // 市场标识
                  const cIsHK = code.length === 5 && /^\d{5}$/.test(code)
                  const cIsUS = /^[A-Z]{1,5}(\.[A-Z])?$/.test(code)
                  const cSuffix = cIsUS ? '(US)' : cIsHK ? '(HK)' : ''

                  if (!name || name === code) return null

                  return (
                    <NavLink
                      key={code}
                      to={`/stock/${code}`}
                      className={() => {
                        const isActive = location.pathname === `/stock/${code}`
                        return `group flex items-center justify-between px-3 py-1.5 rounded text-xs transition-colors ${
                          isActive
                            ? 'bg-sidebar-active/15 text-primary-foreground'
                            : 'text-sidebar-foreground/70 hover:text-primary-foreground hover:bg-sidebar-foreground/5'
                        }`
                      }}
                    >
                      <span className="font-medium truncate">{name}{cSuffix}</span>
                      <div className="flex items-center gap-2">
                        <span className={change >= 0 ? 'text-gain' : 'text-loss'}>
                          {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            removeFromWatchlist(group.id, code)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-sidebar-foreground/10 text-sidebar-foreground/40 transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </NavLink>
                  )
                })}
                {group.stocks.length === 0 && (
                  <p className="px-3 py-2 text-[10px] text-sidebar-foreground/30">
                    暂无股票
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-sidebar-border">
        <p className="text-[10px] text-sidebar-foreground/30">
          数据仅供参考 · 不构成投资建议
        </p>
      </div>
    </aside>
  )
}
