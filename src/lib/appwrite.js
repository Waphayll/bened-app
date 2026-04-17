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
    'UNIT', 'unit', 'UNIT_OF_MEASUREMENT', 'unit_of_measurement', 'UOM', 'uom',
  ]);
  const defaultPrice = resolveField(record, [
    'DEFAULT_PRICE', 'default_price', 'PRICE', 'price', 'UNIT_PRICE', 'unit_price',
  ]);
  const salesTargetPct = resolveField(record, [
    'SALES_TARGET_PCT', 'sales_target_pct', 'TARGET_PCT', 'target_pct', 'SALES_TARGET', 'sales_target',
  ]);

  if (!itemType || !itemName) return null;

  return {
    itemType: String(itemType).trim(),
    itemName: String(itemName).trim(),
    unit: unit ? String(unit).trim() : '',
    defaultPrice: parseNumber(defaultPrice),
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
      const result = await tablesDb.listRows({
        databaseId: dataDatabaseId,
        tableId: masterlistTableId,
        queries: [Query.limit(500)],
      });
      return (result?.rows || []).map(normalizeMasterlistRecord).filter(Boolean);
    } catch (error) {
      errors.push(error);
    }
  }

  if (masterlistCollectionId) {
    try {
      const result = await databases.listDocuments({
        databaseId: dataDatabaseId,
        collectionId: masterlistCollectionId,
        queries: [Query.limit(500)],
      });
      return (result?.documents || []).map(normalizeMasterlistRecord).filter(Boolean);
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
      const result = await tablesDb.listRows({
        databaseId: dataDatabaseId,
        tableId: receiptsTableId,
        queries: [Query.limit(1000)],
      });
      return (result?.rows || []).map(normalizeReceiptRecord);
    } catch (error) {
      errors.push(error);
    }
  }

  if (receiptsCollectionId) {
    try {
      const result = await databases.listDocuments({
        databaseId: dataDatabaseId,
        collectionId: receiptsCollectionId,
        queries: [Query.limit(1000)],
      });
      return (result?.documents || []).map(normalizeReceiptRecord);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw normalizeAppwriteError(errors[0], 'Unable to load receipt records.');
  }

  return [];
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
