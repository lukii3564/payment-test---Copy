if (window.__NEXUS_PAYMENT_SCRIPT_LOADED__) {
    console.warn("Duplicate script.js load prevented.");
} else {
    window.__NEXUS_PAYMENT_SCRIPT_LOADED__ = true;

document.addEventListener("DOMContentLoaded", () => {
    const paymentForm = document.getElementById("paymentForm");
    const pricingTier = document.getElementById("pricing-tier");
    const emailInput = document.getElementById("customer-email");
    const themeToggle = document.getElementById("theme-toggle");
    const payButton = document.getElementById("pay-button");
    const verifyButton = document.getElementById("verify-button");
    const paymentStatus = document.getElementById("payment-status");
    const pdfProductCard = document.getElementById("pdf-product-card");
    const buyPdfButton = document.getElementById("buy-pdf-button");
    const downloadPdfButton = document.getElementById("download-pdf-button");
    const pdfLockedBadge = document.getElementById("pdf-locked-badge");
    const pdfProductStatus = document.getElementById("pdf-product-status");

    const summarySubtotal = document.getElementById("summary-subtotal");
    const summaryTotal = document.getElementById("summary-total");
    const summaryFee = document.getElementById("summary-fee");

    // Keep your actual Paystack TEST public key here.
    // Never put your secret key in this file.
    const PAYSTACK_PUBLIC_KEY = "pk_live_df02bf5f5627e0e6e44f77bc6b7a774d7cbfda95";
    //pk_test_2864e8e34e07c0c589491d28b00129ffa340d725

    let currentReference = null;
    let currentProductReference = null;
    let currentProductId = null;
    let isInitializingPayment = false;
    const PDF_PRODUCT_ID = "nexus-guide";

    function setTheme(theme, persist = false) {
        document.documentElement.dataset.theme = theme;

        if (themeToggle) {
            const nextTheme = theme === "light" ? "dark" : "light";
            themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
            themeToggle.setAttribute("aria-pressed", String(theme === "light"));
            themeToggle.querySelector(".theme-toggle-label").textContent =
                `${nextTheme[0].toUpperCase()}${nextTheme.slice(1)} mode`;
        }

        if (persist) {
            try {
                localStorage.setItem("nexus-theme", theme);
            } catch (error) {
                console.warn("Theme preference could not be saved.", error);
            }
        }
    }

    setTheme(document.documentElement.dataset.theme || "dark");
    themeToggle?.addEventListener("click", () => {
        const nextTheme =
            document.documentElement.dataset.theme === "light" ? "dark" : "light";
        setTheme(nextTheme, true);
    });

    // Confirm the required HTML elements exist.
    if (
        !paymentForm ||
        !pricingTier ||
        !emailInput ||
        !payButton ||
        !verifyButton ||
        !paymentStatus ||
        !pdfProductCard ||
        !buyPdfButton ||
        !downloadPdfButton ||
        !pdfLockedBadge ||
        !pdfProductStatus
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

    function unlockPdfProduct() {
        pdfProductCard.dataset.unlocked = "true";
        pdfLockedBadge.hidden = true;
        buyPdfButton.hidden = true;
        downloadPdfButton.hidden = false;
        pdfProductStatus.textContent =
            "Purchase verified. Your sample PDF is ready to download.";
    }

    async function initializeCheckout(productId = null) {
        if (isInitializingPayment) {
            console.warn("Duplicate payment submission blocked.");
            return;
        }

        const email = emailInput.value.trim();
        const plan = pricingTier.value;

        if (!emailInput.checkValidity()) {
            emailInput.reportValidity();
            return;
        }

        if (!productId && !["100", "200", "500", "1000"].includes(plan)) {
            paymentStatus.textContent = "Please select a valid subscription plan.";
            return;
        }

        if (!/^pk_live_[A-Za-z0-9]+$/.test(PAYSTACK_PUBLIC_KEY)) {
            const message = "Add your actual Paystack live public key in script.js.";
            paymentStatus.textContent = message;
            pdfProductStatus.textContent = message;
            console.error("Paystack live public key is missing or invalid.");
            return;
        }

        if (typeof window.PaystackPop === "undefined") {
            const message =
                "Paystack did not load. Check your internet connection and reload.";
            paymentStatus.textContent = message;
            pdfProductStatus.textContent = message;
            console.error("PaystackPop is unavailable.");
            return;
        }

        isInitializingPayment = true;
        const checkoutButton = productId ? buyPdfButton : payButton;
        checkoutButton.disabled = true;
        verifyButton.hidden = true;
        currentReference = null;
        currentProductId = null;

        const progressMessage = productId
            ? "Preparing secure PDF checkout..."
            : "Preparing secure checkout...";
        paymentStatus.textContent = progressMessage;
        if (productId) {
            pdfProductStatus.textContent = progressMessage;
        }

        try {
            const response = await fetch(
                productId
                    ? `/api/products/${PDF_PRODUCT_ID}/initialize`
                    : "/api/payments/initialize",
                {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    ...(productId ? {} : { plan })
                })
                }
            );

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
            currentProductId = productId;
            verifyButton.hidden = false;

            paymentStatus.textContent =
                `Checkout prepared for ${formatKES(result.amountKsh)}. ` +
                "Complete payment in the Paystack window, then select Verify Payment.";
            if (productId) {
                pdfProductStatus.textContent =
                    `Checkout prepared for ${formatKES(result.amountKsh)}. ` +
                    "Complete payment, then select Verify Payment.";
            }

            const popup = new window.PaystackPop();
            popup.resumeTransaction(result.accessCode);

        } catch (error) {
            currentReference = null;
            currentProductId = null;
            verifyButton.hidden = true;
            paymentStatus.textContent =
                error.message || "Checkout failed. Please try again.";
            if (productId) {
                pdfProductStatus.textContent =
                    error.message || "PDF checkout failed. Please try again.";
            }

            console.error("Checkout initialization error:", error);
        } finally {
            checkoutButton.disabled = false;
            isInitializingPayment = false;
        }
    }

    paymentForm.addEventListener("submit", (event) => {
        event.preventDefault();
        initializeCheckout();
    });

    buyPdfButton.addEventListener("click", () => {
        initializeCheckout(PDF_PRODUCT_ID);
    });

    async function restorePdfAccess() {
        try {
            const reference = sessionStorage.getItem("nexus-pdf-reference");

            if (!reference) {
                return;
            }

            const response = await fetch(
                `/api/products/${PDF_PRODUCT_ID}/access`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ reference })
                }
            );
            const result = await response.json();

            if (!response.ok || !result.unlocked) {
                if (response.status === 404) {
                    sessionStorage.removeItem("nexus-pdf-reference");
                }
                throw new Error(
                    result.message || "Could not restore verified PDF access."
                );
            }

            currentProductReference = reference;
            unlockPdfProduct();
        } catch (error) {
            pdfProductStatus.textContent =
                error.message || "Could not restore PDF access.";
            console.error("PDF access restore failed:", error);
        }
    }

    async function downloadPdf() {
        if (!currentProductReference) {
            pdfProductStatus.textContent =
                "Verify the PDF purchase before downloading.";
            return;
        }

        downloadPdfButton.disabled = true;
        pdfProductStatus.textContent = "Preparing your secure download...";

        try {
            const response = await fetch(
                `/api/products/${PDF_PRODUCT_ID}/download`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        reference: currentProductReference
                    })
                }
            );

            if (!response.ok) {
                const result = await response.json();
                throw new Error(
                    result.message || "The PDF download could not be authorized."
                );
            }

            const fileUrl = URL.createObjectURL(await response.blob());
            const downloadLink = document.createElement("a");
            downloadLink.href = fileUrl;
            downloadLink.download = "nexus-labs-sample-guide.pdf";
            document.body.append(downloadLink);
            downloadLink.click();
            downloadLink.remove();
            window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
            pdfProductStatus.textContent = "Your PDF download has started.";
        } catch (error) {
            pdfProductStatus.textContent =
                error.message || "The PDF download failed. Please try again.";
            console.error("PDF download failed:", error);
        } finally {
            downloadPdfButton.disabled = false;
        }
    }

    downloadPdfButton.addEventListener("click", downloadPdf);
    restorePdfAccess();

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
            if (currentProductId === PDF_PRODUCT_ID &&
                result.productId === PDF_PRODUCT_ID) {
                currentProductReference = currentReference;
                try {
                    sessionStorage.setItem(
                        "nexus-pdf-reference",
                        currentProductReference
                    );
                } catch (error) {
                    console.warn("Verified PDF access could not be saved for this tab.", error);
                }
                unlockPdfProduct();
            }

            currentReference = null;
            currentProductId = null;

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
