import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles.css'
import './shared/styles/preferences.css'
import App from './App.jsx'
import { AuthProvider } from './shared/context/AuthContext.jsx'
import { UiPreferencesProvider } from './shared/context/UiPreferencesContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <UiPreferencesProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </UiPreferencesProvider>
    </BrowserRouter>
  </StrictMode>
)
