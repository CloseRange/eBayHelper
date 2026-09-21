const express = require('express');
const path = require('path');
const session = require('express-session');
const { getSupabase, isSupabaseConfigured } = require('./supabase/client');
const { getEbayAccessToken, getEbaySignInUrl, exchangeAuthCodeForTokens, getRequestedScopes } = require('./ebay');
const { getActiveListings } = require('./ebay/ebay');
const { types, getAspects } = require('./ebay/ebay_categories');
const { generateImageModel1 } = require('./ebay/openai_image');
const { generateSKU, generateListing } = require('./util/post_new_item');

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
	res.locals.currentUser = req.session.user || null;
	next();
});

function requireAuth(req, res, next) {
	if (!req.session.user) {
		return res.redirect('/login');
	}

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
	if (process.env.EBAY_ACCESS_TOKEN || req.session.ebayAccessToken) {
		hydrateEbaySessionToken(req);
		return true;
	}

	try {
		const token = await getEbayAccessToken({
			forceRefresh: true,
			environment: process.env.EBAY_ENV || 'PRODUCTION',
			scopes: process.env.EBAY_SCOPES,
		});
		if (token) {
			process.env.EBAY_ACCESS_TOKEN = token;
			req.session.ebayAccessToken = token;
			return true;
		}
	} catch (err) {
		console.error('[ensureEbayAccessToken] Failed:', err.message || err);
	}

	return false;
}

app.get('/', (req, res) => {
	if (req.session.user) {
		return res.redirect('/dashboard');
	}

	return res.redirect('/login');
});

app.get('/login', (req, res) => {
	if (req.session.user) {
		return res.redirect('/dashboard');
	}

	return res.render('login', {
		error: null,
		email: DEFAULT_LOGIN_EMAIL,
	});
});

app.post('/login', async (req, res) => {
	const email = DEFAULT_LOGIN_EMAIL;
	const password = typeof req.body.password === 'string' ? req.body.password : '';

	if (!password) {
		return res.status(400).render('login', {
			error: 'Please enter your passcode.',
			email,
		});
	}

	if (password === DEFAULT_LOGIN_PASSCODE) {
		req.session.user = {
			id: 'local-dev-user',
			email,
		};
		return res.redirect('/dashboard');
	}

	if (!isSupabaseConfigured()) {
		return res.status(401).render('login', {
			error: 'Invalid passcode.',
			email,
		});
	}

	try {
		const supabase = getSupabase();
		const { data, error } = await supabase.auth.signInWithPassword({ email, password });

		if (error || !data.user) {
			return res.status(401).render('login', {
				error: 'Invalid email or password.',
				email,
			});
		}

		req.session.user = {
			id: data.user.id,
			email: data.user.email,
		};

		return res.redirect('/dashboard');
	} catch (err) {
		return res.status(500).render('login', {
			error: err.message || 'Unable to sign in right now. Please try again.',
			email,
		});
	}
});

app.get('/dashboard', requireAuth, async (req, res) => {
	const hasEbayToken = await ensureEbayAccessToken(req);

	if (!hasEbayToken) {
		return res.status(500).render('dashboard', {
			listings: [],
			error: 'Unable to mint an eBay access token. Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.',
			currentUser: req.session.user,
		});
	}

	let listings = [];
	let error = null;

	try {
		if (process.env.EBAY_ACCESS_TOKEN || req.session.ebayAccessToken) {
			listings = await getActiveListings();
		}
	} catch (err) {
		error = err.message || 'Unable to load active listings.';
	}

	return res.render('dashboard', {
		listings,
		error,
		currentUser: req.session.user,
	});
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

		const generated = await generateImageModel1(category, features, frontImage, backImage);
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
		res.redirect('/login');
	});
});

// Basic health check left in for convenience.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/auth/ebay/login', async (req, res) => {
	try {
		const token = await getEbayAccessToken({
			forceRefresh: true,
			environment: process.env.EBAY_ENV || 'PRODUCTION',
			scopes: process.env.EBAY_SCOPES,
		});
		if (token) {
			process.env.EBAY_ACCESS_TOKEN = token;
			req.session.ebayAccessToken = token;
			return res.redirect('/dashboard');
		}
		return res.status(500).json({ error: 'Unable to mint eBay access token.' });
	} catch (err) {
		return res.status(500).json({ error: err.message || String(err) });
	}
});

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
				return res.redirect('/dashboard');
			}
			return res.status(500).json({
				error: 'Unable to mint eBay access token from callback.',
				state: state || null,
			});
		}

		const tokens = await exchangeAuthCodeForTokens({ code });

		if (tokens.accessToken) {
			process.env.EBAY_ACCESS_TOKEN = tokens.accessToken;
			req.session.ebayAccessToken = tokens.accessToken;
		}
		if (tokens.refreshToken) {
			process.env.EBAY_REFRESH_TOKEN = tokens.refreshToken;
			req.session.ebayRefreshToken = tokens.refreshToken;
		}

		return res.redirect('/dashboard');
	} catch (err) {
		return res.status(500).json({
			error: 'Failed to exchange eBay auth code for tokens',
			details: err.message || String(err),
			state: state || null,
		});
	}
});

module.exports = app;


