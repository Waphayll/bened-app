import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { AppDataProvider, useAppData } from './lib/AppDataContext';
import { pingAppwrite } from './lib/appwrite';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));

function AppLoader({ title = 'Preparing Workspace', subtitle = 'Loading your session, data, and views...' }) {
  return (
    <div className="route-loading">
      <div className="route-loading-card">
        <div className="route-loading-spinner" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="route-loading-title">{title}</div>
        <div className="route-loading-subtitle">{subtitle}</div>
      </div>
    </div>
  );
}

function RouteLoading() {
  return <AppLoader title="Loading View" subtitle="Preparing the next screen..." />;
}

function getDefaultRoute(user) {
  return user?.isAdmin ? '/admin' : '/dashboard';
}

function ProtectedRoute({ children }) {
  const { user, isLoading } = useAuth();
  const { isBootstrapping, hasBootstrapped } = useAppData();
  if (isLoading) return <AppLoader title="Loading Session" subtitle="Checking your Appwrite access..." />;
  if (user && (!hasBootstrapped || isBootstrapping)) {
    return <AppLoader title="Loading Workspace" subtitle="Fetching receipts, inventory, and masterlist data..." />;
  }
  return user ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { user, isLoading } = useAuth();
  const { isBootstrapping, hasBootstrapped } = useAppData();
  if (isLoading) return <AppLoader title="Loading Session" subtitle="Checking your Appwrite access..." />;
  if (user && (!hasBootstrapped || isBootstrapping)) {
    return <AppLoader title="Loading Admin Control" subtitle="Preparing all datasets before admin access..." />;
  }
  if (!user) return <Navigate to="/login" replace />;
  return user.isAdmin ? children : <Navigate to="/dashboard" replace />;
}

function PublicRoute({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <RouteLoading />;
  return !user ? children : <Navigate to={getDefaultRoute(user)} replace />;
}

export default function App() {
  useEffect(() => {
    pingAppwrite().catch((error) => {
      console.error('Appwrite ping failed:', error);
    });
  }, []);

  return (
    <AuthProvider>
      <AppDataProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AppDataProvider>
    </AuthProvider>
  );
}
