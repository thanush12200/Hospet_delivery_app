import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './theme/storefront.css'

// The review catalogue is a separate app and is eliminated from production.
const Root = import.meta.env.DEV && /^\/preview(?:\/|$)/.test(window.location.pathname)
  ? lazy(() => import('./preview/PreviewApp')) : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}><Root /></Suspense>
  </StrictMode>,
)
