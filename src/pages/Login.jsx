import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import '../styles/Login.css';

const LogoMark = () => (
  <div className="logo-mark">
    <svg viewBox="0 0 20 20">
      <polygon points="10,2 18,7 18,13 10,18 2,13 2,7" />
      <line x1="10" y1="2" x2="10" y2="18" />
      <line x1="2" y1="7" x2="18" y2="13" />
      <line x1="18" y1="7" x2="2" y2="13" />
    </svg>
  </div>
);

export default function Login() {
  const navigate = useNavigate();
  const { login, isConfigured, authError } = useAuth();

  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [remember,  setRemember]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const handleLogin = async (e) => {
    e?.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }

    if (!isConfigured) {
      setError(
        'Appwrite is not configured yet. Add VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID.',
      );
      return;
    }

    setLoading(true);
    try {
      const nextUser = await login(email.trim(), password);
      navigate(nextUser?.isAdmin ? '/admin' : '/inventory');
    } catch (loginError) {
      setError(loginError?.message || 'Unable to sign in. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">

      {/* TOP BAR */}
      <header className="topbar">
        <span className="topbar-brand">Bened Industrial Group</span>
      </header>

      {/* LEFT COLUMN */}
      <aside className="col-left">
        <span className="side-text">Secure Employee Portal</span>
      </aside>

      {/* CENTER CARD */}
      <main className="card-col">
        <div className="card">

          <div className="card-header">
            <div className="logo-row">
              <LogoMark />
              <div>
                <div className="logo-text">Bened</div>
                <div className="logo-sub">Industrial Group</div>
              </div>
            </div>
            <div className="card-title">Employee Sign-In</div>
            <div className="card-subtitle">
              Authenticate with your Appwrite email and password.
            </div>
          </div>

          <div className="card-body">

            {error && <div className="error-msg">{error}</div>}
            {!error && authError && <div className="error-msg">{authError}</div>}
            <div className="access-note">
              This portal now uses Appwrite session authentication and routes admin accounts to their own workspace.
            </div>

            {/* Email */}
            <div className="form-group">
              <label className="form-label" htmlFor="employee-id">
                Employee ID / Email Address
              </label>
              <div className="input-wrap">
                <input
                  className="form-input"
                  type="email"
                  id="employee-id"
                  placeholder="firstname.lastname@bened.com"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                <svg className="input-icon" viewBox="0 0 24 24">
                  <rect x="3" y="5" width="18" height="14" rx="1" />
                  <polyline points="3,5 12,13 21,5" />
                </svg>
              </div>
            </div>

            {/* Password */}
            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <div className="input-wrap">
                <input
                  className="form-input"
                  type="password"
                  id="password"
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                <svg className="input-icon" viewBox="0 0 24 24">
                  <rect x="5" y="11" width="14" height="10" rx="1" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </div>
            </div>

            {/* Remember + Forgot */}
            <div className="row-between">
              <label
                className="checkbox-label"
                onClick={() => setRemember(!remember)}
              >
                <input type="checkbox" readOnly checked={remember} />
                <span className={`checkbox-box ${remember ? 'checked' : ''}`}>
                  {remember && <span className="checkbox-dot" />}
                </span>
                Keep me signed in
              </label>
              <span className="forgot-link">Managed by Appwrite Auth</span>
            </div>

            {/* Submit */}
            <button
              className="btn-primary"
              type="button"
              disabled={loading}
              onClick={handleLogin}
            >
              {loading ? 'Verifying…' : 'Authenticate & Continue'}
            </button>

          </div>
        </div>
      </main>

      {/* BOTTOM BAR */}
      <footer className="bottombar">
        <span className="bottombar-left">made by Bleza, Peria, Tizon for Bened Hardware</span>
        <nav className="bottombar-center">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Use</a>
          <a href="#">Accessibility</a>
        </nav>
      </footer>

    </div>
  );
}
