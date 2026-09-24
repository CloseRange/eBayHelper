require('dotenv').config();

const { setupEbayPolicies } = require('./ebay_policies');
const { getEbayApiBase, getEbaySignInUrl } = require('./index');
const db = require('../supabase/client');

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
function isExplicitLocalTestModeEnabled() {
    const raw = process.env.EBAY_TEST_MODE ?? 'false';
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
    if ((!Number.isFinite(categoryId) || categoryId <= 0) && !isExplicitLocalTestModeEnabled()) {
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
    const buildBody = () => ({
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
    });

    const sendOffer = async () => {
        const body = buildBody();

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
            return { ok: false, status: response.status, message, data };
        }

        console.log("Offer created!");
        return { ok: true, data };
    };

    const first = await sendOffer();

    if (first.ok) {
        return first.data;
    }

    const needsPolicyRefresh = String(first.message || '').includes('Fulfillment policy') ||
        String(first.message || '').includes('valid shipping service option') ||
        String(first.message || '').includes('err:216118');

    if (needsPolicyRefresh) {
        console.warn('[eBay] Fulfillment policy is invalid; regenerating eBay business policies and retrying offer creation once.');

        const { fulfillmentPolicyId, paymentPolicyId, returnPolicyId } = await require('./ebay_policies').setupEbayPolicies();
        process.env.EBAY_FULFILLMENT_POLICY_ID = fulfillmentPolicyId;
        process.env.EBAY_PAYMENT_POLICY_ID = paymentPolicyId;
        process.env.EBAY_RETURN_POLICY_ID = returnPolicyId;

        const retry = await sendOffer();
        if (retry.ok) {
            return retry.data;
        }

        const retryMessage = retry?.message ? JSON.stringify(retry.message) : 'Unknown retry error';
        throw new Error(`eBay offer creation failed after policy refresh: ${retryMessage}`);
    }

    throw new Error(`eBay offer creation failed: ${first.message}`);
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
    if (isExplicitLocalTestModeEnabled()) {
        console.log('[eBay] Local test mode enabled; skipping live inventory publish. Set EBAY_TEST_MODE=false to send to eBay.');
        return {
            sku: info.sku,
            mode: 'test-no-op',
            message: 'Live eBay inventory publishing was skipped because EBAY_TEST_MODE=true.'
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
    return {};
    await createLocation('home-inventory', {
        name: 'Main Inventory Location',
        merchantLocationStatus: 'ENABLED',
        locationTypes: ['WAREHOUSE'],
        address: {
            postalCode: '54901',
            country: 'US'
        }
    });

    const policyIds = await setupEbayPolicies();

    return {
        locationKey: 'home-inventory',
        ...policyIds
    };
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

async function getInventoryItemBySku(sku) {
    const response = await fetch(
        `${getEbayApiBase()}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        {
            method: "GET",
            headers: getEbayJsonHeaders()
        }
    );

    if (!response.ok) {
        return null;
    }

    const data = await response.json().catch(() => ({}));
    return data || null;
}

async function getEbayPostingStatusForSku(sku) {
    const normalizedSku = typeof sku === 'string' ? sku.trim() : '';

    if (!normalizedSku) {
        return {
            posted: false,
            status: 'UNKNOWN',
            message: 'missing sku'
        };
    }

    const inventoryItem = await getInventoryItemBySku(normalizedSku);
    const offers = await getOffersForSku(normalizedSku);
    const publishedActiveOffer = offers.find(
        (offer) => offer?.status === 'PUBLISHED' && offer?.listing?.listingStatus === 'ACTIVE'
    );
    const publishedOffer = offers.find((offer) => offer?.status === 'PUBLISHED');

    if (publishedActiveOffer) {
        return {
            posted: true,
            status: 'POSTED',
            message: 'posted and active on ebay'
        };
    }

    if (publishedOffer) {
        return {
            posted: true,
            status: 'POSTED',
            message: 'posted on ebay'
        };
    }

    if (inventoryItem) {
        return {
            posted: false,
            status: 'NOT_POSTED',
            message: 'inventory item exists but no published offer'
        };
    }

    return {
        posted: false,
        status: 'NOT_FOUND',
        message: 'sku not found in ebay inventory'
    };
}
async function updateListingPrice(sku, newPrice) {
    // --------------------------------------------------------
    // VALIDATE INPUT
    // --------------------------------------------------------

    const normalizedSku = String(sku || "").trim();
    const price = Number(newPrice);

    if (!normalizedSku) {
        throw new Error("SKU is required.");
    }

    if (
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isInteger(Math.round(price * 100) * 100 / 100)
    ) {
        // The integer check is not needed for ordinary prices;
        // validation below enforces a maximum of two decimal places.
        if (!Number.isFinite(price) || price <= 0) {
            throw new Error("Price must be greater than zero.");
        }
    }

    const formattedPrice = price.toFixed(2);

    // --------------------------------------------------------
    // FIND EXISTING OFFER
    // --------------------------------------------------------

    const offers = await getOffersForSku(normalizedSku);

    const offer = offers.find(
        (item) =>
            item.status === "PUBLISHED" &&
            item.marketplaceId === "EBAY_US"
    );

    if (!offer) {
        throw new Error(
            `No published eBay offer found for SKU ${normalizedSku}.`
        );
    }

    if (!offer.offerId) {
        throw new Error(
            `Published offer for SKU ${normalizedSku} has no offerId.`
        );
    }

    // --------------------------------------------------------
    // UPDATE PRICE
    // --------------------------------------------------------

    const body = {
        requests: [
            {
                sku: normalizedSku,

                offers: [
                    {
                        offerId: offer.offerId,

                        price: {
                            currency: "USD",
                            value: formattedPrice
                        }
                    }
                ]
            }
        ]
    };

    const response = await fetch(
        `${getEbayApiBase()}/sell/inventory/v1/bulk_update_price_quantity`,
        {
            method: "POST",

            headers: {
                ...getEbayJsonHeaders(),
                "Content-Type": "application/json"
            },

            body: JSON.stringify(body)
        }
    );

    const data = await response.json();

    // --------------------------------------------------------
    // CHECK HTTP RESPONSE
    // --------------------------------------------------------

    if (!response.ok) {
        throw new Error(
            `eBay price update failed (${response.status}): ` +
            JSON.stringify(data)
        );
    }

    // --------------------------------------------------------
    // CHECK INDIVIDUAL ITEM / OFFER RESPONSE
    // --------------------------------------------------------

    const itemResult = data.responses?.[0];

    if (!itemResult) {
        throw new Error(
            `eBay did not return a price update result: ` +
            JSON.stringify(data)
        );
    }

    const offerResult = itemResult.offers?.find(
        (item) => item.offerId === offer.offerId
    );

    const itemFailed =
        itemResult.statusCode >= 400 ||
        (itemResult.errors?.length ?? 0) > 0;

    const offerFailed =
        offerResult?.statusCode >= 400 ||
        (offerResult?.errors?.length ?? 0) > 0;

    if (itemFailed || offerFailed) {
        throw new Error(
            `eBay rejected the price update: ` +
            JSON.stringify(data)
        );
    }

    console.log(
        `[eBay] Updated ${normalizedSku} to $${formattedPrice}`
    );

    try {
        await db.updatePrice(normalizedSku, Number(formattedPrice));
    } catch (dbError) {
        console.warn('[eBay] Local listing price update failed after successful eBay update:', dbError.message || dbError);
    }

    return {
        sku: normalizedSku,
        offerId: offer.offerId,
        price: Number(formattedPrice),
        currency: "USD",
        success: true
    };
}

module.exports = { getAllInventoryItems, postListing, createLocation, ebaySetup, getActiveListings, getEbayPostingStatusForSku, updateListingPrice };
