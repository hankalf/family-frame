import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider } from './lib/useAuth.jsx';
import Display from './display/Display.jsx';
import AppShell from './app/AppShell.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* The kiosk view — no login, authenticated by display token. */}
        <Route path="/display" element={<Display />} />

        {/* The family companion app. */}
        <Route
          path="/app/*"
          element={
            <AuthProvider>
              <AppShell />
            </AuthProvider>
          }
        />

        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
