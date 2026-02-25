import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface ServerLocation {
  code: string
  desc: string
  ip: string
  port: number
}

interface CountryData {
  name: string
  flag: string
  total: number
  blocked: number
  servers: ServerLocation[]
}

interface ContinentData {
  name: string
  total: number
  blocked: number
  countries: CountryData[]
}

type Theme = 'dark' | 'neon-cyan' | 'neon-purple'
type FilterMode = 'all' | 'blocked' | 'unblocked' | 'partial'

function App() {
  const [servers, setServers] = useState<ServerLocation[]>([])
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [continents, setContinents] = useState<ContinentData[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [theme, setTheme] = useState<Theme>('dark')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set())
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set())
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [dialogType, setDialogType] = useState<string | null>(null)
  const [showAdminWarning, setShowAdminWarning] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      setStatusMessage('Loading servers...')
      
      const [serverList, blockedList, adminStatus] = await Promise.all([
        invoke<ServerLocation[]>('fetch_server_locations'),
        invoke<Set<string>>('get_blocked_servers'),
        invoke<boolean>('is_admin')
      ])
      
      setServers(serverList)
      setBlocked(blockedList)
      setIsAdmin(adminStatus)
      
      const countryData = await invoke<ContinentData[]>('get_country_data', {
        servers: serverList,
        blocked: blockedList
      })
      setContinents(countryData)
      
      const blockedCount = Array.from(blockedList).length
      setStatusMessage(`Loaded ${serverList.length} servers, ${blockedCount} blocked`)
    } catch (error) {
      console.error('Failed to load data:', error)
      setStatusMessage(`Error: ${error}`)
    } finally {
      setLoading(false)
    }
  }



  const blockCountry = async (countryName: string) => {
    try {
      const country = continents
        .flatMap(c => c.countries)
        .find(c => c.name === countryName)
      if (!country) return
      
      await invoke('block_all_in_country', { servers: country.servers })
      setBlocked(prev => {
        const next = new Set(prev)
        country.servers.forEach(s => next.add(s.code))
        return next
      })
      setStatusMessage(`Blocked all servers in ${countryName}`)
      await refreshCountryData()
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }

  const unblockCountry = async (countryName: string) => {
    try {
      const country = continents
        .flatMap(c => c.countries)
        .find(c => c.name === countryName)
      if (!country) return
      
      await invoke('unblock_all_in_country', { servers: country.servers })
      setBlocked(prev => {
        const next = new Set(prev)
        country.servers.forEach(s => next.delete(s.code))
        return next
      })
      setStatusMessage(`Unblocked all servers in ${countryName}`)
      await refreshCountryData()
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }

  const unblockAll = async () => {
    try {
      await invoke('unblock_all')
      setBlocked(new Set())
      setStatusMessage('Unblocked all servers')
      await refreshCountryData()
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }

  const refreshCountryData = async () => {
    const countryData = await invoke<ContinentData[]>('get_country_data', {
      servers,
      blocked
    })
    setContinents(countryData)
  }

  const toggleServer = async (server: ServerLocation) => {
    try {
      if (blocked.has(server.code)) {
        await invoke('unblock_servers', { servers: [server] })
        setBlocked(prev => {
          const next = new Set(prev)
          next.delete(server.code)
          return next
        })
      } else {
        await invoke('block_servers', { servers: [server] })
        setBlocked(prev => new Set([...prev, server.code]))
      }
      await refreshCountryData()
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }

  const handleDialogConfirm = async () => {
    if (dialogType === 'unblock-all') {
      await unblockAll()
    } else if (dialogType === 'block-selected') {
      for (const countryName of selectedCountries) {
        await blockCountry(countryName)
      }
    } else if (dialogType === 'unblock-selected') {
      for (const countryName of selectedCountries) {
        await unblockCountry(countryName)
      }
    }
    setDialogType(null)
  }

  const toggleCountrySelection = (countryName: string) => {
    setSelectedCountries(prev => {
      const next = new Set(prev)
      if (next.has(countryName)) {
        next.delete(countryName)
      } else {
        next.add(countryName)
      }
      return next
    })
  }

  const themeColors = {
    'dark': 'border-dark-border',
    'neon-cyan': 'border-neon-cyan neon-cyan',
    'neon-purple': 'border-neon-purple neon-purple'
  }

  const filteredContinents = continents.map(continent => ({
    ...continent,
    countries: continent.countries.filter(country => {
      const isBlocked = country.blocked > 0
      const allBlocked = country.blocked === country.total
      const partial = isBlocked && !allBlocked
      
      switch (filterMode) {
        case 'blocked': return allBlocked
        case 'unblocked': return !isBlocked
        case 'partial': return partial
        default: return true
      }
    })
  })).filter(c => c.countries.length > 0)

  const blockedCount = Array.from(blocked).length

  return (
    <div className={`h-full flex flex-col bg-dark-bg ${themeColors[theme]}`}>
      {/* Admin Warning Modal */}
      {!isAdmin && showAdminWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass rounded-xl p-6 max-w-md border border-yellow-500/50">
            <h2 className="text-xl font-bold text-yellow-500 mb-4">⚠️ Administrator Recommended</h2>
            <p className="text-gray-300 mb-6">
              For the best experience, run this app as Administrator to manage firewall rules.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => invoke('relaunch_as_admin')}
                className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold py-2 px-4 rounded-lg transition"
              >
                Yes, Run as Admin
              </button>
              <button
                onClick={() => setShowAdminWarning(false)}
                className="flex-1 bg-dark-border hover:bg-dark-panel text-gray-400 py-2 px-4 rounded-lg transition"
              >
                No, Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {dialogType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass rounded-xl p-6 max-w-md border border-red-500/50">
            <h2 className="text-xl font-bold text-red-500 mb-4">⚠️ Confirm Action</h2>
            <p className="text-gray-300 mb-6">
              {dialogType === 'unblock-all' && 'Are you sure you want to unblock ALL servers?'}
              {dialogType === 'block-selected' && `Block ${selectedCountries.size} selected countries?`}
              {dialogType === 'unblock-selected' && `Unblock ${selectedCountries.size} selected countries?`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDialogConfirm}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold py-2 px-4 rounded-lg transition"
              >
                Yes, Continue
              </button>
              <button
                onClick={() => setDialogType(null)}
                className="flex-1 bg-dark-border hover:bg-dark-panel text-gray-400 py-2 px-4 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="glass px-6 py-4 flex items-center justify-between border-b border-dark-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
            <span className="text-xl">🛡️</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">CS2 Server Blocker</h1>
            <p className="text-sm text-gray-500">{statusMessage}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Theme Selector */}
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="bg-dark-panel border border-dark-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
          >
            <option value="dark">Dark</option>
            <option value="neon-cyan">Neon Cyan</option>
            <option value="neon-purple">Neon Purple</option>
          </select>
          
          {/* Refresh Button */}
          <button
            onClick={loadData}
            disabled={loading}
            className="bg-dark-panel hover:bg-dark-border border border-dark-border px-4 py-2 rounded-lg flex items-center gap-2 transition"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span>
            Refresh
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map/Stats Area */}
        <main className="flex-1 p-6 overflow-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-400">Loading servers...</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Stats Cards */}
              <div className="glass rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4">Statistics</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-dark-bg rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Total Servers</p>
                    <p className="text-3xl font-bold">{servers.length}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Blocked</p>
                    <p className="text-3xl font-bold text-red-500">{blockedCount}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Unblocked</p>
                    <p className="text-3xl font-bold text-green-500">{servers.length - blockedCount}</p>
                  </div>
                  <div className="bg-dark-bg rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Admin Status</p>
                    <p className={`text-xl font-bold ${isAdmin ? 'text-green-500' : 'text-yellow-500'}`}>
                      {isAdmin ? '✓ Admin' : '✗ User'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Continents Overview */}
              <div className="glass rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4">Continents</h2>
                <div className="space-y-3">
                  {continents.filter(c => c.total > 0).map(continent => (
                    <div key={continent.name} className="bg-dark-bg rounded-lg p-3 flex items-center justify-between">
                      <span className="font-medium">{continent.name}</span>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-400">{continent.total} servers</span>
                        <span className={`px-2 py-1 rounded ${continent.blocked === continent.total ? 'bg-red-500/20 text-red-400' : continent.blocked > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
                          {continent.blocked}/{continent.total} blocked
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Sidebar - Country List */}
        <aside className="w-[450px] glass border-l border-dark-border flex flex-col">
          {/* Search & Filters */}
          <div className="p-4 border-b border-dark-border">
            <input
              type="text"
              placeholder="Search countries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-4 py-2 mb-3 focus:outline-none focus:border-cyan-500"
            />
            
            {/* Filter Chips */}
            <div className="flex gap-2 flex-wrap">
              {(['all', 'blocked', 'unblocked', 'partial'] as FilterMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  className={`px-3 py-1 rounded-full text-sm transition ${
                    filterMode === mode 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-dark-bg text-gray-400 hover:text-white'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            {/* Bulk Actions */}
            {selectedCountries.size > 0 && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setDialogType('block-selected')}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white py-1 px-3 rounded-lg text-sm"
                >
                  Block Selected ({selectedCountries.size})
                </button>
                <button
                  onClick={() => setDialogType('unblock-selected')}
                  className="flex-1 bg-green-600 hover:bg-green-500 text-white py-1 px-3 rounded-lg text-sm"
                >
                  Unblock Selected ({selectedCountries.size})
                </button>
              </div>
            )}
            
            {blockedCount > 0 && (
              <button
                onClick={() => setDialogType('unblock-all')}
                className="w-full mt-2 bg-red-900/50 hover:bg-red-900 text-red-400 py-1 px-3 rounded-lg text-sm border border-red-800"
              >
                Unblock All
              </button>
            )}
          </div>

          {/* Country List */}
          <div className="flex-1 overflow-auto p-4">
            {filteredContinents.map(continent => (
              <div key={continent.name} className="mb-4">
                <h3 className="text-sm font-semibold text-gray-400 mb-2">
                  {continent.name} ({continent.countries.length})
                </h3>
                <div className="space-y-1">
                  {continent.countries
                    .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(country => (
                      <CountryRow
                        key={country.name}
                        country={country}
                        isBlocked={country.blocked === country.total}
                        isSelected={selectedCountries.has(country.name)}
                        isExpanded={expandedCountries.has(country.name)}
                        onToggleExpand={() => {
                          setExpandedCountries(prev => {
                            const next = new Set(prev)
                            if (next.has(country.name)) {
                              next.delete(country.name)
                            } else {
                              next.add(country.name)
                            }
                            return next
                          })
                        }}
                        onToggleSelect={() => toggleCountrySelection(country.name)}
                        onBlock={() => blockCountry(country.name)}
                        onUnblock={() => unblockCountry(country.name)}
                        blockedCodes={blocked}
                        onToggleServer={toggleServer}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Status Bar */}
      <footer className="glass px-6 py-2 border-t border-dark-border flex items-center justify-between text-sm text-gray-400">
        <div className="flex items-center gap-4">
          <span className="text-red-500">{blockedCount} blocked</span>
          <span>|</span>
          <span className="text-green-500">{servers.length - blockedCount} unblocked</span>
          <span>|</span>
          <span>{statusMessage}</span>
        </div>
        <span>CS2 Server Blocker v0.1.0</span>
      </footer>
    </div>
  )
}

interface CountryRowProps {
  country: CountryData
  isBlocked: boolean
  isSelected: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleSelect: () => void
  onBlock: () => void
  onUnblock: () => void
  blockedCodes: Set<string>
  onToggleServer: (server: ServerLocation) => void
}

function CountryRow({ country, isSelected, isExpanded, onToggleExpand, onToggleSelect, onBlock, onUnblock, blockedCodes, onToggleServer }: CountryRowProps) {
  const allBlocked = country.blocked === country.total
  const partial = country.blocked > 0 && !allBlocked
  
  return (
    <div className="bg-dark-bg rounded-lg overflow-hidden">
      <div 
        className={`flex items-center justify-between p-3 cursor-pointer hover:bg-dark-panel transition ${
          isSelected ? 'bg-dark-panel border-l-2 border-cyan-500' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="w-4 h-4 accent-cyan-500"
          />
          <button onClick={onToggleExpand} className="text-gray-400 hover:text-white">
            {isExpanded ? '▼' : '▶'}
          </button>
          <span className="text-lg">{country.flag}</span>
          <span className="font-medium">{country.name}</span>
          <span className="text-gray-400 text-sm">({country.blocked}/{country.total})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs ${
            allBlocked ? 'bg-red-500/20 text-red-400' : 
            partial ? 'bg-yellow-500/20 text-yellow-400' : 
            'bg-green-500/20 text-green-400'
          }`}>
            {allBlocked ? 'Blocked' : partial ? 'Partial' : 'Open'}
          </span>
          {country.total > 1 && (
            <button
              onClick={allBlocked ? onUnblock : onBlock}
              className={`px-2 py-1 rounded text-xs ${
                allBlocked 
                  ? 'bg-green-600 hover:bg-green-500 text-white' 
                  : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              {allBlocked ? 'Unblock' : 'Block'}
            </button>
          )}
        </div>
      </div>
      
      {isExpanded && country.servers.length > 1 && (
        <div className="border-t border-dark-border p-2 pl-8 space-y-1">
          {country.servers.map(server => (
            <div key={server.code} className="flex items-center justify-between py-1 px-2 hover:bg-dark-panel rounded">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onToggleServer(server)}
                  className={`w-5 h-5 flex items-center justify-center rounded ${
                    blockedCodes.has(server.code) 
                      ? 'bg-red-500 text-white' 
                      : 'bg-green-500 text-white'
                  }`}
                >
                  {blockedCodes.has(server.code) ? '✖' : '○'}
                </button>
                <span className="text-sm text-gray-300">{server.desc}</span>
              </div>
              <span className="text-xs text-gray-500">{server.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
