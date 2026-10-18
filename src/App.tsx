import { useMemo, useState } from 'react'
import './App.css'
import ParticlesBackground from './components/ParticlesBackground'
import MachinePage from './pages/MachinePage'
import StatsPage from './pages/StatsPage'

type Tab = 'machine' | 'stats'

const TABS: { id: Tab; label: string }[] = [
  { id: 'machine', label: 'Machine' },
  { id: 'stats', label: 'Statistics' },
]

function App() {
  const [tab, setTab] = useState<Tab>('machine')

  // Memoize ParticlesBackground to prevent re-renders
  const particles = useMemo(() => <ParticlesBackground />, []);

  return (
    <>
      {particles}
      <nav className="app-tabs" role="tablist" aria-label="Sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {/* The machine stays mounted so an uploaded file and entered values survive switching tabs */}
      <div hidden={tab !== 'machine'}>
        <MachinePage />
      </div>
      {tab === 'stats' && <StatsPage />}
    </>
  )
}

export default App
