if (window.__NEXUS_PAYMENT_SCRIPT_LOADED__) {
    console.warn("Duplicate script.js load prevented.");
} else {
    window.__NEXUS_PAYMENT_SCRIPT_LOADED__ = true;

document.addEventListener("DOMContentLoaded", () => {
    const paymentForm = document.getElementById("paymentForm");
    const pricingTier = document.getElementById("pricing-tier");
    const emailInput = document.getElementById("customer-email");
    const payButton = document.getElementById("pay-button");
    const verifyButton = document.getElementById("verify-button");
    const paymentStatus = document.getElementById("payment-status");

    const summarySubtotal = document.getElementById("summary-subtotal");
    const summaryTotal = document.getElementById("summary-total");
    const summaryFee = document.getElementById("summary-fee");

    // Keep your actual Paystack TEST public key here.
    // Never put your secret key in this file.
    const PAYSTACK_PUBLIC_KEY = "pk_live_df02bf5f5627e0e6e44f77bc6b7a774d7cbfda95";
    //pk_test_2864e8e34e07c0c589491d28b00129ffa340d725

    let currentReference = null;
    let isInitializingPayment = false;

    // Confirm the required HTML elements exist.
    if (
        !paymentForm ||
        !pricingTier ||
        !emailInput ||
        !payButton ||
        !verifyButton ||
        !paymentStatus
    ) {
        console.error(
            "Payment setup error: one or more required HTML IDs are missing."
        );
        return;
    }

    // Format amounts consistently.
    const formatKES = (amount) =>
        `KES ${amount.toLocaleString("en-KE", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;

    // Update the invoice when the customer changes the plan.
    function updateInvoice() {
        const amount = Number(pricingTier.value);

        if (!Number.isFinite(amount) || amount <= 0) {
            return;
        }

        if (summarySubtotal) {
            summarySubtotal.textContent = formatKES(amount);
        }

        if (summaryTotal) {
            summaryTotal.textContent = formatKES(amount);
        }

        if (summaryFee) {
            summaryFee.textContent = formatKES(0);
        }
    }

    pricingTier.addEventListener("change", updateInvoice);
    updateInvoice();

    // Single checkout flow: browser -> backend -> Paystack.
    paymentForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (isInitializingPayment) {
            console.warn("Duplicate payment submission blocked.");
            return;
        }

        isInitializingPayment = true;

        const email = emailInput.value.trim();
        const plan = pricingTier.value;

        if (!emailInput.checkValidity()) {
            emailInput.reportValidity();
            isInitializingPayment = false;
            return;
        }

        if (!["100", "200", "500", "1000"].includes(plan)) {
            paymentStatus.textContent = "Please select a valid subscription plan.";
            isInitializingPayment = false;
            return;
        }

        if (!/^pk_test_[A-Za-z0-9]+$/.test(PAYSTACK_PUBLIC_KEY)) {
            paymentStatus.textContent =
                "Add your actual Paystack test public key in script.js.";
            console.error("Paystack test public key is missing or invalid.");
            isInitializingPayment = false;
            return;
        }

        if (typeof window.PaystackPop === "undefined") {
            paymentStatus.textContent =
                "Paystack did not load. Check your internet connection and reload.";
            console.error("PaystackPop is unavailable.");
            isInitializingPayment = false;
            return;
        }

        payButton.disabled = true;
        verifyButton.hidden = true;
        currentReference = null;
       // console.log("Backend initialized reference:", currentReference);

        paymentStatus.textContent = "Preparing secure checkout...";

        try {
            // The backend decides the actual price for this approved plan.
            const response = await fetch("/api/payments/initialize", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    plan
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message || "Could not initialize payment."
                );
            }

            if (!result.accessCode || !result.reference) {
                throw new Error("The backend returned an incomplete payment response.");
            }

            currentReference = result.reference;
            verifyButton.hidden = false;

            paymentStatus.textContent =
                `Checkout prepared for ${formatKES(result.amountKsh)}. ` +
                "Complete payment in the Paystack window, then select Verify Payment.";

            // Resume the transaction initialized securely by our backend.
            const popup = new window.PaystackPop();
            popup.resumeTransaction(result.accessCode);

        } catch (error) {
            currentReference = null;
            verifyButton.hidden = true;
            paymentStatus.textContent =
                error.message || "Checkout failed. Please try again.";

            console.error("Checkout initialization error:", error);
        } finally {
            payButton.disabled = false;
            isInitializingPayment = false;
        }
    });

    // Verify the transaction directly with our backend.
    verifyButton.addEventListener("click", async () => {
        if (!currentReference) {
            paymentStatus.textContent = "Start a payment before verifying.";
            return;
        }

        verifyButton.disabled = true;
        paymentStatus.textContent = "Verifying payment with Paystack...";

        try {
            const response = await fetch("/api/payments/verify", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    reference: currentReference
                })
            });

            const result = await response.json();

            if (!response.ok || !result.verified) {
                throw new Error(
                    result.message || "Payment has not been verified."
                );
            }

            paymentStatus.textContent =
                `Payment verified successfully. Amount: ${formatKES(result.amountKsh)}.`;

            verifyButton.hidden = true;
            currentReference = null;

            console.log("Payment verified by the backend.");

        } catch (error) {
            paymentStatus.textContent =
                error.message || "Verification failed. Please try again.";

            console.error("Payment verification error:", error);
        } finally {
            verifyButton.disabled = false;
        }
    });
});
}
