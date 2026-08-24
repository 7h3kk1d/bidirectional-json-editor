import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './ui/styles/tokens.css'
import './ui/styles/base.css'
import './ui/styles/shell.css'
import './ui/styles/tree.css'
import './ui/styles/cm.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
