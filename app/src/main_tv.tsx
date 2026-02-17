import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppTV from './AppTV.tsx'
import { registerSW } from 'virtual:pwa-register'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppTV />
  </StrictMode>,
)

// Only register service worker in production (not in dev mode)
if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}
