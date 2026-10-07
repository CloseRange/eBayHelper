require('dotenv').config();

const fs = require('fs');
const path = require('path');
// const { getEbayPolicies } = require('./ebay/ebay');
const { setupEbayPolicies, getEbayPolicies } = require('./ebay/ebay_policies');
const { getActiveListings, postListing, ebaySetup } = require('./ebay/ebay');
const { getAspects, types } = require('./ebay/ebay_categories');

const { generateSKU } = require('./util/post_new_item');
const EbayAuthToken = require('ebay-oauth-nodejs-client');
const { env } = require('process');

const { generatePrintAndDiscardSkuLabelPdf, printPdfFile } = require('./util/sku_label_pdf');

async function warmAllCategoryAspectsCache({ continueOnError = true } = {}) {
    const allTypes = Object.values(types || {}).sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0));
    const startedAt = Date.now();
    const results = [];

    console.log(`[cache-warm] Starting aspect cache warmup for ${allTypes.length} categories...`);

    for (const type of allTypes) {
        const categoryLabel = `${type?.name || 'Unknown'} (id=${type?.id ?? 'n/a'})`;

        try {
            const data = await getAspects(type);
            const aspectCount = Array.isArray(data?.aspects) ? data.aspects.length : 0;
            const categoryId = data?.categoryId || 'n/a';

            results.push({
                typeId: type?.id,
                typeName: type?.name,
                ok: true,
                categoryId,
                aspectCount,
            });

            console.log(`[cache-warm] OK: ${categoryLabel} -> eBay category ${categoryId}, ${aspectCount} aspects`);
        } catch (err) {
            const message = err?.message || String(err);

            results.push({
                typeId: type?.id,
                typeName: type?.name,
                ok: false,
                error: message,
            });

            console.error(`[cache-warm] FAIL: ${categoryLabel} -> ${message}`);

            if (!continueOnError) {
                throw err;
            }
        }
    }

    const successCount = results.filter((row) => row.ok).length;
    const failureCount = results.length - successCount;
    const elapsedMs = Date.now() - startedAt;

    console.log(`[cache-warm] Finished in ${elapsedMs}ms. Success: ${successCount}, Failed: ${failureCount}`);

    if (failureCount > 0) {
        const failed = results.filter((row) => !row.ok);
        console.log('[cache-warm] Failed categories:', failed);
    }

    return {
        total: results.length,
        successCount,
        failureCount,
        elapsedMs,
        results,
    };
}


async function main() {
  try {
        const warmAspectsRequested = process.argv.includes('--warm-aspects') ||
            String(process.env.npm_config_warm_aspects || '').toLowerCase() === 'true';

        if (warmAspectsRequested) {
            console.log('Warming all category aspects cache...');
            await warmAllCategoryAspectsCache({ continueOnError: true });
            return;
        }

    // await ebaySetup();

    // const ebayAuthToken = new EbayAuthToken({
    //     clientId: env.EBAY_CLIENT_ID,
    //     clientSecret: env.EBAY_CLIENT_SECRET,
    //     redirectUri: env.EBAY_REDIRECT_URI
    // });
    // await (async () => {
    //     const token = await ebayAuthToken.getApplicationToken('PRODUCTION');
    //     console.log(token);
    // })();
    // await (async () => {
    //     const scopes = [
    //         'https://api.ebay.com/oauth/api_scope/sell.inventory',
    //         'https://api.ebay.com/oauth/api_scope/sell.account'];
    //     const options = { state: 'custom-state-value', prompt: 'login' };
    //     const authUrl = ebayAuthToken.generateUserAuthorizationUrl('PRODUCTION', scopes, options);
    //         console.log('User Authorization URL:', authUrl);

    //     // (async () => {
    //     //     const accessToken = await ebayAuthToken.exchangeCodeForAccessToken('PRODUCTION', code);
    //     //     console.log(accessToken);
    //     // })();
    // })();
    // console.log('EbayAuthToken instance created:', ebayAuthToken);
    // await generateSKU();
    // await setupEbayPolicies();
    
    // const aspects =
    //     await getAspects(types.DRESS);

    // console.log(
    //     JSON.stringify(aspects, null, 2)
    // );

    // const listings = await getActiveListings();
    // console.log('Listings:', listings);
    // console.log("PAYMENT POLICIES:");
    // const paymentPolicies = await getPaymentPolicies();
    // const returnPolicies = await getReturnPolicies();
    // for (const policy of paymentPolicies) {
    //     console.log({
    //         name: policy.name,
    //         id: policy.paymentPolicyId
    //     });
    // }

    // console.log("RETURN POLICIES:");

    // for (const policy of returnPolicies) {
    //     console.log({
    //         name: policy.name,
    //         id: policy.returnPolicyId
    //     });
      // }
      

      await generatePrintAndDiscardSkuLabelPdf("021-112");

  } catch (err) {
    console.error(err);
  }
}
async function getPaymentPolicies() {
    const response = await fetch(
        "https://api.ebay.com/sell/account/v1/payment_policy?marketplace_id=EBAY_US",
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                Accept: "application/json"
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            `Failed to get payment policies: ${JSON.stringify(data)}`
        );
    }

    return data.paymentPolicies ?? [];
}


async function getReturnPolicies() {
    const response = await fetch(
        "https://api.ebay.com/sell/account/v1/return_policy?marketplace_id=EBAY_US",
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                Accept: "application/json"
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            `Failed to get return policies: ${JSON.stringify(data)}`
        );
    }

    return data.returnPolicies ?? [];
}


main();


