const express = require('express');
const path = require('path');
const session = require('express-session');
const EbayAuthToken = require('ebay-oauth-nodejs-client');
const { getSupabase, isSupabaseConfigured, getDashboardListings, getPendingListings, getLogs, getListingDetailsBySku } = require('./supabase/client');
const { getEbayAccessToken, getEbaySignInUrl, exchangeAuthCodeForTokens, getRequestedScopes } = require('./ebay');
const { ebaySetup, getEbayPostingStatusForSku, getActiveListings } = require('./ebay/ebay');
const { types, getAspects } = require('./ebay/ebay_categories');
const { generateImageModel1 } = require('./ebay/openai_image');
const { generateSKU, generateListing } = require('./util/post_new_item');
const { beginMint, endMint, getAccessToken } = require('./ebay/minting');
const debug = require('./debug/debug');

const DEFAULT_LOGIN_EMAIL = 'michael.m.hulbert@gmail.com';
const DEFAULT_LOGIN_PASSCODE = process.env.LOGIN_PASSCODE || 'passcode';
	
// Minimal Express app — stripped of routes and middleware.
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(express.static(path.join(__dirname, '../public')));
app.use('/icons', express.static(path.join(__dirname, '../icons')));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(
	session({
		secret: process.env.SESSION_SECRET || 'dev-session-secret',
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: 1000 * 60 * 60 * 24 * 7,
		},
	})
);

app.use((req, res, next) => {
	if (!req.session.user) {
		req.session.user = {
			id: 'local-dev-user',
			email: DEFAULT_LOGIN_EMAIL,
		};
	}
	res.locals.currentUser = req.session.user || null;
	next();
});

function requireAuth(req, res, next) {
	return next();
}

function hydrateEbaySessionToken(req) {
	if (req.session.ebayAccessToken && !process.env.EBAY_ACCESS_TOKEN) {
		process.env.EBAY_ACCESS_TOKEN = req.session.ebayAccessToken;
	}
	if (req.session.ebayRefreshToken && !process.env.EBAY_REFRESH_TOKEN) {
		process.env.EBAY_REFRESH_TOKEN = req.session.ebayRefreshToken;
	}
	return Boolean(process.env.EBAY_ACCESS_TOKEN || req.session.ebayAccessToken);
}

async function ensureEbayAccessToken(req) {
	try {
		const token = await getAccessToken();
		if (token) {
			process.env.EBAY_ACCESS_TOKEN = token;
			if (req?.session) {
				req.session.ebayAccessToken = token;
			}
			return true;
		}
		console.log('[ensureEbayAccessToken] minting fresh eBay token with env:', process.env.EBAY_ENV || 'PRODUCTION');
		const freshToken = await getEbayAccessToken({
			forceRefresh: true,
			environment: process.env.EBAY_ENV || 'PRODUCTION',
			scopes: process.env.EBAY_SCOPES,
		});
		if (freshToken) {
			console.log('[ensureEbayAccessToken] token minted successfully:', `${freshToken.slice(0, 16)}...`);
			process.env.EBAY_ACCESS_TOKEN = freshToken;
			if (req?.session) {
				req.session.ebayAccessToken = freshToken;
			}
			return true;
		}
	} catch (err) {
		console.error('[ensureEbayAccessToken] Failed:', err.message || err);
	}

	return false;
}

app.get('/', (req, res) => {
	return res.redirect('/dashboard');
});

app.get('/settings', requireAuth, async (req, res) => {
	return res.render('settings', {
		currentUser: req.session.user,
	});
});

app.get('/settings/logs', requireAuth, async (req, res) => {
	let logs = [];

	try {
		logs = await getLogs();
	} catch (err) {
		console.warn('[GET /settings/logs] Unable to load logs:', err.message || err);
		logs = [];
	}

	return res.render('logs', {
		currentUser: req.session.user,
		logs,
	});
});

app.get('/dashboard', requireAuth, async (req, res) => {
	let listings = [];
	let pendingListings = [];
	let error = null;
	let ebayConnectionError = null;

	try {
		if (!isSupabaseConfigured()) {
			throw new Error('Database is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
		}

		const [rows, pendingRows] = await Promise.all([
			getDashboardListings(),
			getPendingListings(),
		]);
		const now = Date.now();
		const msPerDay = 1000 * 60 * 60 * 24;

		listings = rows.map((row) => {
			const createdAtValue = row.created_at ? Date.parse(row.created_at) : NaN;
			const daysActive = Number.isFinite(createdAtValue)
				? Math.max(0, Math.floor((now - createdAtValue) / msPerDay))
				: null;

			const parsedPrice = row.price === null || row.price === undefined ? NaN : Number(row.price);

			return {
				title: row.title || 'Untitled listing',
				sku: row.sku || '—',
				priceDisplay: Number.isFinite(parsedPrice) ? `$${parsedPrice.toFixed(2)}` : '—',
				ageDisplay: daysActive === null ? '—' : String(daysActive),
			};
		});

		pendingListings = Array.isArray(pendingRows) ? pendingRows : [];
	} catch (err) {
		error = err.message || 'Unable to load listing table rows.';
	}

	try {
		await getActiveListings();
	} catch (err) {
		ebayConnectionError = 'Not connected to eBay API';
		console.warn('[GET /dashboard] eBay API connection check failed:', err.message || err);
	}

	return res.render('dashboard', {
		listings,
		pendingListings,
		skuQuery: '',
		error,
		ebayConnectionError,
		currentUser: req.session.user,
	});
});

app.get('/setupEbay', requireAuth, async (req, res) => {
	try {
		return await beginMint(res);
	} catch (err) {
		console.error('[GET /setupEbay] Failed:', err.message || err);
		return res.redirect(`/dashboard?setup=error&message=${encodeURIComponent(err.message || 'Unable to start eBay auth flow.')}`);
	}
});

app.get('/create-listing', requireAuth, async (req, res) => {
	hydrateEbaySessionToken(req);
	const categoryOptions = Object.values(types).map((type) => ({
		value: type.name,
		label: type.name,
	}));

	const selectedCategory = typeof req.query.category === 'string' ? req.query.category : '';
	const rawStep = typeof req.query.step === 'string' ? req.query.step.toLowerCase() : '';
	const currentStep = selectedCategory ? (rawStep === 'photos' ? 'photos' : rawStep === 'summary' ? 'summary' : 'options') : 'category';
	let selectedType = null;
	let aspects = [];
	let aspectError = null;

	if (selectedCategory) {
		selectedType = Object.values(types).find((type) => type.name === selectedCategory) || null;

		if (selectedType) {
			try {
				const typeData = await getAspects(selectedType);
				aspects = Array.isArray(typeData?.aspects) ? typeData.aspects : [];
			} catch (err) {
				aspectError = err.message || 'Unable to load this category options.';
			}
		}
	}

	return res.render('create-listing', {
		currentUser: req.session.user,
		categoryOptions,
		selectedCategory,
		selectedType,
		aspects,
		aspectError,
		currentStep,
	});
});

app.post('/api/listing/generate', requireAuth, async (req, res) => {
	try {
		hydrateEbaySessionToken(req);
		const frontImage64 = typeof req.body?.frontImage64 === 'string' ? req.body.frontImage64 : '';
		const backImage64 = typeof req.body?.backImage64 === 'string' ? req.body.backImage64 : '';
		const rawTagImage64 = typeof req.body?.tagImage64 === 'string' ? req.body.tagImage64 : undefined;
		const tagImage64 = rawTagImage64 && rawTagImage64.trim() ? rawTagImage64 : undefined;
		const rawInfo = req.body?.info && typeof req.body.info === 'object' ? req.body.info : {};
		const info = {
			...rawInfo,
			features: rawInfo.features ?? rawInfo.aspects ?? {},
		};

		if (typeof info.category === 'string' && info.category.trim() && !info.categoryId) {
			const selectedType = Object.values(types).find((type) => type.name === info.category) || null;
			if (selectedType) {
				const typeData = await getAspects(selectedType);
				if (typeData?.categoryId) {
					info.categoryId = Number(typeData.categoryId);
				}
			}
		}

		if (info.categoryId !== undefined && info.categoryId !== null && info.categoryId !== '') {
			info.categoryId = Number(info.categoryId);
		}

		if (!Number.isFinite(Number(info.categoryId)) || Number(info.categoryId) <= 0) {
			return res.status(400).json({
				error: 'A valid eBay category is required before generating this listing.',
			});
		}

		if (!frontImage64 || !backImage64) {
			return res.status(400).json({
				error: 'Front and back photos are required before generating a listing.',
			});
		}

		const sku = await generateSKU();
		void generateListing(frontImage64, backImage64, tagImage64, sku, info).catch((err) => {
			console.error('[POST /api/listing/generate] Background listing generation failed:', err);
		});

		return res.json({
			ok: true,
			sku,
		});
	} catch (err) {
		console.error('[POST /api/listing/generate] Failed:', err);
		return res.status(500).json({
			error: err.message || 'Unable to generate the listing right now.',
		});
	}
});

app.get('/listing/submitted', requireAuth, (req, res) => {
	const sku = typeof req.query.sku === 'string' ? req.query.sku : '';

	if (!sku) {
		return res.redirect('/dashboard');
	}

	return res.render('listing-submitted', {
		currentUser: req.session.user,
		sku,
	});
});

app.get('/api/listing/:sku/details', requireAuth, async (req, res) => {
	const sku = typeof req.params.sku === 'string' ? req.params.sku.trim() : '';

	if (!sku) {
		return res.status(400).json({ error: 'SKU is required.' });
	}

	try {
		if (!isSupabaseConfigured()) {
			return res.status(500).json({ error: 'Database is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.' });
		}

		const { listing, images } = await getListingDetailsBySku(sku);
		const createdAtValue = listing?.created_at ? Date.parse(listing.created_at) : NaN;
		const daysActive = Number.isFinite(createdAtValue)
			? Math.max(0, Math.floor((Date.now() - createdAtValue) / (1000 * 60 * 60 * 24)))
			: null;

		let ebayPostedStatus = {
			posted: false,
			status: 'UNKNOWN',
			message: 'cant verify ebay posting status'
		};
		try {
			if (await ensureEbayAccessToken(req)) {
				ebayPostedStatus = await getEbayPostingStatusForSku(sku);
			} else {
				ebayPostedStatus = {
					posted: false,
					status: 'UNKNOWN',
					message: 'ebay token unavailable'
				};
			}
		} catch (err) {
			console.warn('[GET /api/listing/:sku/details] Unable to load eBay posting status:', err.message || err);
		}

		return res.json({
			ok: true,
			listing: {
				title: listing?.title || 'Untitled listing',
				description: listing?.description || '',
				price: listing?.price === null || listing?.price === undefined ? null : Number(listing.price),
				bin: listing?.bin ?? null,
				sn: listing?.sn ?? null,
				sku: listing?.sku || sku,
				categoryId: listing?.category_id || null,
				condition: listing?.condition || null,
				aspects: listing?.aspects || {},
				state: listing?.state || null,
				createdAt: listing?.created_at || null,
				ageDays: daysActive,
				ebayPostedStatus,
			},
			images: images || [],
		});
	} catch (err) {
		const message = err?.code === 'PGRST116'
			? 'Listing not found for this SKU.'
			: (err.message || 'Unable to load listing details.');

		return res.status(err?.code === 'PGRST116' ? 404 : 500).json({ error: message });
	}
});

app.post('/api/generate-listing-images', requireAuth, async (req, res) => {
	try {
		const category = typeof req.body?.category === 'string' ? req.body.category : '';
		const features = req.body?.features && typeof req.body.features === 'object' ? req.body.features : {};
		const frontImage = typeof req.body?.frontImage === 'string' ? req.body.frontImage : '';
		const backImage = typeof req.body?.backImage === 'string' ? req.body.backImage : '';

		if (!category || !frontImage || !backImage) {
			return res.status(400).json({
				error: 'Category and both front/back photos are required to generate images.',
			});
		}

		const sku = typeof req.body?.sku === 'string' ? req.body.sku.trim() : null;
		const generated = await generateImageModel1(category, features, frontImage, backImage, sku);
		return res.json({
			ok: true,
			modelDescription: generated?.modelDescription || null,
			pose2Description: generated?.pose2Description || null,
			images: generated?.images || {},
		});
	} catch (err) {
		console.error('[POST /api/generate-listing-images] Failed:', err);
		return res.status(500).json({
			error: err.message || 'Unable to generate the listing images right now.',
		});
	}
});

app.post('/logout', (req, res) => {
	req.session.destroy(() => {
		res.redirect('/dashboard');
	});
});

// Basic health check left in for convenience.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/auth/ebay/login', async (req, res) => {
	try {
		return beginMint(res);
	} catch (err) {
		return res.status(500).json({ error: err.message || String(err) });
	}
});

app.post('/auth/ebay/login', async (req, res) => {
	try {
		return beginMint(res);
	} catch (err) {
		return res.status(500).json({ error: err.message || String(err) });
	}
});

function renderEbaySuccessPage(code="") {
	return `<!doctype html>
		<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>Successful</title>
			<script>
				// This JavaScript runs when the browser parses this script block
				console.log("${code}");
			</script>
			<style>
				:root {
					--bg1: #f7e1dc;
					--bg2: #f4e9f7;
					--panel: rgba(255,255,255,0.32);
					--border: #d3817d;
					--text: #6c2e2b;
				}
				* { box-sizing: border-box; }
				body {
					margin: 0;
					min-height: 100vh;
					display: grid;
					place-items: center;
					font-family: Arial, Helvetica, sans-serif;
					background: linear-gradient(135deg, var(--bg1), var(--bg2));
					color: var(--text);
				}
				.card {
					width: min(92vw, 760px);
					padding: 32px 24px;
					border-radius: 22px;
					border: 2px solid var(--border);
					background: var(--panel);
					text-align: center;
					box-shadow: 0 10px 30px rgba(96, 41, 36, 0.08);
				}
				h1 {
					margin: 0 0 16px;
					font-size: clamp(2.2rem, 4vw, 4rem);
					line-height: 1.1;
				}
				p {
					margin: 0;
					font-size: clamp(1rem, 2vw, 1.4rem);
				}
			</style>
		</head>
		<body>
			<main class="card">
				<h1>Successful</h1>
				<p>eBay authorization completed successfully.</p>
				<p>${code}</p>
			</main>
		</body>
		</html>`;
}

app.get('/auth/ebay/callback', async (req, res) => {
	const { code, state, error, error_description: errorDescription } = req.query;
	if (error) {
		return res.status(400).json({
			error: 'eBay authorization failed',
			details: errorDescription || error,
			state: state || null,
		});
	}

	try {
		if (!code || typeof code !== 'string') {
			const token = await getEbayAccessToken({
				forceRefresh: true,
				environment: process.env.EBAY_ENV || 'PRODUCTION',
				scopes: process.env.EBAY_SCOPES,
			});
			if (token) {
				process.env.EBAY_ACCESS_TOKEN = token;
				req.session.ebayAccessToken = token;
				return res.status(200).send(renderEbaySuccessPage());
			}
			return res.status(500).json({
				error: 'Unable to mint eBay access token from callback.',
				state: state || null,
			});
		}
		return endMint(res, req, code, state);
	} catch (err) {
		return res.status(500).json({
			error: 'Failed to exchange eBay auth code for tokens',
			details: err.message || String(err),
			state: state || null,
		});
	}
});

module.exports = app;


