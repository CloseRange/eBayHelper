require('dotenv').config();

const debug = require('./../debug/debug');
const { getEbayApiBase } = require('./index');

async function _optIntoBusinessPolicies() {
    const response = await fetch(
        `${getEbayApiBase()}/sell/account/v1/program/opt_in`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "Content-Language": "en-US"
            },
            body: JSON.stringify({
                programType: "SELLING_POLICY_MANAGEMENT"
            })
        }
    );

    let data = null;

    const text = await response.text();

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (!response.ok) {
        await debug.error('ebay_policies:_optIntoBusinessPolicies', `Business Policy opt-in failed: ${response.status} ${JSON.stringify(data, null, 2)}`);

        throw new Error("Unable to opt into eBay Business Policies");
    }

    await debug.info('ebay_policies:_optIntoBusinessPolicies', 'Opted into eBay Business Policies!');

    return data;
}
async function createFulfillmentPolicy() {
    const body = {
        name: "Standard Shipping",
        description: "Standard shipping policy for clothing",
        marketplaceId: "EBAY_US",

        handlingTime: {
            value: 2,
            unit: "DAY"
        },

        shippingOptions: [
            {
                optionType: "DOMESTIC",
                costType: "FLAT_RATE",

                shippingServices: [
                    {
                        shippingCarrierCode: "USPS",
                        shippingServiceCode: "USPSGroundAdvantage",

                        shippingCost: {
                            currency: "USD",
                            value: "5.99"
                        },

                        freeShipping: false,
                        sortOrder: 1
                    }
                ]
            }
        ]
    };

    const response = await fetch(
        `${getEbayApiBase()}/sell/account/v1/fulfillment_policy`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "Content-Language": "en-US"
            },
            body: JSON.stringify(body)
        }
    );

    const data = await response.json();

    if (!response.ok) {
        await debug.error('ebay_policies:createFulfillmentPolicy', `Fulfillment policy error: ${response.status} ${JSON.stringify(data, null, 2)}`);

        throw new Error("Failed to create fulfillment policy");
    }

    await debug.info('ebay_policies:createFulfillmentPolicy', `Fulfillment policy created: ${data.fulfillmentPolicyId}`);

    return data.fulfillmentPolicyId;
}
async function createPaymentPolicy() {
    const body = {
        name: "Default Payment",
        description: "Default payment policy",
        marketplaceId: "EBAY_US",

        categoryTypes: [
            {
                name: "ALL_EXCLUDING_MOTORS_VEHICLES",
                default: true
            }
        ]
    };

    const response = await fetch(
        `${getEbayApiBase()}/sell/account/v1/payment_policy`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "Content-Language": "en-US"
            },
            body: JSON.stringify(body)
        }
    );

    const data = await response.json();

    if (!response.ok) {
        await debug.error('ebay_policies:createPaymentPolicy', `Payment policy error: ${response.status} ${JSON.stringify(data, null, 2)}`);

        throw new Error("Failed to create payment policy");
    }

    await debug.info('ebay_policies:createPaymentPolicy', `Payment policy created: ${data.paymentPolicyId}`);

    return data.paymentPolicyId;
}
async function createReturnPolicy() {
    const body = {
        name: "30 Day Returns",
        description: "Returns accepted within 30 days",
        marketplaceId: "EBAY_US",

        categoryTypes: [
            {
                name: "ALL_EXCLUDING_MOTORS_VEHICLES",
                default: true
            }
        ],

        returnsAccepted: true,

        returnPeriod: {
            value: 30,
            unit: "DAY"
        },

        refundMethod: "MONEY_BACK",

        returnShippingCostPayer: "BUYER"
    };

    const response = await fetch(
        `${getEbayApiBase()}/sell/account/v1/return_policy`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "Content-Language": "en-US"
            },
            body: JSON.stringify(body)
        }
    );

    const data = await response.json();

    if (!response.ok) {
        await debug.error('ebay_policies:createReturnPolicy', `Return policy error: ${response.status} ${JSON.stringify(data, null, 2)}`);

        throw new Error("Failed to create return policy");
    }

    await debug.info('ebay_policies:createReturnPolicy', `Return policy created: ${data.returnPolicyId}`);

    return data.returnPolicyId;
}
async function setupEbayPolicies() {
    const fulfillmentPolicyId =
        await createFulfillmentPolicy();

    const paymentPolicyId =
        await createPaymentPolicy();

    const returnPolicyId =
        await createReturnPolicy();

    await debug.info('ebay_policies:setupEbayPolicies', `\n==============================\nEBAY POLICY IDS\n==============================\nEBAY_FULFILLMENT_POLICY_ID=${fulfillmentPolicyId}\nEBAY_PAYMENT_POLICY_ID=${paymentPolicyId}\nEBAY_RETURN_POLICY_ID=${returnPolicyId}`);

    return {
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId
    };
}


async function getEbayPolicies() {
    // await _optIntoBusinessPolicies();
    const headers = {
        Authorization: `Bearer ${process.env.EBAY_ACCESS_TOKEN}`,
        Accept: "application/json"
    };

    const base = `${getEbayApiBase()}/sell/account/v1`;

    const [
        fulfillmentResponse,
        paymentResponse,
        returnResponse
    ] = await Promise.all([
        fetch(
            `${base}/fulfillment_policy?marketplace_id=EBAY_US`,
            { headers }
        ),

        fetch(
            `${base}/payment_policy?marketplace_id=EBAY_US`,
            { headers }
        ),

        fetch(
            `${base}/return_policy?marketplace_id=EBAY_US`,
            { headers }
        )
    ]);

    const fulfillment = await fulfillmentResponse.json();
    const payment = await paymentResponse.json();
    const returns = await returnResponse.json();

    await debug.info('ebay_policies:getEbayPolicies', `FULFILLMENT POLICIES: ${JSON.stringify(fulfillment, null, 2)}`);
    await debug.info('ebay_policies:getEbayPolicies', `PAYMENT POLICIES: ${JSON.stringify(payment, null, 2)}`);
    await debug.info('ebay_policies:getEbayPolicies', `RETURN POLICIES: ${JSON.stringify(returns, null, 2)}`);

    return {
        fulfillment,
        payment,
        returns
    };
}

module.exports = { setupEbayPolicies, getEbayPolicies };

