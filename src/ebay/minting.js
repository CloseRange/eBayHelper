
require('dotenv').config();

const EbayAuthToken = require('ebay-oauth-nodejs-client');
const { exchangeAuthCodeForTokens } = require('./index');

let accessToken = process.env.EBAY_ACCESS_TOKEN || null;

async function getAccessToken() {
    if (!accessToken && process.env.EBAY_ACCESS_TOKEN) {
        accessToken = process.env.EBAY_ACCESS_TOKEN;
    }
    return accessToken;
}

async function beginMint(res) {
    const ebayAuthToken = new EbayAuthToken({
        clientId: process.env.EBAY_CLIENT_ID,
        clientSecret: process.env.EBAY_CLIENT_SECRET,
        redirectUri: process.env.EBAY_REDIRECT_URI,
    });

    const scopes = [
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.account',
    ];

    const options = { state: 'custom-state-value', prompt: 'login' };
    const authUrl = ebayAuthToken.generateUserAuthorizationUrl('PRODUCTION', scopes, options);
    return res.redirect(authUrl);
}

async function endMint(res, req, code, state = null) {
    try {
        const tokens = await exchangeAuthCodeForTokens({ code });

        if (tokens.accessToken) {
            process.env.EBAY_ACCESS_TOKEN = tokens.accessToken;
            accessToken = tokens.accessToken;
            if (req?.session) {
                req.session.ebayAccessToken = tokens.accessToken;
            }
        }
        if (tokens.refreshToken) {
            process.env.EBAY_REFRESH_TOKEN = tokens.refreshToken;
            if (req?.session) {
                req.session.ebayRefreshToken = tokens.refreshToken;
            }
        }

        if (req?.session) {
            return req.session.save((err) => {
                if (err) {
                    console.error('[endMint] session save failed:', err);
                }
                return res.redirect('/ebay');
            });
        }

        return res.redirect('/ebay');
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: 'Failed to exchange eBay auth code for tokens',
            details: err.message || String(err),
            state: state || null,
        });
    }
}

module.exports = { getAccessToken, beginMint, endMint };


