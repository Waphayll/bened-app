import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import {
  listInventoryRecords,
  listMasterlistRecords,
  listReceiptRecords,
} from './appwrite';

const AppDataContext = createContext(null);

const MASTERLIST_CSV_URL = import.meta.env.VITE_MASTERLIST_CSV_URL || '/masterlist.csv';
const MASTERLIST_CACHE_KEY = 'bened.masterlist.cache.v1';
const MASTERLIST_CACHE_TTL_MS = 5 * 60 * 1000;

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

function normalizeMasterlistCsvRow(row) {
  const itemType = row.ITEM_TYPE || row.item_type || row.CATEGORY || row.category || row.TYPE || row.type;
  const itemName = row.ITEM_NAME || row.item_name || row.NAME || row.name || row.PRODUCT_NAME || row.product_name;
  const unit = row.ITEM_UNIT || row.item_unit || row.UNIT || row.unit || row.UNIT_OF_MEASUREMENT || row.unit_of_measurement || row.UOM || row.uom || '';
  const itemDesc = row.ITEM_DESC || row.item_desc || row.DESCRIPTION || row.description || row.DESC || row.desc || '';
  const brand = row.BRAND || row.brand || '';
  const defaultPrice = row.DEFAULT_PRICE || row.default_price || row.PRICE || row.price || '';
  const measurement = row.MEASUREMENT || row.measurement || row.MEASUREMENT_UNIT || row.measurement_unit || row.MEASURE || row.measure || row.UNIT_MEASURE || row.unit_measure || '';
  const salesTargetPct = row.SALES_TARGET_PCT || row.sales_target_pct || row.TARGET_PCT || row.target_pct || row.SALES_TARGET || row.sales_target || '';

  if (!itemType || !itemName) return null;

  return {
    id: null,
    source: 'csv',
    itemType: String(itemType).trim(),
    itemName: String(itemName).trim(),
    unit: String(unit).trim(),
    itemDesc: String(itemDesc).trim(),
    brand: String(brand).trim(),
    defaultPrice: parseCsvNumber(defaultPrice),
    measurement: String(measurement).trim(),
    salesTargetPct: parseCsvNumber(salesTargetPct),
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && window.localStorage;
}

function readMasterlistCache() {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(MASTERLIST_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.rows) || !Number.isFinite(parsed?.savedAt)) return null;
    if (Date.now() - parsed.savedAt > MASTERLIST_CACHE_TTL_MS) return null;

    return {
      rows: parsed.rows,
      source: parsed.source || 'cache',
    };
  } catch {
    return null;
  }
}

function writeMasterlistCache(rows, source) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(MASTERLIST_CACHE_KEY, JSON.stringify({
      rows,
      source,
      savedAt: Date.now(),
    }));
  } catch {
    // Ignore cache write failures.
  }
}

async function loadMasterlistData({ preferCache = true } = {}) {
  const cachedMasterlist = preferCache ? readMasterlistCache() : null;
  if (cachedMasterlist) {
    return {
      rows: cachedMasterlist.rows,
      source: cachedMasterlist.source,
      error: '',
    };
  }

  let databaseError = '';

  try {
    const records = await listMasterlistRecords();
    if (records.length > 0) {
      writeMasterlistCache(records, 'database');
      return {
        rows: records,
        source: 'database',
        error: '',
      };
    }
  } catch (error) {
    databaseError = error?.message || 'Unable to load masterlist from Appwrite database.';
  }

  try {
    const response = await fetch(MASTERLIST_CSV_URL);
    if (!response.ok) throw new Error(`Cannot load ${MASTERLIST_CSV_URL}`);

    const text = await response.text();
    const parsedRows = parseCsvText(text)
      .map(normalizeMasterlistCsvRow)
      .filter(Boolean);

    writeMasterlistCache(parsedRows, 'csv');

    return {
      rows: parsedRows,
      source: 'csv',
      error: databaseError ? `${databaseError} Loaded CSV fallback.` : '',
    };
  } catch (error) {
    return {
      rows: [],
      source: '',
      error: databaseError
        ? `${databaseError} CSV fallback failed: ${error?.message || 'unknown error'}.`
        : `Unable to load masterlist CSV: ${error?.message || 'unknown error'}.`,
    };
  }
}

async function loadReceiptData() {
  try {
    return {
      rows: await listReceiptRecords(),
      error: '',
    };
  } catch (error) {
    return {
      rows: [],
      error: error?.message || 'Unable to load receipt records from the database.',
    };
  }
}

async function loadInventoryData() {
  try {
    return {
      rows: await listInventoryRecords(),
      error: '',
    };
  } catch (error) {
    return {
      rows: [],
      error: error?.message || 'Unable to load inventory records from the database.',
    };
  }
}

export function AppDataProvider({ children }) {
  const { user } = useAuth();

  const [receiptRows, setReceiptRows] = useState([]);
  const [receiptError, setReceiptError] = useState('');
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryError, setInventoryError] = useState('');
  const [masterlistRows, setMasterlistRows] = useState([]);
  const [masterlistSource, setMasterlistSource] = useState('');
  const [masterlistError, setMasterlistError] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  const resetData = useCallback(() => {
    setReceiptRows([]);
    setReceiptError('');
    setInventoryRows([]);
    setInventoryError('');
    setMasterlistRows([]);
    setMasterlistSource('');
    setMasterlistError('');
    setIsBootstrapping(false);
    setHasBootstrapped(false);
  }, []);

  const refreshReceiptData = useCallback(async () => {
    const result = await loadReceiptData();
    setReceiptRows(result.rows);
    setReceiptError(result.error);
    return result.rows;
  }, []);

  const refreshInventoryData = useCallback(async () => {
    const result = await loadInventoryData();
    setInventoryRows(result.rows);
    setInventoryError(result.error);
    return result.rows;
  }, []);

  const refreshMasterlistData = useCallback(async (options = {}) => {
    const result = await loadMasterlistData(options);
    setMasterlistRows(result.rows);
    setMasterlistSource(result.source);
    setMasterlistError(result.error);
    return result.rows;
  }, []);

  const refreshAllData = useCallback(async (options = {}) => {
    const [receiptResult, inventoryResult, masterlistResult] = await Promise.all([
      loadReceiptData(),
      loadInventoryData(),
      loadMasterlistData(options),
    ]);

    setReceiptRows(receiptResult.rows);
    setReceiptError(receiptResult.error);
    setInventoryRows(inventoryResult.rows);
    setInventoryError(inventoryResult.error);
    setMasterlistRows(masterlistResult.rows);
    setMasterlistSource(masterlistResult.source);
    setMasterlistError(masterlistResult.error);

    return {
      receiptRows: receiptResult.rows,
      inventoryRows: inventoryResult.rows,
      masterlistRows: masterlistResult.rows,
    };
  }, []);

  useEffect(() => {
    if (!user) {
      resetData();
      return undefined;
    }

    let active = true;
    setIsBootstrapping(true);
    setHasBootstrapped(false);

    void import('../pages/Dashboard');
    void import('../pages/AdminDashboard');

    const bootstrap = async () => {
      const [receiptResult, inventoryResult, masterlistResult] = await Promise.all([
        loadReceiptData(),
        loadInventoryData(),
        loadMasterlistData({ preferCache: true }),
      ]);

      if (!active) return;

      setReceiptRows(receiptResult.rows);
      setReceiptError(receiptResult.error);
      setInventoryRows(inventoryResult.rows);
      setInventoryError(inventoryResult.error);
      setMasterlistRows(masterlistResult.rows);
      setMasterlistSource(masterlistResult.source);
      setMasterlistError(masterlistResult.error);
      setIsBootstrapping(false);
      setHasBootstrapped(true);
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, [resetData, user]);

  const value = useMemo(() => ({
    receiptRows,
    receiptError,
    inventoryRows,
    inventoryError,
    masterlistRows,
    masterlistSource,
    masterlistError,
    isBootstrapping,
    hasBootstrapped,
    refreshReceiptData,
    refreshInventoryData,
    refreshMasterlistData,
    refreshAllData,
  }), [
    receiptRows,
    receiptError,
    inventoryRows,
    inventoryError,
    masterlistRows,
    masterlistSource,
    masterlistError,
    isBootstrapping,
    hasBootstrapped,
    refreshReceiptData,
    refreshInventoryData,
    refreshMasterlistData,
    refreshAllData,
  ]);

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const context = useContext(AppDataContext);

  if (!context) {
    throw new Error('useAppData must be used within an AppDataProvider.');
  }

  return context;
}
