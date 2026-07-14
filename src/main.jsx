import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// ลงทะเบียน Service Worker (PWA) — ทำงานเฉพาะ secure context (https หรือ localhost)
// บน http://IP ในวง LAN เบราว์เซอร์จะไม่ลงทะเบียนให้ ซึ่งไม่กระทบการใช้งานปกติ
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration skipped:', err.message);
    });
  });
}
