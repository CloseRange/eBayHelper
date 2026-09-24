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

const { generateSkuLabelPdfFile } = require('./util/sku_label_pdf');


async function main() {
  try {
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
      

      await generateSkuLabelPdfFile("021-112", "output.pdf");

  } catch (err) {
    console.error('Error fetching eBay policies:', err.message || err);
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


