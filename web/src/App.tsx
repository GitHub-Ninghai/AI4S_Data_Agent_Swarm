import { useState, useEffect } from 'react'

const MIN_WIDTH = 1280

export function App() {
  const [tooSmall, setTooSmall] = useState(window.innerWidth < MIN_WIDTH)

  useEffect(() => {
    const handleResize = () => setTooSmall(window.innerWidth < MIN_WIDTH)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (tooSmall) {
    return (
      <div className="screen-warning">
        <h2>请使用更大屏幕</h2>
        <p>Agent Swarm 需要 {MIN_WIDTH}px 以上的屏幕宽度。</p>
        <p className="screen-warning-hint">当前宽度：{window.innerWidth}px</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Agent Swarm</h1>
      </header>
      <main className="app-main">
        <p>Agent Swarm 正在启动...</p>
      </main>
    </div>
  )
}
