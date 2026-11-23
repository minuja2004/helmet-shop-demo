# Verification report

Date: 21 November 2026. Runtime: Node.js 24.22.3. This report describes checks actually performed for the delivered demonstration.

## Results

| Check | Result |
|---|---|
| JavaScript syntax checks (`npm run check`) | Passed |
| API/database and PayHere adapter checks | Passed |
| Customer/admin DOM integration checks against the real Node API | Passed |
| Combined automated test result (`npm test`) | 38 passed; 0 failed |
| Runtime/development dependency audit (`npm audit`) | 0 reported vulnerabilities at verification time |
| SQLite online backup command | Passed |
| Desktop Chromium visual review | Homepage, product cards, gallery, filters and shopping bag inspected |
| Download package | ZIP integrity and fresh extracted-server startup checked before handoff |

## Behaviours covered

Authentication, duplicate email handling, customer/admin separation, session logout, CSRF/origin protection, invalid requests, protected administrator accounts, customer CRUD, linked-history deletion restrictions, product/brand/category/promotion CRUD, price and size inventory edits, unsafe upload rejection, stored settings and persistence after a restart.

Commerce checks cover server-calculated totals, Sri Lankan address validation, quantity validation, duplicate checkout prevention, isolation of customer orders, concurrent stock reservation, overselling prevention, exact-once cancellation restocking, pending-order expiry, Koko/card demo confirmation and valid order fulfilment transitions.

The UI integration tests execute the application's actual DOM handlers against a temporary Node server. They exercise filters/search, product size/gallery controls, wishlist, bag, customer signup, address checkout, Koko demo confirmation, account cancellation, administrator login/search, editor forms and help modals. Test customer data is fictional and is removed with its temporary database.

PayHere adapter tests use fake merchant credentials and synthetic callbacks. They verify generated checkout hashes, invalid signatures, exact amount/currency matching, repeated notifications, chargebacks, replay after chargeback and late success on a cancelled reservation. They do not contact PayHere or charge a card.

## Verification limits

No real merchant credentials were provided: provider-hosted sandbox/live payment acceptance remains unverified; live Koko has not been implemented. Automated DOM checks are not a substitute for full device-browser testing. Desktop Chromium browsing was checked; mobile responsive CSS is included, but physical phone and Safari testing was not performed. Email/SMS, courier, tax, refunds and password-reset integrations are outside this demo.

The application is packaged with a fresh first-run seed, not the temporary test database or demonstration customer records. `node_modules`, secrets, uploads and local backups are excluded from the ZIP. Test dependencies can be reproduced with `npm ci` using the supplied lockfile.
