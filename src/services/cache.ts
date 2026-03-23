/**
 * 本地缓存层 — Stale-While-Revalidate 模式
 * 
 * 设计逻辑：
 *   1. 打开页面时立即读取上次缓存数据（瞬间展示）
 *   2. 后台按需刷新，拿到新数据后更新显示 + 写入缓存
 *   3. 缓存自带时间戳，供 UI 显示数据新鲜度
 */

const PREFIX = 'vl_cache_'

export interface CachedData<T> {
  data: T
  ts: number         // 缓存时间戳 (ms)
  version?: string   // 数据版本标识
}

/** 写入缓存 */
export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CachedData<T> = {
      data,
      ts: Date.now(),
    }
    localStorage.setItem(PREFIX + key, JSON.stringify(entry))
  } catch (e) {
    // localStorage 满了，清理最旧的缓存
    console.warn('[Cache] 写入失败，尝试清理', e)
    clearOldestCache()
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }))
    } catch {
      // 放弃
    }
  }
}

/** 读取缓存，返回 null 表示无缓存 */
export function getCache<T>(key: string): CachedData<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as CachedData<T>
  } catch {
    return null
  }
}

/** 删除缓存 */
export function removeCache(key: string): void {
  localStorage.removeItem(PREFIX + key)
}

/** 清理最旧的缓存条目（释放空间） */
function clearOldestCache(): void {
  const entries: { key: string; ts: number }[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX)) {
      try {
        const raw = localStorage.getItem(key)
        if (raw) {
          const parsed = JSON.parse(raw)
          entries.push({ key, ts: parsed.ts || 0 })
        }
      } catch {
        entries.push({ key, ts: 0 })
      }
    }
  }
  // 删除最旧的 5 条
  entries.sort((a, b) => a.ts - b.ts)
  entries.slice(0, 5).forEach(e => localStorage.removeItem(e.key))
}

/** 格式化缓存时间（如 "3分钟前"、"1小时前"） */
export function formatCacheAge(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

/** 判断缓存是否过期 */
export function isCacheStale(ts: number, maxAgeMs: number): boolean {
  return Date.now() - ts > maxAgeMs
}
