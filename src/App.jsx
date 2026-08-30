// src/App.jsx
import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { fetchApi } from './utils/api';
import { subscribeIfGranted } from './utils/push';

import Navbar from './components/Navbar';
import Homepage from './components/Homepage';
import LoginPage from './components/Login';
import SettingsPage from './components/Settings';
import ResetPasswordPage from './components/ResetPassword';
const Inventory = lazy(() => import('./components/Inventory'));
const Products = lazy(() => import('./components/Products'));
const Analysis = lazy(() => import('./components/Analysis'));
const Storage = lazy(() => import('./components/Storage'));
const UserManagement = lazy(() => import('./components/UserManagement'));
import InstallPrompt from './components/InstallPrompt';
import WelcomeTips from './components/WelcomeTips';
import { ConfirmHost } from './utils/confirm';
import { AuthContext } from './AuthContext';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const token = sessionStorage.getItem('token');
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
  const userRole = currentUser.role || 'Operator';

  if (!token) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(userRole)) {
    return <Navigate to="/homepage" replace />;
  }
  return children;
};

export default function App() {
  const location = useLocation();
  const isStoragePage = location.pathname === '/storage';
  const [isAuthenticated, setIsAuthenticated] = useState(!!sessionStorage.getItem('token'));
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    const verifyUserSession = async () => {
      const token = sessionStorage.getItem('token');
      if (token) {
        try {
          const data = await fetchApi('/api/verify-token');
          if (data.user) {
            sessionStorage.setItem('currentUser', JSON.stringify(data.user));
          }
          setIsAuthenticated(true);
          subscribeIfGranted(); // สมัคร push ถ้าเคยอนุญาตไว้แล้ว (ไม่เด้งขอสิทธิ์)
        } catch {
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }
      setIsVerifying(false);
    };
    verifyUserSession();
  }, []);

  if (isVerifying) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-transparent gap-4">
        <span className="loading loading-spinner loading-lg text-primary"></span>
        <p className="font-semibold text-base-content/70">กำลังตรวจสอบระบบ...</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated }}>
      {/* เลื่อน toast ลงมาให้พ้น navbar (สูง ~64px) จะได้ไม่บังเมนู/กระดิ่งแจ้งเตือน */}
      <Toaster position="top-right" reverseOrder={false} containerStyle={{ top: 76 }} toastOptions={{ className: 'text-sm font-medium rounded-xl shadow-lg' }} />
      <InstallPrompt />
      <ConfirmHost />
      {isAuthenticated && <WelcomeTips />}
      {/* พื้นหลังจริงเป็น gradient ที่ body (index.css) — wrapper ต้องโปร่งใสให้เห็น */}
      <div className="min-h-screen flex flex-col bg-transparent transition-colors duration-300">
        <Navbar />
        <div className={`relative flex-1 ${isStoragePage ? 'min-h-0 overflow-hidden' : ''}`}>
          <main className={isStoragePage ? 'h-[calc(100vh-4rem)] w-full overflow-auto p-2 lg:overflow-hidden' : 'h-full p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full'}>
            <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><span className="loading loading-spinner loading-lg text-primary" /></div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/homepage" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

              <Route path="/homepage" element={<ProtectedRoute><Homepage /></ProtectedRoute>} />
              <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
              <Route path="/storage" element={<ProtectedRoute><Storage /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              
              <Route path="/products" element={<ProtectedRoute allowedRoles={['Admin', 'Manager']}><Products /></ProtectedRoute>} />
              <Route path="/analysis" element={<ProtectedRoute allowedRoles={['Admin', 'Manager']}><Analysis /></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute allowedRoles={['Admin']}><UserManagement /></ProtectedRoute>} />

              <Route path="*" element={<Navigate to="/homepage" replace />} />
            </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
