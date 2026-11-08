import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import NotFoundApp from '@/app/NotFoundApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NotFoundApp />
  </StrictMode>,
)
