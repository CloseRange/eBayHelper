const querystring = require('querystring');

function getEbayBaseUrls() {
  const isProd = process.env.EBAY_ENV === 'production';

  return {
    authBase: isProd ? 'https://auth.ebay.com/oauth2/authorize' : 'https://auth.sandbox.ebay.com/oauth2/authorize',
    apiBase: isProd ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com',
  };
}

function getRequestedScopes() {
  return (process.env.EBAY_SCOPES || '')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
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
  getEbaySignInUrl,
  exchangeAuthCodeForTokens,
  getRequestedScopes,
};
