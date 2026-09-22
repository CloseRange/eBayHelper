require('dotenv').config();

const { setupEbayPolicies } = require('./ebay_policies');
const { getEbayApiBase, getEbaySignInUrl } = require('./index');

function getEbayJsonHeaders() {
    const token = process.env.EBAY_ACCESS_TOKEN;

    if (!token) {
        console.warn('[eBay] No EBAY_ACCESS_TOKEN available when building request headers.');
    }

    return {
        Authorization: `Bearer ${token || ''}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
        "Content-Language": "en-US"
    };
}

async function getAllInventoryItems() {
    try {
        const response = await fetch(
            `${getEbayApiBase()}/sell/inventory/v1/inventory_item?limit=5&offset=0`,
            {
                method: "GET",
                headers: getEbayJsonHeaders()
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                `eBay API returned ${response.status}: ${JSON.stringify(data)}`
            );
        }

        return data.inventoryItems ?? [];
    } catch (err) {
        console.error("Error fetching inventory:", err);
        throw err;
    }
}
async function createLocation(locationKey, locationData) {
    const merchantLocationKey = "home-inventory";

    const body = {
    location: {
        address: {
        postalCode: "54901",
        country: "US"
        }
    },

    name: "Main Inventory Location",

    merchantLocationStatus: "ENABLED",

    locationTypes: [
        "WAREHOUSE"
    ]
    };

    const response = await fetch(
    `${getEbayApiBase()}/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
    {
        method: "POST",
        headers: {
            ...getEbayJsonHeaders(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body)
    }
    );

    if (!response.ok) {
        const error = await response.text();
        console.error("eBay location error:", response.status, error);
    } else {
        console.log("Inventory location created!");
        return response;
    }
}
function isLiveEbayModeEnabled() {
    const raw = process.env.EBAY_LIVE_MODE ?? 'false';
    return String(raw).trim().toLowerCase() === 'true';
}

function normalizeEbayCondition(value) {
    const normalized = String(value || '').trim().toUpperCase();
    const allowed = {
        NEW: 'NEW',
        LIKE_NEW: 'LIKE_NEW',
        USED_EXCELLENT: 'USED_EXCELLENT',
        PRE_OWNED_EXCELLENT: 'USED_EXCELLENT',
        USED_VERY_GOOD: 'USED_VERY_GOOD',
        PRE_OWNED_VERY_GOOD: 'USED_VERY_GOOD',
        USED_GOOD: 'USED_GOOD',
        PRE_OWNED_GOOD: 'USED_GOOD',
        USED_ACCEPTABLE: 'USED_ACCEPTABLE',
        PRE_OWNED_ACCEPTABLE: 'USED_ACCEPTABLE'
    };

    return allowed[normalized] || 'NEW';
}

function normalizeEbayAspects(aspects) {
    if (!aspects || typeof aspects !== 'object') {
        return {};
    }

    const normalized = {};

    for (const [key, value] of Object.entries(aspects)) {
        if (!key || typeof key !== 'string') {
            continue;
        }

        const values = Array.isArray(value)
            ? value
            : [value];

        const cleanValues = values
            .map((entry) => String(entry).trim())
            .filter(Boolean)
            .slice(0, 10);

        if (cleanValues.length) {
            normalized[String(key).trim()] = cleanValues;
        }
    }

    return normalized;
}

function normalizeEbayImageUrls(imageUrls) {
    if (!Array.isArray(imageUrls)) {
        return [];
    }

    return imageUrls
        .map((url) => typeof url === 'string' ? url.trim() : '')
        .filter((url) => /^https?:\/\//i.test(url))
        .slice(0, 12);
}

async function _createInventoryItem(info) {
    const validImageUrls = normalizeEbayImageUrls(info.imageUrls);

    if (!validImageUrls.length) {
        throw new Error('No valid image URLs were provided for the eBay inventory item.');
    }

    const title = String(info.title || '').replace(/\s+/g, ' ').trim();
    const description = String(info.description || '').replace(/\s+/g, ' ').trim();

    if (!title || !description) {
        throw new Error('eBay inventory item requires a non-empty title and description.');
    }

    const categoryId = Number(info.categoryId);
    if (isLiveEbayModeEnabled() && (!Number.isFinite(categoryId) || categoryId <= 0)) {
        throw new Error('A valid live eBay categoryId is required before publishing inventory.');
    }

    const body = {
        product: {
            title,
            description,
            imageUrls: validImageUrls,
            aspects: normalizeEbayAspects(info.aspects)
        },
        condition: normalizeEbayCondition(info.condition),
        availability: {
            shipToLocationAvailability: {
                quantity: 1
            }
        }
    };

    console.log('[eBay] Inventory payload:', JSON.stringify({
        sku: info.sku,
        condition: body.condition,
        title: body.product.title,
        imageCount: body.product.imageUrls.length,
        aspectCount: Object.keys(body.product.aspects).length
    }, null, 2));

    const response = await fetch(
        `${getEbayApiBase()}/sell/inventory/v1/inventory_item/${encodeURIComponent(info.sku)}`,
        {
            method: "PUT",
            headers: {
                ...getEbayJsonHeaders(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body)
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = `eBay inventory item create failed: ${response.status} ${errorText}`;
        console.error("eBay error:", response.status, errorText);
        throw new Error(errorMessage);
    }

    console.log("Inventory item created/updated");
    return response;
}
async function _createOffer(info) {
    const body = {
        sku: info.sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        availableQuantity: 1,
        categoryId: info.categoryId,
        merchantLocationKey: "home-inventory",

        listingPolicies: {
            fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
            paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
            returnPolicyId: process.env.EBAY_RETURN_POLICY_ID
        },

        pricingSummary: {
            price: {
            currency: "USD",
            value: info.price
            }
        },

        listingDuration: "GTC"
        };

    const response = await fetch(
    `${getEbayApiBase()}/sell/inventory/v1/offer`,
    {
        method: "POST",
        headers: {
            ...getEbayJsonHeaders(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body)
    }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.errors ? JSON.stringify(data.errors) : JSON.stringify(data);
        console.error("eBay offer error:", response.status, message);
        throw new Error(`eBay offer creation failed: ${message}`);
    }

    console.log("Offer created!");
    return data;
}

async function _publishOffer(offerId) {
    const response = await fetch(
        `${getEbayApiBase()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
        {
            method: "POST",
            headers: {
                ...getEbayJsonHeaders(),
                "Content-Type": "application/json",
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        console.error(
            "Publish failed:",
            response.status,
            JSON.stringify(data, null, 2)
        );

        throw new Error("Failed to publish offer");
    }

    console.log("Published!");
    console.log("Listing ID:", data.listingId);

    return data;
}


async function postListing(info={
    price: 19.99,
    title: "Sample Product",
    sku: "SAMPLE123",
    description: "This is a sample product description.",
    categoryId: "12345",
    condition: "PRE_OWNED_EXCELLENT", // USED_EXCELLENT / PRE_OWNED_FAIR
    imageUrls: [],
    aspects: {
        Brand: ["Nike"],
        Size: ["M"],
        Color: ["Black"],
        Department: ["Men"]
    }
}) {
    if (!isLiveEbayModeEnabled() || String(process.env.OPEN_AI_DISABLE || '').trim().toLowerCase() === 'true') {
        console.log('[eBay] Test mode enabled; skipping live inventory publish. Set EBAY_LIVE_MODE=true to send to eBay.');
        return {
            sku: info.sku,
            mode: 'test-no-op',
            message: 'Live eBay inventory publishing was skipped because the app is running in local test mode.'
        };
    }

    try {
        await createLocation('home-inventory', {
            name: 'Main Inventory Location',
            merchantLocationStatus: 'ENABLED',
            locationTypes: ['WAREHOUSE'],
            address: {
                postalCode: '54901',
                country: 'US'
            }
        });
    } catch (error) {
        console.warn('[eBay] inventory location setup skipped or failed:', error.message || error);
    }

    await _createInventoryItem(info);
    const offer = await _createOffer(info);

    if (!offer || !offer.offerId) {
        throw new Error(`Offer response missing offerId for SKU ${info.sku}`);
    }

    const published = await _publishOffer(offer.offerId);

    return {
        sku: info.sku,
        offerId: offer.offerId,
        listingId: published.listingId
    };
}
async function ebaySetup() {
    await createLocation();
    await setupEbayPolicies();
}
async function getOffersForSku(sku) {
    const response = await fetch(
        `${getEbayApiBase()}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
        {
            method: "GET",
            headers: getEbayJsonHeaders()
        }
    );

    const data = await response.json();

    if (!response.ok) {
        return [];
    }

    return data.offers ?? [];
}
async function getActiveListings() {
    const token = process.env.EBAY_ACCESS_TOKEN;
    console.log('[getActiveListings] mint status:', Boolean(token), token ? `${token.slice(0, 16)}...` : 'missing');

    const inventoryResponse = await fetch(
        `${getEbayApiBase()}/sell/inventory/v1/inventory_item?limit=100&offset=0`,
        {
            method: "GET",
            headers: {
                ...getEbayJsonHeaders(),
                "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
                "X-EBAY-C-ENDUSERCTX": "affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>"
            }
        }
    );

    const inventoryData = await inventoryResponse.json();

    if (!inventoryResponse.ok) {
        throw new Error(
            `Failed to get inventory: ${JSON.stringify(inventoryData)}`
        );
    }

    const inventoryItems = inventoryData.inventoryItems ?? [];
    const listings = [];

    for (const item of inventoryItems) {
        const offers = await getOffersForSku(item.sku);
        
        for (const offer of offers) {
            if (
                offer.status === "PUBLISHED" &&
                offer.listing?.listingStatus === "ACTIVE"
            ) {
                listings.push({
                    sku: item.sku,
                    title: item.product?.title,
                    description: item.product?.description,
                    images: item.product?.imageUrls ?? [],
                    condition: item.condition,
                    price: offer.pricingSummary?.price,
                    quantity: offer.availableQuantity,
                    categoryId: offer.categoryId,
                    offerId: offer.offerId,
                    listingId: offer.listing?.listingId,
                    listingStatus: offer.listing?.listingStatus,
                    marketplaceId: offer.marketplaceId
                });
            }
        }
    }

    return listings;
}
module.exports = { getAllInventoryItems, postListing, createLocation, ebaySetup, getActiveListings };
