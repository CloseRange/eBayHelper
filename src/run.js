require('dotenv').config();

const fs = require('fs');
const path = require('path');
// const { getEbayPolicies } = require('./ebay/ebay');
const { setupEbayPolicies, getEbayPolicies } = require('./ebay/ebay_policies');
const { getActiveListings, postListing, ebaySetup } = require('./ebay/ebay');
const { getAspects, types } = require('./ebay/ebay_categories');

const { generateSKU } = require('./util/post_new_item');

async function main() {
  try {
    await ebaySetup();
    // await generateSKU();
    // await setupEbayPolicies();
    
    // const aspects =
    //     await getAspects(types.DRESS);

    // console.log(
    //     JSON.stringify(aspects, null, 2)
    // );

    // const listings = await getActiveListings();
    // console.log('Listings:', listings);

  } catch (err) {
    console.error('Error fetching eBay policies:', err.message || err);
  }
}

main();


