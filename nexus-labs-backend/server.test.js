
require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Fixed test price: KES 100 = 10,000 cents/subunits.
const TEST_AMOUNT_KES = 100;
const TEST_AMOUNT_SUBUNITS = TEST_AMOUNT_KES * 100;
const CURRENCY = "KES";

// Temporary local-development storage only.
// Replace this Map with a database before production.
const transactions = new Map();

if (!PAYSTACK_SECRET_KEY) {
    throw new Error("Missing PAYSTACK_SECRET_KEY in .env");
}

if (!PAYSTACK_SECRET_KEY.startsWith("sk_test_")) {
    throw new Error(
        "This starter backend accepts TEST keys only. " +
        "Use your Paystack test secret key."
    );
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10kb" }));

const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        message: "Too many payment requests. Please try again later."
    }
});

app.use("/api/payments", paymentLimiter);

// Serve the existing frontend from /public.
app.use(express.static(path.join(__dirname, "public")));

async function paystackRequest(endpoint, options = {}) {
    const response = await fetch(
        `https://api.paystack.co${endpoint}`,
        {
            ...options,
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
                ...options.headers
            },
            signal: AbortSignal.timeout(15000)
        }
    );

    const result = await response.json();

    if (!response.ok || !result.status) {
        throw new Error(
            result.message || "Paystack request failed."
        );
    }

    return result.data;
}


         // Initialize a payment using a server-approved subscription amount.
         app.post("/api/payments/initialize", async (req, res) => {
          try {
         const email =
            typeof req.body.email === "string"
                ? req.body.email.trim().toLowerCase()
                : "";

        if (
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return res.status(400).json({
                message: "Please provide a valid email address."
            });
        }

        // The backend controls the available prices.
        // Paystack amounts are expressed in the smallest currency unit.
        const approvedPlans = {
            "100": 10000,
            "200": 20000,
            "500": 50000,
            "1000": 100000
        };

        const selectedPlan =
            typeof req.body.plan === "string"
                ? req.body.plan
                : "";

        const amountSubunits = approvedPlans[selectedPlan];

        if (!amountSubunits) {
            return res.status(400).json({
                message: "Please select a valid subscription amount."
            });
        }

        const amountKsh = Number(selectedPlan);
        const reference = `nexus_${crypto.randomUUID().replace(/-/g, "")}`;

        const payment = await paystackRequest(
            "/transaction/initialize",
            {
                method: "POST",
                body: JSON.stringify({
                    email,
                    amount: amountSubunits,
                    currency: CURRENCY,
                    reference,
                    metadata: {
                        product: "Nexus Labs",
                        purpose: "Test subscription payment",
                        subscription_amount_kes: amountKsh
                    }
                })
            }
        );

        if (!payment.access_code || payment.reference !== reference) {
            throw new Error("Unexpected Paystack initialization response.");
        }

        transactions.set(reference, {
            email,
            amount: amountSubunits,
            currency: CURRENCY,
            verified: false,
            createdAt: Date.now()
        });

        return res.json({
            message: "Payment initialized.",
            accessCode: payment.access_code,
            reference: payment.reference,
            amountKsh,
            currency: CURRENCY
        });
    } catch (error) {
        console.error("Payment initialization failed:", error.message);

        return res.status(502).json({
            message: "Could not initialize payment. Please try again."
        });
    }
});



 // Verify a payment with Paystack.
   
app.post("/api/payments/verify", async (req, res) => {
    try {
        const reference =
            typeof req.body.reference === "string"
                ? req.body.reference
                : "";

        if (!/^nexus_[a-f0-9]{32}$/.test(reference)) {
            return res.status(400).json({
                verified: false,
                message: "Invalid transaction reference."
            });
        }

        const localTransaction = transactions.get(reference);

        if (!localTransaction) {
            return res.status(404).json({
                verified: false,
                message: "Transaction not found. Start a new payment."
            });
        }

        if (localTransaction.verified) {
            return res.json({
                verified: true,
                message: "Payment has already been verified.",
                amountKsh: localTransaction.amount / 100,
                currency: localTransaction.currency
            });
        }

        const payment = await paystackRequest(
            `/transaction/verify/${encodeURIComponent(reference)}`
        );

        const matches =
            payment.reference === reference &&
            payment.status === "success" &&
            payment.amount === localTransaction.amount &&
            payment.currency === localTransaction.currency &&
            payment.customer?.email?.trim().toLowerCase() ===
                localTransaction.email &&
            payment.domain === "test";

        console.log("PAYMENT VERIFICATION:", {
            reference,
            status: payment.status,
            amount: payment.amount,
            currency: payment.currency,
            checksPassed: matches
        });

        if (!matches) {
            return res.status(400).json({
                verified: false,
                message:
                    payment.status !== "success"
                        ? `Payment status is "${payment.status}". Complete the payment before verifying.`
                        : "Payment details do not match the expected transaction."
            });
        }

        localTransaction.verified = true;
        localTransaction.verifiedAt = Date.now();

        return res.json({
            verified: true,
            message: "Payment verified successfully.",
            amountKsh: localTransaction.amount / 100,
            currency: localTransaction.currency
        });
    } catch (error) {
        console.error("Payment verification failed:", error.message);

        return res.status(502).json({
            verified: false,
            message: "Could not verify payment. Please try again."
        });
    }
});


app.listen(PORT, () => {
    console.log(`Nexus Labs running 🚀 at http://localhost:${PORT}`);
    console.log("Payment mode: PAYSTACK TEST MODE");
    console.log(`Test amount: KES ${TEST_AMOUNT_KES}`);  
});
