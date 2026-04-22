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

function normalizeMasterlistRecord(record) {
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
    itemType: String(itemType).trim(),
    itemName: String(itemName).trim(),
    unit: unit ? String(unit).trim() : '',
    itemDesc: itemDesc ? String(itemDesc).trim() : '',
    brand: brand ? String(brand).trim() : '',
    defaultPrice: parseNumber(defaultPrice),
    measurement: measurement ? String(measurement).trim() : '',
    salesTargetPct: parseNumber(salesTargetPct),
  };
}

function normalizeReceiptRecord(record) {
  return {
    inputBy: resolveField(record, ['INPUT_BY', 'input_by', 'inputBy']),
    inputDate: resolveField(record, ['INPUT_DATE', 'input_date', 'inputDate']),
    itemName: resolveField(record, ['ITEM_NAME', 'item_name', 'itemName']),
    itemType: resolveField(record, ['ITEM_TYPE', 'item_type', 'itemType']),
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
    id: resolveField(record, ['$id', 'id']),
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
  if (!dataDatabaseId) {
    throw normalizeAppwriteError(
      null,
      'Missing Appwrite data database ID. Set VITE_APPWRITE_DATA_DB_ID (or VITE_APPWRITE_DB_ID).',
    );
  }

  const errors = [];

  if (masterlistTableId) {
    try {
      const rows = await listAllTableRows(masterlistTableId);
      return rows.map(normalizeMasterlistRecord).filter(Boolean);
    } catch (error) {
      errors.push(error);
    }
  }

  if (masterlistCollectionId) {
    try {
      const documents = await listAllDocuments(masterlistCollectionId);
      return documents.map(normalizeMasterlistRecord).filter(Boolean);
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
      return rows.map(normalizeReceiptRecord);
    } catch (error) {
      errors.push(error);
    }
  }

  if (receiptsCollectionId) {
    try {
      const documents = await listAllDocuments(receiptsCollectionId);
      return documents.map(normalizeReceiptRecord);
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
  const payload = {
    CURRENT_INV: nextCurrentInv,
  };

  if (source === 'table' && inventoryTableId) {
    await tablesDb.updateRow({
      databaseId: dataDatabaseId,
      tableId: inventoryTableId,
      rowId: recordId,
      data: payload,
    });
    return;
  }

  if (source === 'collection' && inventoryCollectionId) {
    await databases.updateDocument({
      databaseId: dataDatabaseId,
      collectionId: inventoryCollectionId,
      documentId: recordId,
      data: payload,
    });
    return;
  }

  throw normalizeAppwriteError(
    null,
    'Inventory source is not configured. Set VITE_APPWRITE_INVENTORY_TABLE_ID or VITE_APPWRITE_INVENTORY_COLLECTION_ID.',
  );
}

export async function applyReceiptRowsToInventory(receiptRows) {
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
    const nextCurrentInv = Math.max(0, baselineCurrent - quantity);

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

export async function createReceiptRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  if (!dataDatabaseId) {
    throw normalizeAppwriteError(
      null,
      'Missing Appwrite data database ID. Set VITE_APPWRITE_DATA_DB_ID (or VITE_APPWRITE_DB_ID).',
    );
  }

  const payloads = records.map((record) => ({
    INPUT_BY: String(record.INPUT_BY || '').trim(),
    INPUT_DATE: String(record.INPUT_DATE || '').trim(),
    ITEM_NAME: String(record.ITEM_NAME || '').trim(),
    ITEM_TYPE: String(record.ITEM_TYPE || '').trim(),
    PRICE: Number(record.PRICE || 0),
    QUANTITY: Number(record.QUANTITY || 0),
    TOTAL_PRICE: Number(record.TOTAL_PRICE || 0),
  }));

  const errors = [];
  let created = 0;

  if (receiptsTableId) {
    try {
      for (const payload of payloads) {
        await tablesDb.createRow({
          databaseId: dataDatabaseId,
          tableId: receiptsTableId,
          rowId: ID.unique(),
          data: payload,
        });
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
        await databases.createDocument({
          databaseId: dataDatabaseId,
          collectionId: receiptsCollectionId,
          documentId: ID.unique(),
          data: payload,
        });
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
