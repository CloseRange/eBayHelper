const db = require('./../supabase/client');
const { generateImageModel1, cleanupProductPhoto, generateListingText } = require('./../ebay/openai_image');
const { randomUUID } = require('crypto');
const { postListing } = require('./../ebay/ebay');

async function generateSKU() {
    const skus = await db.getAllListingSkus();
    const parsedSkus = skus
        .map((sku) => String(sku).trim())
        .filter((sku) => /^\d{3}-\d+$/.test(sku))
        .map((sku) => {
            const [bin, sn] = sku.split('-');
            return { bin, sn: Number(sn) };
        });

    let nextBin = '010';
    let nextSn = 1;

    if (parsedSkus.length) {
        const highestSn = Math.max(...parsedSkus.map((item) => item.sn));
        nextSn = highestSn + 1;

        while (parsedSkus.some((item) => item.bin === nextBin)) {
            nextBin = (Number(nextBin) + 1).toString().padStart(3, '0');
        }
    }

    return `${nextBin}-${nextSn}`;
}
function formatAspects(aspects) {
    const result = {};
    if (!aspects || typeof aspects !== "object") {
        return result;
    }

    for (const aspect of Object.values(aspects)) {
        if (!aspect || typeof aspect !== "object") {
            continue;
        }

        const label = aspect.label;
        const value = aspect.value;

        if (
            !label ||
            value === undefined ||
            value === null ||
            value === ""
        ) {
            continue;
        }

        const key = String(label)
            .trim()
            .split(/\s+/)
            .map(
                word =>
                    word.charAt(0).toUpperCase() +
                    word.slice(1)
            )
            .join(" ");

        result[key] = Array.isArray(value)
            ? value.map(String)
            : [String(value)];
    }

    return result;
}


async function generateListing(frontImage64, backImage64, modelImage64A, modelImage64B, tagImage64, sku, info) {
    let result = null;

    try {
        await db.updateListingState(sku, 1, 'N/A');
        const normalizedInfo = {
            ...(info || {}),
            features: info?.features ?? info?.aspects ?? {},
        };
        const aspects = formatAspects(normalizedInfo.features || {});
        const id = randomUUID();
        const ebayCategoryId = Number(normalizedInfo.categoryId ?? normalizedInfo.category);

        if (!Number.isFinite(ebayCategoryId) || ebayCategoryId <= 0) {
            throw new Error('A valid numeric eBay categoryId is required before creating the offer.');
        }

        if (!frontImage64 || !backImage64) {
            throw new Error('Front and back images are required.');
        }

        const hasProvidedModelImages = Boolean(
            modelImage64A && String(modelImage64A).trim() &&
            modelImage64B && String(modelImage64B).trim()
        );

        let modelImage1Url = null;
        let modelImage2Url = null;
        if (hasProvidedModelImages) {
            try {
                modelImage1Url = await db.uploadBase64ImageToBucket({
                    bucketName: 'listing-photos',
                    path: `${info.category}/${sku}-model1-${id}.jpg`,
                    base64Data: modelImage64A,
                });
                modelImage2Url = await db.uploadBase64ImageToBucket({
                    bucketName: 'listing-photos',
                    path: `${info.category}/${sku}-model2-${id}.jpg`,
                    base64Data: modelImage64B,
                });
            } catch (err) {
                console.error('Error uploading provided model images to Supabase:', err);
                throw new Error('Failed to upload provided model images. Please try again later.');
            }
        } else {
            let genData = null;
            try {
                genData = await generateImageModel1(info.category, info.features, frontImage64, backImage64, sku);
            } catch (err) {
                console.error('Error generating images with OpenAI:', err);
                throw new Error('Failed to generate images. Please try again later.');
            }

            if (genData?.images) {
                try {
                    if (genData.images.photoA) {
                        modelImage1Url = await db.uploadBase64ImageToBucket({
                            bucketName: 'listing-photos',
                            path: `${info.category}/${sku}-model1-${id}.jpg`,
                            base64Data: genData.images.photoA,
                        });
                    }
                    if (genData.images.photoB) {
                        modelImage2Url = await db.uploadBase64ImageToBucket({
                            bucketName: 'listing-photos',
                            path: `${info.category}/${sku}-model2-${id}.jpg`,
                            base64Data: genData.images.photoB,
                        });
                    }
                } catch (err) {
                    console.error('Error uploading generated images to Supabase:', err);
                    throw new Error('Failed to upload generated images. Please try again later.');
                }
            }
        }

        const frontPublicUrl = await db.uploadBase64ImageToBucket({
            bucketName: 'listing-photos',
            path: `${info.category}/${sku}-front-${id}.jpg`,
            base64Data: await cleanupProductPhoto(frontImage64),
        });
        console.log('Front Public URL:', frontPublicUrl);

        const backPublicUrl = await db.uploadBase64ImageToBucket({
            bucketName: 'listing-photos',
            path: `${info.category}/${sku}-back-${id}.jpg`,
            base64Data: await cleanupProductPhoto(backImage64),
        });
        console.log('Back Public URL:', backPublicUrl);

        let tagPublicUrl = null;
        if (tagImage64 && String(tagImage64).trim()) {
            tagPublicUrl = await db.uploadBase64ImageToBucket({
                bucketName: 'listing-photos',
                path: `${info.category}/${sku}-tag-${id}.jpg`,
                base64Data: tagImage64,
            });
        }
        console.log('Tag Public URL:', tagPublicUrl);

        await db.updateListingState(sku, 6, 'N/A');

        const listingText = await generateListingText({
            imageDataFront: frontImage64,
            category: info.category || "Unknown",
            features: { ...info.features },
            condition: "USED_EXCELLENT",
            extraDetails: ""
        });

        await db.updateListingState(sku, 7, 'N/A');
        const bin = sku.split('-')[0];
        const sn = sku.split('-')[1];
        const priceRates = await db.getPriceRates();
        const basePriceRate = (priceRates || []).find((rate) => Number(rate.id) === 1);
        const defaultBasePrice = Number(basePriceRate?.price);
        const initialPrice = Number.isFinite(defaultBasePrice) && defaultBasePrice > 0
            ? defaultBasePrice
            : 10;

        await db.createListing({
            title: listingText.title || `Pre-owned ${info.category || "item"}`,
            description: listingText.description || `Pre-owned ${info.category || "item"} in good condition.`,
            price: info.price !== undefined && info.price !== null ? Number(info.price) : initialPrice,
            bin: bin,
            sn: sn,
            sku: sku,
            categoryId: info.category || '0000',
            condition: 'USED_EXCELLENT',
            aspects: info.features || {}
        });

        const orderedImageUrls = [modelImage1Url, modelImage2Url, frontPublicUrl, backPublicUrl, tagPublicUrl]
            .filter((url) => typeof url === 'string' && url.trim() !== '');

        await db.addListingImages(sku, orderedImageUrls);

        const validImageUrls = [...orderedImageUrls];

        if (!validImageUrls.length) {
            throw new Error('No valid listing images were generated for the eBay inventory item.');
        }

        const listingPrice = Number.isFinite(Number(info.price)) && Number(info.price) > 0
            ? Number(info.price)
            : initialPrice;

        await postListing({
            price: normalizedInfo.price !== undefined && normalizedInfo.price !== null ? Number(normalizedInfo.price) : listingPrice,
            title: listingText.title || `Pre-owned ${info.category || "item"}`,
            sku: sku,
            description: listingText.description || `Pre-owned ${info.category || "item"} in good condition.`,
            categoryId: ebayCategoryId,
            condition: 'PRE_OWNED_EXCELLENT',
            imageUrls: validImageUrls,
            aspects: aspects
        });

        result = {
            sku,
            modelImage1Url,
            modelImage2Url,
            frontPublicUrl,
            backPublicUrl,
            tagPublicUrl,
        };

        return result;
    } catch (err) {
        console.error('Error generating listing:', err);
        throw err;
    } finally {
        await db.deleteListingState(sku).catch((cleanupErr) => {
            console.error('[generateListing] Failed to clear listing state:', cleanupErr);
        });
    }
}


module.exports = { generateSKU, generateListing };


