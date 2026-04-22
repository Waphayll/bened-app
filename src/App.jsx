import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { pingAppwrite } from './lib/appwrite';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));

function RouteLoading() {
  return <div className="route-loading">Loading session...</div>;
}

function ProtectedRoute({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <RouteLoading />;
  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <RouteLoading />;
  return !user ? children : <Navigate to="/dashboard" replace />;
}

export default function App() {
  useEffect(() => {
    pingAppwrite().catch((error) => {
      console.error('Appwrite ping failed:', error);
    });
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/"         element={<Navigate to="/login" replace />} />
            <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="*"         element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
