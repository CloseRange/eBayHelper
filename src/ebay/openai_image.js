require("dotenv").config();

const sharp = require("sharp");


// ============================================================
// CONFIG
// ============================================================

const OPENAI_URL = "https://api.openai.com/v1/responses";

const VISION_MODEL = "gpt-4.1";
const IMAGE_MODEL = "gpt-image-2";

const IMAGE_SIZE = "1024x1536";
const IMAGE_QUALITY = "high";

const MAX_IMAGE_ATTEMPTS = 3;

const SUPPORTED_IMAGE_FORMATS = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
]);

async function cleanupProductPhoto(imageData) {
    // Keep the original exactly as provided so we can fall back to it.
    const originalImage = imageData;
    return imageData;
    // The rest of the function is currently unreachable due to the early return.

    try {
        if (!imageData || typeof imageData !== "string") {
            return originalImage;
        }

        // Normalize AVIF / raw base64 / data URLs using your existing helper.
        const normalizedImage =
            await toDataUrl(
                imageData,
                "image/png"
            );

        if (!normalizedImage) {
            console.warn(
                "[cleanupProductPhoto] Could not normalize image. Returning original."
            );

            return originalImage;
        }

        const prompt = `
Edit the supplied product photograph into a cleaner, more professional
ecommerce listing image.

IMPORTANT:

The supplied photograph is the authoritative source for the actual item.

Do NOT redesign, replace, or materially change the clothing item itself.

Preserve as accurately as possible:

- exact garment shape
- proportions
- colors
- logos
- graphics
- printed text
- stitching
- seams
- pockets
- buttons
- zippers
- fabric texture
- patterns
- wear
- condition
- unique identifying details

HANGER / SUPPORT PRESERVATION:

If the garment is hanging on a hanger in the original photograph:

- KEEP the hanger.
- Preserve the approximate hanger shape, position, and orientation.
- The garment must still visibly hang from the hanger.
- Do not remove the hanger.
- Do not make the garment float in midair.
- Do not detach the garment from the hanger.

The hanger must also be realistically supported.

For example, the hanger may be hanging from:

- a simple clothing rack
- a wall hook
- a wardrobe rail
- a minimal studio garment stand

Choose the simplest realistic support that fits naturally into the new
background.

The support should be subtle and secondary to the garment.

Do not add a large distracting rack or complicated furniture.

If NO hanger is present in the original photograph, do not invent one.

Improve ONLY the presentation of the photograph.

LIGHTING / IMAGE CLEANUP:

- correct poor or uneven lighting
- improve exposure
- improve white balance
- reduce harsh shadows when appropriate
- make colors look natural and accurate
- increase clarity without making the image look artificial
- retain realistic texture
- make the item look well lit and easy to inspect
- do not hide flaws or condition issues

BACKGROUND:

Replace the original background with a simple, tasteful,
professional ecommerce environment that complements the garment.

The background should:

- make the item stand out clearly
- remain visually secondary
- be clean and uncluttered
- avoid readable signs or text
- use subtle realistic depth or texture when appropriate
- use neutral or complementary tones
- look like a professionally photographed resale listing

If a hanger is present, make sure the new background includes a realistic
place for that hanger to be physically suspended from.

Possible background styles include:

- soft warm neutral studio with a minimal clothing rack
- muted gray-beige wall with a simple wall hook
- subtle cream studio wall with a garment rail
- understated pastel studio setting
- clean contemporary dressing area
- softly lit neutral studio with a minimal garment stand

Choose whichever scene best complements the actual item.

COMPOSITION:

- keep the original garment clearly visible
- keep approximately the same orientation
- keep the garment centered or professionally composed
- do not crop off important parts
- preserve the hanger if one exists
- make sure the hanger is attached to a realistic support
- do not let the garment float
- do not add people unless a person already exists in the original
- do not add text, labels, watermarks, or borders

The final result should look like the SAME real garment,
still hanging naturally if it was hanging originally,
but photographed in a cleaner professional environment.
`;

        const content = [
            {
                type: "input_text",
                text: prompt
            },
            {
                type: "input_image",
                image_url: normalizedImage,
                detail: "high"
            }
        ];

        console.log(
            "[cleanupProductPhoto] sending cleanup request..."
        );

        const data =
            await openAIResponse({
                model: VISION_MODEL,

                input: [
                    {
                        role: "user",
                        content
                    }
                ],

                tools: [
                    {
                        type: "image_generation",
                        model: IMAGE_MODEL,
                        size: IMAGE_SIZE,
                        quality: IMAGE_QUALITY,
                        output_format: "png"
                    }
                ],

                tool_choice: {
                    type: "image_generation"
                }
            });

        const imageCall =
            getImageCall(data);

        const result =
            imageCall?.result ||
            data.result;

        if (
            !result ||
            typeof result !== "string"
        ) {
            console.warn(
                "[cleanupProductPhoto] OpenAI did not return an image. Returning original."
            );

            return originalImage;
        }

        console.log(
            "[cleanupProductPhoto] cleanup succeeded."
        );

        return result;

    } catch (error) {
        console.error(
            "[cleanupProductPhoto] cleanup failed. Returning original:",
            error.message || error
        );

        return originalImage;
    }
}
// ============================================================
// RANDOM VARIATION HELPERS
// ============================================================

function randomItem(array) {
    return array[
        Math.floor(Math.random() * array.length)
    ];
}

function isOpenAIDisabled() {
    const rawValue =
        process.env.OPEN_AI_DISABLE ??
        process.env.OPENAI_DISABLE ??
        process.env.OPEN_AI_DISABLED ??
        "false";

    return [
        "1",
        "true",
        "yes",
        "on"
    ].includes(
        String(rawValue).trim().toLowerCase()
    );
}

function getDefaultListingText({ category, features = {} }) {
    const categoryName =
        String(category || "Clothing").trim() || "Clothing";

    const featureValue = (key, fallback) => {
        const direct = features?.[key] ?? features?.[key.toLowerCase()] ?? features?.[key.toUpperCase()];

        if (Array.isArray(direct)) {
            return direct.find(v => v !== undefined && v !== null && String(v).trim()) ?? fallback;
        }

        return (direct !== undefined && direct !== null && String(direct).trim())
            ? String(direct)
            : fallback;
    };

    const brand = featureValue("Brand", "Brand");
    const color = featureValue("Color", "Neutral");
    const size = featureValue("Size", "M");

    const titleOptions = [
        `${brand} ${categoryName} ${size}`,
        `${brand} ${color} ${categoryName} ${size}`,
        `${categoryName} ${color} ${size}`,
        `${brand} ${categoryName} - ${color}`
    ];

    const descriptionOptions = [
        `Pre-owned ${color} ${categoryName} in size ${size}. This is a test listing using the supplied photos and default values while OpenAI generation is disabled.`,
        `${brand} ${categoryName} in ${color}, size ${size}. This is a default listing generated for local testing with the provided photos only.`,
        `This ${color.toLowerCase()} ${categoryName.toLowerCase()} is a size ${size} test listing. OpenAI generation is disabled, so the provided photos are used as the product references.`
    ];

    return {
        title: randomItem(titleOptions),
        description: randomItem(descriptionOptions)
    };
}


function getRandomVariationHint() {
    const hairIdeas = [
        "short textured hair",
        "medium-length layered hair",
        "natural curls",
        "soft loose waves",
        "straight shoulder-length hair",
        "short faded haircut",
        "messy textured hairstyle",
        "pulled-back hairstyle",
        "soft fringe hairstyle",
        "long natural hair",
        "chin-length bob",
        "wavy medium-length hair",
        "short curly hairstyle"
    ];

    const faceIdeas = [
        "oval face with soft youthful features",
        "angular face with defined cheekbones",
        "round youthful face",
        "longer face with subtle features",
        "square jaw with softer styling",
        "heart-shaped face",
        "defined cheekbones with a softer jawline",
        "soft symmetrical facial features",
        "slightly sharper youthful facial structure",
        "gentle rounded facial features"
    ];

    const poseIdeas = [
        "weight shifted onto one leg with the opposite knee slightly bent",
        "one hand resting naturally on the hip with a relaxed stance",
        "one hand loosely in a pocket with the torso turned slightly",
        "a subtle walking pose as if taking one natural step forward",
        "one leg crossed slightly in front of the other with relaxed shoulders",
        "a three-quarter body turn while keeping the garment front clearly visible",
        "one arm relaxed while the other bends naturally near the waist",
        "shoulders slightly angled with weight shifted onto the back leg",
        "one foot slightly forward with the torso gently rotated",
        "a relaxed fashion stance with one knee bent and one hand near the waist"
    ];
    const sceneIdeas = [
        "a softly lit modern studio using a contrasting neutral backdrop",
        "a contemporary loft with a background tone clearly separated from the garment color",
        "a softly blurred urban streetscape with strong subject-background separation",
        "a minimal modern interior using restrained neutral tones that contrast with the garment",
        "a warm neutral studio set when the garment is cool-toned, or a cool neutral studio when the garment is warm-toned",
        "a modern concrete-and-glass environment with enough tonal contrast to clearly outline the clothing",
        "a softly lit architectural setting whose colors do not repeat the garment's dominant color",
        "an upscale lifestyle setting with a muted contrasting background and shallow depth of field",
        "a bright contemporary interior chosen specifically to contrast with the garment",
        "a subtle architectural setting with strong light-dark separation from the clothing",
        "a tasteful city scene with muted colors and clear separation around the garment silhouette",
        "a clean editorial studio using a restrained contrasting color rather than the garment's own dominant color"
    ];

    const expressionIdeas = [
        "subtle friendly smile",
        "relaxed confident expression",
        "soft neutral expression",
        "slight natural smile",
        "calm approachable expression",
        "confident but relaxed expression"
    ];

    return {
        hairDirection:
            randomItem(hairIdeas),

        faceDirection:
            randomItem(faceIdeas),

        poseDirection:
            randomItem(poseIdeas),

        sceneDirection:
            randomItem(sceneIdeas),

        expressionDirection:
            randomItem(expressionIdeas)
    };
}


// ============================================================
// IMAGE NORMALIZATION
// ============================================================

async function normalizeImageInput(
    value,
    fallbackMime = "image/png"
) {
    if (
        !value ||
        typeof value !== "string"
    ) {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed) {
        return null;
    }


    // --------------------------------------------------------
    // HTTP / HTTPS URL
    // --------------------------------------------------------

    if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")
    ) {
        return trimmed;
    }


    // --------------------------------------------------------
    // DATA URL
    // --------------------------------------------------------

    if (trimmed.startsWith("data:")) {
        const mimeMatch =
            trimmed.match(
                /^data:(image\/[a-zA-Z0-9.+-]+);base64,/i
            );

        const mime =
            mimeMatch
                ? mimeMatch[1].toLowerCase()
                : null;

        const base64Payload =
            trimmed.replace(
                /^data:image\/[a-zA-Z0-9.+-]+;base64,/i,
                ""
            );

        if (!base64Payload) {
            throw new Error(
                "Image data URL did not contain base64 image data."
            );
        }


        if (
            mime &&
            SUPPORTED_IMAGE_FORMATS.has(mime)
        ) {
            return (
                `data:${mime};base64,` +
                base64Payload
            );
        }


        console.log(
            `[normalizeImageInput] Converting ${mime || "unknown format"} to PNG`
        );

        try {
            const buffer =
                Buffer.from(
                    base64Payload,
                    "base64"
                );

            const converted =
                await sharp(buffer)
                    .png()
                    .toBuffer();

            return (
                "data:image/png;base64," +
                converted.toString("base64")
            );

        } catch (error) {
            throw new Error(
                `Failed converting image to PNG: ${error.message}`
            );
        }
    }


    // --------------------------------------------------------
    // RAW BASE64
    // --------------------------------------------------------

    const cleaned =
        trimmed.replace(/\s/g, "");

    try {
        const buffer =
            Buffer.from(
                cleaned,
                "base64"
            );

        const metadata =
            await sharp(buffer).metadata();

        const detectedMime =
            metadata.format === "jpeg"
                ? "image/jpeg"

            : metadata.format === "png"
                ? "image/png"

            : metadata.format === "gif"
                ? "image/gif"

            : metadata.format === "webp"
                ? "image/webp"

            : null;


        if (
            detectedMime &&
            SUPPORTED_IMAGE_FORMATS.has(
                detectedMime
            )
        ) {
            return (
                `data:${detectedMime};base64,` +
                cleaned
            );
        }


        console.log(
            `[normalizeImageInput] Converting ${metadata.format || fallbackMime} to PNG`
        );

        const converted =
            await sharp(buffer)
                .png()
                .toBuffer();

        return (
            "data:image/png;base64," +
            converted.toString("base64")
        );

    } catch (error) {
        throw new Error(
            `Invalid image data: ${error.message}`
        );
    }
}


async function toDataUrl(
    imageData,
    fallbackMime = "image/png"
) {
    return normalizeImageInput(
        imageData,
        fallbackMime
    );
}


// ============================================================
// OPENAI REQUEST
// ============================================================

async function openAIResponse(body) {
    const apiKey =
        process.env.OPENAI_API_KEY;

    if (!apiKey) {
        throw new Error(
            "OPENAI_API_KEY is not set."
        );
    }

    try {
        const response =
            await fetch(
                OPENAI_URL,
                {
                    method: "POST",

                    headers: {
                        Authorization:
                            `Bearer ${apiKey}`,

                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(body)
                }
            );

        const rawText =
            await response.text();

        let data;

        try {
            data =
                rawText
                    ? JSON.parse(rawText)
                    : {};
        } catch {
            data = {
                raw: rawText
            };
        }


        if (!response.ok) {
            console.error(
                "[openAIResponse] OpenAI failed:",
                {
                    status:
                        response.status,

                    body:
                        data
                }
            );

            throw new Error(
                `OpenAI error ${response.status}: ${JSON.stringify(data)}`
            );
        }

        return data;

    } catch (error) {
        console.error(
            "[openAIResponse] Request exception:",
            error
        );

        throw error;
    }
}


// ============================================================
// RESPONSE HELPERS
// ============================================================

function getResponseText(data) {
    if (!data) {
        return "";
    }

    if (
        typeof data.output_text === "string" &&
        data.output_text.trim()
    ) {
        return data.output_text.trim();
    }

    const messages =
        data.output
            ?.filter(
                item =>
                    item.type === "message"
            )
            ?.flatMap(
                item =>
                    item.content || []
            )
            ?.filter(
                content =>
                    content.type ===
                    "output_text"
            )
            ?.map(
                content =>
                    content.text
            )
            ?.filter(Boolean)
            || [];

    return messages
        .join("\n")
        .trim();
}


function getImageCall(data) {
    return data.output?.find(
        item =>
            item.type ===
            "image_generation_call"
    );
}


function isSafetyFailure(data) {
    const imageCall =
        getImageCall(data);

    const text =
        getResponseText(data)
            .toLowerCase();

    if (
        imageCall?.status !== "failed"
    ) {
        return false;
    }

    const safetyPhrases = [
        "safety",
        "content",
        "explicit",
        "sexual",
        "revealing",
        "nudity",
        "provocative",
        "can't create",
        "cannot create",
        "can’t create",
        "policy"
    ];

    return safetyPhrases.some(
        phrase =>
            text.includes(phrase)
    );
}


// ============================================================
// TEXT + IMAGE VISION
// ============================================================

async function generateTextWithImages(
    prompt,
    images = []
) {
    const content = [
        {
            type: "input_text",
            text: prompt
        }
    ];

    for (const image of images) {
        if (!image) {
            continue;
        }

        content.push({
            type: "input_image",
            image_url: image,
            detail: "high"
        });
    }

    console.log(
        "[generateTextWithImages] sending prompt with",
        content.length - 1,
        "images"
    );

    const data =
        await openAIResponse({
            model:
                VISION_MODEL,

            input: [
                {
                    role: "user",
                    content
                }
            ]
        });

    const text =
        getResponseText(data);

    if (!text) {
        throw new Error(
            "OpenAI did not return a text description."
        );
    }

    return text;
}


// ============================================================
// IMAGE GENERATION RETRY PROMPT
// ============================================================
function createNeutralEcommercePrompt(
    originalPrompt,
    attempt = 2
) {
    const strongerSafety =
        attempt >= 3;

    return `
Create a standard professional ecommerce clothing photograph.

This is ordinary, non-sexual retail product photography.

The person shown must be a fictional ADULT professional fashion
model who is clearly age 18 or older.

Prefer a young-adult appearance.

The purpose of this image is to accurately display the supplied garment
in a safe, conservative, professional ecommerce presentation.

IMPORTANT:

The supplied garment photographs are the authoritative source for
the GARMENT ITSELF.

Do NOT redesign the garment.

Preserve:

- garment color
- graphics
- logos
- printed text
- patterns
- seams
- sleeves
- neckline
- hem
- fabric appearance
- construction
- fit
- proportions

However, if wearing the garment by itself would create too much visible
skin for a safe image-generation result, you MAY add simple opaque
base-layer clothing UNDER the garment.

SAFE LAYERING IS ALLOWED.

Examples include:

- plain fitted undershirt
- opaque camisole
- simple tank top
- fitted long-sleeve base layer
- leggings
- opaque tights
- simple shorts underneath a short garment
- other plain non-distracting coverage layers

Any added layer should:

- be simple and solid-colored
- use neutral or coordinating colors
- remain visually secondary
- not cover important garment graphics or details
- not change the garment itself
- look like normal everyday clothing

If the garment exposes the midriff:

- prefer an opaque fitted camisole or undershirt underneath

If the garment has an open or low back:

- use a fitted opaque base layer underneath if needed

If the garment exposes a large amount of leg:

- opaque tights, leggings, or modest shorts may be used if needed

If the neckline creates too much exposure:

- use a simple camisole or fitted undershirt beneath it

POSE SAFELY:

If the original pose or planned pose creates excessive body exposure,
change the pose.

Prefer:

- torso facing more toward the camera
- arms positioned naturally near the body
- legs closer together
- reduced twisting
- reduced arching
- less dramatic side or rear angles
- normal upright fashion posture

Do NOT use:

- seductive poses
- provocative poses
- exaggerated hip positioning
- deep back arching
- suggestive camera framing
- low camera angles that emphasize the body
- unnecessary focus on exposed skin

CAMERA:

Choose a normal ecommerce camera angle.

Prefer:

- eye-level or chest-level camera
- normal fashion catalog framing
- enough distance to show the garment clearly
- no body-emphasizing closeups

The garment must remain the visual focus.

BACKGROUND:

Keep the planned professional ecommerce environment when possible.

The background should:

- contrast clearly with the garment
- remain visually secondary
- not use the garment's dominant color
- keep the clothing easy to distinguish
- look clean and professional

LIGHTING:

Use:

- clean professional retail lighting
- natural body proportions
- realistic fabric behavior
- realistic anatomy
- clear garment detail

${strongerSafety ? `
EXTRA-SAFE FALLBACK:

The previous attempts were not accepted.

For this attempt, prioritize a conservative retail presentation.

Use:

- a clearly opaque base layer wherever substantial skin would otherwise show
- a straightforward upright pose
- a front or gentle three-quarter camera view
- no body-emphasizing positioning
- normal commercial catalog styling

It is acceptable for the model to wear an undershirt, camisole, tights,
leggings, or another simple coverage layer beneath the supplied garment.

Do whatever reasonable styling adjustment is needed to produce a safe,
ordinary ecommerce photograph while keeping the actual garment recognizable
and unchanged.
` : `
If there is any uncertainty about whether the original styling creates too
much body exposure, choose the safer option:

- use an opaque underlayer
- use a less exposing pose
- use a more neutral camera angle

The goal is successful, ordinary ecommerce photography.
`}

ORIGINAL PRODUCT PHOTOGRAPHY REQUEST:

${originalPrompt}
`;
}


// ============================================================
// GENERATE PHOTO
// ============================================================

async function generatePhoto(
    prompt,
    images = [],
    options = {}
) {
    const {
        label = "photo",
        maxAttempts =
            MAX_IMAGE_ATTEMPTS
    } = options;

    let currentPrompt =
        prompt;

    for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
    ) {
        console.log(
            `[generatePhoto:${label}] attempt ${attempt}/${maxAttempts}`
        );

        const content = [
            {
                type: "input_text",
                text: currentPrompt
            }
        ];

        for (const image of images) {
            if (!image) {
                continue;
            }

            content.push({
                type: "input_image",
                image_url: image,
                detail: "high"
            });
        }

        console.log(
            `[generatePhoto:${label}] sending`,
            content.length - 1,
            "reference images"
        );

        const data =
            await openAIResponse({
                model:
                    VISION_MODEL,

                input: [
                    {
                        role:
                            "user",

                        content
                    }
                ],

                tools: [
                    {
                        type:
                            "image_generation",

                        model:
                            IMAGE_MODEL,

                        size:
                            IMAGE_SIZE,

                        quality:
                            IMAGE_QUALITY,

                        output_format:
                            "png"
                    }
                ],

                tool_choice: {
                    type:
                        "image_generation"
                }
            });

        const imageCall =
            getImageCall(data);

        const result =
            imageCall?.result ||
            data.result;


        // SUCCESS

        if (
            result &&
            typeof result === "string"
        ) {
            console.log(
                `[generatePhoto:${label}] success`
            );

            console.log(
                `[generatePhoto:${label}] image length:`,
                result.length
            );

            return result;
        }


        // FAILED

        const responseText =
            getResponseText(data);

        console.warn(
            `[generatePhoto:${label}] image generation failed.`,
            {
                status:
                    imageCall?.status,

                message:
                    responseText ||
                    "No explanation returned."
            }
        );


        // SAFETY RETRY

        if (
            isSafetyFailure(data) &&
            attempt < maxAttempts
        ) {
            console.log(
                `[generatePhoto:${label}] safety/content warning detected. Retrying as neutral ecommerce photography.`
            );

            currentPrompt =
                createNeutralEcommercePrompt(
                    prompt
                );

            continue;
        }


        // GENERIC RETRY

        if (
            attempt < maxAttempts
        ) {
            console.log(
                `[generatePhoto:${label}] retrying image generation...`
            );

            continue;
        }


        throw new Error(
            responseText
                ? `Image generation failed for ${label}: ${responseText}`
                : `Image generation failed for ${label} after ${maxAttempts} attempts.`
        );
    }

    throw new Error(
        `Image generation failed for ${label}.`
    );
}


// ============================================================
// MAIN TWO-PHOTO GENERATION PIPELINE
// ============================================================

async function generateImageModel1(
    category,
    features,
    imageDataFront,
    imageDataBack
) {
    console.log(
        "[generateImageModel1] starting..."
    );

    if (isOpenAIDisabled()) {
        console.log(
            "[generateImageModel1] OpenAI disabled; using provided front/back photos as the default test images."
        );

        return {
            modelDescription:
                "default test generation",

            pose2Description: "",

            variationHint: "",

            images: {
                photoA: imageDataFront || null,
                photoB: imageDataBack || null
            }
        };
    }


    // ========================================================
    // NORMALIZE ORIGINAL GARMENT IMAGES
    // ========================================================

    const frontImage =
        await toDataUrl(
            imageDataFront,
            "image/png"
        );

    const backImage =
        await toDataUrl(
            imageDataBack,
            "image/png"
        );

    if (
        !frontImage ||
        !backImage
    ) {
        throw new Error(
            "Both front and back garment photos are required."
        );
    }

    console.log(
        "[generateImageModel1] front image length:",
        frontImage.length
    );

    console.log(
        "[generateImageModel1] back image length:",
        backImage.length
    );


    // ========================================================
    // RANDOM CREATIVE VARIATION
    // ========================================================

    const variationHint =
        getRandomVariationHint();

    console.log(
        "[generateImageModel1] variation hint:",
        variationHint
    );


    // ========================================================
    // STEP 1
    // CREATE MODEL + FIRST POSE + SCENE
    // ========================================================

    const promptPerson = `
You are planning a professional ecommerce fashion photography
shoot for an online resale clothing listing.

CATEGORY:

${category}

COMPLETE CLOTHING FEATURES:

${JSON.stringify(features, null, 2)}

The COMPLETE features object is important.

Carefully inspect it for information such as:

- Department
- gender presentation
- intended audience
- style
- color
- fit
- garment type
- fashion aesthetic
- age demographic

DEPARTMENT GUIDANCE:

If a Department field exists, use it as an important guide.

- "Men":
  choose a young adult masculine-presenting model.

- "Women":
  choose a young adult feminine-presenting model.

- "Teens":
  choose a youthful-looking YOUNG ADULT approximately age 18-22.
  NEVER depict a minor.

- "Unisex Adult":
  choose whichever adult presentation best complements the garment.
  Do not always choose the same gender presentation between listings.

- If Department is missing, unclear, or different:
  infer the best adult model using the entire features object and the
  garment reference photos.

AGE:

Prioritize YOUNG ADULTS.

Normally choose a model approximately 18-28 years old.

The person must ALWAYS clearly be an adult age 18 or older.

REFERENCE PHOTOS:

You are being supplied photographs of the real garment.

Inspect them to understand:

- overall fashion style
- intended audience
- color palette
- garment personality
- garment proportions
- visual aesthetic
- fit
- overall styling direction

Your task is NOT to redesign or separately describe the garment.

Your task is to design:

- the fictional adult model
- face
- hair
- expression
- body type
- pose
- background
- camera
- lighting
- overall photography style

MODEL VARIETY IS IMPORTANT.

Do NOT default to the same generic-looking fashion model every time.

Actively vary between listings:

- facial structure
- jaw shape
- cheekbones
- eye shape
- nose shape
- hairstyle
- hair length
- hair texture
- hair color
- skin tone
- body proportions
- expression
- overall fashion personality

The goal is for different listings to feel like different models were
used in different professional shoots.

CREATIVE VARIATION HINTS FOR THIS LISTING:

Hair direction:

${variationHint.hairDirection}

Face direction:

${variationHint.faceDirection}

Expression direction:

${variationHint.expressionDirection}

These are inspiration, not strict requirements.

Adjust them if another choice would complement the garment better.

POSE:

The model should look like they are actually participating in a
professional fashion shoot.

Do NOT simply stand:

- straight up and down
- both feet flat and even
- both arms straight down
- shoulders square to camera
- head staring directly forward

Use a NATURAL but VISUALLY INTERESTING commercial fashion pose.

Possible pose ideas:

- weight shifted onto one leg
- one knee slightly bent
- one foot slightly forward
- one foot crossed slightly in front
- one hand naturally on the hip
- one hand loosely in a pocket
- one arm bent naturally
- shoulders rotated slightly
- torso turned slightly
- subtle walking pose
- head angled slightly
- relaxed three-quarter stance

For this listing, consider this pose direction:

${variationHint.poseDirection}

The pose should feel stylish and natural without becoming dramatic.

The FIRST photograph should still prioritize clearly showing the FRONT
of the garment.

Do NOT allow:

- hands
- arms
- hair
- accessories
- extreme body rotation

to cover important parts of the garment.

BACKGROUND / ENVIRONMENT:

Do NOT default to a plain white background.

Create a tasteful professional fashion or lifestyle environment that
supports the garment aesthetically while providing STRONG VISUAL SEPARATION
from the garment.

The garment must always be immediately easy to distinguish from the
background.

BACKGROUND COLOR CONTRAST IS A HIGH PRIORITY.

Before choosing the environment, identify the garment's dominant visible
color or colors.

Then choose a background whose dominant tone is CLEARLY DIFFERENT from the
garment.

Do NOT create a background dominated by the same or a closely similar color
as the garment.

Examples:

- green garment -> avoid green, olive, mint, teal-heavy backgrounds
- blue garment -> avoid blue or cyan-heavy backgrounds
- red garment -> avoid red, burgundy, or strong pink backgrounds
- orange garment -> avoid orange or rust-heavy backgrounds
- purple garment -> avoid purple or lavender-heavy backgrounds
- black garment -> prefer lighter backgrounds such as warm beige, cream,
  soft gray, pale concrete, or light architectural scenes
- white garment -> prefer medium-value backgrounds such as warm gray,
  muted tan, soft blue-gray, or darker neutral architecture
- gray garment -> avoid similarly valued gray backgrounds; create either
  lighter/darker contrast or use a restrained contrasting hue
- beige/brown garment -> avoid tan and brown-dominant surroundings

The background does NOT need to use the garment's color palette.

Instead, choose a restrained contrasting palette that makes the garment
visually separate from its surroundings.

Good background strategies include:

- warm garment against a cooler neutral environment
- cool garment against a warmer neutral environment
- dark garment against a light environment
- light garment against a medium or darker environment
- saturated garment against a muted neutral environment

The garment should have clear edge separation from the background,
especially around:

- shoulders
- sleeves
- torso
- hem
- sides of the garment

Avoid matching colors directly behind the garment.

Use lighting and tonal contrast to create visible separation between the
model, clothing, and background.

Possible environments include:

- modern studio environment
- contemporary loft
- modern interior
- subtle urban architecture
- clean city streetscape
- warm minimalist interior
- architectural outdoor setting
- editorial studio set
- textured wall environment
- tasteful commercial lifestyle setting

For this listing, this scene idea may be used as inspiration:

${variationHint.sceneDirection}

IMPORTANT:

The randomized scene direction is secondary to garment visibility.

If the suggested scene would create poor color or tonal contrast with the
garment, choose a different scene.

The background must:

- contrast clearly with the garment
- keep the garment as the highest-priority visual element
- stay visually secondary
- avoid repeating the garment's dominant color
- avoid camouflage-like color similarity
- contain no distracting readable signs
- remain slightly softer than the model
- use shallow depth of field where appropriate
- provide obvious silhouette separation
- look like professional fashion photography

CAMERA:

Choose the best:

- camera height
- viewing angle
- body framing
- crop
- focal-length feel

for clearly showing the garment and pose.

Usually show enough of the body for the pose to make sense while keeping
the garment large and easy to inspect.

SAFETY / PRESENTATION:

This is normal ecommerce fashion photography.

The model must always be an adult.

Do not design:

- sexualized poses
- seductive expressions
- provocative framing
- erotic photography
- boudoir photography

Do not describe the garment in sexual terms.

GARMENT ACCURACY:

Do not invent or alter:

- logos
- graphics
- printed text
- colors
- seams
- pockets
- buttons
- zippers
- garment construction

RETURN ONLY a concise but detailed description of:

1. model gender presentation
2. approximate adult age
3. skin tone
4. face
5. hair
6. expression
7. body type
8. exact pose
9. hand placement
10. leg placement
11. head direction
12. camera framing
13. camera angle
14. background/environment
15. lighting

Do not separately describe the garment.
`;


    console.log(
        "[generateImageModel1] creating model description..."
    );

    const personDescription =
        await generateTextWithImages(
            promptPerson,
            [
                frontImage,
                backImage
            ]
        );

    console.log(
        "[generateImageModel1] model description:",
        personDescription
    );


    // ========================================================
    // STEP 2
    // CREATE SECOND DYNAMIC POSE
    // ========================================================

    const promptPose2 = `
We are creating photograph number TWO in the SAME professional
ecommerce fashion photo set.

The EXACT SAME fictional adult model must appear.

ESTABLISHED MODEL AND PHOTOGRAPHY SETUP:

${personDescription}

Create a SECOND pose that feels like another photograph from the
same professional fashion shoot.

The second image should NOT simply repeat the first pose.

Its main purpose is to show another useful angle of the garment.

Prefer when appropriate:

- three-quarter rear view
- full rear view with slight body rotation
- side view
- over-the-shoulder three-quarter view
- subtle walking turn
- relaxed turned pose
- side-and-back combination view

MAKE THE SECOND POSE DYNAMIC.

Do not simply have the model stand straight with both arms hanging down.

Use natural commercial fashion posing such as:

- weight shifted to one leg
- one knee slightly bent
- one foot behind the other
- one foot slightly forward
- torso gently rotated
- shoulders rotated
- one hand naturally at the hip
- one arm relaxed while the other bends
- head turned slightly toward camera
- head turned slightly away from camera
- subtle movement

The pose should look:

- stylish
- natural
- relaxed
- professional
- useful for displaying the clothing

Maintain EXACTLY the same:

- fictional adult person
- face
- age
- skin tone
- body type
- hair
- hairstyle
- hair color
- expression style
- background scene
- lighting
- camera quality
- color grading
- photographic style

The background must remain the SAME environment as photograph one.

A slightly different camera location or crop is allowed.

The garment must remain the main visual focus.

Do not cover important garment details.

Do not change or reinterpret the garment.

This is ordinary non-sexual ecommerce fashion photography.

Return ONLY:

- exact body pose
- torso direction
- shoulder direction
- leg placement
- foot placement
- hand placement
- head direction
- model viewing direction
- camera position
- camera angle
- framing
`;


    console.log(
        "[generateImageModel1] creating second pose..."
    );

    const pose2Description =
        await generateTextWithImages(
            promptPose2,
            [
                frontImage,
                backImage
            ]
        );

    console.log(
        "[generateImageModel1] second pose:",
        pose2Description
    );


    // ========================================================
    // STEP 3
    // GENERATE PHOTO A
    // ========================================================

    const promptPhotoA = `
Create a high-quality photorealistic professional ecommerce
fashion photograph.

This is ordinary, non-sexual retail clothing photography.

The person must be the fictional ADULT fashion model described below.

MODEL AND SCENE:

${personDescription}

REFERENCE IMAGES:

The supplied garment photographs are the AUTHORITATIVE source
for the clothing.

The model must wear the same garment shown in the supplied
reference photographs.

GARMENT ACCURACY IS EXTREMELY IMPORTANT.

Preserve the real garment's:

- color
- graphics
- printed text
- logos
- patterns
- fabric appearance
- neckline
- sleeves
- hem
- seams
- pockets
- buttons
- zippers
- stitching
- proportions
- fit
- visible wear
- visible construction details

Do NOT:

- redesign the garment
- beautify the garment
- repair the garment
- simplify graphics
- change logos
- invent text
- remove details
- add details
- make the garment tighter
- make the garment looser
- alter garment proportions

The garment should look like the real physical item from the
reference photographs, simply being naturally worn by the model.

POSE:

Use the dynamic fashion pose described in MODEL AND SCENE.

Do NOT replace it with a stiff straight-standing pose.

The pose should feel like a real professional clothing photoshoot.

BACKGROUND:

Use the environment described in MODEL AND SCENE.

However, garment visibility takes priority over matching the original
background description.

The background must provide STRONG COLOR AND TONAL CONTRAST with the
garment.

Do NOT use a background dominated by the same color as the garment.

For example:

- do not put a green garment against a green environment
- do not put a blue garment against a blue environment
- do not put a black garment against a very dark background
- do not put a white garment against a very light background

If the planned scene has colors that are too similar to the garment,
adjust the scene colors while preserving the same general environment.

The garment silhouette must be easy to see immediately.

Create clear visual separation around:

- shoulders
- sleeves
- torso
- sides
- hem

Use differences in:

- hue
- brightness
- saturation
- lighting
- depth of field

to separate the garment from the background.

The environment should:

- contrast clearly with the garment
- remain secondary to the clothing
- be visually appealing
- use realistic depth
- be slightly softer than the subject
- avoid repeating the garment's dominant color
- avoid distracting readable text
- make the garment the strongest visual element

Do NOT replace the scene with plain white unless white provides the best
contrast and still looks professionally styled.

PHOTOGRAPHY REQUIREMENTS:

- photorealistic adult human
- realistic anatomy
- realistic body proportions
- realistic hands
- realistic fabric folds
- natural clothing fit
- sharp garment detail
- professional fashion lighting
- attractive commercial environment
- realistic depth of field
- garment clearly separated from the background
- natural dynamic fashion pose
- commercial ecommerce photography
- realistic camera perspective
- garment remains the strongest visual focus

Do not sexualize the model.

Do not use:

- seductive expressions
- provocative poses
- erotic camera framing

No text overlays.

No watermark.

No collage.

One adult model only.

The result should look like a real professional fashion photograph
for an online secondhand clothing listing.
`;


    console.log(
        "[generateImageModel1] generating photo A..."
    );

    const photoA =
        await generatePhoto(
            promptPhotoA,
            [
                frontImage,
                backImage
            ],
            {
                label:
                    "photoA",

                maxAttempts:
                    MAX_IMAGE_ATTEMPTS
            }
        );

    console.log(
        "[generateImageModel1] photo A complete."
    );


    // ========================================================
    // TURN PHOTO A INTO REFERENCE
    // ========================================================

    const generatedPhotoA =
        await toDataUrl(
            photoA,
            "image/png"
        );

    if (!generatedPhotoA) {
        throw new Error(
            "Photo A was generated but could not be converted into a reference image."
        );
    }


    // ========================================================
    // STEP 4
    // GENERATE PHOTO B
    // ========================================================

    const promptPhotoB = `
Create photograph number TWO in the SAME professional ecommerce
fashion photography set.

This is ordinary, non-sexual retail product photography.

PHOTO ONE:

The first generated photograph is supplied as a reference.

Use it to maintain the SAME fictional adult model identity.

Maintain:

- same face
- same age
- same body type
- same skin tone
- same hair
- same hairstyle
- same hair color
- same overall fashion personality
- same background environment
- same lighting
- same camera quality
- same color grading
- same photography style

SECOND POSE:

${pose2Description}

Use the dynamic second pose described above.

Do NOT revert to a stiff straight-standing pose.

BACKGROUND:

Use the same background environment as photograph one.

The camera may shift slightly to accommodate the second pose.

The background should remain:

- attractive
- complementary
- realistic
- visually secondary
- slightly softer than the garment when appropriate

GARMENT REFERENCE:

The original garment photographs are also supplied.

The ORIGINAL garment photographs are the authoritative source
for the clothing.

If photograph one differs from the original garment references,
follow the ORIGINAL garment references.

The model must continue wearing the same real garment.

Preserve:

- colors
- logos
- graphics
- printed text
- patterns
- fabric appearance
- seams
- pockets
- stitching
- neckline
- sleeves
- hems
- buttons
- zippers
- proportions
- garment construction
- visible condition

Do NOT:

- redesign the garment
- improve the garment
- remove details
- invent details
- change fit
- change garment proportions

The second photograph should reveal another useful angle of the garment.

Prefer when appropriate:

- back
- three-quarter rear
- side
- side-and-back angle

Use a natural professional fashion pose.

Do not sexualize the model.

Do not use:

- seductive expressions
- provocative poses
- erotic framing
- exaggerated body positioning

No text overlays.

No watermark.

No collage.

One adult model only.

Create a photorealistic professional ecommerce fashion photograph.
`;


    console.log(
        "[generateImageModel1] generating photo B..."
    );

    const photoB =
        await generatePhoto(
            promptPhotoB,
            [
                frontImage,
                backImage,
                generatedPhotoA
            ],
            {
                label:
                    "photoB",

                maxAttempts:
                    MAX_IMAGE_ATTEMPTS
            }
        );

    console.log(
        "[generateImageModel1] photo B complete."
    );


    // ========================================================
    // VERIFY BOTH EXIST
    // ========================================================

    if (
        !photoA ||
        !photoB
    ) {
        throw new Error(
            "Image generation finished without producing both required photos."
        );
    }


    console.log(
        "[generateImageModel1] successfully generated both photos."
    );


    // ========================================================
    // RETURN
    // ========================================================

    return {
        modelDescription:
            personDescription,

        pose2Description,

        variationHint,

        images: {
            photoA,
            photoB
        }
    };
}
async function generateListingText({
    imageDataFront,
    category,
    features = {},
    condition = null,
    extraDetails = null
}) {
    if (isOpenAIDisabled()) {
        console.log(
            "[generateListingText] OpenAI disabled; using default listing text fallback."
        );

        return getDefaultListingText({
            category,
            features
        });
    }

    const frontImage = await toDataUrl(
        imageDataFront,
        "image/png"
    );

    if (!frontImage) {
        throw new Error(
            "A front reference image is required."
        );
    }

    const prompt = `
You are writing an eBay listing for a clothing item.

You are being given:

1. A front reference image of the actual item
2. Structured item features
3. Condition information
4. Optional extra notes

Use ALL of that information together.

REFERENCE IMAGE:

Inspect the image carefully and use it to understand visible details such as:

- garment type
- visible brand or logo
- color
- graphics
- pattern
- style
- neckline
- sleeve style
- general design
- visible text
- overall appearance

IMPORTANT:

Do not invent details that are not visible or provided.

If a detail in the image is unclear, do not guess.

If the structured features conflict with something that appears uncertain
in the photo, prefer the structured features.

CATEGORY:
${category || "Unknown"}

STRUCTURED FEATURES:
${JSON.stringify(features, null, 2)}

CONDITION:
${condition || "Not provided"}

EXTRA DETAILS:
${extraDetails || "None"}

TITLE RULES:

- Write a strong eBay search-friendly title.
- Prioritize important searchable details.
- Include useful information such as:
  - brand
  - item type
  - department
  - size
  - color
  - style
  - important visible graphic or design details
- Use information from the reference image when clearly visible.
- Do not invent information.
- Do not use emojis.
- Do not use excessive punctuation.
- Do not use meaningless marketing words like:
  "WOW", "AMAZING", "MUST HAVE", "LOOK"
- Do not claim:
  - rare
  - vintage
  - authentic
  - collectible
  unless explicitly provided.
- Keep the title under 80 characters.

DESCRIPTION RULES:

Write a clear, professional resale listing description.

Include:

- what the item is
- brand if known
- color
- size
- department
- important visible style/design details
- relevant structured features
- known condition information

The description should sound natural, not robotic.

Do not invent:

- stains
- holes
- damage
- measurements
- material
- age
- authenticity
- manufacturing location
- history

unless explicitly provided.

Do not include:

- shipping information
- return policy
- seller policies
- pricing
- contact information
- emojis

Return ONLY valid JSON in this exact format:

{
  "title": "listing title",
  "description": "listing description"
}
`;

    const data = await openAIResponse({
        model: VISION_MODEL,

        input: [
            {
                role: "user",

                content: [
                    {
                        type: "input_text",
                        text: prompt
                    },

                    {
                        type: "input_image",
                        image_url: frontImage,
                        detail: "high"
                    }
                ]
            }
        ],

        text: {
            format: {
                type: "json_schema",

                name: "listing_text",

                strict: true,

                schema: {
                    type: "object",

                    properties: {
                        title: {
                            type: "string"
                        },

                        description: {
                            type: "string"
                        }
                    },

                    required: [
                        "title",
                        "description"
                    ],

                    additionalProperties: false
                }
            }
        }
    });

    const output =
        data.output_text ||
        getResponseText(data);

    if (!output) {
        throw new Error(
            "OpenAI did not return listing text."
        );
    }

    let parsed;

    try {
        parsed = JSON.parse(output);
    } catch {
        throw new Error(
            `Failed to parse listing text: ${output}`
        );
    }

    return {
        title: parsed.title.trim(),
        description: parsed.description.trim()
    };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    generateImageModel1,
    cleanupProductPhoto,
    generateListingText,
};