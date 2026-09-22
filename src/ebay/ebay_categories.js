require("dotenv").config();

const { getEbayApiBase } = require('./index');

const EBAY_TAXONOMY_BASE = `${getEbayApiBase()}/commerce/taxonomy/v1`;
const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.join(__dirname, "../cache/ebay-aspects.json");

const CACHE_MAX_AGE =
    7 * 24 * 60 * 60 * 1000;

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
    const response = await fetch(
        `${EBAY_TAXONOMY_BASE}/get_default_category_tree_id?marketplace_id=EBAY_US`,
        {
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                Accept: "application/json"
            }
        }
    );

    const data = await response.json();

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


async function findEbayCategories(query) {
    const treeId = await getCategoryTreeId();

    const response = await fetch(
        `${EBAY_TAXONOMY_BASE}/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(query)}`,
        {
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                Accept: "application/json"
            }
        }
    );

    const data = await response.json();

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

    const response = await fetch(
        `${EBAY_TAXONOMY_BASE}/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
        {
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                Accept: "application/json"
            }
        }
    );

    const data = await response.json();

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


    const category = await findLeafEbayCategory(type.ebayQuery);

    if (!category?.categoryId) {
        throw new Error(`No valid live leaf eBay category found for ${type.name}`);
    }

    const ebayAspects =
        await getEbayCategoryAspects(
            category.categoryId
        );


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
    getAspects
};