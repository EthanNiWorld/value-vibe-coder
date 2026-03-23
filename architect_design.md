# ValueLens 架构设计文档

> **版本**: 1.2.0 | **更新日期**: 2026-03-23 | **状态**: Production Ready

---

## 1. 系统概述

ValueLens 是一款一站式价值投资分析平台，采用前后端分离架构，提供 A 股/港股/美股实时行情、多维筛选、估值计算、AI 智能对话、文件识别导入等核心能力。

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           React SPA  (Vite · localhost:5173)             │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐   │   │
│  │  │Dashboard │ │Screener  │ │Valuation │ │ Compare   │   │   │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬─────┘   │   │
│  │       │             │            │              │         │   │
│  │  ┌────▼─────────────▼────────────▼──────────────▼─────┐   │   │
│  │  │          services/api.ts  +  cache.ts (SWR)        │   │   │
│  │  └────────────────────┬───────────────────────────────┘   │   │
│  └───────────────────────│───────────────────────────────────┘   │
│                          │ HTTP / SSE / FormData                  │
└──────────────────────────│───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│                  FastAPI Server (localhost:8000)                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ /api/stock │  │/api/screener│ │/api/indices│  │ /api/chat │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬─────┘  │
│        │               │               │               │         │
│  ┌─────▼───────────────▼───────────────▼───────────────▼──────┐  │
│  │              In-Memory Cache (TTL 60s ~ 86400s)            │  │
│  └─────┬──────────┬────────────┬───────────────┬──────────────┘  │
│        │          │            │               │                  │
│  ┌─────▼──────┐ ┌▼──────────┐ ┌▼────────────┐ ┌▼─────────────┐  │
│  │  AKShare   │ │ 腾讯 QT   │ │  AKShare    │ │  DashScope   │  │
│  │(新浪日线)  │ │(港股/美股)│ │ (同花顺)    │ │(Qwen3.5-Plus)│  │
│  └────────────┘ └───────────┘ └─────────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈

### 2.1 前端

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | React | 18.3.1 | UI 组件化渲染 |
| 语言 | TypeScript | 5.6.2 | 类型安全 |
| 构建 | Vite | 6.0.5 | 快速 HMR + 生产构建 |
| 路由 | React Router DOM | 7.1.1 | SPA 客户端路由 |
| 样式 | Tailwind CSS | 3.4.17 | 原子化 CSS |
| 图表 | Recharts | 2.15.0 | 折线图 / 柱状图 / 雷达图 |
| 图标 | Lucide React | 0.468.0 | 矢量图标库 |
| 组件变体 | class-variance-authority | 0.7.1 | 组件多态样式 |

### 2.2 后端

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | FastAPI | >= 0.104 | 异步 Web API |
| 服务器 | Uvicorn | >= 0.24 | ASGI 高性能运行时 |
| 数据采集 | AKShare | >= 1.12 | A 股 / 港股行情 + 财务数据 |
| 数据处理 | Pandas | >= 2.0 | DataFrame 转换与聚合 |
| HTTP 客户端 | httpx | >= 0.25 | 异步流式请求 (AI) + 腾讯 QT 行情 |
| 数据验证 | Pydantic | >= 2.0 | 请求/响应模型 |
| PDF 处理 | PyMuPDF (fitz) | >= 1.23 | PDF 转图片 (文件导入功能) |

### 2.3 AI 服务

| 项目 | 说明 |
|------|------|
| 平台 | 阿里云百炼 DashScope |
| 对话模型 | Qwen3.5-Plus (Function Calling + SSE 流式) |
| VL 模型 | Qwen3.5-Plus (图片/PDF/视频 多模态识别) |
| 协议 | OpenAI 兼容接口 (SSE 流式) |
| 端点 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |

---

## 3. 前端架构

### 3.1 目录结构

```
src/
├── main.tsx                          # React 根挂载
├── App.tsx                           # 路由定义 + 全局布局
├── index.css                         # 设计 Token + Tailwind 基础层
│
├── context/
│   └── AppContext.tsx                # 全局状态 Provider
│
├── services/
│   ├── api.ts                        # REST API 客户端 (10 个函数)
│   └── cache.ts                      # localStorage SWR 缓存层
│
├── data/
│   └── stockData.ts                  # 本地 Fallback 数据 (12 只 A 股)
│
├── lib/
│   └── utils.ts                      # 工具函数 (cn = clsx + twMerge)
│
├── components/
│   ├── Header.tsx                    # 顶部搜索栏 (三市场标识: A/港/US)
│   ├── Sidebar.tsx                   # 侧边导航 + 自选股面板
│   ├── ChatBot.tsx                   # AI 聊天浮窗
│   ├── Toast.tsx                     # 消息通知
│   └── ui/
│       ├── button.tsx                # Button (6 variants × 4 sizes)
│       └── card.tsx                  # Card 容器组件族
│
└── pages/
    ├── Dashboard.tsx                 # 仪表盘 — 指数 / 自选(含删除+文件导入) / 排行
    ├── StockDetail.tsx               # 股票详情 — 行情 / 指标 / 图表 (A/港/美三市场)
    ├── Screener.tsx                  # 股票筛选 — 条件 / 策略 / 表格
    ├── Valuation.tsx                 # 估值计算 — DCF / Graham / PEG
    └── Compare.tsx                   # 股票对比 — 雷达图 / 柱状图
```

### 3.2 路由设计

| 路径 | 页面组件 | 功能 |
|------|---------|------|
| `/` | Dashboard | 市场指数 + 自选股概览(含文件导入) + 价值排行 |
| `/screener` | Screener | 40 只行业龙头筛选 + 4 种预设策略 |
| `/valuation` | Valuation | 3 种估值模型 + 5 位大师策略 |
| `/compare` | Compare | 最多 5 只股票多维度对比 |
| `/stock/:code` | StockDetail | 个股行情 + 12 项指标 + 财务趋势 (A/港/美) |

所有页面共享统一布局：左侧 Sidebar + 顶部 Header + 右下角 ChatBot 浮窗。

### 3.3 全局状态管理 (AppContext)

采用 React Context + useCallback/useMemo 模式，**不引入额外状态管理库**。

```typescript
interface AppState {
  // ── 自选股 ──────────────────────────────────
  watchlist: WatchlistGroup[]
  addToWatchlist(groupId: string, code: string): void
  removeFromWatchlist(groupId: string, code: string): void
  createWatchlistGroup(name: string): void
  deleteWatchlistGroup(groupId: string): void
  isInWatchlist(code: string): boolean

  // ── 搜索 ────────────────────────────────────
  searchQuery: string
  setSearchQuery(q: string): void
  searchResults: SearchResult[]

  // ── 后端状态 ─────────────────────────────────
  isBackendOnline: boolean

  // ── 行情缓存 (跨组件共享) ────────────────────
  quoteCache: Record<string, StockBrief>

  // ── 通知 ────────────────────────────────────
  toast: { message: string; type: 'success' | 'error' | 'info' } | null
  showToast(message: string, type: string): void
}
```

**v1.1.0 改进**:

| 改进 | 说明 |
|------|------|
| Watchlist 持久化 | 自选分组自动读写 localStorage (`valuelens_watchlist`)，刷新不丢失 |
| Context value 稳定化 | Provider value 使用 `useMemo` 包装，避免无关 state 更新引发全局 re-render |
| Toast timer 清理 | `showToast` 使用 `useRef` 存储 timer ID，连续调用时先 `clearTimeout` 旧 timer |
| 空 Watchlist 容错 | `addToWatchlist` 若目标分组不存在，自动创建默认分组 |

**核心副作用**:

| Effect | 触发条件 | 间隔 | 说明 |
|--------|---------|------|------|
| 后端健康检查 | 挂载 | 30s | 调用 `checkBackendHealth()` 更新 `isBackendOnline` |
| 自选股行情刷新 | 后端在线 && 自选非空 | 30s | `fetchBatchQuotes()` → 更新 `quoteCache` + localStorage |
| 搜索防抖 | `searchQuery` 变化 | 300ms | `searchStocks(query)` → 更新 `searchResults` |

### 3.4 服务层

#### api.ts — REST 客户端

所有函数统一模式：**API 优先 → 异常降级到 fallback 参数**。

```typescript
const API_BASE = 'http://localhost:8000/api'

// 通用请求封装 (8 秒超时)
async function fetchAPI<T>(path: string, fallback?: T): Promise<T>
```

| 函数 | 端点 | 返回类型 | 说明 |
|------|------|---------|------|
| `checkBackendHealth()` | `GET /api/health` | `boolean` | 3 秒超时 |
| `fetchIndices(fallback)` | `GET /api/indices` | `IndexData[]` | 4 大指数 |
| `searchStocks(query)` | `GET /api/stock/search?q=` | `SearchResult[]` | 全市场搜索 A+港+美 (≤15 条) |
| `fetchStockQuote(code, fallback)` | `GET /api/stock/{code}/quote` | `StockQuote` | 单股实时行情 (三市场) |
| `fetchBatchQuotes(codes)` | `GET /api/stock/batch?codes=` | `SearchResult[]` | 批量行情 (≤20 只) |
| `fetchFundamentals(code, fallback)` | `GET /api/stock/{code}/fundamentals` | `Fundamentals` | 综合财务指标 (三市场) |
| `fetchFinancialHistory(code, fallback)` | `GET /api/stock/{code}/financials` | `FinancialRecord[]` | 历年财务数据 |
| `fetchScreenerResults(params, fallback)` | `GET /api/screener?...` | `{ data, total }` | 筛选结果 |
| `importStocksFromFile(file)` | `POST /api/stock/import-from-file` | `StockItem[]` | VL 文件识别 (图片/PDF/视频) |

#### cache.ts — SWR 缓存层

**设计思想**: Stale-While-Revalidate — 先展示上次缓存，后台静默刷新。

```typescript
interface CachedData<T> {
  data: T
  ts: number           // 缓存写入时间戳 (ms)
  version?: string
}

setCache<T>(key, data)                    // 写入 localStorage (前缀 vl_cache_)
getCache<T>(key): CachedData<T> | null    // 读取缓存
removeCache(key)                          // 删除
isCacheStale(ts, maxAgeMs): boolean       // 判断是否过期
formatCacheAge(ts): string                // → "刚刚" / "3分钟前" / "1小时前"
clearOldestCache()                        // 清理最旧 5 条 (quota 溢出时)
```

**各页面缓存策略**:

| 页面 | Cache Key | 写入时机 | 读取时机 | 过期策略 |
|------|-----------|---------|---------|---------|
| Dashboard | `watchlist_quotes` | 行情刷新后 | 页面挂载 | 30 秒自动刷新 |
| Screener | `screener_data` | API 返回后 | 页面挂载 | 显示缓存 + 后台刷新 |
| Compare | `compare_stocks` | API 返回后 | 页面挂载 | 显示缓存 + 后台刷新 |

### 3.5 设计系统

#### 色彩体系 (CSS Custom Properties)

```css
/* 核心调板 */
--background: 220 20% 97%;        /* 浅蓝灰底色 */
--foreground: 222 20% 12%;        /* 深蓝灰文字 */
--primary: 228 60% 50%;           /* 品牌蓝 */
--primary-foreground: 0 0% 100%;

/* 财务语义色 (A 股风格: 红涨绿跌) */
--gain: 0 78% 52%;                /* 红色 = 上涨 */
--loss: 145 63% 36%;              /* 绿色 = 下跌 */

/* 侧边栏 */
--sidebar: 222 20% 12%;           /* 深色背景 */
--sidebar-active: 228 60% 50%;    /* 激活态蓝 */
```

#### 排版节奏

```css
/* 字号阶梯: 12 → 14 → 16 → 18 → 24 → 28 (px) */
.text-display   { font-size: 2.25rem; font-weight: 700; }  /* 页面大标题 */
.text-heading   { font-size: 1.5rem;  font-weight: 600; }  /* 区域标题 */
.text-subheading{ font-size: 1.125rem;font-weight: 600; }  /* 副标题 */
.text-body      { font-size: 0.875rem;font-weight: 400; }  /* 正文 */
.text-caption   { font-size: 0.75rem; font-weight: 500; }  /* 标签 */
.text-metric    { font-size: 1.75rem; font-weight: 700; }  /* 指标大数字 */
```

#### 动画

```css
@keyframes fade-in   { 0% { opacity: 0 }                    → 1 }
@keyframes slide-in  { 0% { opacity: 0; translateY(8px) }   → 正常 }
@keyframes scale-in  { 0% { opacity: 0; scale(0.95) }       → 正常 }
/* timing: cubic-bezier(0.4, 0, 0.2, 1)  duration: 0.2~0.3s */
```

### 3.6 组件层级

```
App
├── AppProvider (Context)
│   ├── Sidebar
│   │   ├── Logo
│   │   ├── NavItems (4 routes)
│   │   └── WatchlistGroups (expandable)
│   │       └── StockItem (with live quote)
│   ├── Header
│   │   ├── PageTitle
│   │   └── SearchBox → Dropdown (results with market badge: A/港/US)
│   ├── <Routes>
│   │   ├── Dashboard
│   │   │   ├── IndexCards (×4)
│   │   │   ├── WatchlistTable (with delete + file import)
│   │   │   └── RankingCards (×3)
│   │   ├── StockDetail
│   │   │   ├── QuoteHeader (market label: A股/港股/美股)
│   │   │   ├── IndicatorGrid (×12)
│   │   │   └── FinancialCharts (tabs)
│   │   ├── Screener
│   │   │   ├── PresetButtons (×4)
│   │   │   ├── FilterPanel
│   │   │   └── ResultTable
│   │   ├── Valuation
│   │   │   ├── StrategyCards (×5)
│   │   │   ├── StockSelector
│   │   │   ├── ParameterForm
│   │   │   └── ResultPanel
│   │   └── Compare
│   │       ├── StockSelector (≤5)
│   │       ├── RadarChart
│   │       ├── BarChart
│   │       └── ComparisonTable
│   ├── ChatBot (fixed, floating)
│   │   ├── FloatingButton (pulse dot)
│   │   └── ChatPanel
│   │       ├── MessageList (streaming)
│   │       ├── QuickQuestions
│   │       └── InputArea
│   └── Toast (top-right, auto-dismiss)
```

---

## 4. 后端架构

### 4.1 目录结构

```
server/
├── main.py              # 单文件后端 (~1800 行)
│   ├── 数据模型         # Pydantic: ChatMessage (角色/长度校验), ChatRequest (上限 40 条)
│   ├── 安全层           # 路径注入防护 (_safe_persist_path)、输入校验
│   ├── 缓存层           # _cache / _cache_ts / _lock (线程安全) + 持久化缓存
│   ├── 名称映射         # _stock_name_map (A股) + _hk_stock_name_map (港股) + _us_stock_name_map (美股)
│   ├── 数据获取         # AKShare (新浪+同花顺) + 腾讯 QT (港股/美股行情+基本面)
│   ├── VL 文件识别      # Qwen3.5-Plus 多模态 (图片/PDF/视频) → 股票代码提取
│   ├── API 路由         # 11 个端点 (阻塞型用 def，异步型用 async def)
│   └── 启动入口         # uvicorn 0.0.0.0:8000
└── requirements.txt     # Python 依赖清单
```

### 4.2 API 端点一览

```
GET  /api/health                          健康检查 (含三市场股票数)
GET  /api/indices                         市场指数 (4 大指数)
GET  /api/stock/search?q={query}          股票搜索 (A + 港 + 美)
GET  /api/stock/{code}/quote              单股实时行情 (三市场)
GET  /api/stock/batch?codes={csv}         批量行情 (≤20)
GET  /api/stock/{code}/fundamentals       综合财务指标 (三市场)
GET  /api/stock/{code}/financials         历年财务数据
GET  /api/screener?{filters}              股票筛选
POST /api/chat                            AI 流式对话
POST /api/stock/import-from-file          文件导入识别股票 (图片/PDF/视频)
```

### 4.3 各端点详细设计

#### GET /api/health

```
Response 200:
{
  "status": "ok",
  "timestamp": "2026-03-23T11:33:24Z",
  "stocks_loaded": 5645,       // A 股 + 港股 + 美股总数
  "a_stocks": 5491,
  "hk_stocks": 66,
  "us_stocks": 88,
  "version": "5.0.0",
  "data_source": "sina/ths/tencent_qt"
}
```

#### GET /api/indices

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string | 000001 / 399001 / 399006 / 000300 |
| name | string | 上证指数 / 深证成指 / 创业板指 / 沪深300 |
| value | float | 指数点位 |
| change | float | 涨跌值 |
| changePercent | float | 涨跌幅 % |

**数据源**: `ak.stock_zh_index_daily(symbol)` — 取最近 2 个交易日计算涨跌。  
**缓存 TTL**: 120 秒。

#### GET /api/stock/search?q={query}

- 在预加载的 `_stock_name_map` (A股) + `_hk_stock_name_map` (港股) + `_us_stock_name_map` (美股) 中做前缀/包含匹配
- 5 位纯数字 → 港股 (`market: "HK"`)，6 位纯数字 → A 股 (`market: "A"`)，1~5 位英文字母 → 美股 (`market: "US"`)
- 最多返回 15 条

#### GET /api/stock/{code}/quote

| 字段 | 类型 | 说明 |
|------|------|------|
| price | float | 最新价 |
| change / changePercent | float | 涨跌 / 涨跌幅 |
| open / high / low | float | 开 / 高 / 低 |
| volume / amount | float | 成交量 / 成交额 |
| marketCap | float | 总市值 (亿) |
| pe / pb | float | 市盈率 / 市净率 |
| turnoverRate | float | 换手率 % |

**A 股数据源**: `ak.stock_zh_a_daily(symbol, adjust="qfq")` — 新浪前复权日线。  
**港股数据源**: `ak.stock_hk_daily(symbol, adjust="qfq")` — 新浪港股日线。  
**美股数据源**: 腾讯 QT 接口 `https://qt.gtimg.cn/q=us{CODE}` — GBK 编码解析。  
**缓存 TTL**: A 股 60 秒 / 港股 300 秒 / 美股 300 秒。  
**缓存策略**: 仅在 `price > 0` 时写入缓存，防止错误结果污染。

#### GET /api/stock/{code}/fundamentals

| 字段 | 类型 | 说明 |
|------|------|------|
| roe | float | 净资产收益率 % |
| eps | float | 每股收益 |
| dividendYield | float | 股息率 % |
| debtRatio | float | 资产负债率 % |
| grossMargin / netMargin | float | 毛利率 / 净利率 % |
| revenueGrowth / profitGrowth | float | 营收增长 / 利润增长 % |
| freeCashFlow | float | 自由现金流 |
| currentRatio | float | 流动比率 |
| pe / pb | float | 根据实时价格计算 |

**数据源** (按市场分流):
1. **A 股**: `ak.stock_financial_analysis_indicator(symbol)` + `ak.stock_financial_abstract_ths(symbol)` — 同花顺
2. **港股**: 腾讯 QT 接口 `https://qt.gtimg.cn/q=hk{code}` — 字段 [39]=PE, [72]=PB, [43]=股息率, [44]=市值
3. **美股**: 腾讯 QT 接口 `https://qt.gtimg.cn/q=us{CODE}` — 字段 [39]=PE, [57]=PB, [49]=股息率, [45]=市值

**缓存 TTL**: 3600 秒。

#### GET /api/stock/{code}/financials?years=6

返回近 N 年的年度财务数据数组 (revenue, netProfit, eps, roe, margins, growth 等)。

**数据源**: `ak.stock_financial_abstract_ths(symbol, indicator="按年度")`  
**缓存 TTL**: 86400 秒 (1 天)。

#### GET /api/screener

**筛选参数** (均可选):

| 参数 | 类型 | 说明 |
|------|------|------|
| pe_min / pe_max | float | PE 范围 |
| pb_min / pb_max | float | PB 范围 |
| roe_min / roe_max | float | ROE 范围 |
| dividend_min | float | 最低股息率 |
| debt_max | float | 最高负债率 |
| profit_growth_min | float | 最低利润增长率 |
| gross_margin_min | float | 最低毛利率 |
| net_margin_min | float | 最低净利率 |
| current_ratio_min | float | 最低流动比率 |
| market_cap_min | float | 最低市值 (亿) |
| sort_by | string | 排序字段 (default: roe) |
| sort_dir | string | asc / desc (default: desc) |
| limit | int | 返回条数 (default: 50) |

**筛选池**: 40 只行业龙头，覆盖白酒、银行、保险、家电、新能源、科技、医药、建材等行业。  
**缓存 TTL**: 600 秒 (整池数据)。

#### POST /api/chat

```
Request Body:
{
  "messages": [
    { "role": "user",      "content": "茅台护城河分析" },
    { "role": "assistant", "content": "..." }
  ],
  "stock_context": "600519 贵州茅台 PE:65 ROE:10%..."  // 可选
}

Response: text/event-stream (SSE)
  data: {"content": "茅台的"}
  data: {"content": "护城河"}
  data: {"content": "主要体现在..."}
  data: [DONE]
```

**AI 模型**: Qwen3.5-Plus  
**AI 系统角色**:
- 价值投资分析专家
- 能力：财务指标解读、基本面分析、大师方法论应用、估值模型计算
- 风格：中文简洁、数据驱动、附带免责声明
- 支持注入当前查看股票的上下文信息

#### POST /api/stock/import-from-file (v1.2.0 新增)

```
Request: multipart/form-data
  file: <binary>   # 支持图片(jpg/png/gif/webp)、PDF、视频(mp4/mov/webm)

Response 200:
{
  "stocks": [
    { "code": "000858", "name": "五粮液" },
    { "code": "600519", "name": "贵州茅台" }
  ]
}
```

**处理流程**:
1. **图片**: 转 base64 → 以 `image_url` 类型发送给 Qwen3.5-Plus VL
2. **PDF**: 通过 PyMuPDF 逐页转为图片 (200dpi, 最多 8 页) → 多张 `image_url` 发送
3. **视频**: 以 `video_url` 类型直接发送给 VL 模型

**文件大小限制**: 图片/PDF ≤ 20MB，视频 ≤ 50MB  
**去重逻辑**: `_parse_stock_response()` 使用 `seen_codes` 集合去重  
**超时**: 图片/PDF 30 秒，视频 60 秒

### 4.4 缓存架构

```python
# 线程安全的内存缓存
_cache: dict = {}            # key → value
_cache_ts: dict = {}         # key → timestamp
_lock = threading.Lock()     # 全局互斥锁

def cached(key: str, ttl: int = 300):
    """读取缓存，TTL 内有效则返回，否则返回 None"""

def cache_set(key: str, val):
    """写入缓存 + 记录时间戳"""
```

**各类型数据 TTL 规划**:

```
┌──────────────────────┬─────────┬──────────────┐
│ 数据类型             │  TTL    │ 更新频率     │
├──────────────────────┼─────────┼──────────────┤
│ A 股行情 (rt_*)      │  60s    │ 高频交易数据 │
│ 港股行情 (rt_*)      │ 300s    │ 全量拉取成本高│
│ 美股行情 (rt_*)      │ 300s    │ 腾讯 QT 接口 │
│ 市场指数 (indices)   │ 120s    │ 盘中变化     │
│ 筛选池 (screener)    │ 600s    │ 批量计算     │
│ 财务指标 (fund_*)    │ 3600s   │ 季报更新     │
│ 历年财务 (fin_*)     │ 86400s  │ 年报更新     │
│ 名称映射 (_name_map) │ 86400s  │ 极少变化     │
└──────────────────────┴─────────┴──────────────┘
```

> **v1.1.0 缓存安全改进**: 仅在数据获取成功时 (`price > 0`) 写入缓存，防止网络错误/接口异常产生的零值结果污染缓存。

### 4.5 数据源映射

```
        ┌───────────────┐        ┌───────────────┐
        │    AKShare     │        │  腾讯 QT 接口  │
        └───────┬───────┘        └───────┬───────┘
       ┌────────┼────────┐       ┌───────┼───────┐
       ▼        ▼        ▼       ▼       ▼       ▼
     新浪     同花顺  内置映射  港股行情  美股行情  港/美基本面
       │        │        │     qt.gtimg  qt.gtimg   PE/PB/
  ┌────┤   ┌────┤   ┌────┤    /q=hk*   /q=us*    股息率/市值
  │ A股│   │指标│   │港股│
  │日线│   │分析│   │名称│
  │    │   │    │   │66只│
  │港股│   │财务│   ├────┤
  │日线│   │摘要│   │美股│
  │    │   └────┘   │名称│
  │指数│            │88只│
  │日线│            └────┘
  └────┘
```

| 数据 | 接口/函数 | 来源 | 适用市场 |
|------|----------|------|---------|
| A 股日线行情 | `stock_zh_a_daily` | 新浪 (AKShare) | A 股 |
| 港股日线行情 | `stock_hk_daily` | 新浪 (AKShare) | 港股 |
| 指数日线 | `stock_zh_index_daily` | 新浪 (AKShare) | 指数 |
| 财务指标分析 | `stock_financial_analysis_indicator` | 同花顺 (AKShare) | A 股 |
| 财务摘要 | `stock_financial_abstract_ths` | 同花顺 (AKShare) | A 股 |
| A 股代码表 | `stock_info_a_code_name` | AKShare | A 股 |
| 港股名称 | 内置 `_hk_stock_name_map` (66 只) | 手工维护 | 港股 |
| 美股名称 | 内置 `_us_stock_name_map` (88 只) | 手工维护 | 美股 |
| 港股实时行情 | `https://qt.gtimg.cn/q=hk{code}` | 腾讯 QT | 港股 |
| 美股实时行情 | `https://qt.gtimg.cn/q=us{CODE}` | 腾讯 QT | 美股 |
| 港股基本面 | 腾讯 QT 字段 [39][43][44][72] | 腾讯 QT | 港股 |
| 美股基本面 | 腾讯 QT 字段 [39][49][45][57] | 腾讯 QT | 美股 |
| VL 文件识别 | Qwen3.5-Plus VL API | 阿里云百炼 | 图片/PDF/视频 |

### 4.6 市场识别逻辑

```python
def _is_hk_code(code: str) -> bool:
    """5 位纯数字 → 港股"""
    return len(code) == 5 and code.isdigit()

def _is_us_code(code: str) -> bool:
    """1~5 位纯英文字母 → 美股"""
    return bool(re.match(r'^[A-Z]{1,5}$', code))

# A 股代码: 6 位纯数字
# A 股代码 → 新浪 Symbol 转换
def _code_to_sina_symbol(code: str) -> str:
    # 6/9 开头 → "sh" + code (上交所)
    # 其他     → "sz" + code (深交所)
```

**前端市场识别** (Header.tsx / StockDetail.tsx):

```typescript
// 市场标识 + 货币符号
const isUS = /^[A-Z]{1,5}(\.[A-Z])?$/.test(code)    // 美股: "US" 蓝标 + $
const isHK = /^\d{5}$/.test(code)                     // 港股: "港" 橙标 + HK$
const isA  = /^\d{6}$/.test(code)                      // A 股: "A" 默认标 + ¥
```

---

## 5. 核心业务模块

### 5.1 估值计算引擎

前端纯计算，**不依赖后端**。

#### 5.1.1 三种估值模型

**DCF 折现现金流**:
```
PV = Σ(t=1→n) [ FCF × (1+g)^t / (1+r)^t ]
TV = FCF_n × (1 + g_terminal) / (r - g_terminal)
每股价值 = (PV + TV/(1+r)^n) / 总股本
```

**Graham 格雷厄姆公式**:
```
V = EPS × (8.5 + 2g) × Y / 4.4
Y = 当前 AAA 债券收益率 / 4.4%
```

**PEG 估值**:
```
合理 PE = targetPEG × growthRate
合理价格 = 合理 PE × EPS
```

#### 5.1.2 五位投资大师策略

| 大师 | 偏好模型 | 核心参数调整 | 安全边际 |
|------|---------|-------------|---------|
| **巴菲特** | DCF | FCF = 净利润 × 85% · 增长率上限 15% · 折现率 10% | 75% |
| **芒格** | DCF | 品质公司折现率降至 9% · ROE≥20% 判定品质 | 80% |
| **格雷厄姆** | Graham | FCF = 净利润 × 60% · 增长率 2~8% · 折现率 12% | 66% |
| **林奇** | PEG | targetPEG = 1.0 · 成长率主导 | PEG < 1 |
| **段永平** | DCF | 好生意 90% 现金转化 · ROE≥20% + 净利率≥20% + 负债<40% | 70% |

### 5.2 股票筛选引擎

**筛选池** (40 只 A 股行业龙头):

```
白酒: 600519 贵州茅台 · 000858 五粮液 · 000568 泸州老窖 · 002304 洋河股份 · 600809 山西汾酒
银行: 600036 招商银行 · 601166 兴业银行 · 601288 农业银行
保险: 601318 中国平安 · 601628 中国人寿
家电: 000333 美的集团 · 000651 格力电器
新能源: 300750 宁德时代 · 601012 隆基绿能
科技: 002415 海康威视 · 002230 科大讯飞 · 002475 立讯精密
食品: 603288 海天味业 · 600887 伊利股份
电力/医药/化工/汽车/建材/... 等多个行业
```

**预设策略**:

| 策略 | 条件 |
|------|------|
| 低估值高 ROE | PE < 20 · ROE > 15% |
| 高股息 | 股息率 > 3% · PE < 25 |
| 成长股 | 利润增长 > 15% · ROE > 18% |
| 格雷厄姆 | PE < 15 · PB < 1.5 · 流动比率 > 1.5 |

### 5.3 AI 对话系统

```
用户消息 → ChatBot 组件
    │
    ├── 检测当前路由 (/stock/:code)
    │   └── 有 → 注入股票上下文 (行情 + 指标摘要)
    │
    ▼
POST /api/chat (SSE)
    │
    ├── 构建 messages:
    │   [system_prompt, stock_context?, ...history]
    │
    ├── httpx.stream → DashScope API (Qwen3.5-Plus)
    │
    └── yield SSE chunks → 前端 ReadableStream
                               │
                               ▼
                     逐 token 渲染到气泡
```

### 5.4 文件识别导入系统 (v1.2.0 新增)

```
用户选择文件 → Dashboard 文件导入按钮
    │
    ├── 判断文件类型:
    │   ├── 图片 (jpg/png/gif/webp) → base64 编码 → image_url
    │   ├── PDF → PyMuPDF 逐页转图片 (200dpi, ≤8页) → 多张 image_url
    │   └── 视频 (mp4/mov/webm) → video_url 直传
    │
    ▼
POST /api/stock/import-from-file (FormData)
    │
    ├── 构建多模态 messages → Qwen3.5-Plus VL
    │
    ├── AI 返回文本 → _parse_stock_response() 提取股票代码
    │   └── 正则匹配 + seen_codes 去重
    │
    └── Response: { stocks: [{code, name}, ...] }
                               │
                               ▼
                  前端显示识别结果面板
                  用户确认 → 批量加入自选 (自动去重)
```

---

## 6. 数据流架构

### 6.1 SWR 缓存模式 (前端)

```
页面挂载
    │
    ├── 1. getCache(key) → 有缓存?
    │       ├── 有 → 立即渲染 (loading=false)
    │       │        显示 "本地缓存 · 3分钟前"
    │       └── 无 → 显示 Loading Skeleton
    │
    ├── 2. 后台请求 API
    │       ├── 成功 → 更新 state + setCache(key, data)
    │       │          显示 "实时数据 · 刚刚"
    │       └── 失败 → 保留缓存数据 (如有)
    │                  显示 "离线模式"
    │
    └── 3. 定时刷新 (可选, 如 Dashboard 30s)
```

### 6.2 数据降级链

```
优先级 1: FastAPI 后端 (实时 API)
    ↓ (超时 8s / 网络错误)
优先级 2: localStorage 缓存 (SWR)
    ↓ (缓存为空)
优先级 3: stockData.ts 静态数据 (12 只 A 股)
```

### 6.3 自选股生命周期

```
创建分组 → addToWatchlist(groupId, code)
              │
              ▼
     localStorage 持久化
              │
              ▼
     AppContext 触发行情刷新
       fetchBatchQuotes([...allCodes])
              │
              ▼
     quoteCache 更新 (RAM + localStorage)
              │
              ├── Sidebar: 实时涨跌幅
              ├── Dashboard: 自选股表格 (含删除按钮)
              └── Dashboard: 排行卡片

新增入口 (v1.2.0):
  ├── 文件导入 → VL 识别 → 批量加入自选 (自动去重)
  └── Dashboard 表格 ✕ 按钮 → 从所有分组中移除
```

---

## 7. 安全与配置

### 7.1 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `DASHSCOPE_API_KEY` | AI 功能必需 | 阿里云百炼 API 密钥 |

```bash
# .env.example
DASHSCOPE_API_KEY=sk-your-api-key-here
```

后端通过 `os.environ.get("DASHSCOPE_API_KEY", "")` 读取，**不硬编码密钥**。

> **v1.1.0**: .env 解析器现已支持引号包裹的值（`KEY="value"` 或 `KEY='value'`），自动去除首尾引号。

### 7.2 输入校验与防注入 (v1.1.0 新增)

**持久化缓存路径注入防护**:

```python
_SAFE_KEY_RE = re.compile(r'^[\w\-]+$')

def _safe_persist_path(key: str) -> Path:
    if not _SAFE_KEY_RE.match(key):
        raise ValueError(f"Unsafe cache key: {key}")
    fp = (_PERSIST_DIR / f"{key}.json").resolve()
    if not str(fp).startswith(str(_PERSIST_DIR.resolve())):
        raise ValueError(f"Path traversal detected: {key}")
    return fp
```

**Chat 端点输入校验**:

| 校验项 | 规则 | 说明 |
|--------|------|------|
| `role` 白名单 | `user` / `assistant` / `system` / `tool` | 阻止非法角色注入 |
| `content` 长度 | 单条最多 8000 字符 | 防止超大 payload |
| `messages` 数量 | 最多 40 条 | 限制上下文长度 |
| `stock_context` | 最多 500 字符 | 限制注入文本长度 |

**文件导入校验** (v1.2.0 新增):

| 校验项 | 规则 | 说明 |
|--------|------|------|
| 文件大小 | 图片/PDF ≤ 20MB，视频 ≤ 50MB | 防止超大文件 |
| 文件类型 | MIME 白名单 (image/*, application/pdf, video/mp4 等) | 阻止非法文件类型 |
| PDF 页数 | 最多 8 页 | 限制 VL 输入量 |

### 7.3 CORS 配置

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # 开发环境全开放
    allow_methods=["*"],
    allow_headers=["*"],
)
```

> **生产建议**: 将 `allow_origins` 限制为前端域名。

### 7.4 .gitignore 覆盖

```
node_modules/          # 前端依赖
dist/                  # 构建产物
.env / .env.local      # 环境变量 (含密钥)
__pycache__/ / *.pyc   # Python 编译缓存
venv/ / .venv/         # Python 虚拟环境
*.tsbuildinfo          # TypeScript 增量编译
.DS_Store              # macOS 系统文件
```

---

## 8. 部署指南

### 8.1 开发环境

```bash
# 终端 1: 后端
cd server
pip install -r requirements.txt
export DASHSCOPE_API_KEY="sk-..."
python main.py                       # → http://localhost:8000

# 终端 2: 前端
npm install
npm run dev                          # → http://localhost:5173
```

### 8.2 生产构建

```bash
# 前端
npm run build                        # 输出 → dist/

# 后端
uvicorn server.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### 8.3 推荐部署架构

```
                    Nginx / Caddy
                   ┌─────────────┐
                   │  反向代理    │
                   │  HTTPS      │
                   │  Gzip       │
                   └──┬──────┬───┘
                      │      │
              /       │      │  /api/*
              ▼       │      ▼
         ┌────────┐   │  ┌────────────┐
         │ dist/  │   │  │  Uvicorn   │
         │静态文件│   │  │  FastAPI   │
         └────────┘   │  │  Workers×4 │
                      │  └──────┬─────┘
                      │         │
                      │    ┌────▼──────────┐
                      │    │ AKShare       │
                      │    │ 腾讯 QT       │
                      │    │ DashScope     │
                      │    └───────────────┘
```

---

## 9. 性能考量

| 优化点 | 实现方式 | 效果 |
|--------|---------|------|
| 首屏加载 | SWR 缓存立即渲染 | 打开即见数据，无白屏 |
| API 调用频率 | 内存缓存 60s~86400s TTL | 减少 90%+ 重复请求 |
| 批量操作 | `Promise.allSettled` 并行 | 20 只股票 1 次请求 |
| 搜索体验 | 300ms 防抖 | 避免逐字触发 API |
| 行情刷新 | 30s 轮询 (仅后端在线时) | 平衡实时性与资源消耗 |
| 前端渲染 | Context value `useMemo` 稳定化 | 仅依赖项变化时 re-render |
| 缓存容量 | localStorage 满时清理最旧 5 条 | 防止 quota 溢出 |
| 后端并发 | 阻塞端点使用 `def` (线程池执行) | 不阻塞 asyncio 事件循环 |
| 缓存安全 | 仅成功结果写入缓存 | 防止错误零值污染 60 秒 |
| 港股优化 | 缓存 300s + `.tail(2)` 减少计算 | 减少 5x 全量拉取频率 |
| 美股轻量化 | 腾讯 QT 单次 HTTP 获取行情+基本面 | 无需 AKShare 重量级调用 |
| 竞态保护 | `fetchIdRef` 递增计数器 | 丢弃过时异步结果 |
| 请求取消 | ChatBot AbortController | 切换/关闭时终止流式请求 |

---

## 10. 扩展路线 (Roadmap)

| 阶段 | 方向 | 说明 |
|------|------|------|
| ~~v1.1~~ | ~~代码质量 + 安全加固~~ | ~~已完成: 修复 6 CRITICAL + 3 IMPORTANT + MINOR 问题~~ |
| ~~v1.2~~ | ~~三市场 + AI 导入~~ | ~~已完成: 美股支持 + 港股基本面 + 文件导入 (图片/PDF/视频)~~ |
| v1.3 | 用户系统 | 注册登录 + 云端自选股同步 |
| v1.4 | 策略回测 | 基于历史数据的策略回测引擎 |
| v2.0 | 移动端适配 | 响应式布局 + PWA 离线支持 |
| v2.1 | 数据库持久化 | PostgreSQL / SQLite 替代内存缓存 |
| v2.2 | WebSocket 实时推送 | 替代轮询，降低延迟 |

---

## 附录 A: v1.2.0 变更日志

> 发布日期: 2026-03-23

### 新功能 (4 项)

1. **美股支持**: 新增 88 只热门美股名称映射、腾讯 QT 实时行情获取、基本面数据 (PE/PB/股息率/市值)；前端搜索和详情页自动识别美股并显示 "US" 标签 + $ 货币符号
2. **智能文件导入**: 新增 `/api/stock/import-from-file` 端点，支持图片/PDF/视频三种格式，通过 Qwen3.5-Plus VL 模型自动识别股票代码，去重后返回结果
3. **港股基本面**: 新增 `_get_hk_fundamentals()` 函数，通过腾讯 QT 接口获取港股 PE/PB/股息率/市值数据
4. **自选股删除**: Dashboard 自选股表格新增删除按钮，一键从所有分组中移除

### Bug 修复 (2 项)

5. **默认自选股**: 移除 `defaultWatchlist` 中默认出现的 601318，新用户自选列表为空
6. **港股基本面不显示**: `_get_complete_fundamentals()` 新增港股分支，路由到 `_get_hk_fundamentals()`

### 技术升级 (3 项)

7. **模型统一**: AI 对话和 VL 识别统一使用 `qwen3.5-plus` 模型
8. **多格式导入**: PDF 通过 PyMuPDF 转换为图片 (200dpi, 最多 8 页)；视频通过 video_url 直传 (最大 50MB)
9. **市场标识**: 前端 Header 搜索结果和 StockDetail 页面自动识别三市场并显示对应标签和货币符号

## 附录 B: v1.1.0 变更日志

> 发布日期: 2026-03-22

### CRITICAL 修复 (6 项)

1. **ChatBot 快捷按钮失效**: `sendMessage` 改为接受 `overrideText` 参数，避免 `setTimeout` + stale closure 问题；同时修复流式消息 state 直接突变 (`last.content = x` → 创建新对象)
2. **合法 0 值被替换**: 全局将数值字段的 `||` 替换为 `??` (nullish coalescing)，涉及 StockDetail / Compare / Dashboard / Valuation 四个页面
3. **空 Watchlist 加自选静默失败**: `addToWatchlist` 增加分组不存在检测，自动创建默认分组
4. **后端事件循环阻塞**: 6 个调用 AKShare (同步阻塞) 的端点从 `async def` 改为 `def`，FastAPI 自动线程池执行
5. **错误结果缓存污染**: A 股和港股行情仅在 `price > 0` 时写入缓存
6. **港股全量历史拉取**: 缓存 TTL 60s → 300s，数据处理改用 `.tail(2)` 减少内存开销

### IMPORTANT 修复 (3 项)

7. **Valuation 竞态条件**: 使用 `fetchIdRef` 递增计数器，快速切换股票时丢弃过时的异步响应
8. **路径注入 + Chat 输入校验**: 持久化缓存 key 增加正则校验 + path resolve 防穿越；Chat 消息增加角色白名单、长度限制、条数上限
9. **Watchlist 持久化 + Context 优化**: 自选分组读写 localStorage；Provider value 用 `useMemo` 稳定化；toast timer 用 ref 管理防泄漏

### MINOR 修复

10. **杂项**: Compare barData `||` → `??`；.env 解析支持引号包裹值
