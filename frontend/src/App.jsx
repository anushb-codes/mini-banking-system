import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Beneficiaries from './pages/Beneficiaries';
import AdminPanel from './pages/AdminPanel';
import Customers from './pages/Customers';

const PrivateRoute = ({ children, adminOnly = false }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  return children;
};

const AppShell = ({ children }) => (
  <div className="app-shell">
    <Sidebar />
    <main className="main-content">{children}</main>
  </div>
);

const AppRoutes = () => {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login"    element={user ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <Register />} />

      <Route path="/dashboard" element={
        <PrivateRoute><AppShell><Dashboard /></AppShell></PrivateRoute>
      } />
      <Route path="/accounts" element={
        <PrivateRoute><AppShell><Accounts /></AppShell></PrivateRoute>
      } />
      <Route path="/transactions" element={
        <PrivateRoute><AppShell><Transactions /></AppShell></PrivateRoute>
      } />
      <Route path="/beneficiaries" element={
        <PrivateRoute><AppShell><Beneficiaries /></AppShell></PrivateRoute>
      } />
      <Route path="/customers" element={
        <PrivateRoute><AppShell><Customers /></AppShell></PrivateRoute>
      } />
      <Route path="/admin/*" element={
        <PrivateRoute adminOnly><AppShell><AdminPanel /></AppShell></PrivateRoute>
      } />

      <Route path="/" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a2236',
            color: '#f1f5f9',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />
      <AppRoutes />
    </AuthProvider>
  </BrowserRouter>
);

export default App;
