import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './i18n.js';
import './styles.css';
import './styles-topbar-theme.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { BranchFilterProvider } from './context/BranchFilterContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { CompanyProvider } from './context/CompanyContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <CompanyProvider>
          <AuthProvider>
            <BranchFilterProvider>
              <NotificationProvider>
                <ToastProvider>
                  <App />
                </ToastProvider>
              </NotificationProvider>
            </BranchFilterProvider>
          </AuthProvider>
        </CompanyProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
