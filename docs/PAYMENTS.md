# Payment configuration and boundaries

## Demonstration (default)

`PAYMENT_MODE=demo` enables card and Koko choice. Both lead to a clearly labelled payment simulation and `paymentStatus=demo-paid`, never `paid`. The order itself, inventory reservation and confirmation are persisted. No card/Koko credentials or money are handled.

Pending stock reservations expire after 30 minutes. Store, shopping, order and admin requests and verified payment callbacks trigger expiry checks.

## PayHere card adapter

Reference: [PayHere Checkout API](https://support.payhere.lk/api-&-mobile-sdk/checkout-api.I).

The provider's integration needs the merchant ID, a domain-specific merchant secret and approved callback origin. These were not supplied for this demo.

1. Register/approve the actual domain in the merchant's PayHere integrations.
2. Configure the server's `.env` or hosting secret environment:

```dotenv
NODE_ENV=production
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=REPLACE_WITH_A_UNIQUE_LONG_PASSWORD
PUBLIC_URL=https://YOUR_APPROVED_DOMAIN
PAYMENT_MODE=payhere
PAYHERE_MERCHANT_ID=YOUR_MERCHANT_ID
PAYHERE_MERCHANT_SECRET=YOUR_DOMAIN_SPECIFIC_SECRET
PAYHERE_SANDBOX=true
```

3. Use persistent storage and HTTPS. The server must be reachable at `/api/payments/payhere/notify` from PayHere; localhost will not receive a provider callback.
4. Place a sandbox order, follow the hosted PayHere form, and verify both a successful and failed/cancelled payment using the merchant's sandbox.
5. Check that the server records payment from a verified callback. The return page reads the customer's current order status from the server.
6. Test duplicate callbacks, value mismatch, unpaid expiry, late payment and chargeback handling. Only after merchant acceptance tests should `PAYHERE_SANDBOX=false` be enabled.

`POST /api/orders/:id/payment` creates the form fields and hash server-side. Frontend card fields do not exist. The merchant secret never leaves the server. `POST /api/payments/payhere/notify` verifies the provider signature and matches merchant ID, order ID, exact LKR amount and currency. A repeated success callback is idempotent. A callback for an expired/cancelled reservation enters `payment-review`, for manual stock/refund reconciliation.

Failure/pending callbacks do not confirm an order; its existing unpaid reservation may remain pending until expiry or cancellation. Live paid orders require store-assisted cancellation/refund. There is no automatic refund or provider-transaction reconciliation API in this version. Late or disputed payments need the retailer's explicit review.

The included automated tests use fake credentials and locally generated signed payloads. They verify this code's checksum, matching and transition logic, not a real merchant connection or settlement.

## Koko live integration

References: [Koko business](https://www.paykoko.com/business), [merchant signup](https://merchant-signup.paykoko.com/), [merchant terms](https://www.paykoko.com/merchant-terms).

Koko's live merchant adapter is intentionally not fabricated from an assumed API. Request the merchant-specific approved integration instructions, sandbox access and credentials from Koko. A production adapter needs server-side checkout/session creation according to that contract, an approved callback verifier, exact order/amount/currency matching, idempotency, provider-status mapping, expired-reservation reconciliation and acceptance tests.

Until that adapter is implemented and tested, `PAYMENT_MODE=payhere` disables Koko. The Koko logo/instalment examples on this demonstration do not imply a merchant relationship or approval.
