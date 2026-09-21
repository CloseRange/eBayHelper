const querystring = require('querystring');
const EbayAuthToken = require('ebay-oauth-nodejs-client');

const DEFAULT_EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  // 'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  // 'https://api.ebay.com/oauth/api_scope/sell.marketing',
  // 'https://api.ebay.com/oauth/api_scope/sell.analytics',
];

let cachedEbayAccessToken = null;
let cachedEbayAccessTokenExpiry = 0;
let cachedEbayEnvironment = null;

function getEbayBaseUrls() {
  const isProd = (process.env.EBAY_ENV || '').toLowerCase() === 'production';

  return {
    authBase: isProd ? 'https://auth.ebay.com/oauth2/authorize' : 'https://auth.sandbox.ebay.com/oauth2/authorize',
    apiBase: isProd ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com',
  };
}

function getEbayApiBase() {
  return getEbayBaseUrls().apiBase;
}

function getRequestedScopes() {
  const configuredScopes = (process.env.EBAY_SCOPES || '').trim();
  const scopes = configuredScopes
    ? configuredScopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
    : [...DEFAULT_EBAY_SCOPES];

  if (!configuredScopes) {
    process.env.EBAY_SCOPES = scopes.join(' ');
  }

  return scopes;
}

function normalizeEnvironmentValue(value) {
  const rawValue = String(value || '').trim().toUpperCase();
  return rawValue === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
}

async function getEbayAccessToken({ forceRefresh = false, environment = process.env.EBAY_ENV || 'PRODUCTION', scopes = process.env.EBAY_SCOPES } = {}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing eBay OAuth settings: EBAY_CLIENT_ID or EBAY_CLIENT_SECRET.');
  }

  const normalizedEnvironment = normalizeEnvironmentValue(environment);
  const requestedScopes = Array.isArray(scopes)
    ? scopes
    : String(scopes || '').split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  const effectiveScopes = requestedScopes.length ? requestedScopes : [...DEFAULT_EBAY_SCOPES];

  if (!forceRefresh && process.env.EBAY_ACCESS_TOKEN) {
    cachedEbayAccessToken = process.env.EBAY_ACCESS_TOKEN;
    cachedEbayAccessTokenExpiry = Date.now() + 60 * 60 * 1000;
    cachedEbayEnvironment = normalizedEnvironment;
    return process.env.EBAY_ACCESS_TOKEN;
  }

  if (!forceRefresh && cachedEbayAccessToken && cachedEbayEnvironment === normalizedEnvironment && Date.now() < cachedEbayAccessTokenExpiry - 60000) {
    return cachedEbayAccessToken;
  }

  const ebayAuthToken = new EbayAuthToken({
    clientId,
    clientSecret,
    redirectUri: process.env.EBAY_REDIRECT_URI || 'https://ebayhelper.onrender.com/auth/ebay/callback',
  });

  const rawToken = await ebayAuthToken.getApplicationToken(normalizedEnvironment, effectiveScopes);
  const payload = typeof rawToken === 'string' ? JSON.parse(rawToken) : rawToken;

  if (!payload || !payload.access_token) {
    throw new Error(payload?.error_description || payload?.error || 'eBay app token request failed.');
  }

  cachedEbayAccessToken = payload.access_token;
  cachedEbayAccessTokenExpiry = Date.now() + Number(payload.expires_in || 7200) * 1000;
  cachedEbayEnvironment = normalizedEnvironment;
  process.env.EBAY_ACCESS_TOKEN = payload.access_token;

  return payload.access_token;
}

function getEbaySignInUrl({ state } = {}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const redirectUri = process.env.EBAY_REDIRECT_URI;
  const scopes = getRequestedScopes().join(' ');

  if (!clientId || !redirectUri || !scopes) {
    throw new Error('Missing eBay OAuth settings: EBAY_CLIENT_ID, EBAY_REDIRECT_URI, or EBAY_SCOPES.');
  }

  const query = querystring.stringify({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state: state || undefined,
  });

  const { authBase } = getEbayBaseUrls();
  return `${authBase}?${query}`;
}

async function exchangeAuthCodeForTokens({ code }) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const redirectUri = process.env.EBAY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing eBay OAuth settings: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, or EBAY_REDIRECT_URI.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }).toString();

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const { apiBase } = getEbayBaseUrls();

  const response = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'eBay token exchange failed.');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    refreshTokenExpiresIn: payload.refresh_token_expires_in,
    tokenType: payload.token_type,
    scope: payload.scope,
  };
}

module.exports = {
  getEbayAccessToken,
  getEbayApiBase,
  getEbaySignInUrl,
  exchangeAuthCodeForTokens,
  getRequestedScopes,
};
