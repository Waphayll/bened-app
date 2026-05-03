import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SpreadsheetGrid from '../components/SpreadsheetGrid';
import TextSizeToggle from '../components/TextSizeToggle';
import { useAuth } from '../lib/AuthContext';
import { useAppData } from '../lib/AppDataContext';
import {
  combineReceiptDateAndTime,
  formatReceiptDateValue,
  getCurrentManilaDateTimeValue,
  parseReceiptDateValue,
  splitReceiptDateTimeInputValue,
} from '../lib/receiptDate';
import {
  applyReceiptRowsToInventory,
  createMasterlistRecord,
  createReceiptRecord,
  deleteMasterlistRecord,
  deleteReceiptRecord,
  restoreReceiptRowsToInventory,
  updateMasterlistRecord,
  updateReceiptRecord,
} from '../lib/appwrite';
import '../styles/Dashboard.css';
import '../styles/AdminDashboard.css';

function normalizeLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function formatMoney(value) {
  if (!Number.isFinite(Number(value))) return 'N/A';
  return `P ${Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(Number(value))) return 'N/A';
  const numericValue = Number(value);
  return numericValue.toLocaleString('en-PH', {
    minimumFractionDigits: Number.isInteger(numericValue) ? 0 : Math.min(fractionDigits, 2),
    maximumFractionDigits: fractionDigits,
  });
}

function formatDateValue(value) {
  return formatReceiptDateValue(value);
}

function createReceiptForm(inputBy = 'Admin') {
  const currentDateTime = splitReceiptDateTimeInputValue(getCurrentManilaDateTimeValue());

  return {
    inputBy,
    inputDate: currentDateTime.date,
    inputTime: currentDateTime.time,
    itemType: '',
    itemName: '',
    itemUnit: '',
    price: '',
    quantity: '',
  };
}

function createMasterlistForm() {
  return {
    itemType: '',
    itemName: '',
    unit: '',
    itemDesc: '',
    brand: '',
    defaultPrice: '',
    measurement: '',
    salesTargetPct: '',
  };
}

function mapReceiptToForm(record, fallbackInputBy = 'Admin') {
  const receiptDateTime = splitReceiptDateTimeInputValue(record?.inputDate);

  return {
    inputBy: String(record?.inputBy || fallbackInputBy),
    inputDate: receiptDateTime.date,
    inputTime: receiptDateTime.time,
    itemType: String(record?.itemType || ''),
    itemName: String(record?.itemName || ''),
    itemUnit: String(record?.itemUnit || ''),
    price: Number.isFinite(Number(record?.price)) ? String(record.price) : '',
    quantity: Number.isFinite(Number(record?.quantity)) ? String(record.quantity) : '',
  };
}

function mapMasterlistToForm(record) {
  return {
    itemType: String(record?.itemType || ''),
    itemName: String(record?.itemName || ''),
    unit: String(record?.unit || ''),
    itemDesc: String(record?.itemDesc || ''),
    brand: String(record?.brand || ''),
    defaultPrice: Number.isFinite(Number(record?.defaultPrice)) ? String(record.defaultPrice) : '',
    measurement: String(record?.measurement || ''),
    salesTargetPct: Number.isFinite(Number(record?.salesTargetPct)) ? String(record.salesTargetPct) : '',
  };
}

function getReceiptFormTotal(receiptForm) {
  const price = Number(receiptForm.price);
  const quantity = Number(receiptForm.quantity);
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return 0;
  return roundMoney(price * quantity);
}

function canManageAppwriteRecord(row) {
  return Boolean(row?.id && row?.source);
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

function AdminStatCard({ label, value, detail }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{value}</strong>
      <span className="admin-stat-detail">{detail}</span>
    </div>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const {
    receiptRows,
    receiptError: receiptDataError,
    masterlistRows,
    masterlistError: masterlistDataError,
    refreshReceiptData,
    refreshInventoryData,
    refreshMasterlistData,
  } = useAppData();
  const navigate = useNavigate();

  const displayName = user?.username
    ? user.username.charAt(0).toUpperCase() + user.username.slice(1)
    : 'Admin';
  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const [receiptSearch, setReceiptSearch] = useState('');
  const [masterlistSearch, setMasterlistSearch] = useState('');
  const [masterlistTypeFilter, setMasterlistTypeFilter] = useState('All');
  const [masterlistBrandFilter, setMasterlistBrandFilter] = useState('All');
  const [receiptForm, setReceiptForm] = useState(() => createReceiptForm(displayName));
  const [masterlistForm, setMasterlistForm] = useState(() => createMasterlistForm());
  const [editingReceipt, setEditingReceipt] = useState(null);
  const [editingMasterlist, setEditingMasterlist] = useState(null);
  const [receiptError, setReceiptError] = useState('');
  const [receiptNotice, setReceiptNotice] = useState('');
  const [masterlistError, setMasterlistError] = useState('');
  const [masterlistNotice, setMasterlistNotice] = useState('');
  const [isSavingReceipt, setIsSavingReceipt] = useState(false);
  const [isSavingMasterlist, setIsSavingMasterlist] = useState(false);

  const deferredReceiptSearch = useDeferredValue(receiptSearch);
  const deferredMasterlistSearch = useDeferredValue(masterlistSearch);

  useEffect(() => {
    if (!editingReceipt) {
      setReceiptForm((current) => ({
        ...current,
        inputBy: displayName,
      }));
    }
  }, [displayName, editingReceipt]);

  const sortedReceiptRows = useMemo(() => (
    [...receiptRows].sort((a, b) => {
      const aTime = parseReceiptDateValue(a?.inputDate)?.getTime() ?? 0;
      const bTime = parseReceiptDateValue(b?.inputDate)?.getTime() ?? 0;
      const safeATime = Number.isNaN(aTime) ? 0 : aTime;
      const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
      return safeBTime - safeATime || String(a?.itemName || '').localeCompare(String(b?.itemName || ''));
    })
  ), [receiptRows]);

  const filteredReceiptRows = useMemo(() => {
    const needle = normalizeLookup(deferredReceiptSearch);
    if (!needle) return sortedReceiptRows;

    return sortedReceiptRows.filter((row) => {
      const haystack = [
        row.inputBy,
        row.inputDate,
        row.itemType,
        row.itemName,
        row.itemUnit,
        row.note,
      ]
        .filter(Boolean)
        .map((value) => normalizeLookup(value))
        .join(' ');

      return haystack.includes(needle);
    });
  }, [deferredReceiptSearch, sortedReceiptRows]);

  const sortedMasterlistRows = useMemo(() => (
    [...masterlistRows].sort((a, b) => (
      String(a?.itemType || '').localeCompare(String(b?.itemType || ''))
      || String(a?.itemName || '').localeCompare(String(b?.itemName || ''))
      || String(a?.brand || '').localeCompare(String(b?.brand || ''))
    ))
  ), [masterlistRows]);

  const masterlistTypeOptions = useMemo(() => (
    Array.from(new Set(masterlistRows.map((row) => row.itemType).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
  ), [masterlistRows]);

  const masterlistBrandOptions = useMemo(() => (
    Array.from(new Set(masterlistRows.map((row) => row.brand).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
  ), [masterlistRows]);

  const filteredMasterlistRows = useMemo(() => {
    const needle = normalizeLookup(deferredMasterlistSearch);

    return sortedMasterlistRows.filter((row) => {
      const matchesType = masterlistTypeFilter === 'All' || row.itemType === masterlistTypeFilter;
      const matchesBrand = masterlistBrandFilter === 'All' || row.brand === masterlistBrandFilter;
      if (!matchesType || !matchesBrand) return false;

      if (!needle) return true;

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

      return haystack.includes(needle);
    });
  }, [deferredMasterlistSearch, masterlistBrandFilter, masterlistTypeFilter, sortedMasterlistRows]);

  const filteredMasterlistCountLabel = filteredMasterlistRows.length;

  const handleMasterlistTypeChange = (value) => {
    startTransition(() => {
      setMasterlistTypeFilter(value);
    });
  };

  const handleMasterlistBrandChange = (value) => {
    startTransition(() => {
      setMasterlistBrandFilter(value);
    });
  };

  const handleMasterlistSearchChange = (value) => {
    startTransition(() => {
      setMasterlistSearch(value);
    });
  };

  const resetMasterlistFilters = () => {
    startTransition(() => {
      setMasterlistSearch('');
      setMasterlistTypeFilter('All');
      setMasterlistBrandFilter('All');
    });
  };

  const masterlistFilterSummary = [
    masterlistTypeFilter !== 'All' ? masterlistTypeFilter : null,
    masterlistBrandFilter !== 'All' ? masterlistBrandFilter : null,
  ].filter(Boolean).join(' · ');

  const totalReceiptRevenue = useMemo(() => (
    roundMoney(receiptRows.reduce((total, row) => total + Number(row?.totalPrice || 0), 0))
  ), [receiptRows]);

  const totalMasterlistCategories = useMemo(() => (
    new Set(masterlistRows.map((row) => row.itemType).filter(Boolean)).size
  ), [masterlistRows]);

  const receiptFormTotal = useMemo(() => getReceiptFormTotal(receiptForm), [receiptForm]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  function resetReceiptEditor() {
    setEditingReceipt(null);
    setReceiptForm(createReceiptForm(displayName));
    setReceiptError('');
  }

  function resetMasterlistEditor() {
    setEditingMasterlist(null);
    setMasterlistForm(createMasterlistForm());
    setMasterlistError('');
  }

  function validateReceiptForm() {
    if (!receiptForm.inputBy.trim()) return 'Input by is required.';
    if (!receiptForm.inputDate) return 'Input date is required.';
    if (!receiptForm.inputTime) return 'Input time is required.';
    if (!receiptForm.itemType.trim()) return 'Item type is required.';
    if (!receiptForm.itemName.trim()) return 'Item name is required.';
    if (!receiptForm.itemUnit.trim()) return 'Unit of measurement is required.';

    const price = Number(receiptForm.price);
    const quantity = Number(receiptForm.quantity);

    if (!Number.isFinite(price) || price <= 0) return 'Price must be greater than 0.';
    if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantity must be greater than 0.';

    return '';
  }

  function buildReceiptPayload() {
    return {
      INPUT_BY: receiptForm.inputBy.trim(),
      INPUT_DATE: combineReceiptDateAndTime(receiptForm.inputDate, receiptForm.inputTime),
      ITEM_TYPE: receiptForm.itemType.trim(),
      ITEM_NAME: receiptForm.itemName.trim(),
      ITEM_UNIT: receiptForm.itemUnit.trim(),
      PRICE: roundMoney(Number(receiptForm.price)),
      QUANTITY: Number(receiptForm.quantity),
      TOTAL_PRICE: receiptFormTotal,
    };
  }

  async function handleReceiptSubmit(event) {
    event.preventDefault();
    if (isSavingReceipt) return;

    const nextError = validateReceiptForm();
    if (nextError) {
      setReceiptError(nextError);
      return;
    }

    setIsSavingReceipt(true);
    setReceiptError('');
    setReceiptNotice('');

    const payload = buildReceiptPayload();

    try {
      let inventoryMessage = '';

      if (editingReceipt?.id) {
        await updateReceiptRecord(editingReceipt.id, editingReceipt.source, payload);

        try {
          await restoreReceiptRowsToInventory([editingReceipt]);
          await applyReceiptRowsToInventory([payload]);
        } catch (inventoryError) {
          inventoryMessage = ` Inventory sync failed: ${inventoryError?.message || 'unknown error'}.`;
        }

        setReceiptNotice(`Receipt row updated.${inventoryMessage}`);
      } else {
        await createReceiptRecord(payload);

        try {
          await applyReceiptRowsToInventory([payload]);
        } catch (inventoryError) {
          inventoryMessage = ` Inventory sync failed: ${inventoryError?.message || 'unknown error'}.`;
        }

        setReceiptNotice(`Receipt row created.${inventoryMessage}`);
      }

      await Promise.allSettled([refreshReceiptData(), refreshInventoryData()]);
      resetReceiptEditor();
    } catch (error) {
      setReceiptError(error?.message || 'Unable to save the receipt row.');
    } finally {
      setIsSavingReceipt(false);
    }
  }

  function handleReceiptEdit(row) {
    setEditingReceipt(row);
    setReceiptForm(mapReceiptToForm(row, displayName));
    setReceiptError('');
    setReceiptNotice('');
  }

  async function handleReceiptDelete(row) {
    if (!row?.id) {
      setReceiptError('This receipt row cannot be deleted because it has no Appwrite record ID.');
      return;
    }

    const confirmed = window.confirm(
      `Delete receipt row for "${row.itemName || 'Unnamed item'}" dated ${formatDateValue(row.inputDate) || 'unknown date'}?`,
    );

    if (!confirmed) return;

    setReceiptError('');
    setReceiptNotice('');

    try {
      await deleteReceiptRecord(row.id, row.source);

      let inventoryMessage = '';
      try {
        await restoreReceiptRowsToInventory([row]);
      } catch (inventoryError) {
        inventoryMessage = ` Inventory sync failed: ${inventoryError?.message || 'unknown error'}.`;
      }

      await Promise.allSettled([refreshReceiptData(), refreshInventoryData()]);

      if (editingReceipt?.id === row.id) {
        resetReceiptEditor();
      }

      setReceiptNotice(`Receipt row deleted.${inventoryMessage}`);
    } catch (error) {
      setReceiptError(error?.message || 'Unable to delete the receipt row.');
    }
  }

  function validateMasterlistForm() {
    if (!masterlistForm.itemType.trim()) return 'Item type is required.';
    if (!masterlistForm.itemName.trim()) return 'Item name is required.';

    if (
      masterlistForm.defaultPrice !== ''
      && (!Number.isFinite(Number(masterlistForm.defaultPrice)) || Number(masterlistForm.defaultPrice) < 0)
    ) {
      return 'Default price must be a valid non-negative number.';
    }

    if (
      masterlistForm.salesTargetPct !== ''
      && !Number.isFinite(Number(masterlistForm.salesTargetPct))
    ) {
      return 'Sales target percent must be a valid number.';
    }

    return '';
  }

  function buildMasterlistPayload() {
    return {
      ITEM_TYPE: masterlistForm.itemType.trim(),
      ITEM_NAME: masterlistForm.itemName.trim(),
      ITEM_UNIT: masterlistForm.unit.trim(),
      ITEM_DESC: masterlistForm.itemDesc.trim(),
      BRAND: masterlistForm.brand.trim(),
      DEFAULT_PRICE: masterlistForm.defaultPrice === '' ? null : roundMoney(Number(masterlistForm.defaultPrice)),
      MEASUREMENT: masterlistForm.measurement.trim(),
      SALES_TARGET_PCT: masterlistForm.salesTargetPct === '' ? null : Number(masterlistForm.salesTargetPct),
    };
  }

  async function handleMasterlistSubmit(event) {
    event.preventDefault();
    if (isSavingMasterlist) return;

    const nextError = validateMasterlistForm();
    if (nextError) {
      setMasterlistError(nextError);
      return;
    }

    setIsSavingMasterlist(true);
    setMasterlistError('');
    setMasterlistNotice('');

    try {
      const payload = buildMasterlistPayload();

      if (editingMasterlist?.id) {
        await updateMasterlistRecord(editingMasterlist.id, editingMasterlist.source, payload);
        setMasterlistNotice('Masterlist row updated.');
      } else {
        await createMasterlistRecord(payload);
        setMasterlistNotice('Masterlist row created.');
      }

      await refreshMasterlistData({ preferCache: false });
      resetMasterlistEditor();
    } catch (error) {
      setMasterlistError(error?.message || 'Unable to save the masterlist row.');
    } finally {
      setIsSavingMasterlist(false);
    }
  }

  function handleMasterlistEdit(row) {
    setEditingMasterlist(row);
    setMasterlistForm(mapMasterlistToForm(row));
    setMasterlistError('');
    setMasterlistNotice('');
  }

  async function handleMasterlistDelete(row) {
    if (!row?.id) {
      setMasterlistError('This masterlist row cannot be deleted because it has no Appwrite record ID.');
      return;
    }

    const confirmed = window.confirm(
      `Delete masterlist item "${row.itemName || 'Unnamed item'}"${row.brand ? ` (${row.brand})` : ''}?`,
    );

    if (!confirmed) return;

    setMasterlistError('');
    setMasterlistNotice('');

    try {
      await deleteMasterlistRecord(row.id, row.source);
      await refreshMasterlistData({ preferCache: false });

      if (editingMasterlist?.id === row.id) {
        resetMasterlistEditor();
      }

      setMasterlistNotice('Masterlist row deleted.');
    } catch (error) {
      setMasterlistError(error?.message || 'Unable to delete the masterlist row.');
    }
  }

  const masterlistGridColumns = [
    {
      key: 'rowNumber',
      label: '#',
      width: '72px',
      align: 'end',
      render: (_row, index) => String(index + 1).padStart(3, '0'),
    },
    { key: 'itemType', label: 'Type', width: 'minmax(140px, 1.1fr)' },
    { key: 'itemName', label: 'Item Name', width: 'minmax(220px, 1.5fr)' },
    { key: 'unit', label: 'Unit', width: 'minmax(120px, 0.8fr)' },
    { key: 'itemDesc', label: 'Description', width: 'minmax(220px, 1.4fr)' },
    { key: 'brand', label: 'Brand', width: 'minmax(160px, 1fr)' },
    {
      key: 'defaultPrice',
      label: 'Price',
      width: 'minmax(130px, 0.9fr)',
      align: 'end',
      render: (row) => formatMoney(row.defaultPrice),
    },
    { key: 'measurement', label: 'Measurement', width: 'minmax(150px, 1fr)' },
    {
      key: 'salesTargetPct',
      label: 'Sales Target %',
      width: 'minmax(150px, 0.9fr)',
      align: 'end',
      render: (row) => formatNumber(row.salesTargetPct),
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '190px',
      sticky: 'right',
      render: (row) => {
        const canManageRow = canManageAppwriteRecord(row);

        return (
          <div className="admin-table-actions">
            <button
              type="button"
              className="admin-action-btn"
              disabled={!canManageRow}
              title={canManageRow ? 'Load this masterlist row into the editor.' : 'This row is read-only because no Appwrite record ID was returned.'}
              onClick={() => handleMasterlistEdit(row)}
            >
              Edit Row
            </button>
            <button
              type="button"
              className="admin-action-btn danger"
              disabled={!canManageRow}
              title={canManageRow ? 'Delete this masterlist row from Appwrite.' : 'This row is read-only because no Appwrite record ID was returned.'}
              onClick={() => handleMasterlistDelete(row)}
            >
              Delete Row
            </button>
          </div>
        );
      },
    },
  ];

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
          <div className="admin-topbar-copy">
            <span className="admin-role-pill">Admin Workspace</span>
            <span className="nav-date">{dateStr}</span>
          </div>
        </div>

        <div className="topnav-right admin-topbar-actions">
          <TextSizeToggle className="topbar-text-size-toggle" />
          <button type="button" className="btn-outline" onClick={() => navigate('/dashboard')}>
            Open Dashboard
          </button>
          <button type="button" className="btn-solid" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <section className="page-header admin-header">
        <div>
          <h1 className="page-title">Admin Control Center</h1>
          <p className="page-sub">
            Manage receipt rows and masterlist items directly from the site for {displayName}.
          </p>
        </div>
      </section>

      <main className="dash-main admin-main">
        <section className="admin-stats-grid">
          <AdminStatCard
            label="Receipt Rows"
            value={receiptRows.length.toLocaleString()}
            detail="Live rows available for editing or deletion."
          />
          <AdminStatCard
            label="Receipt Revenue"
            value={formatMoney(totalReceiptRevenue)}
            detail="Based on total price stored in the receipts dataset."
          />
          <AdminStatCard
            label="Masterlist Items"
            value={masterlistRows.length.toLocaleString()}
            detail="Items currently available in the Appwrite masterlist source."
          />
          <AdminStatCard
            label="Tracked Categories"
            value={totalMasterlistCategories.toLocaleString()}
            detail="Unique item types currently defined in the masterlist."
          />
        </section>

        <section className="admin-grid">
          <article className="panel admin-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Receipts Manager</div>
                <div className="panel-sub">Add, update, and remove receipt rows without leaving the site.</div>
              </div>
            </div>

            <form className="admin-editor-form" onSubmit={handleReceiptSubmit}>
              <div className="admin-form-grid">
                <label className="admin-field">
                  <span className="admin-field-label">Input By</span>
                  <input
                    type="text"
                    value={receiptForm.inputBy}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      inputBy: event.target.value,
                    }))}
                    placeholder="Name of encoder"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Input Date</span>
                  <input
                    type="date"
                    value={receiptForm.inputDate}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      inputDate: event.target.value,
                    }))}
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Input Time</span>
                  <input
                    type="time"
                    value={receiptForm.inputTime}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      inputTime: event.target.value,
                    }))}
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Category</span>
                  <input
                    type="text"
                    value={receiptForm.itemType}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      itemType: event.target.value,
                    }))}
                    placeholder="Cement, Electrical, Hardware..."
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Unit of Measurement</span>
                  <input
                    type="text"
                    value={receiptForm.itemUnit}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      itemUnit: event.target.value,
                    }))}
                    placeholder="PCS, BAG, BOX..."
                  />
                </label>

                <label className="admin-field admin-field-wide">
                  <span className="admin-field-label">Item Name</span>
                  <input
                    type="text"
                    value={receiptForm.itemName}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      itemName: event.target.value,
                    }))}
                    placeholder="Enter item name"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={receiptForm.price}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      price: event.target.value,
                    }))}
                    placeholder="0.00"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Quantity</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={receiptForm.quantity}
                    onChange={(event) => setReceiptForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))}
                    placeholder="0"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Total Price</span>
                  <input type="text" value={formatMoney(receiptFormTotal)} readOnly />
                </label>
              </div>

              {(receiptNotice || receiptError) && (
                <div className={`admin-feedback ${receiptError ? 'error' : 'success'}`}>
                  {receiptError || receiptNotice}
                </div>
              )}

              <div className="admin-editor-actions">
                <button type="submit" className="btn-solid" disabled={isSavingReceipt}>
                  {isSavingReceipt
                    ? 'Saving...'
                    : editingReceipt
                      ? 'Update Receipt'
                      : 'Add Receipt'}
                </button>
                <button type="button" className="btn-outline" onClick={resetReceiptEditor}>
                  {editingReceipt ? 'Cancel Edit' : 'Reset Form'}
                </button>
              </div>
            </form>

            <div className="admin-toolbar">
              <label className="admin-search-field">
                <span className="admin-search-label">Search receipt rows</span>
                <input
                  type="search"
                  value={receiptSearch}
                  onChange={(event) => setReceiptSearch(event.target.value)}
                  placeholder="Search by date, encoder, item, unit, or category"
                />
              </label>
              <span className="admin-result-count">
                {filteredReceiptRows.length.toLocaleString()} visible row{filteredReceiptRows.length === 1 ? '' : 's'}
              </span>
            </div>

            {filteredReceiptRows.length > 0 ? (
              <div className="data-table-wrap table-responsive admin-table-scroll admin-table-scroll-receipts">
                <table className="data-table admin-table">
                  <thead>
                    <tr>
                      <th>Input By</th>
                      <th>Date &amp; Time</th>
                      <th>Category</th>
                      <th>Item Name</th>
                      <th>Unit</th>
                      <th className="table-num">Price</th>
                      <th className="table-num">Qty</th>
                      <th className="table-num">Total</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReceiptRows.map((row, index) => (
                      <tr key={row.id || `${row.inputDate}-${row.itemName}-${index}`}>
                        <td>{row.inputBy || 'N/A'}</td>
                        <td>{formatDateValue(row.inputDate)}</td>
                        <td>{row.itemType || 'N/A'}</td>
                        <td>{row.itemName || 'N/A'}</td>
                        <td>{row.itemUnit || 'N/A'}</td>
                        <td className="table-num">{formatMoney(row.price)}</td>
                        <td className="table-num">{formatNumber(row.quantity)}</td>
                        <td className="table-num">{formatMoney(row.totalPrice)}</td>
                        <td>
                          <div className="admin-table-actions">
                            <button type="button" className="admin-action-btn" onClick={() => handleReceiptEdit(row)}>
                              Edit Row
                            </button>
                            <button
                              type="button"
                              className="admin-action-btn danger"
                              onClick={() => handleReceiptDelete(row)}
                            >
                              Delete Row
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel-empty-state">
                <p>
                  {receiptError || receiptDataError || 'No receipt rows match the current search.'}
                </p>
              </div>
            )}
          </article>

          <article className="panel admin-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Masterlist Manager</div>
                <div className="panel-sub">Maintain item pricing, descriptions, and category details in one place.</div>
              </div>
            </div>

            <form className="admin-editor-form" onSubmit={handleMasterlistSubmit}>
              <div className="admin-form-grid">
                <label className="admin-field">
                  <span className="admin-field-label">Item Type</span>
                  <input
                    type="text"
                    value={masterlistForm.itemType}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      itemType: event.target.value,
                    }))}
                    placeholder="Category"
                  />
                </label>

                <label className="admin-field admin-field-wide">
                  <span className="admin-field-label">Item Name</span>
                  <input
                    type="text"
                    value={masterlistForm.itemName}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      itemName: event.target.value,
                    }))}
                    placeholder="Item name"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Unit</span>
                  <input
                    type="text"
                    value={masterlistForm.unit}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      unit: event.target.value,
                    }))}
                    placeholder="PCS, BAG, BOX..."
                  />
                </label>

                <label className="admin-field admin-field-wide">
                  <span className="admin-field-label">Description</span>
                  <input
                    type="text"
                    value={masterlistForm.itemDesc}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      itemDesc: event.target.value,
                    }))}
                    placeholder="Variant or description"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Brand</span>
                  <input
                    type="text"
                    value={masterlistForm.brand}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      brand: event.target.value,
                    }))}
                    placeholder="Brand"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Default Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={masterlistForm.defaultPrice}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      defaultPrice: event.target.value,
                    }))}
                    placeholder="0.00"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Measurement</span>
                  <input
                    type="text"
                    value={masterlistForm.measurement}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      measurement: event.target.value,
                    }))}
                    placeholder="Size or measure"
                  />
                </label>

                <label className="admin-field">
                  <span className="admin-field-label">Sales Target %</span>
                  <input
                    type="number"
                    step="0.01"
                    value={masterlistForm.salesTargetPct}
                    onChange={(event) => setMasterlistForm((current) => ({
                      ...current,
                      salesTargetPct: event.target.value,
                    }))}
                    placeholder="Optional"
                  />
                </label>
              </div>

              {(masterlistNotice || masterlistError) && (
                <div className={`admin-feedback ${masterlistError ? 'error' : 'success'}`}>
                  {masterlistError || masterlistNotice}
                </div>
              )}

              <div className="admin-editor-actions">
                <button type="submit" className="btn-solid" disabled={isSavingMasterlist}>
                  {isSavingMasterlist
                    ? 'Saving...'
                    : editingMasterlist
                      ? 'Update Masterlist Item'
                      : 'Add Masterlist Item'}
                </button>
                <button type="button" className="btn-outline" onClick={resetMasterlistEditor}>
                  {editingMasterlist ? 'Cancel Edit' : 'Reset Form'}
                </button>
              </div>
            </form>

            <div className="admin-toolbar">
              <label className="admin-search-field">
                <span className="admin-search-label">Search masterlist rows</span>
                <input
                  type="search"
                  value={masterlistSearch}
                  onChange={(event) => handleMasterlistSearchChange(event.target.value)}
                  placeholder="Search by type, item, brand, unit, or description"
                />
              </label>
              <label className="admin-filter-field">
                <span className="admin-search-label">Item Type</span>
                <select
                  value={masterlistTypeFilter}
                  onChange={(event) => handleMasterlistTypeChange(event.target.value)}
                >
                  <option value="All">All Types</option>
                  {masterlistTypeOptions.map((itemType) => (
                    <option key={itemType} value={itemType}>{itemType}</option>
                  ))}
                </select>
              </label>
              <label className="admin-filter-field">
                <span className="admin-search-label">Brand</span>
                <select
                  value={masterlistBrandFilter}
                  onChange={(event) => handleMasterlistBrandChange(event.target.value)}
                >
                  <option value="All">All Brands</option>
                  {masterlistBrandOptions.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-outline admin-filter-reset-btn" onClick={resetMasterlistFilters}>
                Reset Filters
              </button>
              <span className="admin-result-count">
                {filteredMasterlistCountLabel.toLocaleString()} visible item{filteredMasterlistCountLabel === 1 ? '' : 's'}
              </span>
            </div>

            {(masterlistFilterSummary || deferredMasterlistSearch) && (
              <div className="admin-selection-note">
                Filtered by: {masterlistFilterSummary || 'Search only'}
                {deferredMasterlistSearch ? ` · search: "${masterlistSearch}"` : ''}
              </div>
            )}

            {editingMasterlist && (
              <div className="admin-selection-note">
                Editing: {editingMasterlist.itemName || 'Unnamed item'}
                {editingMasterlist.brand ? ` (${editingMasterlist.brand})` : ''}
              </div>
            )}

            {filteredMasterlistRows.length > 0 ? (
              <div className="data-table-wrap table-responsive admin-table-scroll admin-table-scroll-masterlist admin-sheet-wrap">
                <SpreadsheetGrid
                  className="admin-masterlist-grid"
                  columns={masterlistGridColumns}
                  rows={filteredMasterlistRows}
                  getRowKey={(row, index) => row.id || `${row.itemType}-${row.itemName}-${index}`}
                  rowClassName={(row) => (
                    editingMasterlist?.id && row.id && editingMasterlist.id === row.id
                      ? 'admin-row-active'
                      : ''
                  )}
                />
              </div>
            ) : (
              <div className="panel-empty-state">
                <p>
                  {masterlistError || masterlistDataError || 'No masterlist rows match the current search.'}
                </p>
              </div>
            )}
          </article>
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
