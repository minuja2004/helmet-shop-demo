# Zeez Helmet Shop

A complete Node.js helmet-store demonstration for Zeez Labs sales presentations. White retail design, orange accents, a custom helmet logo, local product photographs, promotional carousel, customer shopping and a database-backed administration area.

## Start in two minutes

Install **Node.js 24 LTS** (22.16+ works for the server). Extract this ZIP, open a terminal in the `zeez-helmet-shop` folder, then run:

```sh
npm start
```

Open **http://localhost:3000**. No database service, API key, build step or runtime package install is needed. An SQLite database is created and populated on first startup. Keep the terminal running while showing the demo.

For Windows, `START-WINDOWS.bat` performs the same startup after you install Node.js.

**Admin:** http://localhost:3000/#admin

- Email: `admin@zeezhelmets.lk`
- Password: use the value printed in the terminal when a fresh demo database is created, or set `ADMIN_PASSWORD` in `.env` before starting the shop.

Keep the generated password for later sign-ins. To reset it for an existing database, set `ADMIN_PASSWORD` in `.env` and restart. Customers create their own accounts from My account or checkout. The first signup never becomes an administrator.

## Included

| Customer storefront | Admin workspace |
|---|---|
| 14 seeded helmets, brand and category browsing | Overview, order value, customer and product counts |
| Search, brand/type/size/price/stock/sale filters, sorting | Product create, read, update and delete |
| Product gallery, size guide, size selection and stock checks | Per-size stock, prices, sale prices, featured products |
| Account-synced wishlist and shopping bag, with guest shopping | Brand and category CRUD |
| Account registration and sign in | Promotional banner CRUD and image uploads |
| Sri Lankan addresses, districts and delivery calculation | Customer create, edit and deletion when no orders exist |
| Card and Koko demonstration payments | Order details, fulfilment transitions and eligible deletion |
| Order history, payment retry and eligible cancellation | Store contact details, delivery fees, announcement |

`Vegas` is included as an editable brand with no invented product range. Add the retailer's actual Vegas products and photographs in admin. AXOR, Vega and Steelbird have sample catalogue items. All seeded LKR prices, stock quantities and offers are illustrative.

The catalogue, users, sessions, promotions, settings, orders and signed-in shopping data are persisted in `data/shop.sqlite`. Guest bags and wishlists live in the browser and merge into the account on sign-in. Checkout remembers the account's most recent delivery address and removes the ordered items from its saved bag.

## Demo presentation (five minutes)

1. Show the homepage, carousel and category sections.
2. Open All helmets; combine brand, price and size filters.
3. Open a helmet, select a size and add it to the bag.
4. Create a customer account and enter fictional delivery details.
5. Choose Koko or card and complete the clearly labelled demo payment.
6. Open the admin, change a product price/stock and upload a promotion.
7. Return to the storefront and show the saved changes.

Use fictional customer details in sales demonstrations. No email, SMS, supplier request or shipment is sent.

## Payments: what is implemented

The default `PAYMENT_MODE=demo` supports both **card** and **Koko** choice and simulated payment confirmation. No real money is charged; no PAN, CVV, banking password or Koko credentials are requested.

A **PayHere hosted card checkout adapter** is included with server-generated hashes and signed webhook verification, exact amount/currency checks, replay handling and a payment-review state for late payments. Its cryptographic behaviour is covered by tests using fake merchant credentials. A real sandbox transaction has not been performed because no merchant account was supplied.

**Live Koko is not implemented or enabled.** Merchant onboarding and Koko's approved integration contract, credentials, sandbox and signed-callback requirements are needed to build and validate that adapter. The production card mode disables Koko rather than pretending a simulated confirmation is a real payment. See `docs/PAYMENTS.md`.

## Configuration

Copy `.env.example` to `.env` and edit values. Never commit `.env` or give merchant secrets to the frontend. `npm start` loads the file automatically.

- `PORT`, `HOST`: listener settings; default `3000`, `0.0.0.0`.
- `DB_PATH`: persistent SQLite database location.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: administrator account. On restart, an explicitly changed password updates the seeded admin and invalidates its old sessions.
- `PAYMENT_MODE`: `demo` or `payhere`.
- `PUBLIC_URL`: public HTTPS origin for payment callbacks and origin checks.
- `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`, `PAYHERE_SANDBOX`: see payment documentation.

For a new retailer, edit store settings, upload their catalogue and promotions, and replace `public/assets/logo.png` with their approved logo. The demo logo and shop name are Zeez Helmet Shop. A large transparent version of the logo is also provided in `branding/`.

## Tests

Use Node.js 24.15+ (or 22.22.2+) for the test dependency, then install test-only development dependencies:

```sh
npm ci
npm run check
npm test
```

The server uses Node built-ins and does not require those dependencies at runtime. Automated checks cover the database/API, payment signatures and complete DOM customer/admin flows. Read `docs/TEST-REPORT.md` for the actual results and verification limits.

## Backups

```sh
npm run backup
```

This makes a consistent SQLite backup under `backups/`, including WAL changes. Back up `public/uploads/` separately for retailer photographs. To restore, stop the server, preserve the existing database, copy the backup to the configured `DB_PATH`, remove its old `-wal`/`-shm` sidecars while stopped, and restart. Never reset a live store by deleting its database.

## Deployment

Use a long-running Node host with a persistent disk, HTTPS and one application instance. This project is not a static-only hosting package. The Dockerfile is optional. Mount `/app/data` and `/app/public/uploads` when using containers. Use `NODE_ENV=production`, a new 12+ character admin password and the correct public HTTPS origin. The server refuses production startup with the public demo password.

This is a sales-demo foundation with a working backend. For real retail operation, finish merchant acceptance tests, approve actual product/helmet certification claims and policies, configure backups and operational monitoring, and arrange transactional email/refund workflows. There is no password-reset email, automatic tax engine, courier integration, automatic refunds or multi-instance inventory service in this version.

## Project map

```text
src/server.js           HTTP server, sessions, commerce API, admin, payments
src/seed.js             First-run setup
src/catalog.json        Demonstration products and photograph sources
src/backup.js           SQLite backup command
public/index.html       Accessible application shell
public/app.js           Storefront and admin interactions
public/styles.css       Responsive white/orange retail styling
public/assets/          Local photographs, logo, fonts and favicon
branding/               Original transparent generated logo
test/                  API and DOM integration tests
docs/                  Research, payment guide, test report, asset notes
```

For reference-store analysis and image provenance, read `docs/DESIGN-RESEARCH.md` and `docs/ASSETS.md`. Brand names and third-party photographs remain their owners' property; replace supplier assets with retailer-authorised photography before public commercial use.
