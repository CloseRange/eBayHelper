const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

function isSupabaseConfigured() {
  return Boolean(supabase);
}

function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase client is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }

  return supabase;
}

async function getAllListingSkus() {
  const client = getSupabase();
  const { data, error } = await client.from('listing').select('sku');

  if (error) {
    console.log(error);
    throw error;
  }
  return (data || []).map((row) => row.sku).filter(Boolean);
}

async function getDashboardListings({ skuQuery = '', state = null } = {}) {
  const client = getSupabase();
  const normalizedSkuQuery = typeof skuQuery === 'string' ? skuQuery.trim() : '';
  const parsedState = state === null || state === undefined || state === '' ? null : Number(state);
  const hasStateFilter = Number.isFinite(parsedState);

  let query = client
    .from('listing')
    .select('title, price, sku, created_at')
    .order('created_at', { ascending: false });

  if (hasStateFilter) {
    query = query.eq('state', parsedState);
  }

  if (normalizedSkuQuery) {
    query = query.ilike('sku', `%${normalizedSkuQuery}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getDashboardListings] Supabase error:', error);
    throw error;
  }

  return data || [];
}

async function getPendingListings() {
  const client = getSupabase();

  let rows = [];
  let error = null;

  try {
    const { data, error: listingStateError } = await client
      .from('listing_state')
      .select('sku, title, state')
      .limit(200);

    error = listingStateError;
    rows = Array.isArray(data) ? data : [];
  } catch (err) {
    error = err;
  }

  if (error) {
    const errorMessage = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    const isMissingTable =
      errorMessage.includes('does not exist') ||
      (errorMessage.includes('relation') && errorMessage.includes('not found')) ||
      errorMessage.includes('not found') && errorMessage.includes('listing_state');

    if (isMissingTable) {
      return [];
    }

    console.error('[getPendingListings] Supabase error:', error);
    return [];
  }

  const stateIds = [...new Set(
    rows
      .map((row) => row?.state)
      .filter((state) => state !== null && state !== undefined && state !== '')
      .map((state) => {
        if (state && typeof state === 'object') {
          return state.id ?? state.state_id ?? state.stateId ?? null;
        }

        return state;
      })
      .filter((stateId) => stateId !== null && stateId !== undefined && stateId !== '')
  )];

  let statesById = new Map();

  if (stateIds.length) {
    const normalizedIds = [...new Set(
      stateIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id))
    )];

    if (normalizedIds.length) {
      const possibleTables = ['States', 'State', 'states', 'state'];

      for (const tableName of possibleTables) {
        try {
          const { data: stateRows, error: stateError } = await client
            .from(tableName)
            .select('id, name, color')
            .in('id', normalizedIds);

          if (stateError) {
            const stateMessage = typeof stateError.message === 'string' ? stateError.message.toLowerCase() : '';
            if (stateMessage.includes('does not exist') || stateMessage.includes('not found')) {
              continue;
            }
            break;
          }

          (stateRows || []).forEach((stateRow) => {
            if (stateRow && stateRow.id !== undefined && stateRow.id !== null) {
              statesById.set(String(stateRow.id), stateRow);
            }
          });

          if (statesById.size) {
            break;
          }
        } catch (stateLookupError) {
          console.warn('[getPendingListings] State lookup failed for table', tableName, stateLookupError);
        }
      }
    }
  }

  return rows.map((row) => {
    const rawState = row?.state;
    const resolvedState =
      rawState && typeof rawState === 'object' && !Array.isArray(rawState)
        ? rawState
        : statesById.get(String(rawState)) ||
          statesById.get(String(Number(rawState))) ||
          null;

    const stateName =
      resolvedState?.name ||
      resolvedState?.label ||
      resolvedState?.status ||
      (rawState === 0 || rawState === '0' ? 'Status 0' : 'Unknown');

    const stateColor = resolvedState?.color || '#B8A4E3';

    return {
      sku: row?.sku || '—',
      title: row?.title || 'Untitled listing',
      stateName,
      stateColor,
    };
  });
}

async function getLogs({ limit = 200 } = {}) {
  const client = getSupabase();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Number(limit))) : 200;

  const tablesToTry = ['logs', 'log'];

  for (const tableName of tablesToTry) {
    const { data, error } = await client
      .from(tableName)
      .select('created_at, caller, message, color, type')
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (!error) {
      return Array.isArray(data) ? data : [];
    }

    const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    if (message.includes('does not exist') || (message.includes('relation') && message.includes('not found'))) {
      continue;
    }

    console.error('[getLogs] Supabase error:', error);
    return [];
  }

  return [];
}

async function getSaleDetails() {
  const client = getSupabase();
  const selectVariants = [
    'sku, sold_price, days_alive, created_at',
    'sku, price, days_alive, created_at',
  ];

  let lastError = null;

  for (const selectClause of selectVariants) {
    const { data, error } = await client
      .from('sale_details')
      .select(selectClause)
      .order('created_at', { ascending: true });

    if (!error) {
      return (data || []).map((row) => ({
        sku: row?.sku || '—',
        sold_price: row?.sold_price !== undefined ? row.sold_price : row?.price,
        days_alive: row?.days_alive,
        created_at: row?.created_at || null,
      }));
    }

    lastError = error;
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    const askedForSoldPrice = selectClause.includes('sold_price');

    if (
      askedForSoldPrice &&
      (message.includes('column') || message.includes('schema cache')) &&
      message.includes('sold_price')
    ) {
      continue;
    }

    break;
  }

  console.error('[getSaleDetails] Supabase error:', lastError);
  throw lastError || new Error('Unable to load sale details.');
}

async function getPriceRates() {
  const client = getSupabase();
  const { data, error } = await client
    .from('price_rates')
    .select('id, price, days_to_change')
    .order('id', { ascending: true });

  if (error) {
    console.error('[getPriceRates] Supabase error:', error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function getListingsForPriceRateCheck({ state = null } = {}) {
  const client = getSupabase();
  const parsedState = state === null || state === undefined || state === '' ? null : Number(state);
  const hasStateFilter = Number.isFinite(parsedState);

  let query = client
    .from('listing')
    .select('sku, price, created_at, state')
    .order('created_at', { ascending: false });

  if (hasStateFilter) {
    query = query.eq('state', parsedState);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getListingsForPriceRateCheck] Supabase error:', error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function savePriceRate({ id, price, days_to_change }) {
  const client = getSupabase();
  const numericPrice = Number(price);
  const isProtectedBaseRate = Number(id) === 1;
  const numericDays = isProtectedBaseRate ? 0 : Number(days_to_change);

  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    throw new Error('Price must be a valid number greater than or equal to 0.');
  }

  if (!isProtectedBaseRate && (!Number.isInteger(numericDays) || numericDays < 0)) {
    throw new Error('Days to change must be a whole number greater than or equal to 0.');
  }

  const sanitizedPrice = Number(numericPrice.toFixed(2));

  if (isProtectedBaseRate) {
    const { data, error } = await client
      .from('price_rates')
      .update({
        price: sanitizedPrice,
        days_to_change: 0,
      })
      .eq('id', 1)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  if (id) {
    const { data, error } = await client
      .from('price_rates')
      .update({
        price: sanitizedPrice,
        days_to_change: numericDays,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await client
    .from('price_rates')
    .insert({
      price: sanitizedPrice,
      days_to_change: numericDays,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function deletePriceRate(id) {
  const client = getSupabase();
  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('Invalid price rate id.');
  }

  if (numericId === 1) {
    throw new Error('ID 1 is protected and cannot be deleted.');
  }

  const { error } = await client
    .from('price_rates')
    .delete()
    .eq('id', numericId);

  if (error) {
    throw error;
  }

  return true;
}

async function getListingDetailsBySku(sku) {
  const client = getSupabase();
  const normalizedSku = typeof sku === 'string' ? sku.trim() : '';

  if (!normalizedSku) {
    throw new Error('sku is required.');
  }

  let listing = null;
  let listingError = null;

  const primarySelect = await client
    .from('listing')
    .select('title, description, price, bin, sn, sku, category_id, condition, aspects, state, created_at')
    .eq('sku', normalizedSku)
    .single();

  listing = primarySelect.data;
  listingError = primarySelect.error;

  const missingStateColumn =
    listingError &&
    typeof listingError.message === 'string' &&
    listingError.message.toLowerCase().includes('column listing.state does not exist');

  if (missingStateColumn) {
    const fallbackSelect = await client
      .from('listing')
      .select('title, description, price, bin, sn, sku, category_id, condition, aspects, created_at')
      .eq('sku', normalizedSku)
      .single();

    listing = fallbackSelect.data ? { ...fallbackSelect.data, state: null } : null;
    listingError = fallbackSelect.error;
  }

  if (listingError) {
    throw listingError;
  }

  const { data: images, error: imagesError } = await client
    .from('listing_image')
    .select('image_url, image_order')
    .eq('sku', normalizedSku)
    .order('image_order', { ascending: true });

  if (imagesError) {
    throw imagesError;
  }

  return {
    listing,
    images: (images || []).map((row) => row.image_url).filter(Boolean),
  };
}

async function uploadBase64ImageToBucket({ bucketName, path, base64Data, mimeType = 'image/jpeg' }) {
  const client = getSupabase();

  if (!bucketName || !path) {
    throw new Error('bucketName and path are required.');
  }

  if (!base64Data) {
    return null;
  }

  const matches = base64Data.match(/^data:(image\/\w+);base64,(.*)$/);
  const cleanBase64 = matches ? matches[2] : base64Data;
  const actualMimeType = matches ? matches[1] : mimeType;

  const binary = Buffer.from(cleanBase64, 'base64');
  const { error } = await client.storage.from(bucketName).upload(path, binary, {
    contentType: actualMimeType,
    upsert: true,
  });

  if (error) {
    throw error;
  }

  const { data: publicUrlData } = client.storage.from(bucketName).getPublicUrl(path);
  return publicUrlData?.publicUrl || null;
}
async function createListing({
  title,
  description = null,
  price,
  bin = null,
  sn,
  sku,
  categoryId = null,
  condition = null,
  aspects = {}
}) {
  const client = getSupabase();

  if (!title) {
    throw new Error('title is required.');
  }

  if (price === undefined || price === null) {
    throw new Error('price is required.');
  }

  if (sn === undefined || sn === null) {
    throw new Error('sn is required.');
  }

  if (!sku) {
    throw new Error('sku is required.');
  }

  const { data, error } = await client
    .from('listing')
    .insert({
      title,
      description,
      price,
      bin,
      sn,
      sku,
      category_id: categoryId,
      condition,
      aspects
    })
    .select()
    .single();

  if (error) {
    console.error('[createListing] Supabase error:', error);
    throw error;
  }

  return data;
}
async function addListingImages(sku, imageUrls = []) {
  const client = getSupabase();

  if (!sku) {
    throw new Error('sku is required.');
  }

  if (!Array.isArray(imageUrls)) {
    throw new Error('imageUrls must be an array.');
  }

  const validUrls = imageUrls.filter(
    (url) =>
      typeof url === 'string' &&
      url.trim() !== ''
  );

  if (validUrls.length === 0) {
    return [];
  }

  const rows = validUrls.map((url, index) => ({
    sku,
    image_url: url.trim(),
    image_order: index
  }));

  const { data, error } = await client
    .from('listing_image')
    .insert(rows)
    .select();

  if (error) {
    console.error('[addListingImages] Supabase error:', error);
    throw error;
  }

  return data || [];
}
async function updateListingState(sku, newState, title) {
  const client = getSupabase();

  if (!sku) {
    return null;
  }

  if (!newState) {
    return null;
  }

  const { data, error } = await client
    .from('listing_state')
    .upsert({
      sku,
      state: newState,
      title
    })
    .select()
    .single();

  if (error) {
    console.error('[updateListingState] Supabase error:', error);
    return null;
  }

  return data;
}
async function updateListingTableState(sku, newState) {
  const client = getSupabase();

  if (!sku) {
    throw new Error('sku is required.');
  }

  if (newState === undefined || newState === null || newState === '') {
    throw new Error('newState is required.');
  }

  const parsedState = Number(newState);
  if (!Number.isFinite(parsedState)) {
    throw new Error('newState must be a number.');
  }

  const { data, error } = await client
    .from('listing')
    .update({
      state: parsedState,
    })
    .eq('sku', sku)
    .select('sku, state')
    .single();

  if (error) {
    console.error('[updateListingTableState] Supabase error:', error);
    throw error;
  }

  return data;
}
async function addSaleDetails({ sku, soldPrice, daysAlive }) {
  const client = getSupabase();

  if (!sku) {
    throw new Error('sku is required.');
  }

  if (soldPrice === undefined || soldPrice === null || soldPrice === '') {
    throw new Error('soldPrice is required.');
  }

  const parsedPrice = Number(soldPrice);
  if (!Number.isFinite(parsedPrice)) {
    throw new Error('soldPrice must be a number.');
  }

  const parsedDaysAlive = Number(daysAlive);
  if (!Number.isFinite(parsedDaysAlive)) {
    throw new Error('daysAlive must be a number.');
  }

  const rowOptions = [
    {
      sku,
      sold_price: parsedPrice,
      days_alive: parsedDaysAlive,
    },
    {
      sku,
      price: parsedPrice,
      days_alive: parsedDaysAlive,
    },
  ];

  let lastError = null;

  for (const row of rowOptions) {
    const { data, error } = await client
      .from('sale_details')
      .insert(row)
      .select()
      .single();

    if (!error) {
      return data;
    }

    lastError = error;

    const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    const triedSoldPriceColumn = Object.prototype.hasOwnProperty.call(row, 'sold_price');

    if (
      triedSoldPriceColumn &&
      (message.includes('column') || message.includes('schema cache')) &&
      message.includes('sold_price')
    ) {
      continue;
    }

    break;
  }

  console.error('[addSaleDetails] Supabase error:', lastError);
  throw lastError || new Error('Unable to add sale details.');
}
async function deleteListingState(sku) {
  const client = getSupabase();

  if (!sku) {
    return null;
  }

  const { data, error } = await client
    .from('listing_state')
    .delete()
    .eq('sku', sku)
    .select();

  if (error) {
    console.error('[deleteListingState] Supabase error:', error);
    return null;
  }

  return data;
}
async function addLog(caller, message, type, color) {
  const client = getSupabase();

  if (!caller || !message || !type) {
    return null;
  }

  const tablesToTry = ['logs', 'log'];

  for (const tableName of tablesToTry) {
    const { data, error } = await client
      .from(tableName)
      .insert({
        caller,
        message,
        type,
        color
      })
      .select()
      .single();

    if (!error) {
      return data;
    }

    const errorMessage = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    if (errorMessage.includes('does not exist') || (errorMessage.includes('relation') && errorMessage.includes('not found'))) {
      continue;
    }

    console.error('[addLog] Supabase error:', error);
    return null;
  }

  return null;
}

async function updatePrice(sku, newPrice) {
  const client = getSupabase();

  if (!sku) {
    throw new Error('sku is required.');
  }

  if (newPrice === undefined || newPrice === null) {
    throw new Error('newPrice is required.');
  }

  const { data, error } = await client
    .from('listing')
    .update({
      price: newPrice
    })
    .eq('sku', sku)
    .select()
    .single();

  console.log(`[updatePrice] Updated ${sku} to $${newPrice}`);
  if (error) {
    console.error('[updatePrice] Supabase error:', error);
    throw error;
  }

  return data;
}

function extractStorageObjectRefFromUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const pathname = decodeURIComponent(parsed.pathname || '');
  const patterns = [
    '/storage/v1/object/public/',
    '/storage/v1/object/sign/',
    '/storage/v1/object/authenticated/',
  ];

  for (const pattern of patterns) {
    const index = pathname.indexOf(pattern);
    if (index === -1) {
      continue;
    }

    const tail = pathname.slice(index + pattern.length).replace(/^\/+/, '');
    if (!tail) {
      continue;
    }

    const firstSlash = tail.indexOf('/');
    if (firstSlash === -1) {
      continue;
    }

    const bucket = tail.slice(0, firstSlash).trim();
    const objectPath = tail.slice(firstSlash + 1).trim();

    if (!bucket || !objectPath) {
      continue;
    }

    return {
      bucket,
      objectPath,
    };
  }

  return null;
}

async function deleteListingAndAssetsBySku(sku) {
  const client = getSupabase();
  const normalizedSku = typeof sku === 'string' ? sku.trim() : '';

  if (!normalizedSku) {
    throw new Error('sku is required.');
  }

  const { data: imageRows, error: imageLookupError } = await client
    .from('listing_image')
    .select('image_url')
    .eq('sku', normalizedSku);

  if (imageLookupError) {
    throw imageLookupError;
  }

  const objectsByBucket = new Map();
  for (const row of imageRows || []) {
    const ref = extractStorageObjectRefFromUrl(row?.image_url || '');
    if (!ref) {
      continue;
    }

    if (!objectsByBucket.has(ref.bucket)) {
      objectsByBucket.set(ref.bucket, new Set());
    }
    objectsByBucket.get(ref.bucket).add(ref.objectPath);
  }

  for (const [bucket, objectPathSet] of objectsByBucket.entries()) {
    const objectPaths = [...objectPathSet].filter(Boolean);
    if (!objectPaths.length) {
      continue;
    }

    const { error: storageDeleteError } = await client.storage
      .from(bucket)
      .remove(objectPaths);

    if (storageDeleteError) {
      throw storageDeleteError;
    }
  }

  const { error: listingImageDeleteError } = await client
    .from('listing_image')
    .delete()
    .eq('sku', normalizedSku);

  if (listingImageDeleteError) {
    throw listingImageDeleteError;
  }

  const { error: listingStateDeleteError } = await client
    .from('listing_state')
    .delete()
    .eq('sku', normalizedSku);

  if (listingStateDeleteError) {
    const stateDeleteMessage = typeof listingStateDeleteError.message === 'string'
      ? listingStateDeleteError.message.toLowerCase()
      : '';
    const isMissingListingStateTable =
      stateDeleteMessage.includes('does not exist') ||
      (stateDeleteMessage.includes('relation') && stateDeleteMessage.includes('not found'));

    if (!isMissingListingStateTable) {
      throw listingStateDeleteError;
    }
  }

  const { data: deletedListingRows, error: listingDeleteError } = await client
    .from('listing')
    .delete()
    .eq('sku', normalizedSku)
    .select('sku');

  if (listingDeleteError) {
    throw listingDeleteError;
  }

  if (!Array.isArray(deletedListingRows) || deletedListingRows.length === 0) {
    const notFoundError = new Error('Listing not found for this SKU.');
    notFoundError.code = 'PGRST116';
    throw notFoundError;
  }

  return {
    sku: normalizedSku,
    deletedListing: true,
    deletedImages: (imageRows || []).length,
  };
}

module.exports = {
  getSupabase,
  isSupabaseConfigured,
  getAllListingSkus,
  getDashboardListings,
  getPendingListings,
  getLogs,
  getSaleDetails,
  getPriceRates,
  getListingsForPriceRateCheck,
  savePriceRate,
  deletePriceRate,
  getListingDetailsBySku,
  uploadBase64ImageToBucket,
  createListing,
  addListingImages,
  updateListingState,
  updateListingTableState,
  addSaleDetails,
  deleteListingState,
  addLog,
  updatePrice,
  deleteListingAndAssetsBySku,
};
