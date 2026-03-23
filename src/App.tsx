import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from '@/context/AppContext'
import { Sidebar } from '@/components/Sidebar'
import { Toast } from '@/components/Toast'
import { ChatBot } from '@/components/ChatBot'
import { Dashboard } from '@/pages/Dashboard'
import { StockDetail } from '@/pages/StockDetail'
import { Valuation } from '@/pages/Valuation'
import { Screener } from '@/pages/Screener'
import { Compare } from '@/pages/Compare'

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <div className="flex min-h-screen bg-background">
          <Sidebar />
          <main className="flex-1 ml-[240px]">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/stock/:code" element={<StockDetail />} />
              <Route path="/valuation" element={<Valuation />} />
              <Route path="/screener" element={<Screener />} />
              <Route path="/compare" element={<Compare />} />
            </Routes>
          </main>
          <Toast />
          <ChatBot />
        </div>
      </AppProvider>
    </BrowserRouter>
  )
}

export default App
