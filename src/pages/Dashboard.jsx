import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { useAuth } from '../lib/AuthContext';
import {
  createReceiptRecords,
  listMasterlistRecords,
  listReceiptRecords,
} from '../lib/appwrite';
import '../styles/Dashboard.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

ChartJS.defaults.font.family = "'EB Garamond', Georgia, serif";
ChartJS.defaults.color = '#5a7a5a';

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June'];
const REVENUE_SERIES = [620000, 740000, 810000, 695000, 920000, 1036600];

const INVENTORY = [
  { name: 'Steel Fasteners', qty: '4,210 units', pct: 84, color: 'var(--green)', badge: 'ok', label: 'Sufficient' },
  { name: 'Hydraulic Seals', qty: '880 units', pct: 44, color: 'var(--amber)', badge: 'warn', label: 'Moderate' },
  { name: 'Bearing Assemblies', qty: '120 units', pct: 12, color: 'var(--red)', badge: 'alert', label: 'Low Stock' },
  { name: 'Drive Shafts', qty: '3,050 units', pct: 91, color: 'var(--green)', badge: 'ok', label: 'Sufficient' },
  { name: 'Pneumatic Valves', qty: '210 units', pct: 21, color: 'var(--red)', badge: 'alert', label: 'Low Stock' },
  { name: 'Conveyor Belts', qty: '1,640 units', pct: 65, color: 'var(--green)', badge: 'ok', label: 'Sufficient' },
  { name: 'Gear Reducers', qty: '390 units', pct: 39, color: 'var(--amber)', badge: 'warn', label: 'Moderate' },
];

const FALLBACK_TARGETS = [
  { name: 'Mechanical Components', pct: 92, fill: 'var(--green)' },
  { name: 'Hydraulics & Pneumatics', pct: 74, fill: 'var(--green-mid)' },
  { name: 'Conveyor Systems', pct: 61, fill: 'var(--amber)' },
  { name: 'Drive & Power Systems', pct: 83, fill: 'var(--green)' },
  { name: 'Fastening & Sealing', pct: 48, fill: 'var(--red)' },
];

const SUMMARY = [
  { color: 'var(--green)', text: '3 purchase orders pending approval' },
  { color: 'var(--red)', text: '2 items below reorder threshold' },
  { color: 'var(--amber)', text: '5 shipments in transit' },
  { color: 'var(--green)', text: 'Monthly close in 8 days' },
  { color: 'var(--green)', text: 'Top client: Ramonal Eng. Corp.' },
  { color: 'var(--amber)', text: 'Audit scheduled: 28 Mar 2026' },
];

const RECEIPT_OCR_API_BASE = (
  import.meta.env.VITE_RECEIPT_OCR_API_BASE || 'http://127.0.0.1:8000'
).replace(/\/$/, '');
const MASTERLIST_CSV_URL = import.meta.env.VITE_MASTERLIST_CSV_URL || '/masterlist.csv';

function createManualRow() {
  return {
    id: `manual-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    itemType: '',
    itemName: '',
    unit: '',
    price: '',
    quantity: '',
  };
}

function createReceiptDraft(inputtedBy = 'User') {
  return {
    inputtedBy,
    inputDate: new Date().toISOString().slice(0, 10),
    notes: '',
    mode: 'manual',
    manualRows: [createManualRow()],
    receipts: [],
  };
}

function createReceiptUploadEntry(file) {
  return {
    id: `receipt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    signature: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    status: 'processing',
    extractionError: '',
    extractedText: '',
    extractedItems: [],
    totalAmount: null,
  };
}

function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  const value = bytes / (1024 ** order);
  return `${value.toFixed(order === 0 ? 0 : 1)} ${sizes[order]}`;
}

function formatMoney(value) {
  if (!Number.isFinite(Number(value))) return 'N/A';
  return `₱ ${Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseCsvNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvText(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (rows.length <= 1) return [];

  const headers = splitCsvLine(rows[0]).map((header) => header.trim());
  return rows.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function normalizeMasterlistRow(row) {
  const itemType = row.ITEM_TYPE || row.item_type || row.CATEGORY || row.category || row.TYPE || row.type;
  const itemName = row.ITEM_NAME || row.item_name || row.NAME || row.name || row.PRODUCT_NAME || row.product_name;
  const unit = row.UNIT || row.unit || row.UNIT_OF_MEASUREMENT || row.unit_of_measurement || row.UOM || row.uom || '';
  const defaultPrice = row.DEFAULT_PRICE || row.default_price || row.PRICE || row.price || '';
  const salesTargetPct = row.SALES_TARGET_PCT || row.sales_target_pct || row.TARGET_PCT || row.target_pct || row.SALES_TARGET || row.sales_target || '';

  if (!itemType || !itemName) return null;

  return {
    itemType: String(itemType).trim(),
    itemName: String(itemName).trim(),
    unit: String(unit).trim(),
    defaultPrice: parseCsvNumber(defaultPrice),
    salesTargetPct: parseCsvNumber(salesTargetPct),
  };
}

function targetFillForPct(pct) {
  if (pct >= 80) return 'var(--green)';
  if (pct >= 65) return 'var(--green-mid)';
  if (pct >= 50) return 'var(--amber)';
  return 'var(--red)';
}

function deriveTargetsFromMasterlist(rows) {
  const byType = new Map();

  rows.forEach((row) => {
    if (!row?.itemType) return;
    if (!byType.has(row.itemType)) byType.set(row.itemType, []);
    if (Number.isFinite(row.salesTargetPct)) {
      byType.get(row.itemType).push(row.salesTargetPct);
    }
  });

  if (byType.size === 0) return [];

  return Array.from(byType.entries())
    .map(([name, values]) => {
      const pct = values.length > 0
        ? roundMoney(values.reduce((total, value) => total + value, 0) / values.length)
        : 0;
      return {
        name,
        pct,
        fill: targetFillForPct(pct),
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

function deriveOrderCountsByMonth(receiptRecords, year) {
  const counts = Array(MONTH_LABELS.length).fill(0);

  receiptRecords.forEach((record) => {
    const rawDate = record?.inputDate;
    if (!rawDate) return;

    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year) return;

    const monthIndex = date.getMonth();
    if (monthIndex >= 0 && monthIndex < MONTH_LABELS.length) {
      counts[monthIndex] += 1;
    }
  });

  return counts;
}

function findMasterlistMatch(productName, masterlistRows) {
  const lookup = normalizeLookup(productName);
  if (!lookup) return null;

  let bestMatch = null;
  let bestScore = 0;

  masterlistRows.forEach((row) => {
    const candidate = normalizeLookup(row.itemName);
    if (!candidate) return;

    if (candidate === lookup) {
      bestMatch = row;
      bestScore = 1;
      return;
    }

    if (lookup.includes(candidate) || candidate.includes(lookup)) {
      const score = Math.min(candidate.length, lookup.length) / Math.max(candidate.length, lookup.length);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = row;
      }
    }
  });

  if (bestScore >= 0.58) return bestMatch;
  return null;
}

function NavLogoMark() {
  return (
    <div className="logo-mark-nav">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="10,2 18,7 18,13 10,18 2,13 2,7" />
        <line x1="10" y1="2" x2="10" y2="18" />
        <line x1="2" y1="7" x2="18" y2="13" />
        <line x1="18" y1="7" x2="2" y2="13" />
      </svg>
    </div>
  );
}

function SalesChart({ mode, orderCountsByMonth }) {
  const showingRevenue = mode === 'Revenue';
  const dataSeries = showingRevenue ? REVENUE_SERIES : orderCountsByMonth;

  const chartData = {
    labels: MONTH_LABELS,
    datasets: [{
      label: showingRevenue ? 'Revenue (₱)' : 'Order Count',
      data: dataSeries,
      borderColor: '#2d6e3e',
      borderWidth: 2,
      pointBackgroundColor: '#2d6e3e',
      pointRadius: 4,
      pointHoverRadius: 6,
      backgroundColor: 'rgba(45,110,62,0.10)',
      fill: true,
      tension: 0.35,
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
        callbacks: {
          label: (ctx) => {
            if (showingRevenue) return ` ₱ ${ctx.parsed.y.toLocaleString()}`;
            return ` ${ctx.parsed.y.toLocaleString()} orders`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(45,110,62,0.07)' },
        border: { dash: [4, 4] },
      },
      y: showingRevenue
        ? {
            grid: { color: 'rgba(45,110,62,0.07)' },
            border: { dash: [4, 4] },
            ticks: {
              callback: (value) => `₱${(value / 1000).toFixed(0)}k`,
            },
          }
        : {
            beginAtZero: true,
            grid: { color: 'rgba(45,110,62,0.07)' },
            border: { dash: [4, 4] },
            ticks: {
              precision: 0,
              callback: (value) => `${value}`,
            },
          },
    },
  };

  return <Line data={chartData} options={options} />;
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

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [activeNav, setActiveNav] = useState('Dashboard');
  const [activeTab, setActiveTab] = useState('Revenue');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState(() => createReceiptDraft('User'));
  const [orderFeedback, setOrderFeedback] = useState('');
  const [orderFormError, setOrderFormError] = useState('');
  const [receiptUploadError, setReceiptUploadError] = useState('');
  const [receiptDragActive, setReceiptDragActive] = useState(false);
  const [isSendingReceipt, setIsSendingReceipt] = useState(false);
  const [masterlistRows, setMasterlistRows] = useState([]);
  const [masterlistSource, setMasterlistSource] = useState('');
  const [masterlistError, setMasterlistError] = useState('');
  const [orderCountsByMonth, setOrderCountsByMonth] = useState(Array(MONTH_LABELS.length).fill(0));

  const dropdownRef = useRef(null);
  const receiptInputRef = useRef(null);

  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'JR';
  const displayName = user?.username
    ? user.username.charAt(0).toUpperCase() + user.username.slice(1)
    : 'User';

  const currentYear = new Date().getFullYear();

  const itemTypeOptions = useMemo(() => (
    Array.from(new Set(masterlistRows.map((row) => row.itemType))).sort((a, b) => a.localeCompare(b))
  ), [masterlistRows]);

  const itemNamesByType = useMemo(() => {
    const byType = new Map();
    masterlistRows.forEach((row) => {
      if (!byType.has(row.itemType)) byType.set(row.itemType, []);
      byType.get(row.itemType).push(row);
    });

    byType.forEach((rows, itemType) => {
      byType.set(
        itemType,
        rows.sort((a, b) => a.itemName.localeCompare(b.itemName)),
      );
    });

    return byType;
  }, [masterlistRows]);

  const salesTargets = useMemo(() => {
    const derived = deriveTargetsFromMasterlist(masterlistRows);
    return derived.length > 0 ? derived : FALLBACK_TARGETS;
  }, [masterlistRows]);

  const totalOrdersInGraphWindow = useMemo(() => (
    orderCountsByMonth.reduce((total, value) => total + value, 0)
  ), [orderCountsByMonth]);

  useEffect(() => {
    const handler = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!isReceiptModalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setIsReceiptModalOpen(false);
        setReceiptDragActive(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isReceiptModalOpen]);

  useEffect(() => {
    setReceiptDraft((prev) => ({
      ...prev,
      inputtedBy: displayName,
    }));
  }, [displayName]);

  useEffect(() => {
    let active = true;

    const loadMasterlist = async () => {
      setMasterlistError('');
      try {
        const records = await listMasterlistRecords();
        if (!active) return;
        if (records.length > 0) {
          setMasterlistRows(records);
          setMasterlistSource('database');
          return;
        }
      } catch (error) {
        if (!active) return;
        setMasterlistError(error?.message || 'Unable to load masterlist from Appwrite database.');
      }

      try {
        const response = await fetch(MASTERLIST_CSV_URL);
        if (!response.ok) throw new Error(`Cannot load ${MASTERLIST_CSV_URL}`);
        const text = await response.text();
        const parsed = parseCsvText(text)
          .map(normalizeMasterlistRow)
          .filter(Boolean);
        if (!active) return;
        setMasterlistRows(parsed);
        setMasterlistSource('csv');
      } catch (error) {
        if (!active) return;
        setMasterlistRows([]);
        setMasterlistError((current) => (
          current
            ? `${current} CSV fallback failed: ${error?.message || 'unknown error'}.`
            : `Unable to load masterlist CSV: ${error?.message || 'unknown error'}.`
        ));
      }
    };

    loadMasterlist();
    return () => {
      active = false;
    };
  }, []);

  const refreshOrderCounts = async () => {
    try {
      const records = await listReceiptRecords();
      setOrderCountsByMonth(deriveOrderCountsByMonth(records, currentYear));
    } catch (error) {
      console.error('Unable to load receipt totals for Orders graph:', error);
      setOrderCountsByMonth(Array(MONTH_LABELS.length).fill(0));
    }
  };

  useEffect(() => {
    refreshOrderCounts();
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const openReceiptModal = () => {
    setDropdownOpen(false);
    setReceiptDraft(createReceiptDraft(displayName));
    setOrderFormError('');
    setReceiptUploadError('');
    setOrderFeedback('');
    setIsReceiptModalOpen(true);
  };

  const closeReceiptModal = () => {
    setIsReceiptModalOpen(false);
    setReceiptDragActive(false);
    setOrderFormError('');
    setReceiptUploadError('');
    setIsSendingReceipt(false);
  };

  const updateReceiptField = (field, value) => {
    setReceiptDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateManualRow = (rowId, changes) => {
    setReceiptDraft((prev) => ({
      ...prev,
      manualRows: prev.manualRows.map((row) => (
        row.id === rowId ? { ...row, ...changes } : row
      )),
    }));
  };

  const handleManualItemTypeChange = (rowId, itemType) => {
    updateManualRow(rowId, {
      itemType,
      itemName: '',
      unit: '',
    });
  };

  const handleManualItemNameChange = (rowId, itemName) => {
    const row = receiptDraft.manualRows.find((item) => item.id === rowId);
    const options = itemNamesByType.get(row?.itemType || '') || [];
    const selected = options.find((option) => option.itemName === itemName);
    updateManualRow(rowId, {
      itemName,
      unit: selected?.unit || '',
    });
  };

  const addManualRow = () => {
    setReceiptDraft((prev) => ({
      ...prev,
      manualRows: [...prev.manualRows, createManualRow()],
    }));
  };

  const removeManualRow = (rowId) => {
    setReceiptDraft((prev) => {
      if (prev.manualRows.length === 1) return prev;
      return {
        ...prev,
        manualRows: prev.manualRows.filter((row) => row.id !== rowId),
      };
    });
  };

  const updateReceiptUploadState = (receiptId, changes) => {
    setReceiptDraft((prev) => ({
      ...prev,
      receipts: prev.receipts.map((receipt) => (
        receipt.id === receiptId ? { ...receipt, ...changes } : receipt
      )),
    }));
  };

  const processReceiptExtraction = async (receiptId, file) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${RECEIPT_OCR_API_BASE}/extract-receipt`, {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || 'Unable to extract receipt text.');
      }

      const extractedItems = Array.isArray(payload?.items)
        ? payload.items.map((item) => {
            const match = findMasterlistMatch(item?.product_name, masterlistRows);
            return {
              quantity: Number(item?.quantity || 0),
              unit: item?.unit || '',
              product_name: item?.product_name || '',
              total_price: Number(item?.total_price || 0),
              item_type: match?.itemType || '',
            };
          })
        : [];

      updateReceiptUploadState(receiptId, {
        status: 'ready',
        extractionError: '',
        extractedText: payload?.text || '',
        extractedItems,
        totalAmount: Number.isFinite(payload?.total_amount) ? payload.total_amount : null,
      });
    } catch (error) {
      updateReceiptUploadState(receiptId, {
        status: 'error',
        extractionError: error?.message || 'Unable to extract receipt text.',
        extractedText: '',
        extractedItems: [],
        totalAmount: null,
      });
    }
  };

  const addReceiptFiles = (fileList) => {
    const incomingFiles = Array.from(fileList || []);
    if (incomingFiles.length === 0) return;

    const imageFiles = incomingFiles.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length !== incomingFiles.length) {
      setReceiptUploadError('Only image files are allowed for receipt upload.');
    } else {
      setReceiptUploadError('');
    }
    if (imageFiles.length === 0) return;

    const existingSignatures = new Set(receiptDraft.receipts.map((receipt) => receipt.signature));
    const entries = imageFiles
      .map(createReceiptUploadEntry)
      .filter((entry) => !existingSignatures.has(entry.signature));

    if (entries.length === 0) return;

    setReceiptDraft((prev) => ({
      ...prev,
      receipts: [...prev.receipts, ...entries],
    }));

    entries.forEach((entry) => {
      processReceiptExtraction(entry.id, entry.file);
    });
  };

  const handleReceiptInputChange = (event) => {
    addReceiptFiles(event.target.files);
    event.target.value = '';
  };

  const handleReceiptDrop = (event) => {
    event.preventDefault();
    setReceiptDragActive(false);
    addReceiptFiles(event.dataTransfer.files);
  };

  const removeReceiptUpload = (receiptId) => {
    setReceiptDraft((prev) => ({
      ...prev,
      receipts: prev.receipts.filter((receipt) => receipt.id !== receiptId),
    }));
  };

  const handleSendReceipt = async (event) => {
    event.preventDefault();
    if (isSendingReceipt) return;

    setOrderFormError('');
    let receiptRows = [];

    if (receiptDraft.mode === 'manual') {
      const normalizedRows = receiptDraft.manualRows
        .map((row) => {
          const price = Number(row.price);
          const quantity = Number(row.quantity);
          const totalPrice = roundMoney(price * quantity);
          if (!row.itemType || !row.itemName || !Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) {
            return null;
          }
          return {
            INPUT_BY: receiptDraft.inputtedBy,
            INPUT_DATE: receiptDraft.inputDate,
            ITEM_NAME: row.itemName,
            ITEM_TYPE: row.itemType,
            PRICE: roundMoney(price),
            QUANTITY: quantity,
            TOTAL_PRICE: totalPrice,
          };
        })
        .filter(Boolean);

      if (normalizedRows.length === 0) {
        setOrderFormError('Add at least one valid manual row before sending.');
        return;
      }

      receiptRows = normalizedRows;
    } else {
      const extractedRows = receiptDraft.receipts
        .filter((receipt) => receipt.status === 'ready')
        .flatMap((receipt) => receipt.extractedItems || []);

      const normalizedRows = extractedRows
        .map((item) => {
          const quantity = Number(item?.quantity || 0);
          const totalPrice = roundMoney(item?.total_price || 0);
          if (!item?.product_name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(totalPrice) || totalPrice <= 0) {
            return null;
          }

          const inferredType = item.item_type || findMasterlistMatch(item.product_name, masterlistRows)?.itemType || 'UNMAPPED';
          const price = roundMoney(totalPrice / quantity);

          return {
            INPUT_BY: receiptDraft.inputtedBy,
            INPUT_DATE: receiptDraft.inputDate,
            ITEM_NAME: item.product_name,
            ITEM_TYPE: inferredType,
            PRICE: price,
            QUANTITY: quantity,
            TOTAL_PRICE: totalPrice,
          };
        })
        .filter(Boolean);

      if (normalizedRows.length === 0) {
        setOrderFormError('Upload at least one receipt with extracted rows before sending.');
        return;
      }

      receiptRows = normalizedRows;
    }

    setIsSendingReceipt(true);
    try {
      const createdCount = await createReceiptRecords(receiptRows);
      await refreshOrderCounts();
      setOrderFeedback(`Sent ${createdCount} receipt row${createdCount === 1 ? '' : 's'} to receipts DB.`);
      closeReceiptModal();
    } catch (error) {
      setOrderFormError(error?.message || 'Failed to send receipt records to the database.');
    } finally {
      setIsSendingReceipt(false);
    }
  };

  const navItems = ['Dashboard', 'Sales', 'Inventory', 'Reports'];

  return (
    <>
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
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

      <div className="page-header">
        <div>
          <h1 className="page-title">Sales &amp; Inventory Overview</h1>
          <p className="page-sub">Fiscal Year 2026 &nbsp;·&nbsp; Q1 Performance</p>
          {orderFeedback && <p className="order-feedback">{orderFeedback}</p>}
        </div>
        <div className="header-actions">
          <button className="btn-outline">Export Report</button>
          <button className="btn-solid" onClick={openReceiptModal}>Input Receipt</button>
        </div>
      </div>

      <main className="dash-main">
        <section className="kpi-strip">
          <div className="kpi-card" style={{ '--delay': '0.05s' }}>
            <div className="kpi-label">Total Revenue</div>
            <div className="kpi-value">₱ 4,821,600</div>
            <div className="kpi-delta positive">▲ 12.4% vs last quarter</div>
          </div>
          <div className="kpi-card" style={{ '--delay': '0.1s' }}>
            <div className="kpi-label">Orders Fulfilled</div>
            <div className="kpi-value">{totalOrdersInGraphWindow.toLocaleString()}</div>
            <div className="kpi-delta positive">Based on receipt rows for Jan–Jun {currentYear}</div>
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

        <section className="row-two">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Monthly Sales Overview</div>
                <div className="panel-sub">
                  {activeTab === 'Revenue'
                    ? 'Revenue (₱) — January to June 2026'
                    : `Orders per month — January to June ${currentYear}`}
                </div>
              </div>
              <div className="panel-tabs">
                {['Revenue', 'Orders'].map((tab) => (
                  <button
                    key={tab}
                    className={`tab ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-area">
              <SalesChart mode={activeTab} orderCountsByMonth={orderCountsByMonth} />
            </div>
          </div>

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

        <section className="row-three">
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

          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Sales Targets</div>
                <div className="panel-sub">
                  By category from masterlist {masterlistSource === 'database' ? 'database' : 'CSV'}
                </div>
              </div>
            </div>
            <div className="target-list">
              {salesTargets.map((target) => (
                <div className="target-row" key={target.name}>
                  <div className="target-label">
                    <span className="target-name">{target.name}</span>
                    <span className="target-pct">{target.pct}%</span>
                  </div>
                  <div className="target-track">
                    <div
                      className="target-fill"
                      style={{ width: `${target.pct}%`, background: target.fill }}
                    />
                  </div>
                </div>
              ))}
              {masterlistError && <p className="masterlist-warning">{masterlistError}</p>}
            </div>
          </div>

          <div className="panel panel-summary">
            <div className="panel-header">
              <div className="panel-title">Quick Summary</div>
            </div>
            <ul className="summary-list">
              {SUMMARY.map((summary, index) => (
                <li className="summary-item" key={index}>
                  <span className="summary-dot" style={{ background: summary.color }} />
                  <span>{summary.text}</span>
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

      {isReceiptModalOpen && (
        <div
          className="order-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeReceiptModal();
          }}
        >
          <section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="input-receipt-title">
            <div className="order-modal-header">
              <div>
                <h2 id="input-receipt-title" className="order-modal-title">Input Receipt</h2>
                <p className="order-modal-subtitle">
                  Choose manual input or upload a receipt image, then send rows to receipts DB.
                </p>
                <div className="receipt-mode-toggle">
                  <button
                    type="button"
                    className={`receipt-mode-btn ${receiptDraft.mode === 'manual' ? 'active' : ''}`}
                    onClick={() => updateReceiptField('mode', 'manual')}
                  >
                    Manual Input
                  </button>
                  <button
                    type="button"
                    className={`receipt-mode-btn ${receiptDraft.mode === 'upload' ? 'active' : ''}`}
                    onClick={() => updateReceiptField('mode', 'upload')}
                  >
                    Upload Receipt
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="order-modal-close"
                onClick={closeReceiptModal}
                aria-label="Close input receipt modal"
              >
                ×
              </button>
            </div>

            <form className="order-form" onSubmit={handleSendReceipt}>
              <div className="order-grid">
                <label className="order-field">
                  <span className="order-field-label">Inputted by</span>
                  <input type="text" value={receiptDraft.inputtedBy} readOnly />
                </label>
                <label className="order-field">
                  <span className="order-field-label">Input Date</span>
                  <input
                    type="date"
                    value={receiptDraft.inputDate}
                    onChange={(event) => updateReceiptField('inputDate', event.target.value)}
                    required
                  />
                </label>
                <label className="order-field order-field-full">
                  <span className="order-field-label">Notes</span>
                  <textarea
                    rows="3"
                    value={receiptDraft.notes}
                    onChange={(event) => updateReceiptField('notes', event.target.value)}
                    placeholder="Optional purchasing notes."
                  />
                </label>
              </div>

              {receiptDraft.mode === 'manual' ? (
                <div className="order-items">
                  <div className="order-items-head">
                    <h3 className="order-section-title">Manual Rows</h3>
                    <button type="button" className="btn-outline btn-inline" onClick={addManualRow}>
                      + Add Row
                    </button>
                  </div>

                  <div className="manual-item-head">
                    <span>Item Type</span>
                    <span>Item Name</span>
                    <span>Unit</span>
                    <span>Price</span>
                    <span>Qty</span>
                    <span>Total</span>
                    <span />
                  </div>

                  <div className="order-item-list">
                    {receiptDraft.manualRows.map((row) => {
                      const options = itemNamesByType.get(row.itemType) || [];
                      const rowTotal = roundMoney(Number(row.price || 0) * Number(row.quantity || 0));

                      return (
                        <div className="manual-item-row" key={row.id}>
                          <select
                            value={row.itemType}
                            onChange={(event) => handleManualItemTypeChange(row.id, event.target.value)}
                            required
                          >
                            <option value="">Select type</option>
                            {itemTypeOptions.map((itemType) => (
                              <option key={itemType} value={itemType}>{itemType}</option>
                            ))}
                          </select>

                          <select
                            value={row.itemName}
                            onChange={(event) => handleManualItemNameChange(row.id, event.target.value)}
                            required
                            disabled={!row.itemType}
                          >
                            <option value="">Select item</option>
                            {options.map((option) => (
                              <option key={`${row.id}-${option.itemName}`} value={option.itemName}>
                                {option.itemName}
                              </option>
                            ))}
                          </select>

                          <input type="text" value={row.unit} readOnly placeholder="Auto" />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.price}
                            onChange={(event) => updateManualRow(row.id, { price: event.target.value })}
                            placeholder="0.00"
                            required
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.quantity}
                            onChange={(event) => updateManualRow(row.id, { quantity: event.target.value })}
                            placeholder="0"
                            required
                          />
                          <div className="manual-total-cell">{formatMoney(rowTotal)}</div>

                          <button
                            type="button"
                            className="order-remove-btn"
                            onClick={() => removeManualRow(row.id)}
                            disabled={receiptDraft.manualRows.length === 1}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <p className="masterlist-note">
                    Item Type and Item Name are sourced from the masterlist {masterlistSource || 'source'}.
                    Unit is auto-filled from the selected row.
                  </p>
                </div>
              ) : (
                <div className="order-receipts">
                  <div className="order-items-head">
                    <h3 className="order-section-title">Receipt Upload</h3>
                  </div>
                  <div
                    className={`receipt-dropzone ${receiptDragActive ? 'drag-active' : ''}`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setReceiptDragActive(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setReceiptDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      if (event.currentTarget === event.target) setReceiptDragActive(false);
                    }}
                    onDrop={handleReceiptDrop}
                  >
                    <input
                      ref={receiptInputRef}
                      className="receipt-file-input"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleReceiptInputChange}
                    />
                    <p className="dropzone-title">Drag and drop receipt photos here</p>
                    <p className="dropzone-hint">or</p>
                    <button
                      type="button"
                      className="btn-outline btn-inline"
                      onClick={() => receiptInputRef.current?.click()}
                    >
                      Upload Receipt Photos
                    </button>
                    <p className="dropzone-meta">Accepted files: image formats only.</p>
                  </div>

                  {receiptUploadError && <p className="order-form-error">{receiptUploadError}</p>}

                  {receiptDraft.receipts.length > 0 && (
                    <ul className="receipt-list">
                      {receiptDraft.receipts.map((receipt) => (
                        <li className="receipt-item" key={receipt.id}>
                          <div className="receipt-meta">
                            <span className="receipt-name">{receipt.name}</span>
                            <span className="receipt-size">{formatFileSize(receipt.size)}</span>
                          </div>
                          <button
                            type="button"
                            className="receipt-remove"
                            onClick={() => removeReceiptUpload(receipt.id)}
                          >
                            Remove
                          </button>

                          {receipt.status === 'processing' && (
                            <p className="receipt-extracting">Extracting text from receipt image...</p>
                          )}

                          {receipt.status === 'error' && (
                            <p className="receipt-error-text">
                              {receipt.extractionError || 'Extraction failed for this image.'}
                            </p>
                          )}

                          {receipt.status === 'ready' && (
                            <>
                              {receipt.extractedItems.length > 0 ? (
                                <div className="receipt-table-wrap">
                                  <table className="receipt-table">
                                    <thead>
                                      <tr>
                                        <th>Quantity</th>
                                        <th>Unit</th>
                                        <th>Product</th>
                                        <th>Total Price</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {receipt.extractedItems.map((item, itemIndex) => (
                                        <tr key={`${receipt.id}-${itemIndex}`}>
                                          <td>{item.quantity}</td>
                                          <td>{item.unit}</td>
                                          <td>{item.product_name}</td>
                                          <td>{formatMoney(item.total_price)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="receipt-empty-text">
                                  No structured receipt rows detected from this image.
                                </p>
                              )}

                              {receipt.totalAmount !== null && (
                                <p className="receipt-total-amount">
                                  Detected Receipt Total: {formatMoney(receipt.totalAmount)}
                                </p>
                              )}

                              {receipt.extractedText && (
                                <details className="receipt-raw-details">
                                  <summary>Show extracted text</summary>
                                  <pre className="receipt-raw-text">{receipt.extractedText}</pre>
                                </details>
                              )}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {orderFormError && <p className="order-form-error">{orderFormError}</p>}

              <div className="order-modal-actions">
                <button type="button" className="btn-outline" onClick={closeReceiptModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-solid" disabled={isSendingReceipt}>
                  {isSendingReceipt ? 'Sending...' : 'Send Receipt'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
