import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageCircle, X, Send, Loader2, Sparkles, Trash2 } from 'lucide-react'

const API_BASE = 'http://localhost:8000/api'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

// 从 URL 提取当前股票代码
function useCurrentStock() {
  const location = useLocation()
  const match = location.pathname.match(/\/stock\/(\w+)/)
  return match ? match[1] : null
}

export function ChatBot() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [pulse, setPulse] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamContentRef = useRef('')
  const rafRef = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null) // 用于取消流式请求
  const currentStock = useCurrentStock()

  // 平滑滚动到底部
  const scrollToBottom = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })
  }, [])

  // 自动滚动到底部（消息变化时）
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 打开时自动聚焦输入
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  // 首次打开后关闭脉冲动画
  useEffect(() => {
    if (open) setPulse(false)
  }, [open])

  // 组件卸载时取消进行中的请求
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || streaming) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)
    streamContentRef.current = ''

    // 构建历史消息（最近10轮）
    const history = [...messages, userMsg]
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }))

    // 股票上下文
    let stockContext: string | undefined
    if (currentStock) {
      stockContext = `股票代码: ${currentStock}`
    }

    // 取消上一次请求（如有）
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          stock_context: stockContext,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''
      let updateScheduled = false

      // 批量更新函数：用 rAF 合并高频 chunk 到一次渲染（不可变更新）
      const flushContent = () => {
        updateScheduled = false
        const snapshot = streamContentRef.current
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: snapshot }
          }
          return updated
        })
        scrollToBottom()
      }

      const scheduleUpdate = () => {
        if (!updateScheduled) {
          updateScheduled = true
          requestAnimationFrame(flushContent)
        }
      }

      let streamDone = false
      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { streamDone = true; break }
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) {
              streamContentRef.current = `⚠️ ${parsed.error}`
              flushContent()
              streamDone = true
              break
            }
            if (parsed.tool_call) {
              setToolStatus(parsed.tool_call)
              scrollToBottom()
              continue
            }
            if (parsed.content) {
              setToolStatus(null)
              streamContentRef.current += parsed.content
              scheduleUpdate()
            }
          } catch {
            // skip invalid JSON
          }
        }
      }

      // 确保最后一个 chunk 被渲染
      flushContent()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // 被取消，静默返回
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: '⚠️ 无法连接到 AI 服务，请确认后端已启动。' }
        }
        return updated
      })
    } finally {
      setStreaming(false)
      setToolStatus(null)
    }
  }, [input, streaming, messages, currentStock, scrollToBottom])

  const clearHistory = () => {
    abortRef.current?.abort()
    setMessages([])
    setStreaming(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`
          fixed bottom-6 right-6 z-50
          w-14 h-14 rounded-full
          flex items-center justify-center
          shadow-lg hover:shadow-xl
          transition-all duration-300 ease-out
          ${open
            ? 'bg-muted text-muted-foreground rotate-0 scale-95'
            : 'text-white scale-100 hover:scale-105'
          }
        `}
        style={!open ? { background: 'var(--gradient-primary)' } : undefined}
      >
        {open ? (
          <X className="w-5 h-5" />
        ) : (
          <>
            <MessageCircle className="w-6 h-6" />
            {pulse && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 animate-ping" />
            )}
            {pulse && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400" />
            )}
          </>
        )}
      </button>

      {/* Chat Panel */}
      <div
        className={`
          fixed bottom-24 right-6 z-50
          w-[420px] max-h-[600px]
          rounded-2xl overflow-hidden
          border border-border
          shadow-2xl
          flex flex-col
          bg-background
          transition-all duration-300 ease-out origin-bottom-right
          ${open ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 translate-y-4 pointer-events-none'}
        `}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between shrink-0"
          style={{ background: 'var(--gradient-primary)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">投资分析助手</h3>
              <p className="text-[10px] text-white/60">
                Qwen-Plus · {currentStock ? `正在查看 ${currentStock}` : '随时提问'}
              </p>
            </div>
          </div>
          <button
            onClick={clearHistory}
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/60 hover:text-white transition-colors"
            title="清空聊天"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-[300px] max-h-[420px]"
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
              <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground text-center leading-relaxed">
                你好！我是你的投资分析助手 👋<br />
                可以问我关于股票分析、估值模型<br />
                或价值投资策略的任何问题
              </p>
              <div className="flex flex-wrap gap-2 mt-2 justify-center">
                {[
                  '茅台的护城河在哪？',
                  '如何用 DCF 估值？',
                  '巴菲特选股标准',
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="px-3 py-1.5 rounded-lg bg-accent text-[11px] text-accent-foreground hover:bg-accent/80 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`
                  max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                  ${msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-accent text-accent-foreground rounded-bl-md'
                  }
                `}
              >
                {msg.role === 'assistant' && msg.content === '' && streaming ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs">{toolStatus || '思考中...'}</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-border shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={currentStock ? `关于 ${currentStock} 的问题...` : '输入你的问题...'}
              rows={1}
              className="flex-1 resize-none px-4 py-2.5 rounded-xl bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow max-h-[100px]"
              style={{ minHeight: '40px' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 100) + 'px'
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || streaming}
              className={`
                shrink-0 w-10 h-10 rounded-xl flex items-center justify-center
                transition-all duration-200
                ${input.trim() && !streaming
                  ? 'text-white hover:opacity-90 shadow-md'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
                }
              `}
              style={input.trim() && !streaming ? { background: 'var(--gradient-primary)' } : undefined}
            >
              {streaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
            AI 分析仅供参考，不构成投资建议
          </p>
        </div>
      </div>
    </>
  )
}
