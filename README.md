# eBay Helper (Express)

Simple Express + EJS web app for an eBay helper workflow.

## What is included

- Sign up page (`/signup`) and login page (`/login`)
- Three main app pages:
	- Current listings (`/listings`)
	- Create listing (`/create-listing`)
	- Market research (`/research`)
- Main route (`/`) redirects to `/listings`
- Card layout: square main image + listing details below
- Protected routes via session login
- eBay service stub ready to swap from mock data to live API
- Create Listing now supports multi-photo uploads plus OpenAI-powered clothing draft generation
- Browser extension scaffold lives in `browser-extension/ebay-autofill`

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Start in development mode:

```bash
npm run dev
```

4. Open:

```text
http://localhost:3000/login
```

## eBay API integration notes

- Current listing data is mock data in `src/services/ebayService.js`.
- Replace `getListings()` with calls to eBay Inventory/Trading APIs using OAuth token flow.
- The route `GET /api/listings` is already in place for frontend consumption.

## eBay OAuth redirect flow (localhost)

- Use `GET /auth/ebay/connect` to start eBay consent.
- Callback route is `GET /auth/ebay/callback`.
- Tokens are stored in session after successful callback, so you do not need to hard-code `EBAY_ACCESS_TOKEN`.
- Research calls prefer connected user token, then fallback to app token generation from client id/secret.
- Create Listing publish flow prefers the connected seller token, then falls back to `EBAY_ACCESS_TOKEN` if you still use an env token.

Set these values in `.env`:

```bash
EBAY_ENV=sandbox
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_REDIRECT_URI=<your-eBay-RuName-mapped-to-http://localhost:3000/auth/ebay/callback>
EBAY_SCOPES="https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/buy.browse"
EBAY_MERCHANT_LOCATION_KEY=...
EBAY_FULFILLMENT_POLICY_ID=...
EBAY_PAYMENT_POLICY_ID=...
EBAY_RETURN_POLICY_ID=...
EBAY_DEFAULT_CATEGORY_ID=...
EBAY_CURRENCY=USD
```

## Supabase auth and storage (started)

- Signup now uses Supabase Auth (`signUp`) and login uses `signInWithPassword`.
- Listings now load from Supabase table `listings` filtered by `user_id`.
- If Supabase is not configured yet, the app falls back to local login + mock listing data.

Set these in `.env`:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_LISTING_IMAGE_BUCKET=listing-photos
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-4.1-mini
```

SQL files you can run in Supabase SQL editor:

1. `sql/001_create_listings_table.sql`
2. `sql/002_enable_rls_policies.sql`
3. `sql/003_add_listing_ai_fields.sql`

## eBay autofill extension

- The extension loads ready listings from the local Express backend and autofills the active eBay Add Listing page.
- The backend routes are `GET /api/extension/ebay/listings`, `GET /api/extension/ebay/listings/:id`, and `PATCH /api/extension/ebay/listings/:id/status`.
- The extension code lives in `browser-extension/ebay-autofill`.
- Load it in Chrome from `chrome://extensions` using Developer mode and Load unpacked.

## AI listing draft workflow

- On `/create-listing`, upload up to 8 clothing photos and optionally enter the known size.
- Click `Generate Draft` to have OpenAI inspect the images and prefill title, description, item specifics, and a price suggestion.
- Generated photos are stored under `public/uploads/listing-photos` so the draft can survive a round trip before saving.
- The image list supports reorder and remove controls. The first image is treated as the primary image.
- `Save As Draft` always stores the listing in Supabase/local data.
- `Publish Listing` attempts a real eBay publish through Inventory + Offer APIs and also stores the result in Supabase/local data.
- If eBay publish fails, the app still saves the listing as a draft and shows the publish error in the success notice.
- If you publish with uploaded photos, configure Supabase storage so the app can convert local uploads into public image URLs for eBay.

Equivalent table SQL:

```sql
create table if not exists public.listings (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null,
	ebay_listing_id text,
	title text not null,
	main_image_url text,
	price numeric(12, 2),
	price_display text,
	sku text,
	quantity integer default 0,
	status text default 'Active',
	created_at timestamptz not null default now()
);

create index if not exists listings_user_created_idx on public.listings (user_id, created_at desc);
```
