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
  aspects = {},
  state = 'processing'
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
      aspects,
      state
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

module.exports = {
  getSupabase,
  isSupabaseConfigured,
  getAllListingSkus,
  uploadBase64ImageToBucket,
  createListing,
  addListingImages
};
