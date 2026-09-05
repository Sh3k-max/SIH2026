import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Clear all session and local storage
try {
  localStorage.clear();
  sessionStorage.clear();
  console.log('[Aero3D] All SessionStorage and LocalStorage cleared successfully.');
} catch (e) {
  console.warn('Storage clear error:', e);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
