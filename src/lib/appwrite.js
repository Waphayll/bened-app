import {
  Account,
  Client,
  Databases,
  ID,
  Query,
  TablesDB,
} from 'appwrite';

const endpoint = 'https://raf-debian.tail848565.ts.net/v1';
const projectId = '69cd11c7003ce3f9532f';
const dataDatabaseId = (
  import.meta.env.VITE_APPWRITE_DATA_DB_ID
  || import.meta.env.VITE_APPWRITE_DB_ID
  || ''
).trim();
const receiptsTableId = (import.meta.env.VITE_APPWRITE_RECEIPTS_TABLE_ID || '').trim();
const receiptsCollectionId = (
  import.meta.env.VITE_APPWRITE_RECEIPTS_COLLECTION_ID
  || ''
).trim();
const masterlistTableId = (import.meta.env.VITE_APPWRITE_MASTERLIST_TABLE_ID || '').trim();
const masterlistCollectionId = (
  import.meta.env.VITE_APPWRITE_MASTERLIST_COLLECTION_ID
  || ''
).trim();
const inventoryTableId = (import.meta.env.VITE_APPWRITE_INVENTORY_TABLE_ID || '').trim();
const inventoryCollectionId = (
  import.meta.env.VITE_APPWRITE_INVENTORY_COLLECTION_ID
  || ''
).trim();

const client = new Client().setEndpoint(endpoint).setProject(projectId);

const account = new Account(client);
const databases = new Databases(client);
const tablesDb = new TablesDB(client);

export { client, account, databases, tablesDb };

export function isAppwriteConfigured() {
  return Boolean(endpoint && projectId);
}

export function isAppwriteDataConfigured() {
  return Boolean(
    dataDatabaseId
      && (
        receiptsTableId
        || receiptsCollectionId
        || masterlistTableId
        || masterlistCollectionId
        || inventoryTableId
        || inventoryCollectionId
      ),
  );
}

function normalizeAppwriteError(error, fallbackMessage) {
  const normalized = new Error(error?.message || fallbackMessage);
  normalized.status = error?.code || error?.status || 500;
  normalized.type = error?.type || 'appwrite_api_error';
  return normalized;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
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

function resolveField(record, candidates) {
  for (const key of candidates) {
    if (record?.[key] !== undefined && record?.[key] !== null && record?.[key] !== '') {
      return record[key];
    }
  }
  return null;
}

function hasOwnField(record, key) {
  return Boolean(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function resolvePresentFieldKey(record, candidates) {
  for (const key of candidates) {
    if (hasOwnField(record, key)) {
      return key;
    }
  }
  return null;
}

function resolveRecordId(record) {
  return resolveField(record, ['$id', 'id', 'rowId', '$rowId', '_id']);
}

const MASTERLIST_FIELD_KEY_CANDIDATES = {
  itemType: ['ITEM_TYPE', 'item_type', 'itemType', 'CATEGORY', 'category', 'TYPE', 'type'],
  itemName: ['ITEM_NAME', 'item_name', 'itemName', 'NAME', 'name', 'PRODUCT_NAME', 'product_name'],
  unit: ['ITEM_UNIT', 'item_unit', 'unit', 'UNIT', 'UNIT_OF_MEASUREMENT', 'unit_of_measurement', 'UOM', 'uom'],
  itemDesc: ['ITEM_DESC', 'item_desc', 'itemDesc', 'DESCRIPTION', 'description', 'DESC', 'desc'],
  brand: ['BRAND', 'brand'],
  defaultPrice: ['DEFAULT_PRICE', 'default_price', 'defaultPrice', 'PRICE', 'price', 'UNIT_PRICE', 'unit_price'],
  measurement: ['MEASUREMENT', 'measurement', 'MEASUREMENT_UNIT', 'measurement_unit', 'MEASURE', 'measure', 'UNIT_MEASURE', 'unit_measure'],
  salesTargetPct: ['SALES_TARGET_PCT', 'sales_target_pct', 'salesTargetPct', 'TARGET_PCT', 'target_pct', 'SALES_TARGET', 'sales_target'],
};

const MASTERLIST_PAYLOAD_VARIANTS = [
  {
    itemType: 'ITEM_TYPE',
    itemName: 'ITEM_NAME',
    unit: 'ITEM_UNIT',
    itemDesc: 'ITEM_DESC',
    brand: 'BRAND',
    defaultPrice: 'DEFAULT_PRICE',
    measurement: 'MEASUREMENT',
  },
  {
    itemType: 'item_type',
    itemName: 'item_name',
    unit: 'item_unit',
    itemDesc: 'item_desc',
    brand: 'brand',
    defaultPrice: 'default_price',
    measurement: 'measurement',
  },
  {
    itemType: 'category',
    itemName: 'item_name',
    unit: 'unit',
    itemDesc: 'description',
    brand: 'brand',
    defaultPrice: 'default_price',
    measurement: 'measurement',
  },
  {
    itemType: 'type',
    itemName: 'name',
    unit: 'unit',
    itemDesc: 'description',
    brand: 'brand',
    defaultPrice: 'price',
    measurement: 'measurement',
  },
];

function detectMasterlistFieldKeys(record) {
  return {
    itemType: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.itemType),
    itemName: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.itemName),
    unit: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.unit),
    itemDesc: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.itemDesc),
    brand: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.brand),
    defaultPrice: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.defaultPrice),
    measurement: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.measurement),
    salesTargetPct: resolvePresentFieldKey(record, MASTERLIST_FIELD_KEY_CANDIDATES.salesTargetPct),
  };
}

function normalizeMasterlistFieldKeys(fieldKeys) {
  if (!fieldKeys) return null;

  const normalized = {};
  Object.entries(fieldKeys).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      normalized[key] = value.trim();
    }
  });

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildMasterlistPayloadFromFieldKeys(values, fieldKeys) {
  const payload = {};
  Object.entries(values).forEach(([key, value]) => {
    const fieldName = fieldKeys?.[key];
    if (!fieldName) return;
    payload[fieldName] = value;
  });
  return payload;
}

function getMasterlistPayloadValues(record) {
  return {
    itemType: sanitizeText(record?.ITEM_TYPE ?? record?.itemType),
    itemName: sanitizeText(record?.ITEM_NAME ?? record?.itemName),
    unit: sanitizeText(record?.ITEM_UNIT ?? record?.unit),
    itemDesc: sanitizeText(record?.ITEM_DESC ?? record?.itemDesc),
    brand: sanitizeText(record?.BRAND ?? record?.brand),
    defaultPrice: sanitizeOptionalNumber(record?.DEFAULT_PRICE ?? record?.defaultPrice),
    measurement: sanitizeText(record?.MEASUREMENT ?? record?.measurement),
  };
}

function getMasterlistPayloadVariants(record, fieldKeys) {
  const values = getMasterlistPayloadValues(record);
  const variants = [];
  const seen = new Set();

  const pushVariant = (variantFieldKeys) => {
    const normalizedFieldKeys = normalizeMasterlistFieldKeys(variantFieldKeys);
    if (!normalizedFieldKeys) return;

    const signature = JSON.stringify(normalizedFieldKeys);
    if (seen.has(signature)) return;
    seen.add(signature);

    variants.push(buildMasterlistPayloadFromFieldKeys(values, normalizedFieldKeys));
  };

  pushVariant(fieldKeys);
  MASTERLIST_PAYLOAD_VARIANTS.forEach(pushVariant);

  return variants;
}

function shouldRetryMasterlistPayload(error) {
  const message = String(error?.message || '');
  return /Unknown attribute|Invalid document structure|Invalid row structure|Unknown column|Unknown property/i.test(message);
}

async function executeMasterlistMutation(mutate, record, fieldKeys) {
  const payloadVariants = getMasterlistPayloadVariants(record, fieldKeys);
  let lastError = null;

  for (const payload of payloadVariants) {
    try {
      await mutate(payload);
      return;
    } catch (error) {
      lastError = error;
      if (!shouldRetryMasterlistPayload(error)) {
        throw error;
      }
    }
  }

  throw lastError || normalizeAppwriteError(null, 'Unable to save the masterlist row.');
}

function normalizeMasterlistRecord(record, source = 'table') {
  const itemType = resolveField(record, [
    'ITEM_TYPE', 'item_type', 'TYPE', 'type', 'CATEGORY', 'category',
  ]);
  const itemName = resolveField(record, [
    'ITEM_NAME', 'item_name', 'NAME', 'name', 'PRODUCT_NAME', 'product_name',
  ]);
  const unit = resolveField(record, [
    'ITEM_UNIT', 'item_unit',
    'UNIT', 'unit', 'UNIT_OF_MEASUREMENT', 'unit_of_measurement', 'UOM', 'uom',
  ]);
  const itemDesc = resolveField(record, [
    'ITEM_DESC', 'item_desc', 'DESCRIPTION', 'description', 'DESC', 'desc',
  ]);
  const brand = resolveField(record, [
    'BRAND', 'brand',
  ]);
  const defaultPrice = resolveField(record, [
    'DEFAULT_PRICE', 'default_price', 'PRICE', 'price', 'UNIT_PRICE', 'unit_price',
  ]);
  const measurement = resolveField(record, [
    'MEASUREMENT', 'measurement', 'MEASUREMENT_UNIT', 'measurement_unit',
    'MEASURE', 'measure', 'UNIT_MEASURE', 'unit_measure',
  ]);
  const salesTargetPct = resolveField(record, [
    'SALES_TARGET_PCT', 'sales_target_pct', 'TARGET_PCT', 'target_pct', 'SALES_TARGET', 'sales_target',
  ]);

  if (!itemType || !itemName) return null;

  return {
    id: resolveRecordId(record),
    source,
    itemType: String(itemType).trim(),
    itemName: String(itemName).trim(),
    unit: unit ? String(unit).trim() : '',
    itemDesc: itemDesc ? String(itemDesc).trim() : '',
    brand: brand ? String(brand).trim() : '',
    defaultPrice: parseNumber(defaultPrice),
    measurement: measurement ? String(measurement).trim() : '',
    salesTargetPct: parseNumber(salesTargetPct),
    fieldKeys: detectMasterlistFieldKeys(record),
  };
}

function normalizeReceiptRecord(record, source = 'table') {
  return {
    id: resolveRecordId(record),
    source,
    inputBy: resolveField(record, ['INPUT_BY', 'input_by', 'inputBy']),
    inputDate: resolveField(record, ['INPUT_DATE', 'input_date', 'inputDate']),
    note: resolveField(record, ['NOTE', 'note', 'NOTES', 'notes']),
    itemName: resolveField(record, ['ITEM_NAME', 'item_name', 'itemName']),
    itemType: resolveField(record, ['ITEM_TYPE', 'item_type', 'itemType']),
    itemUnit: resolveField(record, ['ITEM_UNIT', 'item_unit', 'itemUnit', 'unit']),
    itemDesc: resolveField(record, ['ITEM_DESC', 'item_desc', 'itemDesc']),
    brand: resolveField(record, ['BRAND', 'brand']),
    price: parseNumber(resolveField(record, ['PRICE', 'price'])),
    quantity: parseNumber(resolveField(record, ['QUANTITY', 'quantity'])),
    totalPrice: parseNumber(resolveField(record, ['TOTAL_PRICE', 'total_price', 'totalPrice'])),
  };
}

function normalizeInventoryRecord(record, source = 'table') {
  const category = resolveField(record, [
    'CATEGORY', 'category', 'ITEM_TYPE', 'item_type', 'itemType',
  ]);
  const itemName = resolveField(record, [
    'ITEM_NAME', 'item_name', 'itemName', 'NAME', 'name', 'PRODUCT_NAME', 'product_name',
  ]);
  const unit = resolveField(record, [
    'ITEM_UNIT', 'item_unit',
    'UNIT', 'unit', 'UNIT_OF_MEASUREMENT', 'unit_of_measurement', 'UOM', 'uom',
  ]);
  const itemDesc = resolveField(record, [
    'ITEM_DESC', 'item_desc', 'DESCRIPTION', 'description', 'DESC', 'desc',
  ]);
  const brand = resolveField(record, [
    'BRAND', 'brand',
  ]);

  if (!itemName) return null;

  return {
    id: resolveRecordId(record),
    source,
    category: category ? String(category).trim() : '',
    itemName: String(itemName).trim(),
    unit: unit ? String(unit).trim() : '',
    itemDesc: itemDesc ? String(itemDesc).trim() : '',
    brand: brand ? String(brand).trim() : '',
    maximumInv: parseNumber(resolveField(record, [
      'MAXIMUM_INV', 'maximum_inv', 'MAX_INV', 'max_inv', 'MAXIMUM', 'maximum',
    ])),
    currentInv: parseNumber(resolveField(record, [
      'CURRENT_INV', 'current_inv', 'CURRENT', 'current', 'QUANTITY', 'quantity',
    ])),
  };
}

async function listAllTableRows(tableId) {
  const pageSize = 500;
  const rows = [];
  let offset = 0;

  while (true) {
    const result = await tablesDb.listRows({
      databaseId: dataDatabaseId,
      tableId,
      queries: [Query.limit(pageSize), Query.offset(offset)],
    });

    const batch = result?.rows || [];
    rows.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function listAllDocuments(collectionId) {
  const pageSize = 500;
  const documents = [];
  let offset = 0;

  while (true) {
    const result = await databases.listDocuments({
      databaseId: dataDatabaseId,
      collectionId,
      queries: [Query.limit(pageSize), Query.offset(offset)],
    });

    const batch = result?.documents || [];
    documents.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return documents;
}

function ensureDataDatabaseConfigured() {
  if (!dataDatabaseId) {
    throw normalizeAppwriteError(
      null,
      'Missing Appwrite data database ID. Set VITE_APPWRITE_DATA_DB_ID (or VITE_APPWRITE_DB_ID).',
    );
  }
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function sanitizeOptionalNumber(value) {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeRequiredNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function createRowInTable(tableId, payload) {
  return tablesDb.createRow({
    databaseId: dataDatabaseId,
    tableId,
    rowId: ID.unique(),
    data: payload,
  });
}

async function createDocumentInCollection(collectionId, payload) {
  return databases.createDocument({
    databaseId: dataDatabaseId,
    collectionId,
    documentId: ID.unique(),
    data: payload,
  });
}

async function updateConfiguredRecord({
  source,
  recordId,
  payload,
  tableId,
  collectionId,
  configurationMessage,
}) {
  ensureDataDatabaseConfigured();

  if (source === 'table' && tableId) {
    await tablesDb.updateRow({
      databaseId: dataDatabaseId,
      tableId,
      rowId: recordId,
      data: payload,
    });
    return;
  }

  if (source === 'collection' && collectionId) {
    await databases.updateDocument({
      databaseId: dataDatabaseId,
      collectionId,
      documentId: recordId,
      data: payload,
    });
    return;
  }

  throw normalizeAppwriteError(null, configurationMessage);
}

async function deleteConfiguredRecord({
  source,
  recordId,
  tableId,
  collectionId,
  configurationMessage,
}) {
  ensureDataDatabaseConfigured();

  if (source === 'table' && tableId) {
    await tablesDb.deleteRow({
      databaseId: dataDatabaseId,
      tableId,
      rowId: recordId,
    });
    return;
  }

  if (source === 'collection' && collectionId) {
    await databases.deleteDocument({
      databaseId: dataDatabaseId,
      collectionId,
      documentId: recordId,
    });
    return;
  }

  throw normalizeAppwriteError(null, configurationMessage);
}

function buildReceiptPayload(record) {
  const payload = {
    INPUT_BY: sanitizeText(record?.INPUT_BY ?? record?.inputBy),
    INPUT_DATE: sanitizeText(record?.INPUT_DATE ?? record?.inputDate),
    ITEM_NAME: sanitizeText(record?.ITEM_NAME ?? record?.itemName),
    ITEM_TYPE: sanitizeText(record?.ITEM_TYPE ?? record?.itemType),
    PRICE: sanitizeRequiredNumber(record?.PRICE ?? record?.price),
    QUANTITY: sanitizeRequiredNumber(record?.QUANTITY ?? record?.quantity),
    TOTAL_PRICE: sanitizeRequiredNumber(record?.TOTAL_PRICE ?? record?.totalPrice),
  };

  if (
    hasOwnField(record, 'NOTE')
    || hasOwnField(record, 'note')
    || hasOwnField(record, 'notes')
  ) {
    payload.NOTE = sanitizeText(record?.NOTE ?? record?.note ?? record?.notes);
  }

  return payload;
}

export async function pingAppwrite() {
  try {
    return await client.ping();
  } catch (error) {
    throw normalizeAppwriteError(error, 'Unable to ping Appwrite.');
  }
}

export async function createEmailPasswordSession(email, password) {
  try {
    return await account.createEmailPasswordSession(email, password);
  } catch (error) {
    throw normalizeAppwriteError(error, 'Authentication request failed.');
  }
}

export async function getCurrentAccount() {
  try {
    return await account.get();
  } catch (error) {
    throw normalizeAppwriteError(error, 'Unable to fetch current account.');
  }
}

export async function deleteCurrentSession() {
  try {
    return await account.deleteSession('current');
  } catch (error) {
    throw normalizeAppwriteError(error, 'Unable to close the current session.');
  }
}

export async function listMasterlistRecords() {
  ensureDataDatabaseConfigured();

  const errors = [];

  if (masterlistTableId) {
    try {
      const rows = await listAllTableRows(masterlistTableId);
      return rows.map((row) => normalizeMasterlistRecord(row, 'table')).filter(Boolean);
    } catch (error) {
      errors.push(error);
    }
  }

  if (masterlistCollectionId) {
    try {
      const documents = await listAllDocuments(masterlistCollectionId);
      return documents.map((document) => normalizeMasterlistRecord(document, 'collection')).filter(Boolean);
    } catch (error) {
      errors.push(error);
    }
  }

  throw normalizeAppwriteError(
    errors[0],
    'Masterlist source is not configured. Set VITE_APPWRITE_MASTERLIST_TABLE_ID or VITE_APPWRITE_MASTERLIST_COLLECTION_ID.',
  );
}

export async function listReceiptRecords() {
  if (!dataDatabaseId) {
    return [];
  }

  const errors = [];

  if (receiptsTableId) {
    try {
      const rows = await listAllTableRows(receiptsTableId);
      return rows.map((row) => normalizeReceiptRecord(row, 'table'));
    } catch (error) {
      errors.push(error);
    }
  }

  if (receiptsCollectionId) {
    try {
      const documents = await listAllDocuments(receiptsCollectionId);
      return documents.map((document) => normalizeReceiptRecord(document, 'collection'));
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw normalizeAppwriteError(errors[0], 'Unable to load receipt records.');
  }

  return [];
}

export async function listInventoryRecords() {
  if (!dataDatabaseId) {
    return [];
  }

  const errors = [];

  if (inventoryTableId) {
    try {
      const rows = await listAllTableRows(inventoryTableId);
      return rows.map((row) => normalizeInventoryRecord(row, 'table')).filter(Boolean);
    } catch (error) {
      errors.push(error);
    }
  }

  if (inventoryCollectionId) {
    try {
      const documents = await listAllDocuments(inventoryCollectionId);
      return documents.map((document) => normalizeInventoryRecord(document, 'collection')).filter(Boolean);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw normalizeAppwriteError(errors[0], 'Unable to load inventory records.');
  }

  throw normalizeAppwriteError(
    errors[0],
    'Inventory source is not configured. Set VITE_APPWRITE_INVENTORY_TABLE_ID or VITE_APPWRITE_INVENTORY_COLLECTION_ID.',
  );
}

async function updateInventoryRecord(recordId, nextCurrentInv, source = 'table') {
  await updateConfiguredRecord({
    source,
    recordId,
    payload: {
      CURRENT_INV: nextCurrentInv,
    },
    tableId: inventoryTableId,
    collectionId: inventoryCollectionId,
    configurationMessage: 'Inventory source is not configured. Set VITE_APPWRITE_INVENTORY_TABLE_ID or VITE_APPWRITE_INVENTORY_COLLECTION_ID.',
  });
}

async function syncReceiptRowsWithInventory(receiptRows, mode = 'decrement') {
  if (!Array.isArray(receiptRows) || receiptRows.length === 0) {
    return {
      matchedItemCount: 0,
      skippedItemCount: 0,
      updatedRowCount: 0,
      skippedItems: [],
    };
  }

  const inventoryRecords = await listInventoryRecords();
  const variantMatches = new Map();
  const detailMatches = new Map();
  const descMatches = new Map();
  const exactMatches = new Map();
  const itemNameMatches = new Map();

  inventoryRecords.forEach((record) => {
    const variantKey = buildInventoryVariantKey(
      record.category,
      record.itemName,
      record.itemDesc,
      record.unit,
      record.brand,
    );
    if (!variantMatches.has(variantKey)) variantMatches.set(variantKey, []);
    variantMatches.get(variantKey).push(record);

    const detailKey = buildInventoryDetailKey(
      record.category,
      record.itemName,
      record.itemDesc,
      record.unit,
    );
    if (!detailMatches.has(detailKey)) detailMatches.set(detailKey, []);
    detailMatches.get(detailKey).push(record);

    const descKey = buildInventoryDescKey(record.category, record.itemName, record.itemDesc);
    if (!descMatches.has(descKey)) descMatches.set(descKey, []);
    descMatches.get(descKey).push(record);

    const exactKey = buildInventoryKey(record.category, record.itemName);
    if (!exactMatches.has(exactKey)) exactMatches.set(exactKey, []);
    exactMatches.get(exactKey).push(record);

    const itemKey = normalizeLookup(record.itemName);
    if (!itemNameMatches.has(itemKey)) itemNameMatches.set(itemKey, []);
    itemNameMatches.get(itemKey).push(record);
  });

  const groupedReceiptRows = new Map();
  receiptRows.forEach((record) => {
    const itemType = String(record?.ITEM_TYPE || record?.itemType || '').trim();
    const itemName = String(record?.ITEM_NAME || record?.itemName || '').trim();
    const itemDesc = String(record?.ITEM_DESC || record?.itemDesc || '').trim();
    const unit = String(record?.ITEM_UNIT || record?.itemUnit || record?.unit || '').trim();
    const brand = String(record?.BRAND || record?.brand || '').trim();
    const quantity = parseNumber(record?.QUANTITY ?? record?.quantity) || 0;
    if (!itemName || quantity <= 0) return;

    const key = buildInventoryVariantKey(itemType, itemName, itemDesc, unit, brand);
    const existing = groupedReceiptRows.get(key) || {
      itemType,
      itemName,
      itemDesc,
      unit,
      brand,
      quantity: 0,
    };
    existing.quantity += quantity;
    groupedReceiptRows.set(key, existing);
  });

  let matchedItemCount = 0;
  let skippedItemCount = 0;
  let updatedRowCount = 0;
  const skippedItems = [];

  for (const {
    itemType,
    itemName,
    itemDesc,
    unit,
    brand,
    quantity,
  } of groupedReceiptRows.values()) {
    const variantKey = buildInventoryVariantKey(itemType, itemName, itemDesc, unit, brand);
    const categorylessVariantKey = buildInventoryVariantKey('', itemName, itemDesc, unit, brand);
    const detailKey = buildInventoryDetailKey(itemType, itemName, itemDesc, unit);
    const categorylessDetailKey = buildInventoryDetailKey('', itemName, itemDesc, unit);
    const descKey = buildInventoryDescKey(itemType, itemName, itemDesc);
    const categorylessDescKey = buildInventoryDescKey('', itemName, itemDesc);
    const exactKey = buildInventoryKey(itemType, itemName);
    const categorylessExactKey = buildInventoryKey('', itemName);
    const nameKey = normalizeLookup(itemName);
    const hasSpecificVariantInput = Boolean(itemDesc || unit || brand);
    const matches = hasSpecificVariantInput
      ? (
          variantMatches.get(variantKey)
          || variantMatches.get(categorylessVariantKey)
          || detailMatches.get(detailKey)
          || detailMatches.get(categorylessDetailKey)
          || (itemDesc && !unit ? descMatches.get(descKey) : null)
          || (itemDesc && !unit ? descMatches.get(categorylessDescKey) : null)
          || []
        )
      : (
          exactMatches.get(exactKey)
          || exactMatches.get(categorylessExactKey)
          || itemNameMatches.get(nameKey)
          || []
        );

    if (matches.length === 0) {
      skippedItemCount += 1;
      skippedItems.push(
        itemType
          ? `${itemType}: ${itemName}${itemDesc ? ` (${itemDesc})` : ''}${unit ? ` [${unit}]` : ''}`
          : `${itemName}${itemDesc ? ` (${itemDesc})` : ''}${unit ? ` [${unit}]` : ''}`,
      );
      continue;
    }

    const baselineCurrent = matches.find((match) => Number.isFinite(match.currentInv))?.currentInv ?? 0;
    const inventoryDelta = mode === 'increment' ? quantity : -quantity;
    const nextCurrentInv = Math.max(0, baselineCurrent + inventoryDelta);

    for (const match of matches) {
      if (!match.id) continue;
      await updateInventoryRecord(String(match.id), nextCurrentInv, match.source);
      updatedRowCount += 1;
    }

    matchedItemCount += 1;
  }

  return {
    matchedItemCount,
    skippedItemCount,
    updatedRowCount,
    skippedItems,
  };
}

export async function applyReceiptRowsToInventory(receiptRows) {
  return syncReceiptRowsWithInventory(receiptRows, 'decrement');
}

export async function restoreReceiptRowsToInventory(receiptRows) {
  return syncReceiptRowsWithInventory(receiptRows, 'increment');
}

export async function createReceiptRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  ensureDataDatabaseConfigured();

  const payloads = records.map(buildReceiptPayload);

  const errors = [];
  let created = 0;

  if (receiptsTableId) {
    try {
      for (const payload of payloads) {
        await createRowInTable(receiptsTableId, payload);
        created += 1;
      }
      return created;
    } catch (error) {
      errors.push(error);
      created = 0;
    }
  }

  if (receiptsCollectionId) {
    try {
      for (const payload of payloads) {
        await createDocumentInCollection(receiptsCollectionId, payload);
        created += 1;
      }
      return created;
    } catch (error) {
      errors.push(error);
      created = 0;
    }
  }

  throw normalizeAppwriteError(
    errors[0],
    'Receipts destination is not configured. Set VITE_APPWRITE_RECEIPTS_TABLE_ID or VITE_APPWRITE_RECEIPTS_COLLECTION_ID.',
  );
}

export async function createReceiptRecord(record) {
  const created = await createReceiptRecords([record]);
  return created === 1;
}

export async function updateReceiptRecord(recordId, source, record) {
  await updateConfiguredRecord({
    source,
    recordId,
    payload: buildReceiptPayload(record),
    tableId: receiptsTableId,
    collectionId: receiptsCollectionId,
    configurationMessage: 'Receipts destination is not configured. Set VITE_APPWRITE_RECEIPTS_TABLE_ID or VITE_APPWRITE_RECEIPTS_COLLECTION_ID.',
  });
}

export async function deleteReceiptRecord(recordId, source) {
  await deleteConfiguredRecord({
    source,
    recordId,
    tableId: receiptsTableId,
    collectionId: receiptsCollectionId,
    configurationMessage: 'Receipts destination is not configured. Set VITE_APPWRITE_RECEIPTS_TABLE_ID or VITE_APPWRITE_RECEIPTS_COLLECTION_ID.',
  });
}

export async function createMasterlistRecord(record, fieldKeys = null) {
  ensureDataDatabaseConfigured();
  const errors = [];

  if (masterlistTableId) {
    try {
      await executeMasterlistMutation(
        (payload) => createRowInTable(masterlistTableId, payload),
        record,
        fieldKeys,
      );
      return true;
    } catch (error) {
      errors.push(error);
    }
  }

  if (masterlistCollectionId) {
    try {
      await executeMasterlistMutation(
        (payload) => createDocumentInCollection(masterlistCollectionId, payload),
        record,
        fieldKeys,
      );
      return true;
    } catch (error) {
      errors.push(error);
    }
  }

  throw normalizeAppwriteError(
    errors[0],
    'Masterlist source is not configured. Set VITE_APPWRITE_MASTERLIST_TABLE_ID or VITE_APPWRITE_MASTERLIST_COLLECTION_ID.',
  );
}

export async function updateMasterlistRecord(recordId, source, record, fieldKeys = null) {
  ensureDataDatabaseConfigured();

  if (source === 'table' && masterlistTableId) {
    await executeMasterlistMutation(
      (payload) => tablesDb.updateRow({
        databaseId: dataDatabaseId,
        tableId: masterlistTableId,
        rowId: recordId,
        data: payload,
      }),
      record,
      fieldKeys,
    );
    return;
  }

  if (source === 'collection' && masterlistCollectionId) {
    await executeMasterlistMutation(
      (payload) => databases.updateDocument({
        databaseId: dataDatabaseId,
        collectionId: masterlistCollectionId,
        documentId: recordId,
        data: payload,
      }),
      record,
      fieldKeys,
    );
    return;
  }

  throw normalizeAppwriteError(
    null,
    'Masterlist source is not configured. Set VITE_APPWRITE_MASTERLIST_TABLE_ID or VITE_APPWRITE_MASTERLIST_COLLECTION_ID.',
  );
}

export async function deleteMasterlistRecord(recordId, source) {
  await deleteConfiguredRecord({
    source,
    recordId,
    tableId: masterlistTableId,
    collectionId: masterlistCollectionId,
    configurationMessage: 'Masterlist source is not configured. Set VITE_APPWRITE_MASTERLIST_TABLE_ID or VITE_APPWRITE_MASTERLIST_COLLECTION_ID.',
  });
}
