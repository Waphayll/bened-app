import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { useAuth } from '../lib/AuthContext';
import '../styles/Dashboard.css';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler
);

ChartJS.defaults.font.family = "'EB Garamond', Georgia, serif";
ChartJS.defaults.color = '#5a7a5a';

// ─── Data ───────────────────────────────────────────────────────
const INVENTORY = [
  { name: 'Steel Fasteners',    qty: '4,210 units', pct: 84,  color: 'var(--green)',   badge: 'ok',    label: 'Sufficient' },
  { name: 'Hydraulic Seals',    qty: '880 units',   pct: 44,  color: 'var(--amber)',   badge: 'warn',  label: 'Moderate'   },
  { name: 'Bearing Assemblies', qty: '120 units',   pct: 12,  color: 'var(--red)',     badge: 'alert', label: 'Low Stock'  },
  { name: 'Drive Shafts',       qty: '3,050 units', pct: 91,  color: 'var(--green)',   badge: 'ok',    label: 'Sufficient' },
  { name: 'Pneumatic Valves',   qty: '210 units',   pct: 21,  color: 'var(--red)',     badge: 'alert', label: 'Low Stock'  },
  { name: 'Conveyor Belts',     qty: '1,640 units', pct: 65,  color: 'var(--green)',   badge: 'ok',    label: 'Sufficient' },
  { name: 'Gear Reducers',      qty: '390 units',   pct: 39,  color: 'var(--amber)',   badge: 'warn',  label: 'Moderate'   },
];

const TARGETS = [
  { name: 'Mechanical Components',   pct: 92, fill: 'var(--green)'     },
  { name: 'Hydraulics & Pneumatics', pct: 74, fill: 'var(--green-mid)' },
  { name: 'Conveyor Systems',        pct: 61, fill: 'var(--amber)'     },
  { name: 'Drive & Power Systems',   pct: 83, fill: 'var(--green)'     },
  { name: 'Fastening & Sealing',     pct: 48, fill: 'var(--red)'       },
];

const SUMMARY = [
  { color: 'var(--green)', text: '3 purchase orders pending approval' },
  { color: 'var(--red)',   text: '2 items below reorder threshold' },
  { color: 'var(--amber)', text: '5 shipments in transit' },
  { color: 'var(--green)', text: 'Monthly close in 8 days' },
  { color: 'var(--green)', text: 'Top client: Ramonal Eng. Corp.' },
  { color: 'var(--amber)', text: 'Audit scheduled: 28 Mar 2026' },
];

// ─── Sub-components ──────────────────────────────────────────────
function NavLogoMark() {
  return (
    <div className="logo-mark-nav">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="10,2 18,7 18,13 10,18 2,13 2,7" />
        <line x1="10" y1="2" x2="10" y2="18" />
        <line x1="2"  y1="7"  x2="18" y2="13" />
        <line x1="18" y1="7"  x2="2"  y2="13" />
      </svg>
    </div>
  );
}

function SalesChart() {
  const salesData = {
    labels: ['January', 'February', 'March', 'April', 'May', 'June'],
    datasets: [{
      label: 'Revenue (₱)',
      data: [620000, 740000, 810000, 695000, 920000, 1036600],
      borderColor: '#2d6e3e',
      borderWidth: 2,
      pointBackgroundColor: '#2d6e3e',
      pointRadius: 4,
      pointHoverRadius: 6,
      backgroundColor: 'rgba(45,110,62,0.10)',
      fill: true,
      tension: 0.4,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fff',
        borderColor: '#d0ddd0',
        borderWidth: 1,
        titleColor: '#1e4d2b',
        bodyColor: '#2d6e3e',
        padding: 12,
        callbacks: { label: (ctx) => ' ₱ ' + ctx.parsed.y.toLocaleString() },
      },
    },
    scales: {
      x: { grid: { color: 'rgba(45,110,62,0.07)' }, border: { dash: [4, 4] } },
      y: {
        grid: { color: 'rgba(45,110,62,0.07)' },
        border: { dash: [4, 4] },
        ticks: { callback: (v) => '₱' + (v / 1000).toFixed(0) + 'k' },
      },
    },
  };

  return <Line data={salesData} options={options} />;
}

function ProductChart() {
  const data = {
    labels: ['Steel Fasteners', 'Drive Shafts', 'Conv. Belts', 'Hyd. Seals', 'Gear Reducers'],
    datasets: [{
      label: 'Units Sold',
      data: [1840, 1420, 1100, 860, 640],
      backgroundColor: ['#2d6e3e', '#3a8f50', '#4db368', '#8aab8a', '#d0ddd0'],
      borderRadius: 2,
      borderSkipped: false,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fff',
        borderColor: '#d0ddd0',
        borderWidth: 1,
        titleColor: '#1e4d2b',
        bodyColor: '#2d6e3e',
        padding: 12,
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: 'rgba(45,110,62,0.07)' }, border: { dash: [4, 4] } },
    },
  };

  return <Bar data={data} options={options} />;
}

// ─── Dashboard page ───────────────────────────────────────────────
export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [activeNav,     setActiveNav]     = useState('Dashboard');
  const [activeTab,     setActiveTab]     = useState('Revenue');
  const [dropdownOpen,  setDropdownOpen]  = useState(false);
  const dropdownRef = useRef(null);

  // Format today's date
  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  // Initials from username
  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : 'JR';

  const displayName = user?.username
    ? user.username.charAt(0).toUpperCase() + user.username.slice(1)
    : 'User';

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = ['Dashboard', 'Sales', 'Inventory', 'Products', 'Reports'];

  return (
    <>
      {/* TOP NAV */}
      <header className="topnav">
        <div className="topnav-left">
          <NavLogoMark />
          <div className="brand">
            <span className="brand-name">Bened</span>
            <span className="brand-sub">Industrial Group</span>
          </div>
          <div className="nav-divider" />
          <nav className="nav-links">
            {navItems.map((item) => (
              <button
                key={item}
                className={`nav-link ${activeNav === item ? 'active' : ''}`}
                onClick={() => setActiveNav(item)}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>

        <div className="topnav-right">
          <div className="nav-date">{dateStr}</div>
          <div className="nav-divider" />

          <div className="user-pill" ref={dropdownRef} onClick={() => setDropdownOpen(!dropdownOpen)}>
            <div className="user-avatar">{initials}</div>
            <span className="user-name">{displayName}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>

            {dropdownOpen && (
              <div className="user-dropdown">
                <div className="dropdown-meta">{user?.email}</div>
                <div className="dropdown-divider" />
                <button className="dropdown-item">My Profile</button>
                <button className="dropdown-item">Settings</button>
                <div className="dropdown-divider" />
                <button className="dropdown-item danger" onClick={handleLogout}>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* PAGE HEADER */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales &amp; Inventory Overview</h1>
          <p className="page-sub">Fiscal Year 2026 &nbsp;·&nbsp; Q1 Performance</p>
        </div>
        <div className="header-actions">
          <button className="btn-outline">Export Report</button>
          <button className="btn-solid">+ New Order</button>
        </div>
      </div>

      {/* MAIN */}
      <main className="dash-main">

        {/* KPI STRIP */}
        <section className="kpi-strip">
          <div className="kpi-card" style={{ '--delay': '0.05s' }}>
            <div className="kpi-label">Total Revenue</div>
            <div className="kpi-value">₱ 4,821,600</div>
            <div className="kpi-delta positive">▲ 12.4% vs last quarter</div>
          </div>
          <div className="kpi-card" style={{ '--delay': '0.1s' }}>
            <div className="kpi-label">Orders Fulfilled</div>
            <div className="kpi-value">1,348</div>
            <div className="kpi-delta positive">▲ 8.1% vs last quarter</div>
          </div>
          <div className="kpi-card" style={{ '--delay': '0.15s' }}>
            <div className="kpi-label">Sales Target</div>
            <div className="kpi-value">78.6%</div>
            <div className="kpi-progress">
              <div className="kpi-progress-bar" style={{ width: '78.6%' }} />
            </div>
          </div>
          <div className="kpi-card" style={{ '--delay': '0.2s' }}>
            <div className="kpi-label">Total SKUs in Stock</div>
            <div className="kpi-value">2,914</div>
            <div className="kpi-delta negative">▼ 3 low-stock alerts</div>
          </div>
        </section>

        {/* ROW 2 */}
        <section className="row-two">

          {/* Sales Chart */}
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Monthly Sales Overview</div>
                <div className="panel-sub">Revenue (₱) — January to June 2026</div>
              </div>
              <div className="panel-tabs">
                {['Revenue', 'Orders'].map((t) => (
                  <button
                    key={t}
                    className={`tab ${activeTab === t ? 'active' : ''}`}
                    onClick={() => setActiveTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-area">
              <SalesChart />
            </div>
          </div>

          {/* Inventory Status */}
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Inventory Status</div>
                <div className="panel-sub">Stock levels by category</div>
              </div>
            </div>
            <div className="inv-list">
              {INVENTORY.map((item) => (
                <div className="inv-row" key={item.name}>
                  <div className="inv-info">
                    <span className="inv-name">{item.name}</span>
                    <span className="inv-qty">{item.qty}</span>
                  </div>
                  <div className="inv-bar-wrap">
                    <div
                      className="inv-bar"
                      style={{ width: `${item.pct}%`, background: item.color }}
                    />
                  </div>
                  <span className={`inv-badge ${item.badge}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

        </section>

        {/* ROW 3 */}
        <section className="row-three">

          {/* Product Performance */}
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Product Performance</div>
                <div className="panel-sub">Top 5 by units sold — Q1 2026</div>
              </div>
            </div>
            <div className="chart-area chart-area-sm">
              <ProductChart />
            </div>
          </div>

          {/* Sales Targets */}
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Sales Targets</div>
                <div className="panel-sub">By product division</div>
              </div>
            </div>
            <div className="target-list">
              {TARGETS.map((t) => (
                <div className="target-row" key={t.name}>
                  <div className="target-label">
                    <span className="target-name">{t.name}</span>
                    <span className="target-pct">{t.pct}%</span>
                  </div>
                  <div className="target-track">
                    <div
                      className="target-fill"
                      style={{ width: `${t.pct}%`, background: t.fill }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Summary */}
          <div className="panel panel-summary">
            <div className="panel-header">
              <div className="panel-title">Quick Summary</div>
            </div>
            <ul className="summary-list">
              {SUMMARY.map((s, i) => (
                <li className="summary-item" key={i}>
                  <span className="summary-dot" style={{ background: s.color }} />
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          </div>

        </section>

      </main>

      <footer className="dash-footer">
        <span>© 2026 Bened Industrial Group</span>
        <nav>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Use</a>
          <a href="#">Accessibility</a>
        </nav>
      </footer>
    </>
  );
}
