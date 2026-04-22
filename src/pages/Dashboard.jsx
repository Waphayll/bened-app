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
  applyReceiptRowsToInventory,
  createReceiptRecords,
  listInventoryRecords,
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
const DAILY_SALES_QUOTA = 80000;
const SALES_TARGET_PERIODS = ['day', 'week', 'month'];
const SALES_TARGET_PERIOD_META = {
  day: {
    badge: 'Daily',
    scopeLabel: 'Today',
  },
  week: {
    badge: 'Weekly',
    scopeLabel: 'This week',
  },
  month: {
    badge: 'Monthly',
    scopeLabel: 'This month',
  },
};
const PRODUCT_BAR_COLORS = ['#2d6e3e', '#3a8f50', '#4db368', '#8aab8a', '#d0ddd0'];
const MANUAL_VARIANT_FIELDS = ['unit', 'itemDesc', 'brand'];
const MANUAL_VARIANT_AUTOFILL_ORDER = ['itemDesc', 'unit', 'brand'];
const UNSET_MANUAL_VARIANT_VALUE = '__unset_manual_variant__';

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
    unit: UNSET_MANUAL_VARIANT_VALUE,
    itemDesc: UNSET_MANUAL_VARIANT_VALUE,
    brand: UNSET_MANUAL_VARIANT_VALUE,
    price: '',
    quantity: '',
  };
}

function createReceiptDraft(inputtedBy = 'User') {
  return {
    inputtedBy,
    inputDate: new Date().toISOString().slice(0, 10),
    notes: '',
    scannedLines: [],
    manualRows: [createManualRow()],
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

function formatQuantity(value) {
  if (!Number.isFinite(Number(value))) return 'N/A';
  return Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDateValue(value) {
  if (!value) return 'N/A';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  const rawValue = String(value);
  const hasTime = /T|\d:\d/.test(rawValue);
  return hasTime
    ? parsed.toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : parsed.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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
  const unit = row.ITEM_UNIT || row.item_unit || row.UNIT || row.unit || row.UNIT_OF_MEASUREMENT || row.unit_of_measurement || row.UOM || row.uom || '';
  const itemDesc = row.ITEM_DESC || row.item_desc || row.DESCRIPTION || row.description || row.DESC || row.desc || '';
  const brand = row.BRAND || row.brand || '';
  const defaultPrice = row.DEFAULT_PRICE || row.default_price || row.PRICE || row.price || '';
  const measurement = row.MEASUREMENT || row.measurement || row.MEASUREMENT_UNIT || row.measurement_unit || row.MEASURE || row.measure || row.UNIT_MEASURE || row.unit_measure || '';
  const salesTargetPct = row.SALES_TARGET_PCT || row.sales_target_pct || row.TARGET_PCT || row.target_pct || row.SALES_TARGET || row.sales_target || '';

  if (!itemType || !itemName) return null;

  return {
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

function getReceiptQuantity(record) {
  const parsed = Number(record?.quantity);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getReceiptLineTotal(record) {
  const directTotal = Number(record?.totalPrice);
  if (Number.isFinite(directTotal) && directTotal > 0) return roundMoney(directTotal);

  const price = Number(record?.price);
  const quantity = getReceiptQuantity(record);
  if (Number.isFinite(price) && price > 0 && quantity > 0) {
    return roundMoney(price * quantity);
  }

  return 0;
}

function deriveRevenueByMonth(receiptRecords, year) {
  const totals = Array(MONTH_LABELS.length).fill(0);

  receiptRecords.forEach((record) => {
    const rawDate = record?.inputDate;
    if (!rawDate) return;

    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year) return;

    const monthIndex = date.getMonth();
    if (monthIndex < 0 || monthIndex >= MONTH_LABELS.length) return;

    totals[monthIndex] = roundMoney(totals[monthIndex] + getReceiptLineTotal(record));
  });

  return totals;
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

function getStartOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getStartOfWeek(date) {
  const next = getStartOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function getStartOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getNextSalesTargetPeriod(period) {
  const currentIndex = SALES_TARGET_PERIODS.indexOf(period);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % SALES_TARGET_PERIODS.length : 0;
  return SALES_TARGET_PERIODS[nextIndex];
}

function getSalesTargetWindow(period, referenceDate = new Date()) {
  const current = new Date(referenceDate);
  const meta = SALES_TARGET_PERIOD_META[period] || SALES_TARGET_PERIOD_META.day;

  if (period === 'week') {
    const start = getStartOfWeek(current);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {
      ...meta,
      start,
      end,
      target: DAILY_SALES_QUOTA * 7,
    };
  }

  if (period === 'month') {
    const start = getStartOfMonth(current);
    const end = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
    return {
      ...meta,
      start,
      end,
      target: DAILY_SALES_QUOTA * daysInMonth,
    };
  }

  const start = getStartOfDay(current);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    ...SALES_TARGET_PERIOD_META.day,
    start,
    end,
    target: DAILY_SALES_QUOTA,
  };
}

function deriveSalesTargetMetrics(receiptRecords, period, referenceDate = new Date()) {
  const {
    badge,
    scopeLabel,
    start,
    end,
    target,
  } = getSalesTargetWindow(period, referenceDate);

  const actual = roundMoney(receiptRecords.reduce((total, record) => {
    const rawDate = record?.inputDate;
    if (!rawDate) return total;

    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return total;

    const timestamp = parsed.getTime();
    if (timestamp < start.getTime() || timestamp >= end.getTime()) return total;

    return total + getReceiptLineTotal(record);
  }, 0));

  const progressPct = target > 0 ? roundMoney((actual / target) * 100) : 0;
  const progressBarPct = Math.max(0, Math.min(100, progressPct));
  const remaining = Math.max(0, roundMoney(target - actual));
  const overage = Math.max(0, roundMoney(actual - target));
  const nextPeriod = getNextSalesTargetPeriod(period);
  const nextBadge = SALES_TARGET_PERIOD_META[nextPeriod]?.badge || 'Daily';

  return {
    actual,
    badge,
    nextBadge,
    progressPct,
    progressBarPct,
    scopeLabel,
    target,
    tone: actual >= target ? 'positive' : progressPct >= 50 ? 'muted' : 'negative',
    summary: `${scopeLabel}: ${formatMoney(actual)} / ${formatMoney(target)}`,
    note: actual >= target
      ? `${formatMoney(overage)} above target. Click for ${nextBadge.toLowerCase()} quota.`
      : `${formatMoney(remaining)} left. Click for ${nextBadge.toLowerCase()} quota.`,
  };
}

function deriveCategorySales(receiptRecords) {
  const byCategory = new Map();

  receiptRecords.forEach((record) => {
    const category = String(record?.itemType || '').trim() || 'UNMAPPED';
    const lineTotal = getReceiptLineTotal(record);
    if (lineTotal <= 0) return;

    byCategory.set(category, roundMoney((byCategory.get(category) || 0) + lineTotal));
  });

  const rows = Array.from(byCategory.entries())
    .map(([name, revenue], index) => ({
      name,
      revenue,
      fill: PRODUCT_BAR_COLORS[index % PRODUCT_BAR_COLORS.length],
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const maxRevenue = rows[0]?.revenue || 0;

  return rows.map((row) => ({
    ...row,
    share: maxRevenue > 0 ? roundMoney((row.revenue / maxRevenue) * 100) : 0,
  }));
}

function getInventoryToneColor(badge) {
  if (badge === 'alert') return 'var(--red)';
  if (badge === 'warn') return 'var(--amber)';
  return 'var(--green)';
}

function deriveInventoryOverview(inventoryRows) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const trackedRows = rows.filter((row) => Number.isFinite(row?.currentInv));
  const totalSkusInStock = trackedRows.filter((row) => Number(row.currentInv) > 0).length;
  const lowStockAlertCount = rows.filter((row) => (
    getInventoryStatus(row?.currentInv, row?.maximumInv).inventoryLabel === 'Low Stock'
  )).length;

  return {
    totalSkusInStock,
    lowStockAlertCount,
    trackedSkuCount: trackedRows.length,
  };
}

function deriveInventoryStatusRows(inventoryTableRows, inventoryRows, limit = 7) {
  const preferredRows = (Array.isArray(inventoryTableRows) ? inventoryTableRows : [])
    .filter((row) => Number.isFinite(row?.currentInv) || Number.isFinite(row?.maximumInv));
  const fallbackRows = (Array.isArray(inventoryRows) ? inventoryRows : [])
    .filter((row) => Number.isFinite(row?.currentInv) || Number.isFinite(row?.maximumInv))
    .map((row) => ({
      itemType: row.category || '',
      itemName: row.itemName || '',
      currentInv: row.currentInv,
      maximumInv: row.maximumInv,
    }));
  const sourceRows = preferredRows.length > 0 ? preferredRows : fallbackRows;
  const hasCategoryData = sourceRows.some((row) => String(row?.itemType || '').trim());
  const grouped = new Map();

  sourceRows.forEach((row) => {
    const key = hasCategoryData
      ? String(row?.itemType || '').trim() || 'Uncategorized'
      : String(row?.itemName || '').trim() || 'Unnamed item';
    const currentInv = Number.isFinite(row?.currentInv) ? Number(row.currentInv) : 0;
    const maximumInv = Number.isFinite(row?.maximumInv) ? Number(row.maximumInv) : null;
    const existing = grouped.get(key) || {
      name: key,
      currentInv: 0,
      maximumInv: 0,
      hasMaximumInv: false,
      skuCount: 0,
    };

    existing.currentInv += currentInv;
    existing.skuCount += 1;

    if (Number.isFinite(maximumInv) && maximumInv > 0) {
      existing.maximumInv += maximumInv;
      existing.hasMaximumInv = true;
    }

    grouped.set(key, existing);
  });

  const rows = Array.from(grouped.values())
    .map((row) => {
      const resolvedMaximumInv = row.hasMaximumInv ? row.maximumInv : null;
      const status = getInventoryStatus(row.currentInv, resolvedMaximumInv);
      const skuLabel = hasCategoryData
        ? ` across ${row.skuCount} SKU${row.skuCount === 1 ? '' : 's'}`
        : '';

      return {
        ...row,
        ...status,
        maximumInv: resolvedMaximumInv,
        qtyLabel: `${formatQuantity(row.currentInv)} units${skuLabel}`,
        color: getInventoryToneColor(status.inventoryBadge),
      };
    })
    .sort((a, b) => {
      if (a.currentInv !== b.currentInv) return a.currentInv - b.currentInv;
      if (a.inventoryPct !== b.inventoryPct) return a.inventoryPct - b.inventoryPct;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);

  return {
    groupingLabel: hasCategoryData ? 'category' : 'item',
    rows,
  };
}

function deriveProductPerformance(receiptRecords, limit = 5) {
  const byProduct = new Map();

  receiptRecords.forEach((record) => {
    const productName = String(record?.itemName || '').trim();
    const quantity = getReceiptQuantity(record);
    if (!productName || quantity <= 0) return;

    byProduct.set(productName, roundMoney((byProduct.get(productName) || 0) + quantity));
  });

  return Array.from(byProduct.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
}

function buildInventoryKey(category, itemName) {
  return `${normalizeLookup(category)}::${normalizeLookup(itemName)}`;
}

function buildInventoryDescKey(category, itemName, itemDesc) {
  return [
    normalizeLookup(category),
    normalizeLookup(itemName),
    normalizeLookup(itemDesc),
  ].join('::');
}

function buildInventoryDetailKey(category, itemName, itemDesc, unit) {
  return [
    normalizeLookup(category),
    normalizeLookup(itemName),
    normalizeLookup(itemDesc),
    normalizeLookup(unit),
  ].join('::');
}

function buildInventoryVariantKey(category, itemName, itemDesc, unit, brand) {
  return [
    normalizeLookup(category),
    normalizeLookup(itemName),
    normalizeLookup(itemDesc),
    normalizeLookup(unit),
    normalizeLookup(brand),
  ].join('::');
}

function getVariantFieldText(value) {
  const normalized = String(value || '').trim();
  return normalized || 'Not specified';
}

function normalizeVariantValue(value) {
  return String(value || '').trim();
}

function normalizeManualSelectionValue(value) {
  if (value === UNSET_MANUAL_VARIANT_VALUE) return UNSET_MANUAL_VARIANT_VALUE;
  return normalizeVariantValue(value);
}

function normalizeManualSelection(selection) {
  return MANUAL_VARIANT_FIELDS.reduce((accumulator, field) => ({
    ...accumulator,
    [field]: normalizeManualSelectionValue(selection?.[field]),
  }), {});
}

function getMatchingManualVariants(variants, selection, excludedField = null) {
  if (!Array.isArray(variants) || variants.length === 0) return [];

  const normalizedSelection = normalizeManualSelection(selection);
  return variants.filter((variant) => (
    MANUAL_VARIANT_FIELDS.every((field) => {
      if (field === excludedField) return true;
      const selectedValue = normalizedSelection[field];
      if (selectedValue === UNSET_MANUAL_VARIANT_VALUE) return true;
      return normalizeVariantValue(variant?.[field]) === selectedValue;
    })
  ));
}

function getVariantFieldOptions(variants, field, selection) {
  const seen = new Set();
  const filteredVariants = getMatchingManualVariants(variants, selection, field);
  const sourceVariants = filteredVariants.length > 0 ? filteredVariants : (variants || []);

  return sourceVariants
    .map((variant) => normalizeVariantValue(variant?.[field]))
    .filter((value) => {
      const key = value || '__blank__';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    })
    .map((value) => ({
      value,
      label: getVariantFieldText(value),
    }));
}

function applyManualSelectionDefaults(variants, selection) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return normalizeManualSelection(selection);
  }

  let nextSelection = normalizeManualSelection(selection);

  for (let index = 0; index < MANUAL_VARIANT_AUTOFILL_ORDER.length; index += 1) {
    const field = MANUAL_VARIANT_AUTOFILL_ORDER[index];
    const options = getVariantFieldOptions(variants, field, nextSelection);
    const hasCurrentValue = options.some((option) => option.value === nextSelection[field]);

    if (hasCurrentValue) continue;
    nextSelection = {
      ...nextSelection,
      [field]: options.length === 1 ? options[0].value : UNSET_MANUAL_VARIANT_VALUE,
    };
  }

  return nextSelection;
}

function resolveExactManualVariant(variants, selection) {
  const matches = getMatchingManualVariants(variants, selection);
  return matches.length === 1 ? matches[0] : null;
}

function getManualAvailabilityState(variant, quantity) {
  const requestedQty = Number(quantity);
  const hasRequestedQty = Number.isFinite(requestedQty) && requestedQty > 0;

  if (!variant || !Number.isFinite(variant.currentInv)) {
    return {
      tone: 'unknown',
      selectTone: 'inventory-tone-unknown',
      label: 'Inventory untracked',
      detail: 'No quantity record found yet.',
      help: 'Inventory is not yet tracked for this item, so stock cannot be validated automatically.',
      isBlocked: false,
    };
  }

  const currentInv = Number(variant.currentInv);
  const maxInv = Number(variant.maximumInv);

  if (currentInv <= 0) {
    return {
      tone: 'blocked',
      selectTone: 'inventory-tone-blocked',
      label: 'Out of stock',
      detail: '0 units available',
      help: `${variant.itemName} is out of stock in the inventory table.`,
      isBlocked: true,
    };
  }

  if (hasRequestedQty && requestedQty > currentInv) {
    return {
      tone: 'blocked',
      selectTone: 'inventory-tone-blocked',
      label: 'Insufficient',
      detail: `Only ${formatQuantity(currentInv)} unit${currentInv === 1 ? '' : 's'} available`,
      help: `${variant.itemName} only has ${formatQuantity(currentInv)} unit${currentInv === 1 ? '' : 's'} on hand, which is below the requested quantity of ${formatQuantity(requestedQty)}.`,
      isBlocked: true,
    };
  }

  if (Number.isFinite(maxInv) && maxInv > 0) {
    const pct = Math.max(0, Math.min(100, roundMoney((currentInv / maxInv) * 100)));
    if (pct <= 20) {
      return {
        tone: 'warn',
        selectTone: 'inventory-tone-warn',
        label: 'Low stock',
        detail: `${formatQuantity(currentInv)} of ${formatQuantity(maxInv)} left`,
        help: `${variant.itemName} is low stock with ${formatQuantity(currentInv)} of ${formatQuantity(maxInv)} units remaining.`,
        isBlocked: false,
      };
    }
    if (pct <= 50) {
      return {
        tone: 'warn',
        selectTone: 'inventory-tone-warn',
        label: 'Limited',
        detail: `${formatQuantity(currentInv)} of ${formatQuantity(maxInv)} left`,
        help: `${variant.itemName} has moderate stock with ${formatQuantity(currentInv)} of ${formatQuantity(maxInv)} units remaining.`,
        isBlocked: false,
      };
    }
  }

  return {
    tone: 'ok',
    selectTone: 'inventory-tone-ok',
    label: 'Available',
    detail: `${formatQuantity(currentInv)} unit${currentInv === 1 ? '' : 's'} available`,
    help: `${variant.itemName} has ${formatQuantity(currentInv)} unit${currentInv === 1 ? '' : 's'} available for receipt input.`,
    isBlocked: false,
  };
}

function upsertInventoryEntry(map, key, row) {
  if (!key) return;

  const nextEntry = {
    currentInv: Number.isFinite(row?.currentInv) ? row.currentInv : null,
    maximumInv: Number.isFinite(row?.maximumInv) ? row.maximumInv : null,
  };

  const existing = map.get(key);
  if (!existing) {
    map.set(key, nextEntry);
    return;
  }

  map.set(key, {
    currentInv: Number.isFinite(existing.currentInv) ? existing.currentInv : nextEntry.currentInv,
    maximumInv: Number.isFinite(existing.maximumInv) ? existing.maximumInv : nextEntry.maximumInv,
  });
}

function buildInventoryLookups(inventoryRows) {
  const inventoryByVariantKey = new Map();
  const inventoryByDescKey = new Map();
  const inventoryByExactKey = new Map();
  const inventoryByItemName = new Map();

  inventoryRows.forEach((row) => {
    upsertInventoryEntry(
      inventoryByVariantKey,
      buildInventoryVariantKey(row.category, row.itemName, row.itemDesc, row.unit, row.brand),
      row,
    );
    upsertInventoryEntry(
      inventoryByDescKey,
      buildInventoryDescKey(row.category, row.itemName, row.itemDesc),
      row,
    );
    upsertInventoryEntry(inventoryByExactKey, buildInventoryKey(row.category, row.itemName), row);
    upsertInventoryEntry(inventoryByItemName, normalizeLookup(row.itemName), row);
  });

  return {
    inventoryByVariantKey,
    inventoryByDescKey,
    inventoryByExactKey,
    inventoryByItemName,
  };
}

function addCatalogLookupRow(map, key, row) {
  if (!key || !row || map.has(key)) return;
  map.set(key, row);
}

function buildCatalogRowLookups(rows) {
  const variantByKey = new Map();
  const detailByKey = new Map();
  const descByKey = new Map();
  const exactByKey = new Map();
  const itemNameByKey = new Map();

  (rows || []).forEach((row) => {
    addCatalogLookupRow(
      variantByKey,
      buildInventoryVariantKey(row.itemType, row.itemName, row.itemDesc, row.unit, row.brand),
      row,
    );
    addCatalogLookupRow(
      variantByKey,
      buildInventoryVariantKey('', row.itemName, row.itemDesc, row.unit, row.brand),
      row,
    );
    addCatalogLookupRow(
      detailByKey,
      buildInventoryDetailKey(row.itemType, row.itemName, row.itemDesc, row.unit),
      row,
    );
    addCatalogLookupRow(
      detailByKey,
      buildInventoryDetailKey('', row.itemName, row.itemDesc, row.unit),
      row,
    );
    addCatalogLookupRow(
      descByKey,
      buildInventoryDescKey(row.itemType, row.itemName, row.itemDesc),
      row,
    );
    addCatalogLookupRow(
      descByKey,
      buildInventoryDescKey('', row.itemName, row.itemDesc),
      row,
    );
    addCatalogLookupRow(
      exactByKey,
      buildInventoryKey(row.itemType, row.itemName),
      row,
    );
    addCatalogLookupRow(
      exactByKey,
      buildInventoryKey('', row.itemName),
      row,
    );
    addCatalogLookupRow(itemNameByKey, normalizeLookup(row.itemName), row);
  });

  return {
    variantByKey,
    detailByKey,
    descByKey,
    exactByKey,
    itemNameByKey,
  };
}

function resolveCatalogRowMatch(lookups, category, itemName, itemDesc = '', unit = '', brand = '') {
  if (!lookups) return null;

  const variantMatch = lookups.variantByKey.get(
    buildInventoryVariantKey(category, itemName, itemDesc, unit, brand),
  );
  if (variantMatch) return variantMatch;

  const categorylessVariantMatch = lookups.variantByKey.get(
    buildInventoryVariantKey('', itemName, itemDesc, unit, brand),
  );
  if (categorylessVariantMatch) return categorylessVariantMatch;

  const detailMatch = lookups.detailByKey.get(
    buildInventoryDetailKey(category, itemName, itemDesc, unit),
  );
  if (detailMatch) return detailMatch;

  const categorylessDetailMatch = lookups.detailByKey.get(
    buildInventoryDetailKey('', itemName, itemDesc, unit),
  );
  if (categorylessDetailMatch) return categorylessDetailMatch;

  if (itemDesc) {
    const descMatch = lookups.descByKey.get(buildInventoryDescKey(category, itemName, itemDesc));
    if (descMatch) return descMatch;

    const categorylessDescMatch = lookups.descByKey.get(buildInventoryDescKey('', itemName, itemDesc));
    if (categorylessDescMatch) return categorylessDescMatch;
  }

  const exactMatch = lookups.exactByKey.get(buildInventoryKey(category, itemName));
  if (exactMatch) return exactMatch;

  const categorylessExactMatch = lookups.exactByKey.get(buildInventoryKey('', itemName));
  const itemNameMatch = lookups.itemNameByKey.get(normalizeLookup(itemName));
  return categorylessExactMatch || itemNameMatch || null;
}

function resolveInventoryMatch(lookups, category, itemName, itemDesc = '', unit = '', brand = '') {
  if (!lookups) return null;

  const variantMatch = lookups.inventoryByVariantKey.get(
    buildInventoryVariantKey(category, itemName, itemDesc, unit, brand),
  );
  if (variantMatch) return variantMatch;

  const categorylessVariantMatch = lookups.inventoryByVariantKey.get(
    buildInventoryVariantKey('', itemName, itemDesc, unit, brand),
  );
  if (categorylessVariantMatch) return categorylessVariantMatch;

  if (itemDesc) {
    const descMatch = lookups.inventoryByDescKey.get(buildInventoryDescKey(category, itemName, itemDesc));
    if (descMatch) return descMatch;

    const categorylessDescMatch = lookups.inventoryByDescKey.get(buildInventoryDescKey('', itemName, itemDesc));
    if (categorylessDescMatch) return categorylessDescMatch;
  }

  const exactMatch = lookups.inventoryByExactKey.get(buildInventoryKey(category, itemName));
  if (exactMatch) return exactMatch;

  const categorylessExactMatch = lookups.inventoryByExactKey.get(buildInventoryKey('', itemName));
  const itemNameMatch = lookups.inventoryByItemName.get(normalizeLookup(itemName));
  return categorylessExactMatch || itemNameMatch || null;
}

function deriveManualCatalogRows(masterlistRows, inventoryRows) {
  const catalogLookups = buildCatalogRowLookups(masterlistRows);

  if (Array.isArray(inventoryRows) && inventoryRows.length > 0) {
    const byVariant = new Map();

    inventoryRows.forEach((row) => {
      if (!row?.itemName) return;

      const masterlistMatch = resolveCatalogRowMatch(
        catalogLookups,
        row.category,
        row.itemName,
        row.itemDesc,
        row.unit,
        row.brand,
      );
      const variantKey = buildInventoryVariantKey(
        row.category,
        row.itemName,
        row.itemDesc,
        row.unit,
        row.brand,
      );
      const existing = byVariant.get(variantKey);
      const currentInv = Number.isFinite(row?.currentInv) ? Number(row.currentInv) : 0;
      const maximumInv = Number.isFinite(row?.maximumInv) ? Number(row.maximumInv) : 0;

      if (!existing) {
        byVariant.set(variantKey, {
          itemType: row.category || masterlistMatch?.itemType || '',
          itemName: row.itemName || masterlistMatch?.itemName || '',
          unit: row.unit || masterlistMatch?.unit || '',
          itemDesc: row.itemDesc || masterlistMatch?.itemDesc || '',
          brand: row.brand || masterlistMatch?.brand || '',
          defaultPrice: Number.isFinite(masterlistMatch?.defaultPrice) ? masterlistMatch.defaultPrice : null,
          measurement: masterlistMatch?.measurement || '',
          salesTargetPct: Number.isFinite(masterlistMatch?.salesTargetPct) ? masterlistMatch.salesTargetPct : null,
          currentInv: Number.isFinite(row?.currentInv) ? currentInv : null,
          maximumInv: Number.isFinite(row?.maximumInv) ? maximumInv : null,
        });
        return;
      }

      if (Number.isFinite(row?.currentInv)) {
        existing.currentInv = Number.isFinite(existing.currentInv) ? existing.currentInv + currentInv : currentInv;
      }

      if (Number.isFinite(row?.maximumInv)) {
        existing.maximumInv = Number.isFinite(existing.maximumInv) ? existing.maximumInv + maximumInv : maximumInv;
      }

      if (!Number.isFinite(existing.defaultPrice) && Number.isFinite(masterlistMatch?.defaultPrice)) {
        existing.defaultPrice = masterlistMatch.defaultPrice;
      }

      if (!existing.measurement && masterlistMatch?.measurement) {
        existing.measurement = masterlistMatch.measurement;
      }

      if (!Number.isFinite(existing.salesTargetPct) && Number.isFinite(masterlistMatch?.salesTargetPct)) {
        existing.salesTargetPct = masterlistMatch.salesTargetPct;
      }
    });

    return Array.from(byVariant.values())
      .map((row) => ({
        ...row,
        ...getInventoryStatus(row.currentInv, row.maximumInv),
      }))
      .sort((a, b) => (
        String(a.itemType || '').localeCompare(String(b.itemType || ''))
        || a.itemName.localeCompare(b.itemName)
        || String(a.itemDesc || '').localeCompare(String(b.itemDesc || ''))
        || String(a.unit || '').localeCompare(String(b.unit || ''))
        || String(a.brand || '').localeCompare(String(b.brand || ''))
      ));
  }

  if (!Array.isArray(masterlistRows) || masterlistRows.length === 0) return [];

  const lookups = buildInventoryLookups(inventoryRows);

  return [...masterlistRows]
    .map((row) => {
      const inventoryMatch = resolveInventoryMatch(
        lookups,
        row.itemType,
        row.itemName,
        row.itemDesc,
        row.unit,
        row.brand,
      );
      const currentInv = Number.isFinite(inventoryMatch?.currentInv) ? inventoryMatch.currentInv : null;
      const maximumInv = Number.isFinite(inventoryMatch?.maximumInv) ? inventoryMatch.maximumInv : null;

      return {
        ...row,
        currentInv,
        maximumInv,
        ...getInventoryStatus(currentInv, maximumInv),
      };
    })
    .sort((a, b) => (
      a.itemType.localeCompare(b.itemType)
      || a.itemName.localeCompare(b.itemName)
      || String(a.unit || '').localeCompare(String(b.unit || ''))
      || String(a.itemDesc || '').localeCompare(String(b.itemDesc || ''))
      || String(a.brand || '').localeCompare(String(b.brand || ''))
    ));
}

function getManualItemAvailabilityState(variants, quantity) {
  const states = (variants || []).map((variant) => getManualAvailabilityState(variant, quantity));

  return (
    states.find((state) => state.tone === 'ok')
    || states.find((state) => state.tone === 'warn')
    || states.find((state) => state.tone === 'unknown')
    || states[0]
    || getManualAvailabilityState(null, quantity)
  );
}

function getInventoryStatus(currentInv, maximumInv) {
  if (!Number.isFinite(currentInv)) {
    return { inventoryBadge: 'warn', inventoryLabel: 'No Data', inventoryPct: 0 };
  }

  if (!Number.isFinite(maximumInv) || maximumInv <= 0) {
    return {
      inventoryBadge: currentInv > 0 ? 'ok' : 'warn',
      inventoryLabel: currentInv > 0 ? 'Tracked' : 'No Data',
      inventoryPct: currentInv > 0 ? 100 : 0,
    };
  }

  const inventoryPct = Math.max(0, Math.min(100, roundMoney((currentInv / maximumInv) * 100)));
  if (inventoryPct <= 20) {
    return { inventoryBadge: 'alert', inventoryLabel: 'Low Stock', inventoryPct };
  }
  if (inventoryPct <= 50) {
    return { inventoryBadge: 'warn', inventoryLabel: 'Moderate', inventoryPct };
  }
  return { inventoryBadge: 'ok', inventoryLabel: 'Sufficient', inventoryPct };
}

function getInventoryStatusHelp(row) {
  if (!Number.isFinite(row.currentInv)) {
    return 'No inventory quantity is available for this item yet.';
  }

  if (!Number.isFinite(row.maximumInv) || row.maximumInv <= 0) {
    return `${row.inventoryLabel}: ${formatQuantity(row.currentInv)} units currently tracked, but no maximum stock level is set.`;
  }

  const quantityText = `${formatQuantity(row.currentInv)} of ${formatQuantity(row.maximumInv)} units remaining`;

  if (row.inventoryLabel === 'Low Stock') {
    return `Low Stock: ${quantityText}. This item is at 20% or less of its maximum inventory.`;
  }
  if (row.inventoryLabel === 'Moderate') {
    return `Moderate: ${quantityText}. This item is between 21% and 50% of its maximum inventory.`;
  }
  if (row.inventoryLabel === 'Sufficient') {
    return `Sufficient: ${quantityText}. This item is above 50% of its maximum inventory.`;
  }
  if (row.inventoryLabel === 'Tracked') {
    return `Tracked: ${formatQuantity(row.currentInv)} units are available for this item.`;
  }

  return `${row.inventoryLabel}: ${quantityText}.`;
}

function deriveInventoryTableRows(masterlistRows, inventoryRows) {
  const lookups = buildInventoryLookups(inventoryRows);

  const resolvedRows = masterlistRows.length > 0
    ? masterlistRows.map((row) => {
      const inventoryMatch = resolveInventoryMatch(
        lookups,
        row.itemType,
        row.itemName,
        row.itemDesc,
        row.unit,
        row.brand,
      );

      const currentInv = Number.isFinite(inventoryMatch?.currentInv) ? inventoryMatch.currentInv : null;
      const maximumInv = Number.isFinite(inventoryMatch?.maximumInv) ? inventoryMatch.maximumInv : null;

      return {
        ...row,
        currentInv,
        maximumInv,
      };
    })
    : inventoryRows.map((row) => ({
      itemType: row.category,
      itemName: row.itemName,
      unit: row.unit || '',
      itemDesc: row.itemDesc || '',
      brand: row.brand || '',
      defaultPrice: null,
      measurement: '',
      currentInv: row.currentInv,
      maximumInv: row.maximumInv,
    }));

  return resolvedRows
    .map((row) => ({
      ...row,
      ...getInventoryStatus(row.currentInv, row.maximumInv),
    }))
    .sort((a, b) => (
      a.itemType.localeCompare(b.itemType) || a.itemName.localeCompare(b.itemName)
    ));
}

// ── Masterlist matching helpers ───────────────────────────────────────────

function tokenSet(str) {
  return new Set(
    (str || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  );
}

function tokenOverlapScore(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const t of setA) { if (setB.has(t)) overlap++; }

  // We divide by setB.size to measure "how much of the masterlist item is contained in the OCR text".
  // This prevents long OCR lines from diluting the score.
  // We also add a small bonus (0.01 per token) to favor longer, more specific matches.
  return (overlap / setB.size) + (overlap * 0.01);
}

/** Full Levenshtein edit distance — single-row DP (O(min(n,m)) space). */
function levenshtein(a, b) {
  let la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  // Ensure b is the shorter string to minimise row allocation
  if (la < lb) { [a, b] = [b, a];[la, lb] = [lb, la]; }
  let prev = new Uint16Array(lb + 1);
  let curr = new Uint16Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

/** Normalized Levenshtein similarity: 1 = identical, 0 = completely different. */
function levenshteinSim(a, b) {
  const na = normalizeLookup(a);
  const nb = normalizeLookup(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

/**
 * Build a character-level diff between ocrText and masterlistName.
 * Returns an array of { text, type } where type is 'match'|'insert'|'delete'.
 * Used to render inline highlights showing what the OCR got wrong.
 */
function charDiff(ocrText, masterText) {
  const a = (ocrText || '').toUpperCase();
  const b = (masterText || '').toUpperCase();
  const la = a.length, lb = b.length;

  // Build LCS table
  const dp = Array.from({ length: la + 1 }, () => new Uint16Array(lb + 1));
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Traceback
  const ops = [];
  let i = la, j = lb;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ ch: b[j - 1], type: 'match' }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ ch: b[j - 1], type: 'insert' }); j--;
    } else {
      ops.push({ ch: a[i - 1], type: 'delete' }); i--;
    }
  }
  ops.reverse();

  // Merge consecutive same-type spans
  const spans = [];
  for (const op of ops) {
    if (spans.length && spans[spans.length - 1].type === op.type) {
      spans[spans.length - 1].text += op.ch;
    } else {
      spans.push({ text: op.ch, type: op.type });
    }
  }
  return spans;
}

const UNIT_ALIASES = {
  PIECE: 'PCS', PIECES: 'PCS', PC: 'PCS', PCS: 'PCS',
  BOX: 'BOX', BOXES: 'BOX',
  SET: 'SET', SETS: 'SET',
  ROLL: 'ROLL', ROLLS: 'ROLL',
  KG: 'KG', KGS: 'KG', KILO: 'KG', KILOS: 'KG',
  GRAM: 'G', GRAMS: 'G', G: 'G',
  LITER: 'L', LITERS: 'L', LTR: 'L', LTRS: 'L', L: 'L',
  ML: 'ML', MILLILITER: 'ML',
  METER: 'M', METERS: 'M', MTR: 'M', MTRS: 'M', M: 'M',
  FT: 'FT', FEET: 'FT', FOOT: 'FT',
  UNIT: 'UNIT', UNITS: 'UNIT',
  BAG: 'BAG', BAGS: 'BAG',
  PACK: 'PACK', PACKS: 'PACK',
  CTN: 'CTN', CARTON: 'CTN', CARTONS: 'CTN',
};

function normalizeUnit(unit) {
  const compact = (unit || '').toUpperCase().replace(/[.\s]+/g, '');
  return UNIT_ALIASES[compact] || compact;
}

/**
 * Score one OCR product string against one masterlist row.
 * 
 * OCR receipt lines are typically long and noisy (e.g. "300 PCS real steel 058 G3 10mm 147.84 30,586.24")
 * while masterlist entries are short and clean (e.g. brand="REAL STEEL", name="058 G3 10mm", unit="PCS").
 * 
 * We therefore heavily weight composite token containment (does the OCR line contain the words
 * from brand + name + desc + unit?) and use Levenshtein only as a minor tiebreaker.
 * 
 * Weights: composite token containment 0.70, Levenshtein 0.15, desc bonus 0.10, unit bonus ±0.15
 */
function scoreItemAgainstRow(productName, ocrUnit, row) {
  const mlName = row.itemName || '';
  const mlBrand = row.brand || '';
  const mlDesc = row.itemDesc || '';
  const mlUnit = normalizeUnit(row.unit || '');
  const normOcrUnit = normalizeUnit(ocrUnit);

  // Build a composite string: brand + name + description + unit.
  // This lets the OCR line "300 PCS real steel 058 G3 10mm" match a row where
  // brand="REAL STEEL", name="058 G3", unit="PCS", desc="10mm".
  const compositeName = [mlBrand, mlName, mlDesc, row.unit || ''].filter(Boolean).join(' ');

  // Token containment: what fraction of the masterlist composite words are found in the OCR text?
  const compositeTokSim = Math.min(tokenOverlapScore(productName, compositeName), 1.0);

  // Levenshtein: only between OCR text and itemName (minor tiebreaker)
  const levSim = levenshteinSim(productName, mlName);

  // Also try Levenshtein against just the name portion for short clean inputs
  const nameTokSim = Math.min(tokenOverlapScore(productName, mlName), 1.0);

  // Primary score: composite containment dominates
  let nameScore = compositeTokSim * 0.70 + Math.max(levSim, nameTokSim) * 0.15;
  nameScore = Math.min(nameScore, 0.90);

  let descScore = 0;
  if (mlDesc) {
    const descLev = levenshteinSim(productName, mlDesc);
    descScore = Math.min(descLev * 0.10, 0.10);
  }

  let unitMatch = null;
  let unitBonus = 0;
  if (normOcrUnit && mlUnit) {
    unitMatch = normOcrUnit === mlUnit;
    unitBonus = unitMatch ? 0.15 : -0.10;
  }

  return {
    score: Math.max(0, nameScore + descScore + unitBonus),
    nameScore: Math.round(nameScore * 100),
    levSim: Math.round(levSim * 100),
    tokSim: Math.round(compositeTokSim * 100),
    unitMatch,
  };
}

const MASTERLIST_MATCH_THRESHOLD = 0.30;
const TOP_CANDIDATES_COUNT = 3;

/**
 * Score all masterlist rows against an OCR product and return the top N candidates,
 * each annotated with score metadata and a character-level diff.
 */
function rankMasterlistCandidates(productName, ocrUnit, masterlistRows) {
  if (!productName || !Array.isArray(masterlistRows) || masterlistRows.length === 0) return [];

  const scored = [];
  const rows = masterlistRows.filter((r) => r.itemName);
  for (let i = 0; i < rows.length; i++) {
    const meta = scoreItemAgainstRow(productName, ocrUnit, rows[i]);
    scored.push({ row: rows[i], ...meta });
    // Early exit on near-perfect match — no need to score the rest
    if (meta.score >= 0.92) break;
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_CANDIDATES_COUNT).map((entry) => ({
    ...entry,
    diff: charDiff(productName, entry.row.itemName),
  }));
}

/**
 * Find the best-matching masterlist row for an OCR-extracted product.
 *
 * Accepts two call signatures for backward compatibility:
 *   findMasterlistMatch(productName, masterlistRows)          – no unit
 *   findMasterlistMatch(productName, ocrUnit, masterlistRows) – with unit
 */
function findMasterlistMatch(productName, ocrUnitOrRows, masterlistRowsArg) {
  let ocrUnit = '';
  let masterlistRows = masterlistRowsArg;
  if (Array.isArray(ocrUnitOrRows)) {
    masterlistRows = ocrUnitOrRows;
  } else {
    ocrUnit = ocrUnitOrRows || '';
  }

  const candidates = rankMasterlistCandidates(productName, ocrUnit, masterlistRows);
  if (candidates.length === 0 || candidates[0].score < MASTERLIST_MATCH_THRESHOLD) return null;

  const best = candidates[0];
  return {
    ...best.row,
    _matchScore: best.score,
    _nameScore: best.nameScore,
    _levSim: best.levSim,
    _unitMatch: best.unitMatch,
    _candidates: candidates,
  };
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

function SalesChart({ mode, orderCountsByMonth, revenueByMonth }) {
  const showingRevenue = mode === 'Revenue';
  const dataSeries = showingRevenue ? revenueByMonth : orderCountsByMonth;

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

function ProductChart({ products }) {
  const data = {
    labels: products.map((product) => product.name),
    datasets: [{
      label: 'Units Sold',
      data: products.map((product) => product.quantity),
      backgroundColor: products.map((_, index) => PRODUCT_BAR_COLORS[index % PRODUCT_BAR_COLORS.length]),
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
        callbacks: {
          label: (ctx) => ` ${ctx.parsed.y.toLocaleString()} units`,
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
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
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [isSendingReceipt, setIsSendingReceipt] = useState(false);
  const [receiptRows, setReceiptRows] = useState([]);
  const [receiptError, setReceiptError] = useState('');
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryError, setInventoryError] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState('All');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState('All');
  const [masterlistRows, setMasterlistRows] = useState([]);
  const [masterlistSource, setMasterlistSource] = useState('');
  const [masterlistError, setMasterlistError] = useState('');
  const [salesTargetPeriod, setSalesTargetPeriod] = useState('day');

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

  const orderCountsByMonth = useMemo(() => (
    deriveOrderCountsByMonth(receiptRows, currentYear)
  ), [currentYear, receiptRows]);

  const revenueByMonth = useMemo(() => (
    deriveRevenueByMonth(receiptRows, currentYear)
  ), [currentYear, receiptRows]);

  const totalRevenue = useMemo(() => (
    roundMoney(receiptRows.reduce((total, record) => total + getReceiptLineTotal(record), 0))
  ), [receiptRows]);

  const salesTargetMetrics = useMemo(() => (
    deriveSalesTargetMetrics(receiptRows, salesTargetPeriod)
  ), [receiptRows, salesTargetPeriod]);

  const salesByCategory = useMemo(() => (
    deriveCategorySales(receiptRows)
  ), [receiptRows]);

  const productPerformance = useMemo(() => (
    deriveProductPerformance(receiptRows)
  ), [receiptRows]);

  const salesTableRows = useMemo(() => (
    [...receiptRows].sort((a, b) => {
      const aTime = new Date(a?.inputDate || 0).getTime();
      const bTime = new Date(b?.inputDate || 0).getTime();
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    })
  ), [receiptRows]);

  const inventoryTableRows = useMemo(() => (
    deriveInventoryTableRows(masterlistRows, inventoryRows)
  ), [inventoryRows, masterlistRows]);

  const inventoryOverview = useMemo(() => (
    deriveInventoryOverview(inventoryRows)
  ), [inventoryRows]);

  const inventoryStatusData = useMemo(() => (
    deriveInventoryStatusRows(inventoryTableRows, inventoryRows)
  ), [inventoryRows, inventoryTableRows]);

  const manualCatalogRows = useMemo(() => (
    deriveManualCatalogRows(masterlistRows, inventoryRows)
  ), [inventoryRows, masterlistRows]);

  const itemTypeOptions = useMemo(() => (
    Array.from(new Set(manualCatalogRows.map((row) => row.itemType).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
  ), [manualCatalogRows]);

  const manualItemOptionsByType = useMemo(() => {
    const byType = new Map();

    manualCatalogRows.forEach((row) => {
      if (!byType.has(row.itemType)) byType.set(row.itemType, new Set());
      const entries = byType.get(row.itemType);
      if (row.itemName) {
        entries.add(row.itemName);
      }
    });

    const resolved = new Map();
    byType.forEach((items, itemType) => {
      resolved.set(
        itemType,
        Array.from(items.values()).sort((a, b) => a.localeCompare(b)),
      );
    });

    return resolved;
  }, [manualCatalogRows]);

  const manualVariantsByItemKey = useMemo(() => {
    const byItem = new Map();

    manualCatalogRows.forEach((row) => {
      const key = buildInventoryKey(row.itemType, row.itemName);
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(row);
    });

    byItem.forEach((rows, key) => {
      byItem.set(
        key,
        [...rows].sort((a, b) => (
          a.itemName.localeCompare(b.itemName)
          || String(a.unit || '').localeCompare(String(b.unit || ''))
          || String(a.itemDesc || '').localeCompare(String(b.itemDesc || ''))
          || String(a.brand || '').localeCompare(String(b.brand || ''))
        )),
      );
    });

    return byItem;
  }, [manualCatalogRows]);

  const inventoryCategories = useMemo(() => (
    Array.from(new Set(inventoryTableRows.map((row) => row.itemType).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
  ), [inventoryTableRows]);

  const filteredInventoryRows = useMemo(() => {
    const searchNeedle = normalizeLookup(inventorySearch);

    return inventoryTableRows.filter((row) => {
      if (inventoryCategoryFilter !== 'All' && row.itemType !== inventoryCategoryFilter) {
        return false;
      }

      if (inventoryStatusFilter !== 'All' && row.inventoryLabel !== inventoryStatusFilter) {
        return false;
      }

      if (!searchNeedle) return true;

      const haystack = [
        row.itemType,
        row.itemName,
        row.unit,
        row.itemDesc,
        row.brand,
        row.measurement,
      ]
        .filter(Boolean)
        .map((value) => normalizeLookup(value))
        .join(' ');

      return haystack.includes(searchNeedle);
    });
  }, [inventoryCategoryFilter, inventorySearch, inventoryStatusFilter, inventoryTableRows]);

  const totalOrdersInGraphWindow = useMemo(() => (
    orderCountsByMonth.reduce((total, value) => total + value, 0)
  ), [orderCountsByMonth]);

  const pageTitle = activeNav === 'Sales'
    ? 'Sales'
    : activeNav === 'Inventory'
      ? 'Inventory'
      : 'Sales & Inventory Overview';

  const pageSubtitle = activeNav === 'Sales'
    ? 'Receipt rows from the Appwrite receipts table'
    : activeNav === 'Inventory'
      ? 'Masterlist rows joined with quantities from the Appwrite inventory table'
      : 'Fiscal Year 2026 · Q1 Performance';

  const showReceiptActions = activeNav !== 'Inventory';

  const cycleSalesTargetPeriod = () => {
    setSalesTargetPeriod((current) => getNextSalesTargetPeriod(current));
  };

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

  const refreshReceiptData = async () => {
    setReceiptError('');
    try {
      const records = await listReceiptRecords();
      setReceiptRows(records);
    } catch (error) {
      console.error('Unable to load receipt records for dashboard panels:', error);
      setReceiptRows([]);
      setReceiptError(error?.message || 'Unable to load receipt records from the database.');
    }
  };

  useEffect(() => {
    refreshReceiptData();
  }, []);

  const refreshInventoryData = async () => {
    setInventoryError('');
    try {
      const records = await listInventoryRecords();
      setInventoryRows(records);
    } catch (error) {
      console.error('Unable to load inventory records for dashboard panels:', error);
      setInventoryRows([]);
      setInventoryError(error?.message || 'Unable to load inventory records from the database.');
    }
  };

  useEffect(() => {
    refreshInventoryData();
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
    setOrderFormError('');
    setReceiptUploadError('');
    setIsSendingReceipt(false);
    setIsUploadingReceipt(false);
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
      unit: UNSET_MANUAL_VARIANT_VALUE,
      itemDesc: UNSET_MANUAL_VARIANT_VALUE,
      brand: UNSET_MANUAL_VARIANT_VALUE,
      price: '',
    });
  };

  const handleManualItemNameChange = (rowId, itemName) => {
    const row = receiptDraft.manualRows.find((item) => item.id === rowId);
    const variants = manualVariantsByItemKey.get(buildInventoryKey(row?.itemType || '', itemName)) || [];
    const nextSelection = applyManualSelectionDefaults(variants, {
      unit: UNSET_MANUAL_VARIANT_VALUE,
      itemDesc: UNSET_MANUAL_VARIANT_VALUE,
      brand: UNSET_MANUAL_VARIANT_VALUE,
    });
    const selected = resolveExactManualVariant(variants, nextSelection);
    updateManualRow(rowId, {
      itemName,
      unit: nextSelection.unit,
      itemDesc: nextSelection.itemDesc,
      brand: nextSelection.brand,
      price: Number.isFinite(selected?.defaultPrice) ? String(selected.defaultPrice) : '',
    });
  };

  const handleManualVariantFieldChange = (rowId, field, value) => {
    const row = receiptDraft.manualRows.find((item) => item.id === rowId);
    const variants = manualVariantsByItemKey.get(buildInventoryKey(row?.itemType || '', row?.itemName || '')) || [];

    if (!row || variants.length === 0) {
      updateManualRow(rowId, { [field]: value });
      return;
    }

    const nextSelection = {
      unit: field === 'unit' ? value : (row.unit ?? UNSET_MANUAL_VARIANT_VALUE),
      itemDesc: field === 'itemDesc' ? value : (row.itemDesc ?? UNSET_MANUAL_VARIANT_VALUE),
      brand: field === 'brand' ? value : (row.brand ?? UNSET_MANUAL_VARIANT_VALUE),
    };
    const normalizedSelection = applyManualSelectionDefaults(variants, nextSelection);
    const selected = resolveExactManualVariant(variants, normalizedSelection);

    updateManualRow(rowId, {
      unit: normalizedSelection.unit,
      itemDesc: normalizedSelection.itemDesc,
      brand: normalizedSelection.brand,
      price: Number.isFinite(selected?.defaultPrice) ? String(selected.defaultPrice) : '',
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

  const handleReceiptDictionaryUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setReceiptUploadError('Only image files are allowed for receipt upload.');
      return;
    }

    setReceiptUploadError('');
    setIsUploadingReceipt(true);

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

      const rawText = payload.text || '';
      let lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 1);

      if (lines.length > 0) {
        // Find the header line to filter out store info, address, etc.
        const headerIndex = lines.findIndex(l => {
          const lower = l.toLowerCase();
          // Look for common table headers on receipts
          return lower.includes('quantity') || lower.includes('qty') ||
            lower.includes('unit') || lower.includes('item') ||
            lower.includes('desc');
        });

        // If we found a header, and it's not in the bottom 20% of the receipt 
        // (to avoid cutting off the whole receipt if 'item' is used at the very bottom like 'Total items: 5')
        if (headerIndex !== -1 && headerIndex < lines.length * 0.8) {
          lines = lines.slice(headerIndex + 1);
        }

        setReceiptDraft(prev => ({
          ...prev,
          scannedLines: lines,
        }));
      } else {
        setReceiptUploadError('No text could be read from the receipt.');
      }

    } catch (error) {
      setReceiptUploadError(error?.message || 'Unable to extract receipt text.');
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const handleAddLineAsItem = (line) => {
    const match = findMasterlistMatch(line, '', masterlistRows);
    console.log('[OCR Match]', { line, match, matchScore: match?._matchScore, matchName: match?.itemName, matchBrand: match?.brand });

    let newRow;
    if (match) {
      const variants = manualVariantsByItemKey.get(buildInventoryKey(match.itemType, match.itemName)) || [];
      const nextSelection = applyManualSelectionDefaults(variants, {
        unit: UNSET_MANUAL_VARIANT_VALUE,
        itemDesc: UNSET_MANUAL_VARIANT_VALUE,
        brand: UNSET_MANUAL_VARIANT_VALUE,
      });
      const selected = resolveExactManualVariant(variants, nextSelection);

      newRow = {
        ...createManualRow(),
        itemType: match.itemType,
        itemName: match.itemName,
        unit: nextSelection.unit,
        itemDesc: nextSelection.itemDesc,
        brand: nextSelection.brand,
        quantity: '1',
        price: Number.isFinite(selected?.defaultPrice) ? String(selected.defaultPrice) : '',
      };
    } else {
      newRow = createManualRow();
      // Optional: if we want to store the line as a hint, we could put it in a temporary field, but for now just an empty row.
    }

    setReceiptDraft((prev) => {
      const currentRows = prev.manualRows;
      const isFirstEmpty = currentRows.length === 1 && !currentRows[0].itemName && !currentRows[0].itemType;
      return {
        ...prev,
        manualRows: isFirstEmpty ? [newRow] : [...currentRows, newRow],
      };
    });
  };

  const handleSendReceipt = async (event) => {
    event.preventDefault();
    if (isSendingReceipt) return;

    setOrderFormError('');
    let rowsToCreate = [];

    const manualErrors = [];
    const normalizedRows = receiptDraft.manualRows
      .map((row, index) => {
        const quantity = Number(row.quantity);
        const variants = manualVariantsByItemKey.get(buildInventoryKey(row.itemType, row.itemName)) || [];
        const matchingVariants = getMatchingManualVariants(variants, row);
        const selectedVariant = resolveExactManualVariant(variants, row);

        if (!row.itemType || !row.itemName) {
          manualErrors.push(`Row ${index + 1}: select both an item type and item name.`);
          return null;
        }

        if (matchingVariants.length !== 1 || !selectedVariant) {
          manualErrors.push(`Row ${index + 1}: choose a valid unit, description, and brand for ${row.itemName}.`);
          return null;
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
          manualErrors.push(`Row ${index + 1}: enter a quantity greater than 0.`);
          return null;
        }

        const price = Number(selectedVariant.defaultPrice ?? row.price);
        if (!Number.isFinite(price) || price <= 0) {
          manualErrors.push(`Row ${index + 1}: ${row.itemName} has no automatic price in the masterlist.`);
          return null;
        }

        const availability = getManualAvailabilityState(selectedVariant, quantity);
        if (availability.isBlocked) {
          manualErrors.push(`Row ${index + 1}: ${availability.help}`);
          return null;
        }

        const totalPrice = roundMoney(price * quantity);
        return {
          INPUT_BY: receiptDraft.inputtedBy,
          INPUT_DATE: receiptDraft.inputDate,
          ITEM_NAME: selectedVariant.itemName,
          ITEM_TYPE: selectedVariant.itemType,
          ITEM_UNIT: selectedVariant.unit || '',
          ITEM_DESC: selectedVariant.itemDesc || '',
          BRAND: selectedVariant.brand || '',
          PRICE: roundMoney(price),
          QUANTITY: quantity,
          TOTAL_PRICE: totalPrice,
        };
      })
      .filter(Boolean);

    if (manualErrors.length > 0) {
      setOrderFormError(manualErrors[0]);
      return;
    }

    if (normalizedRows.length === 0) {
      setOrderFormError('Add at least one valid manual row before sending.');
      return;
    }

    rowsToCreate = normalizedRows;

    setIsSendingReceipt(true);
    try {
      const createdCount = await createReceiptRecords(rowsToCreate);
      let inventoryMessage = '';

      try {
        const inventoryUpdate = await applyReceiptRowsToInventory(rowsToCreate);
        const skippedNote = inventoryUpdate.skippedItemCount > 0
          ? ` ${inventoryUpdate.skippedItemCount} item${inventoryUpdate.skippedItemCount === 1 ? '' : 's'} had no inventory match.`
          : '';

        inventoryMessage = ` Updated inventory for ${inventoryUpdate.matchedItemCount} item${inventoryUpdate.matchedItemCount === 1 ? '' : 's'}.${skippedNote}`;
      } catch (inventoryError) {
        inventoryMessage = ` Inventory update failed: ${inventoryError?.message || 'unknown error'}.`;
      }

      await Promise.allSettled([refreshReceiptData(), refreshInventoryData()]);
      setOrderFeedback(
        `Sent ${createdCount} receipt row${createdCount === 1 ? '' : 's'} to receipts DB.${inventoryMessage}`,
      );
      closeReceiptModal();
    } catch (error) {
      setOrderFormError(error?.message || 'Failed to send receipt records to the database.');
    } finally {
      setIsSendingReceipt(false);
    }
  };

  const navItems = ['Dashboard', 'Sales', 'Inventory'];

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
          <h1 className="page-title">{pageTitle}</h1>
          <p className="page-sub">{pageSubtitle}</p>
          {orderFeedback && <p className="order-feedback">{orderFeedback}</p>}
        </div>
        <div className="header-actions">
          <button className="btn-outline">Export Report</button>
          {showReceiptActions && (
            <button className="btn-solid" onClick={openReceiptModal}>Input Receipt</button>
          )}
        </div>
      </div>

      <main className="dash-main">
        {activeNav === 'Dashboard' && (
          <>
            <section className="kpi-strip">
              <div className="kpi-card" style={{ '--delay': '0.05s' }}>
                <div className="kpi-label">Total Revenue</div>
                <div className="kpi-value">{formatMoney(totalRevenue)}</div>
                <div className="kpi-delta positive">Based on receipt rows in the database</div>
              </div>
              <div className="kpi-card" style={{ '--delay': '0.1s' }}>
                <div className="kpi-label">Orders Fulfilled</div>
                <div className="kpi-value">{totalOrdersInGraphWindow.toLocaleString()}</div>
                <div className="kpi-delta positive">Based on receipt rows for Jan–Jun {currentYear}</div>
              </div>
              <button
                type="button"
                className="kpi-card kpi-card-button"
                style={{ '--delay': '0.15s' }}
                onClick={cycleSalesTargetPeriod}
                aria-label={`Sales target card showing ${salesTargetMetrics.badge.toLowerCase()} quota. Click to switch to ${salesTargetMetrics.nextBadge.toLowerCase()} quota.`}
                title={`Click to switch to ${salesTargetMetrics.nextBadge.toLowerCase()} quota.`}
              >
                <div className="kpi-card-head">
                  <div className="kpi-label">Sales Target</div>
                  <span className="kpi-chip">{salesTargetMetrics.badge}</span>
                </div>
                <div className="kpi-value">{salesTargetMetrics.progressPct.toFixed(1)}%</div>
                <div className={`kpi-delta ${salesTargetMetrics.tone}`}>{salesTargetMetrics.summary}</div>
                <div className="kpi-progress">
                  <div
                    className="kpi-progress-bar"
                    style={{ width: `${salesTargetMetrics.progressBarPct}%` }}
                  />
                </div>
                <div className="kpi-note">{salesTargetMetrics.note}</div>
              </button>
              <div className="kpi-card" style={{ '--delay': '0.2s' }}>
                <div className="kpi-label">Total SKUs in Stock</div>
                <div className="kpi-value">{inventoryOverview.totalSkusInStock.toLocaleString()}</div>
                <div className={`kpi-delta ${inventoryOverview.lowStockAlertCount > 0 ? 'negative' : 'positive'}`}>
                  {inventoryOverview.lowStockAlertCount > 0
                    ? `▼ ${inventoryOverview.lowStockAlertCount} low-stock alert${inventoryOverview.lowStockAlertCount === 1 ? '' : 's'}`
                    : `Based on ${inventoryOverview.trackedSkuCount.toLocaleString()} tracked SKU${inventoryOverview.trackedSkuCount === 1 ? '' : 's'} in the database`}
                </div>
              </div>
            </section>

            <section className="row-two">
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Monthly Sales Overview</div>
                    <div className="panel-sub">
                      {activeTab === 'Revenue'
                        ? `Revenue (₱) — January to June ${currentYear}`
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
                  <SalesChart
                    mode={activeTab}
                    orderCountsByMonth={orderCountsByMonth}
                    revenueByMonth={revenueByMonth}
                  />
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Inventory Status</div>
                    <div className="panel-sub">
                      {`Stock levels by ${inventoryStatusData.groupingLabel} · lowest quantity first`}
                    </div>
                  </div>
                </div>
                {inventoryStatusData.rows.length > 0 ? (
                  <div className="inv-list">
                    {inventoryStatusData.rows.map((item) => (
                      <div className="inv-row" key={item.name}>
                        <div className="inv-info">
                          <span className="inv-name">{item.name}</span>
                          <span className="inv-qty">{item.qtyLabel}</span>
                        </div>
                        <div className="inv-bar-wrap">
                          <div
                            className="inv-bar"
                            style={{ width: `${item.inventoryPct}%`, background: item.color }}
                          />
                        </div>
                        <span className={`inv-badge ${item.inventoryBadge}`}>{item.inventoryLabel}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel-empty-state">
                    <p>{inventoryError || 'No inventory rows found in the database yet.'}</p>
                  </div>
                )}
              </div>
            </section>

            <section className="row-three">
              <div className="panel panel-performance">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Product Performance</div>
                    <div className="panel-sub">Top 5 by units sold from receipts database</div>
                  </div>
                </div>
                {productPerformance.length > 0 ? (
                  <div className="chart-area chart-area-sm">
                    <ProductChart products={productPerformance} />
                  </div>
                ) : (
                  <div className="panel-empty-state">
                    <p>{receiptError || 'No receipt rows yet for product performance.'}</p>
                  </div>
                )}
              </div>

              <div className="panel panel-targets">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Sales</div>
                    <div className="panel-sub">Total revenue per category from receipts database</div>
                  </div>
                </div>
                <div className="target-list">
                  {salesByCategory.length > 0 ? (
                    salesByCategory.map((category) => (
                      <div className="target-row" key={category.name}>
                        <div className="target-label">
                          <span className="target-name">{category.name}</span>
                          <span className="target-pct">{formatMoney(category.revenue)}</span>
                        </div>
                        <div className="target-track">
                          <div
                            className="target-fill"
                            style={{ width: `${category.share}%`, background: category.fill }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="panel-list-message">{receiptError || 'No receipt revenue yet by category.'}</p>
                  )}
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
          </>
        )}

        {activeNav === 'Sales' && (
          <section className="panel table-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Receipts Table</div>
                <div className="panel-sub">
                  {salesTableRows.length.toLocaleString()} receipt row{salesTableRows.length === 1 ? '' : 's'} from the database
                </div>
              </div>
            </div>
            {salesTableRows.length > 0 ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Input By</th>
                      <th>Input Date</th>
                      <th>Item Name</th>
                      <th>Category</th>
                      <th className="table-num">Price</th>
                      <th className="table-num">Quantity</th>
                      <th className="table-num">Total Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesTableRows.map((row, index) => (
                      <tr key={`${row.inputDate}-${row.itemName}-${index}`}>
                        <td>{row.inputBy || 'N/A'}</td>
                        <td>{formatDateValue(row.inputDate)}</td>
                        <td>{row.itemName || 'N/A'}</td>
                        <td>{row.itemType || 'UNMAPPED'}</td>
                        <td className="table-num">{formatMoney(row.price)}</td>
                        <td className="table-num">{formatQuantity(row.quantity)}</td>
                        <td className="table-num">{formatMoney(getReceiptLineTotal(row))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel-empty-state">
                <p>{receiptError || 'No receipt rows found in the receipts table.'}</p>
              </div>
            )}
          </section>
        )}

        {activeNav === 'Inventory' && (
          <section className="inventory-layout">
            <aside className="panel inventory-sidebar">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Filters</div>
                  <div className="panel-sub">Search and narrow the inventory list</div>
                </div>
              </div>
              <div className="inventory-sidebar-body">
                <label className="inventory-filter-field">
                  <span className="inventory-filter-label">Search</span>
                  <input
                    type="search"
                    value={inventorySearch}
                    onChange={(event) => setInventorySearch(event.target.value)}
                    placeholder="Item, brand, description..."
                  />
                </label>

                <label className="inventory-filter-field">
                  <span className="inventory-filter-label">Category</span>
                  <select
                    value={inventoryCategoryFilter}
                    onChange={(event) => setInventoryCategoryFilter(event.target.value)}
                  >
                    <option value="All">All Categories</option>
                    {inventoryCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>

                <label className="inventory-filter-field">
                  <span className="inventory-filter-label">Status</span>
                  <select
                    value={inventoryStatusFilter}
                    onChange={(event) => setInventoryStatusFilter(event.target.value)}
                  >
                    <option value="All">All Statuses</option>
                    {['Sufficient', 'Moderate', 'Low Stock', 'Tracked', 'No Data'].map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>

                <div className="inventory-filter-summary">
                  <strong>{filteredInventoryRows.length.toLocaleString()}</strong> of{' '}
                  {inventoryTableRows.length.toLocaleString()} items shown
                </div>

                <button
                  type="button"
                  className="btn-outline inventory-reset-btn"
                  onClick={() => {
                    setInventorySearch('');
                    setInventoryCategoryFilter('All');
                    setInventoryStatusFilter('All');
                  }}
                >
                  Reset Filters
                </button>
              </div>
            </aside>

            <section className="panel table-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Masterlist With Inventory Quantity</div>
                  <div className="panel-sub">
                    {filteredInventoryRows.length.toLocaleString()} visible item{filteredInventoryRows.length === 1 ? '' : 's'} · masterlist source: {masterlistSource || 'unavailable'}
                  </div>
                </div>
              </div>
              {(masterlistError || inventoryError) && (
                <div className="table-panel-note">
                  {masterlistError && <p>Masterlist: {masterlistError}</p>}
                  {inventoryError && <p>Inventory: {inventoryError}</p>}
                </div>
              )}
              {filteredInventoryRows.length > 0 ? (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Item Name</th>
                        <th>Item Unit</th>
                        <th>Description</th>
                        <th>Brand</th>
                        <th className="table-num">Price</th>
                        <th>Measure</th>
                        <th className="table-num">Current Qty</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInventoryRows.map((row, index) => (
                        <tr key={`${row.itemType}-${row.itemName}-${index}`}>
                          <td>{row.itemType || 'N/A'}</td>
                          <td>{row.itemName || 'N/A'}</td>
                          <td>{row.unit || 'N/A'}</td>
                          <td>{row.itemDesc || 'N/A'}</td>
                          <td>{row.brand || 'N/A'}</td>
                          <td className="table-num">{formatMoney(row.defaultPrice)}</td>
                          <td>{row.measurement || 'N/A'}</td>
                          <td className="table-num">{formatQuantity(row.currentInv)}</td>
                          <td>
                            <div
                              className="inventory-status-cell"
                              title={getInventoryStatusHelp(row)}
                              aria-label={getInventoryStatusHelp(row)}
                            >
                              <div className="inventory-status-track">
                                <div
                                  className={`inventory-status-fill ${row.inventoryBadge}`}
                                  style={{ width: `${row.inventoryPct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="panel-empty-state">
                  <p>{masterlistError || inventoryError || 'No inventory rows match the current filters.'}</p>
                </div>
              )}
            </section>
          </section>
        )}
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
                  Manually enter rows or upload a receipt image to auto-fill them, then send to DB.
                </p>
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

              <div className="order-items">
                <div className="order-items-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="order-section-title">Receipt Rows</h3>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      ref={receiptInputRef}
                      onChange={handleReceiptDictionaryUpload}
                    />
                    <button
                      type="button"
                      className="btn-outline btn-inline"
                      onClick={() => receiptInputRef.current?.click()}
                      disabled={isUploadingReceipt}
                    >
                      {isUploadingReceipt ? 'Scanning...' : '📷 Upload Receipt'}
                    </button>
                    <button type="button" className="btn-outline btn-inline" onClick={addManualRow}>
                      + Add Row
                    </button>
                  </div>
                </div>

                {receiptUploadError && <p className="order-form-error" style={{ marginBottom: '1rem' }}>{receiptUploadError}</p>}

                {receiptDraft.scannedLines && receiptDraft.scannedLines.length > 0 && (
                  <div className="scanned-text-panel" style={{
                    marginBottom: '1.5rem',
                    background: 'rgba(255,255,255,0.8)',
                    padding: '1rem',
                    borderRadius: '8px',
                    border: '1px solid #d0ddd0'
                  }}>
                    <h4 style={{ margin: '0 0 0.75rem 0', color: '#1e4d2b', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Scanned Receipt Lines
                    </h4>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {receiptDraft.scannedLines.map((line, index) => (
                          <li key={index} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.5rem',
                            background: '#fff',
                            borderRadius: '4px',
                            border: '1px solid #e2ece2',
                            fontSize: '0.9rem'
                          }}>
                            <span style={{ color: '#2d6e3e', flex: 1, marginRight: '1rem' }}>{line}</span>
                            <button
                              type="button"
                              className="btn-outline btn-inline"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                              onClick={() => handleAddLineAsItem(line)}
                            >
                              + Add to Rows
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="order-item-list">
                  {receiptDraft.manualRows.map((row, index) => {
                    const itemOptions = manualItemOptionsByType.get(row.itemType) || [];
                    const variants = manualVariantsByItemKey.get(buildInventoryKey(row.itemType, row.itemName)) || [];
                    const matchingVariants = getMatchingManualVariants(variants, row);
                    const selectedVariant = resolveExactManualVariant(variants, row);
                    const unitOptions = getVariantFieldOptions(variants, 'unit', row);
                    const descOptions = getVariantFieldOptions(variants, 'itemDesc', row);
                    const brandOptions = getVariantFieldOptions(variants, 'brand', row);
                    const priceValue = Number(row.price);
                    const rowTotal = roundMoney((Number.isFinite(priceValue) ? priceValue : 0) * Number(row.quantity || 0));
                    const availability = row.itemName && variants.length > 1 && matchingVariants.length !== 1
                      ? {
                        tone: 'unknown',
                        selectTone: 'inventory-tone-unknown',
                        label: 'Choose variant',
                        detail: `${matchingVariants.length || variants.length} possible matches`,
                        help: `Select the exact item description, item unit, and brand for ${row.itemName} before sending this receipt row.`,
                        isBlocked: false,
                      }
                      : getManualAvailabilityState(selectedVariant, row.quantity);

                    return (
                      <div
                        className={`manual-item-card ${availability.tone === 'blocked' ? 'is-blocked' : ''}`}
                        key={row.id}
                      >
                        <div className="manual-item-card-head">
                          <div className="manual-item-card-title">Row {index + 1}</div>
                          <button
                            type="button"
                            className="order-remove-btn"
                            onClick={() => removeManualRow(row.id)}
                            disabled={receiptDraft.manualRows.length === 1}
                          >
                            Remove
                          </button>
                        </div>

                        <div className="manual-item-grid">
                          <label className="manual-item-field">
                            <span className="manual-item-label">Item Type</span>
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
                          </label>

                          <label className="manual-item-field manual-item-field-wide">
                            <span className="manual-item-label">Item Name</span>
                            <select
                              className={availability.selectTone}
                              title={availability.help}
                              value={row.itemName}
                              onChange={(event) => handleManualItemNameChange(row.id, event.target.value)}
                              required
                              disabled={!row.itemType}
                            >
                              <option value="">Select item</option>
                              {itemOptions.map((itemName) => {
                                const optionVariants = manualVariantsByItemKey.get(
                                  buildInventoryKey(row.itemType, itemName),
                                ) || [];
                                const optionAvailability = getManualItemAvailabilityState(
                                  optionVariants,
                                  row.quantity,
                                );
                                return (
                                  <option
                                    key={`${row.id}-${itemName}`}
                                    value={itemName}
                                    disabled={optionAvailability.isBlocked}
                                  >
                                    {`${itemName} • ${optionAvailability.label}`}
                                  </option>
                                );
                              })}
                            </select>
                          </label>

                          <label className="manual-item-field">
                            <span className="manual-item-label">Quantity</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.quantity}
                              onChange={(event) => updateManualRow(row.id, { quantity: event.target.value })}
                              placeholder="0"
                              required
                            />
                          </label>

                          <label className="manual-item-field">
                            <span className="manual-item-label">Item Unit</span>
                            <select
                              value={row.unit}
                              onChange={(event) => handleManualVariantFieldChange(row.id, 'unit', event.target.value)}
                              disabled={!row.itemName || unitOptions.length <= 1}
                            >
                              {unitOptions.length > 1 && (
                                <option value={UNSET_MANUAL_VARIANT_VALUE}>Select unit</option>
                              )}
                              {unitOptions.length === 0 && <option value="">Auto</option>}
                              {unitOptions.map((option) => (
                                <option key={`${row.id}-unit-${option.value || 'blank'}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="manual-item-field manual-item-field-wide">
                            <span className="manual-item-label">Item Desc</span>
                            <select
                              value={row.itemDesc}
                              onChange={(event) => handleManualVariantFieldChange(row.id, 'itemDesc', event.target.value)}
                              disabled={!row.itemName || descOptions.length <= 1}
                            >
                              {descOptions.length > 1 && (
                                <option value={UNSET_MANUAL_VARIANT_VALUE}>Select description</option>
                              )}
                              {descOptions.length === 0 && <option value="">Auto</option>}
                              {descOptions.map((option) => (
                                <option key={`${row.id}-desc-${option.value || 'blank'}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="manual-item-field">
                            <span className="manual-item-label">Brand</span>
                            <select
                              value={row.brand}
                              onChange={(event) => handleManualVariantFieldChange(row.id, 'brand', event.target.value)}
                              disabled={!row.itemName || brandOptions.length <= 1}
                            >
                              {brandOptions.length > 1 && (
                                <option value={UNSET_MANUAL_VARIANT_VALUE}>Select brand</option>
                              )}
                              {brandOptions.length === 0 && <option value="">Auto</option>}
                              {brandOptions.map((option) => (
                                <option key={`${row.id}-brand-${option.value || 'blank'}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="manual-item-field">
                            <span className="manual-item-label">Price</span>
                            <input
                              type="text"
                              value={row.price === '' || !Number.isFinite(priceValue) ? '' : priceValue.toFixed(2)}
                              readOnly
                              placeholder="Auto"
                            />
                          </label>

                          <div
                            className={`manual-stock-panel ${availability.tone}`}
                            title={availability.help}
                            aria-label={availability.help}
                          >
                            <span className="manual-item-label">Inventory</span>
                            <strong>{availability.label}</strong>
                            <span>{row.itemName ? availability.detail : 'Select an item to validate stock.'}</span>
                          </div>

                          <div className="manual-total-panel">
                            <span className="manual-item-label">Total</span>
                            <strong>{formatMoney(rowTotal)}</strong>
                            <span>Auto-calculated from price and quantity.</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="masterlist-note">
                  Item Type, Item Name, Item Desc, Item Unit, and Brand relationships are sourced from the inventory database.
                  Price is matched from the masterlist {masterlistSource || 'source'} when available, and a row stays unresolved until those fields point to one exact inventory item.
                </p>
                {masterlistError && <p className="masterlist-warning">{masterlistError}</p>}
              </div>

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