// Mock data for value investing analysis tool
// All financial data is for demonstration purposes

export interface Stock {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  pe: number
  pb: number
  roe: number
  eps: number
  marketCap: number // 亿
  industry: string
  dividendYield: number
  debtRatio: number
  revenueGrowth: number
  profitGrowth: number
  freeCashFlow: number // 亿
  grossMargin: number
  netMargin: number
  currentRatio: number
}

export interface FinancialData {
  year: string
  revenue: number
  netProfit: number
  operatingCashFlow: number
  freeCashFlow: number
  totalAssets: number
  totalDebt: number
  equity: number
  eps: number
  roe: number
  grossMargin: number
  netMargin: number
}

export interface WatchlistGroup {
  id: string
  name: string
  stocks: string[] // stock codes
}

export const stocksData: Record<string, Stock> = {
  "600519": {
    code: "600519", name: "贵州茅台", price: 1445.00, change: -7.87, changePercent: -0.54,
    pe: 21.05, pb: 7.79, roe: 36.02, eps: 68.64, marketCap: 18095, industry: "白酒",
    dividendYield: 2.1, debtRatio: 19.04, revenueGrowth: 15.66, profitGrowth: 15.38,
    freeCashFlow: 520, grossMargin: 91.93, netMargin: 52.27, currentRatio: 4.45,
  },
  "000858": {
    code: "000858", name: "五粮液", price: 102.40, change: -1.80, changePercent: -1.25,
    pe: 12.48, pb: 2.98, roe: 23.35, eps: 8.21, marketCap: 3970, industry: "白酒",
    dividendYield: 3.5, debtRatio: 22.5, revenueGrowth: 9.2, profitGrowth: 11.5,
    freeCashFlow: 180, grossMargin: 76.8, netMargin: 38.6, currentRatio: 3.1,
  },
  "000333": {
    code: "000333", name: "美的集团", price: 73.50, change: 0.85, changePercent: 1.26,
    pe: 13.81, pb: 2.65, roe: 21.29, eps: 5.32, marketCap: 5120, industry: "家电",
    dividendYield: 4.2, debtRatio: 62.1, revenueGrowth: 10.1, profitGrowth: 14.5,
    freeCashFlow: 280, grossMargin: 26.3, netMargin: 9.8, currentRatio: 1.3,
  },
  "600036": {
    code: "600036", name: "招商银行", price: 39.72, change: 0.32, changePercent: 0.92,
    pe: 7.02, pb: 0.96, roe: 14.49, eps: 5.66, marketCap: 10010, industry: "银行",
    dividendYield: 5.1, debtRatio: 91.2, revenueGrowth: 0.5, profitGrowth: 1.2,
    freeCashFlow: 850, grossMargin: 0, netMargin: 38.5, currentRatio: 0,
  },
  "601318": {
    code: "601318", name: "中国平安", price: 58.80, change: -0.45, changePercent: -0.85,
    pe: 8.34, pb: 1.17, roe: 13.8, eps: 7.05, marketCap: 10720, industry: "保险",
    dividendYield: 4.8, debtRatio: 88.5, revenueGrowth: 8.5, profitGrowth: 36.5,
    freeCashFlow: 620, grossMargin: 0, netMargin: 12.1, currentRatio: 0,
  },
  "002415": {
    code: "002415", name: "海康威视", price: 33.15, change: 0.55, changePercent: 1.74,
    pe: 24.13, pb: 3.58, roe: 15.34, eps: 1.37, marketCap: 3120, industry: "安防",
    dividendYield: 3.2, debtRatio: 38.2, revenueGrowth: 9.4, profitGrowth: 13.8,
    freeCashFlow: 95, grossMargin: 44.2, netMargin: 17.8, currentRatio: 2.1,
  },
  "300750": {
    code: "300750", name: "宁德时代", price: 413.30, change: 5.30, changePercent: 2.49,
    pe: 25.59, pb: 5.59, roe: 24.91, eps: 16.83, marketCap: 18140, industry: "新能源",
    dividendYield: 0.8, debtRatio: 68.2, revenueGrowth: 15.2, profitGrowth: 22.3,
    freeCashFlow: 320, grossMargin: 22.8, netMargin: 13.2, currentRatio: 1.5,
  },
  "603288": {
    code: "603288", name: "海天味业", price: 37.80, change: -0.25, changePercent: -0.67,
    pe: 33.2, pb: 6.81, roe: 21.76, eps: 1.14, marketCap: 2100, industry: "食品",
    dividendYield: 2.8, debtRatio: 15.8, revenueGrowth: 9.6, profitGrowth: 11.2,
    freeCashFlow: 55, grossMargin: 36.5, netMargin: 22.1, currentRatio: 3.8,
  },
  "002304": {
    code: "002304", name: "洋河股份", price: 62.50, change: 1.20, changePercent: 1.48,
    pe: 11.37, pb: 1.47, roe: 12.07, eps: 5.50, marketCap: 940, industry: "白酒",
    dividendYield: 4.5, debtRatio: 25.6, revenueGrowth: -1.5, profitGrowth: -3.2,
    freeCashFlow: 65, grossMargin: 74.2, netMargin: 32.5, currentRatio: 2.8,
  },
  "000568": {
    code: "000568", name: "泸州老窖", price: 105.20, change: 2.80, changePercent: 1.69,
    pe: 11.46, pb: 3.27, roe: 30.44, eps: 8.62, marketCap: 1550, industry: "白酒",
    dividendYield: 2.9, debtRatio: 22.1, revenueGrowth: 14.8, profitGrowth: 18.2,
    freeCashFlow: 85, grossMargin: 87.2, netMargin: 42.1, currentRatio: 3.5,
  },
  "601012": {
    code: "601012", name: "隆基绿能", price: 15.80, change: -0.65, changePercent: -3.39,
    pe: 0, pb: 2.39, roe: -13.1, eps: -2.82, marketCap: 1200, industry: "新能源",
    dividendYield: 0, debtRatio: 58.5, revenueGrowth: -28.5, profitGrowth: -182.1,
    freeCashFlow: -25, grossMargin: 6.5, netMargin: -15.2, currentRatio: 1.2,
  },
  "600900": {
    code: "600900", name: "长江电力", price: 30.50, change: 0.15, changePercent: 0.53,
    pe: 20.47, pb: 3.16, roe: 15.71, eps: 1.49, marketCap: 7420, industry: "电力",
    dividendYield: 3.8, debtRatio: 55.2, revenueGrowth: 12.5, profitGrowth: 20.8,
    freeCashFlow: 350, grossMargin: 62.5, netMargin: 42.8, currentRatio: 0.8,
  },
}

export function getFinancialHistory(code: string): FinancialData[] {
  const base = stocksData[code]
  if (!base) return []
  
  const years = ["2019", "2020", "2021", "2022", "2023", "2024"]
  const multipliers = [0.62, 0.68, 0.78, 0.85, 0.92, 1.0]
  
  return years.map((year, i) => {
    const m = multipliers[i]
    const revBase = base.marketCap * (base.netMargin / 100) / (base.eps) * base.eps / (base.netMargin / 100)
    return {
      year,
      revenue: Math.round(revBase * m * 10) / 10,
      netProfit: Math.round(revBase * m * (base.netMargin / 100) * 10) / 10,
      operatingCashFlow: Math.round(base.freeCashFlow * m * 1.3 * 10) / 10,
      freeCashFlow: Math.round(base.freeCashFlow * m * 10) / 10,
      totalAssets: Math.round(base.marketCap * 0.8 * m * 10) / 10,
      totalDebt: Math.round(base.marketCap * 0.8 * m * (base.debtRatio / 100) * 10) / 10,
      equity: Math.round(base.marketCap * 0.8 * m * (1 - base.debtRatio / 100) * 10) / 10,
      eps: Math.round(base.eps * m * 100) / 100,
      roe: Math.round(base.roe * (0.9 + i * 0.02) * 10) / 10,
      grossMargin: Math.round(base.grossMargin * (0.95 + i * 0.01) * 10) / 10,
      netMargin: Math.round(base.netMargin * (0.93 + i * 0.015) * 10) / 10,
    }
  })
}

export const defaultWatchlist: WatchlistGroup[] = [
  { id: "1", name: "我的自选", stocks: [] },
]

export const marketIndices = [
  { name: "上证指数", code: "000001", value: 3356.52, change: 12.35, changePercent: 0.37 },
  { name: "深证成指", code: "399001", value: 10568.23, change: -25.18, changePercent: -0.24 },
  { name: "创业板指", code: "399006", value: 2125.68, change: 18.52, changePercent: 0.88 },
  { name: "沪深300", code: "000300", value: 3956.12, change: 8.65, changePercent: 0.22 },
]

export function formatNumber(num: number, decimals = 2): string {
  if (Math.abs(num) >= 10000) return (num / 10000).toFixed(decimals) + "万亿"
  if (Math.abs(num) >= 1) return num.toFixed(decimals) + "亿"
  return (num * 100).toFixed(decimals) + "百万"
}

export function formatPrice(num: number): string {
  return num.toFixed(2)
}

export function formatPercent(num: number): string {
  const sign = num >= 0 ? "+" : ""
  return sign + num.toFixed(2) + "%"
}
