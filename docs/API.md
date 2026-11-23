# API map

All paths are relative to the shop's origin. JSON requests/responses unless noted. Authenticated writes send the CSRF value returned by login or `/api/auth/me` in `X-CSRF-Token`. Sessions use HttpOnly, SameSite=Lax cookies (Secure in production). The server validates Origin when supplied.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/store` | Visible catalogue, store settings, delivery districts and payment capabilities |
| GET | `/api/auth/me` | Session identity and CSRF value |
| POST | `/api/auth/register` | Create a customer account |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Invalidate the session |
| GET / PATCH | `/api/shopping` | Read signed-in shopping data, merge guest selections or update one bag/wishlist entry |
| GET | `/api/orders` | Signed-in customer's order history |
| GET | `/api/orders/:id` | Signed-in customer's latest order and payment status |
| POST | `/api/orders` | Create order and reserve inventory transactionally |
| POST | `/api/orders/:id/cancel` | Eligible cancellation and stock return |
| POST | `/api/orders/:id/demo-pay` | Confirm simulated payment (demo only) |
| POST | `/api/orders/:id/payment` | Generate hosted PayHere form fields (configured card mode only) |
| POST | `/api/payments/payhere/notify` | Signed provider callback; form-encoded |
| GET | `/api/admin/data` | Administrator's full record read |
| POST | `/api/admin/products` | Create helmet |
| PUT / DELETE | `/api/admin/products/:id` | Update/remove helmet |
| POST | `/api/admin/brands` | Create brand |
| PUT / DELETE | `/api/admin/brands/:id` | Update/remove brand |
| POST | `/api/admin/categories` | Create category |
| PUT / DELETE | `/api/admin/categories/:id` | Update/remove category |
| POST | `/api/admin/banners` | Create promotion |
| PUT / DELETE | `/api/admin/banners/:id` | Update/remove promotion |
| POST | `/api/admin/users` | Create customer |
| PUT / DELETE | `/api/admin/users/:id` | Update/remove eligible customer |
| PUT / DELETE | `/api/admin/orders/:id` | Advance fulfilment / remove eligible cancelled/expired order |
| PUT | `/api/admin/settings` | Store identity/contact/delivery/announcement settings |
| POST | `/api/admin/upload` | Base64 PNG/JPEG/WebP; max 2 MB |

Order creation is performed through the customer's checkout rather than fabricating payments in the admin. Stock quantities are maintained by product size. Stored order lines retain their original price and name after a product edit.

Shopping responses contain `cart`, `wishlist` and `address`. Send `{ action: "merge", cart, wishlist }` to import guest data. For matching bag rows the merge keeps the larger quantity. Send `{ action: "cart", productId, size, quantity }` to set a bag quantity, using zero to remove it. Send `{ action: "wishlist", productId, saved }` to set whether a product is in the wishlist. Creating an order returns the updated account data in `shopping`.

## Order lifecycle

`pending → confirmed → processing → shipped → delivered`

Pending and confirmed demo/unpaid orders may be cancelled. Pending orders older than 30 minutes expire on a subsequent relevant request. Both cancellation and expiry return reserved stock once. Real paid cancellation/refund requires merchant handling. Signed late payments and chargebacks use `payment-review` for manual reconciliation. Active fulfilment history cannot be deleted accidentally through normal admin actions.

## Data and deployment model

This is a single Node process with SQLite WAL storage and a persistent upload directory. Records are JSON documents grouped by entity type inside SQLite; user identities and sessions have dedicated tables. Inventory/order mutations use `BEGIN IMMEDIATE` transactions. Suitable for this runnable sales demo and a modest single-instance deployment, not a distributed inventory platform. Back up both the database and uploads.
