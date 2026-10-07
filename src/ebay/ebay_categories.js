require("dotenv").config();

const { getEbayApiBase, getEbayAccessToken } = require('./index');

const EBAY_TAXONOMY_BASE = `${getEbayApiBase()}/commerce/taxonomy/v1`;
const EBAY_TAXONOMY_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.join(__dirname, "../cache/ebay-aspects.json");

const CACHE_MAX_AGE =
    7 * 24 * 60 * 60 * 1000;

function getScopeListWithTaxonomy() {
    // Taxonomy endpoints only require api_scope. Keeping this minimal avoids
    // token mint failures when other optional scopes are not granted.
    return [EBAY_TAXONOMY_SCOPE];
}

function isAccessDeniedError(payload) {
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];

    return errors.some((error) => {
        const errorId = Number(error?.errorId);
        const message = String(error?.message || '').toLowerCase();
        const longMessage = String(error?.longMessage || '').toLowerCase();

        return errorId === 1100 ||
            message.includes('access denied') ||
            longMessage.includes('insufficient permissions');
    });
}

async function fetchTaxonomyJson(url) {
    const headersForToken = (token) => ({
        Authorization: `Bearer ${String(token || '').trim()}`,
        Accept: 'application/json'
    });

    let token = String(process.env.EBAY_ACCESS_TOKEN || '').trim();
    let response = await fetch(url, { headers: headersForToken(token) });
    let data = await response.json().catch(() => ({}));

    if (!response.ok && (response.status === 401 || isAccessDeniedError(data))) {
        const refreshedToken = await getEbayAccessToken({
            forceRefresh: true,
            environment: process.env.EBAY_ENV || 'PRODUCTION',
            scopes: getScopeListWithTaxonomy(),
        });

        process.env.EBAY_ACCESS_TOKEN = refreshedToken;
        token = String(refreshedToken || '').trim();
        response = await fetch(url, { headers: headersForToken(token) });
        data = await response.json().catch(() => ({}));
    }

    return { response, data };
}

const types = {

    // Shirts / tops
    MENS_TSHIRT: {
        id: 0,
        name: "Men's T-Shirt",
        ebayQuery: "mens t shirt"
    },

    MENS_SHIRT: {
        id: 1,
        name: "Men's Shirt",
        ebayQuery: "mens shirt"
    },

    WOMENS_TOP: {
        id: 2,
        name: "Women's Top",
        ebayQuery: "womens top"
    },

    WOMENS_TSHIRT: {
        id: 3,
        name: "Women's T-Shirt",
        ebayQuery: "womens t shirt"
    },

    // Pants
    MENS_PANTS: {
        id: 4,
        name: "Men's Pants",
        ebayQuery: "mens pants"
    },

    WOMENS_PANTS: {
        id: 5,
        name: "Women's Pants",
        ebayQuery: "womens pants"
    },

    JEANS: {
        id: 6,
        name: "Jeans",
        ebayQuery: "jeans"
    },

    // Shorts
    MENS_SHORTS: {
        id: 7,
        name: "Men's Shorts",
        ebayQuery: "mens shorts"
    },

    WOMENS_SHORTS: {
        id: 8,
        name: "Women's Shorts",
        ebayQuery: "womens shorts"
    },

    // Dresses / skirts
    DRESS: {
        id: 9,
        name: "Dress",
        ebayQuery: "womens dress"
    },

    SKIRT: {
        id: 10,
        name: "Skirt",
        ebayQuery: "womens skirt"
    },

    // Outerwear
    MENS_JACKET: {
        id: 11,
        name: "Men's Jacket",
        ebayQuery: "mens jacket"
    },

    WOMENS_JACKET: {
        id: 12,
        name: "Women's Jacket",
        ebayQuery: "womens jacket"
    },

    HOODIE: {
        id: 13,
        name: "Hoodie",
        ebayQuery: "hoodie"
    },

    SWEATSHIRT: {
        id: 14,
        name: "Sweatshirt",
        ebayQuery: "sweatshirt"
    },

    SWEATER: {
        id: 15,
        name: "Sweater",
        ebayQuery: "sweater"
    },

    // Shoes
    MENS_SHOES: {
        id: 16,
        name: "Men's Shoes",
        ebayQuery: "mens shoes"
    },

    WOMENS_SHOES: {
        id: 17,
        name: "Women's Shoes",
        ebayQuery: "womens shoes"
    },

    SNEAKERS: {
        id: 18,
        name: "Sneakers",
        ebayQuery: "sneakers"
    },

    BOOTS: {
        id: 19,
        name: "Boots",
        ebayQuery: "boots"
    },

    SANDALS: {
        id: 20,
        name: "Sandals",
        ebayQuery: "sandals"
    },

    // Headwear
    HAT: {
        id: 21,
        name: "Hat",
        ebayQuery: "hat"
    },

    BASEBALL_CAP: {
        id: 22,
        name: "Baseball Cap",
        ebayQuery: "baseball cap"
    },

    BEANIE: {
        id: 23,
        name: "Beanie",
        ebayQuery: "beanie"
    },

    // Other common clothing
    LEGGINGS: {
        id: 24,
        name: "Leggings",
        ebayQuery: "womens leggings"
    },

    ACTIVEWEAR: {
        id: 25,
        name: "Activewear",
        ebayQuery: "activewear"
    },

    PAJAMAS: {
        id: 26,
        name: "Pajamas",
        ebayQuery: "pajamas"
    },

    SWIMWEAR: {
        id: 27,
        name: "Swimwear",
        ebayQuery: "swimwear"
    },

    SOCKS: {
        id: 28,
        name: "Socks",
        ebayQuery: "socks"
    },

    BELT: {
        id: 29,
        name: "Belt",
        ebayQuery: "belt"
    }
};


async function getCategoryTreeId() {
    const { response, data } = await fetchTaxonomyJson(
        `${EBAY_TAXONOMY_BASE}/get_default_category_tree_id?marketplace_id=EBAY_US`
    );

    if (!response.ok) {
        throw new Error(
            `Unable to retrieve category tree: ${JSON.stringify(data)}`
        );
    }

    return data.categoryTreeId;
}

function loadCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) {
            return {};
        }

        const raw = fs.readFileSync(
            CACHE_FILE,
            "utf8"
        );

        return JSON.parse(raw);
    } catch (err) {
        console.warn(
            "Unable to load eBay aspect cache:",
            err.message
        );

        return {};
    }
}


function saveCache(cache) {
    const directory =
        path.dirname(CACHE_FILE);

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(
            directory,
            { recursive: true }
        );
    }

    fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify(cache, null, 2),
        "utf8"
    );
}


function isCacheValid(entry) {
    if (!entry?.cachedAt) {
        return false;
    }

    const age =
        Date.now() - entry.cachedAt;

    return age < CACHE_MAX_AGE;
}

function normalizeCategoryLabel(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function getTypeByAnyReference(ref) {
    if (ref === undefined || ref === null) {
        return null;
    }

    const normalized = normalizeCategoryLabel(ref);
    if (!normalized) {
        return null;
    }

    const entries = Object.values(types || {});

    return entries.find((type) => {
        if (!type) {
            return false;
        }

        const typeId = String(type.id ?? '').trim();
        const typeName = normalizeCategoryLabel(type.name);

        return normalized === typeId || normalized === typeName;
    }) || null;
}

function resolveEbayCategoryIdFromCache(ref) {
    const cache = loadCache();
    const normalized = normalizeCategoryLabel(ref);

    if (!normalized) {
        return null;
    }

    for (const [cacheKey, cacheEntry] of Object.entries(cache || {})) {
        const typeName = normalizeCategoryLabel(cacheEntry?.typeName);
        const keyMatches = normalized === String(cacheKey).trim();
        const nameMatches = normalized === typeName;

        if (!keyMatches && !nameMatches) {
            continue;
        }

        const categoryId = String(cacheEntry?.data?.categoryId || '').trim();
        if (/^\d+$/.test(categoryId)) {
            return categoryId;
        }
    }

    return null;
}

async function resolveEbayCategoryId(inputCategory, fallbackTypeRef = null) {
    const direct = String(inputCategory || '').trim();
    if (/^\d+$/.test(direct)) {
        return direct;
    }

    const fromInputCache = resolveEbayCategoryIdFromCache(inputCategory);
    if (fromInputCache) {
        return fromInputCache;
    }

    const matchedType = getTypeByAnyReference(inputCategory) || getTypeByAnyReference(fallbackTypeRef);
    if (!matchedType) {
        return null;
    }

    const fromMatchedTypeCache = resolveEbayCategoryIdFromCache(matchedType.id);
    if (fromMatchedTypeCache) {
        return fromMatchedTypeCache;
    }

    const aspects = await getAspects(matchedType).catch(() => null);
    const fromAspects = String(aspects?.categoryId || '').trim();
    if (/^\d+$/.test(fromAspects)) {
        return fromAspects;
    }

    return null;
}


async function findEbayCategories(query) {
    const treeId = await getCategoryTreeId();

    const { response, data } = await fetchTaxonomyJson(
        `${EBAY_TAXONOMY_BASE}/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(query)}`
    );

    if (!response.ok) {
        throw new Error(
            `Unable to retrieve eBay categories: ${JSON.stringify(data)}`
        );
    }

    return data.categorySuggestions ?? [];
}

async function findLeafEbayCategory(query) {
    const suggestions = await findEbayCategories(query);

    const chosen = suggestions.find((suggestion) => {
        const category = suggestion?.category || suggestion;
        return category?.leafCategory === true || category?.leafCategory === "true";
    }) || suggestions[0];

    if (!chosen) {
        throw new Error(`No eBay category found for ${query}`);
    }

    return chosen.category || chosen;
}


async function getEbayCategoryAspects(categoryId) {
    const treeId = await getCategoryTreeId();

    const { response, data } = await fetchTaxonomyJson(
        `${EBAY_TAXONOMY_BASE}/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
    );

    if (!response.ok) {
        throw new Error(
            `Unable to retrieve eBay category aspects: ${JSON.stringify(data)}`
        );
    }

    return data.aspects ?? [];
}


async function getAspects(type) {
    if (!type) {
        throw new Error("Invalid item type");
    }

    const cache =
        loadCache();

    const cacheKey =
        String(type.id);

    const cached =
        cache[cacheKey];

    if (isCacheValid(cached)) {
        return cached.data;
    }


    console.log(
        `Fetching eBay aspects for ${type.name}`
    );

    let category;
    let ebayAspects;

    try {
        category = await findLeafEbayCategory(type.ebayQuery);

        if (!category?.categoryId) {
            throw new Error(`No valid live leaf eBay category found for ${type.name}`);
        }

        ebayAspects =
            await getEbayCategoryAspects(
                category.categoryId
            );
    } catch (err) {
        if (cached?.data?.categoryId && Array.isArray(cached?.data?.aspects) && cached.data.aspects.length > 0) {
            console.warn(
                `[eBay] Falling back to cached aspects for ${type.name}:`,
                err?.message || err
            );
            return cached.data;
        }

        throw err;
    }


    const result = {
        categoryId:
            category.categoryId,

        categoryName:
            category.categoryName,

        aspects:
            ebayAspects.map(aspect => ({
                name:
                    aspect.localizedAspectName,

                required:
                    aspect.aspectConstraint
                        ?.aspectRequired ?? false,

                usage:
                    aspect.aspectConstraint
                        ?.aspectUsage ?? null,

                mode:
                    aspect.aspectConstraint
                        ?.aspectMode ?? null,

                cardinality:
                    aspect.aspectConstraint
                        ?.itemToAspectCardinality ?? null,

                values:
                    aspect.aspectValues?.map(
                        value =>
                            value.localizedValue
                    ) ?? []
            }))
    };


    cache[cacheKey] = {
        typeName: type.name,
        cachedAt: Date.now(),
        data: result
    };


    saveCache(cache);


    return result;
}


module.exports = {
    types,
    getAspects,
    resolveEbayCategoryId
};