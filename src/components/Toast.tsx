import { useApp } from '@/context/AppContext'
import { CheckCircle, XCircle, Info } from 'lucide-react'

export function Toast() {
  const { toast } = useApp()
  if (!toast) return null

  const icons = {
    success: <CheckCircle className="w-4 h-4" />,
    error: <XCircle className="w-4 h-4" />,
    info: <Info className="w-4 h-4" />,
  }

  const styles = {
    success: 'bg-card border-gain/20 text-foreground',
    error: 'bg-card border-destructive/20 text-foreground',
    info: 'bg-card border-primary/20 text-foreground',
  }

  return (
    <div className="fixed top-6 right-6 z-50 animate-fade-in">
      <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border shadow-lg ${styles[toast.type]}`}
        style={{ boxShadow: 'var(--shadow-elevated)' }}>
        <span className={
          toast.type === 'success' ? 'text-gain' :
          toast.type === 'error' ? 'text-destructive' : 'text-primary'
        }>{icons[toast.type]}</span>
        <span className="text-sm font-medium">{toast.message}</span>
      </div>
    </div>
  )
}
