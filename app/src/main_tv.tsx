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

registerSW({ immediate: true })
