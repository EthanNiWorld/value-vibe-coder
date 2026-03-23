/**
 * API 服务层 — 连接 FastAPI 后端获取实时数据
 * 当后端不可用时自动降级为本地模拟数据
 */

const API_BASE = 'http://localhost:8000/api'

async function fetchAPI<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    return json.data ?? json
  } catch {
    console.warn(`[API] ${path} 请求失败，使用本地数据`)
    return fallback
  }
}

// ============================================================
// 市场指数
// ============================================================

export interface IndexData {
  code: string
  name: string
  value: number
  change: number
  changePercent: number
}

export async function fetchIndices(fallback: IndexData[]): Promise<IndexData[]> {
  return fetchAPI('/indices', fallback)
}

// ============================================================
// 股票搜索
// ============================================================

export interface SearchResult {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return []
  return fetchAPI(`/stock/search?q=${encodeURIComponent(query)}`, [])
}

// ============================================================
// 股票实时行情
// ============================================================

export interface StockQuote {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  volume: number
  amount: number
  marketCap: number
  pe: number
  pb: number
  turnoverRate: number
  high52w: number
  low52w: number
}

export async function fetchStockQuote(code: string, fallback: Partial<StockQuote>): Promise<StockQuote> {
  return fetchAPI(`/stock/${code}/quote`, fallback as StockQuote)
}

// ============================================================
// 批量行情
// ============================================================

export async function fetchBatchQuotes(codes: string[]): Promise<SearchResult[]> {
  if (codes.length === 0) return []
  return fetchAPI(`/stock/batch?codes=${codes.join(',')}`, [])
}

// ============================================================
// 财务指标
// ============================================================

export interface Fundamentals {
  code: string
  roe: number
  eps: number
  dividendYield: number
  debtRatio: number
  grossMargin: number
  netMargin: number
  revenueGrowth: number
  profitGrowth: number
  freeCashFlow: number
  currentRatio: number
  pe: number
  pb: number
  marketCap?: number
}

export async function fetchFundamentals(code: string, fallback: Partial<Fundamentals>): Promise<Fundamentals> {
  return fetchAPI(`/stock/${code}/fundamentals`, fallback as Fundamentals)
}

// ============================================================
// 历年财务数据（带持久化缓存 + 增量拉取）
// ============================================================

export interface FinancialRecord {
  year: string
  revenue: number
  netProfit: number
  eps: number
  roe: number
  grossMargin: number
  netMargin: number
  operatingCashFlow?: number
  freeCashFlow?: number
  revenueGrowth?: number
  profitGrowth?: number
  debtRatio?: number
  currentRatio?: number
}

const FIN_CACHE_PREFIX = 'vl_fin_'

/** 从 localStorage 读取持久化的历年财务数据 */
function getCachedFinancials(code: string): FinancialRecord[] {
  try {
    const raw = localStorage.getItem(FIN_CACHE_PREFIX + code)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

/** 持久化历年财务数据到 localStorage */
function setCachedFinancials(code: string, records: FinancialRecord[]) {
  try {
    localStorage.setItem(FIN_CACHE_PREFIX + code, JSON.stringify(records))
  } catch { /* localStorage full, ignore */ }
}

/**
 * 获取历年财务数据 — 三层加速策略:
 * 1. 先返回 localStorage 缓存（瞬间展示）
 * 2. 后台向后端增量拉取（只请求缺失年份）
 * 3. 合并后更新缓存和UI
 */
export async function fetchFinancialHistory(
  code: string,
  fallback: FinancialRecord[]
): Promise<FinancialRecord[]> {
  // 先从 localStorage 读缓存
  const cached = getCachedFinancials(code)

  try {
    // 判断缓存中最大年份，请求增量
    let url = `/stock/${code}/financials`
    if (cached.length > 0) {
      const latestYear = Math.max(...cached.map(r => parseInt(r.year)))
      const currentYear = new Date().getFullYear()
      // 如果缓存覆盖到去年或今年，只增量拉取
      if (latestYear >= currentYear - 1) {
        url += `?since_year=${latestYear - 1}`  // 多拉1年以覆盖可能的修订
      }
    }

    const res = await fetch(`${API_BASE}${url}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const freshData: FinancialRecord[] = json.data ?? json

    if (freshData && freshData.length > 0) {
      if (json.incremental && cached.length > 0) {
        // 增量模式：合并缓存 + 新数据
        const merged = new Map<string, FinancialRecord>()
        cached.forEach(r => merged.set(r.year, r))
        freshData.forEach(r => merged.set(r.year, r))  // 新数据覆盖旧数据
        const result = Array.from(merged.values()).sort((a, b) => a.year.localeCompare(b.year))
        setCachedFinancials(code, result)
        return result
      } else {
        // 全量模式：直接用新数据
        setCachedFinancials(code, freshData)
        return freshData
      }
    }
  } catch {
    console.warn(`[API] financials/${code} 请求失败`)
  }

  // API 失败，用缓存或 fallback
  if (cached.length > 0) return cached
  return fallback
}

/** 获取本地缓存的历年财务数据（不请求后端，用于即时展示） */
export function getCachedFinancialHistory(code: string): FinancialRecord[] {
  return getCachedFinancials(code)
}

// ============================================================
// 股票筛选
// ============================================================

export interface ScreenerParams {
  pe_min?: number
  pe_max?: number
  pb_min?: number
  pb_max?: number
  roe_min?: number
  sort_by?: string
  sort_dir?: string
  limit?: number
}

export interface ScreenerResult {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  pe: number
  pb: number
  marketCap: number
}

export async function fetchScreenerResults(
  params: ScreenerParams,
  fallback: ScreenerResult[]
): Promise<{ data: ScreenerResult[]; total: number }> {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.set(k, String(v))
  })
  try {
    const res = await fetch(`${API_BASE}/screener?${qs}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { data: fallback, total: fallback.length }
  }
}

// ============================================================
// 后端状态检查
// ============================================================

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ============================================================
// 文件导入股票（图片/PDF/视频）
// ============================================================

export interface ImportedStock {
  code: string
  name: string
  market: string
}

/**
 * 通过文件上传识别股票（支持图片/PDF/视频）
 * 使用 FormData multipart 上传，后端调用 qwen-plus VL 模型识别
 */
export async function importStocksFromFile(file: File): Promise<ImportedStock[]> {
  try {
    const formData = new FormData()
    formData.append('file', file)

    // 视频文件可能较大，给更长超时
    const timeout = file.type.startsWith('video/') ? 60000 : 30000

    const res = await fetch(`${API_BASE}/stock/import-from-file`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `HTTP ${res.status}`)
    }
    const json = await res.json()
    return json.data ?? []
  } catch (e) {
    console.warn('[API] import-from-file 请求失败', e)
    throw e
  }
}

/** @deprecated 使用 importStocksFromFile 代替 */
export async function importStocksFromImage(base64Image: string): Promise<ImportedStock[]> {
  try {
    const res = await fetch(`${API_BASE}/stock/import-from-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    return json.data ?? []
  } catch (e) {
    console.warn('[API] import-from-image 请求失败', e)
    return []
  }
}
