# Reference-store analysis

Reviewed 21 November 2026 before implementation. These are independent official brand stores, not shops affiliated with Zeez Labs. The implementation uses an original layout and branding informed by familiar helmet retail patterns.

| Store | Observed patterns | Applied to Zeez Helmet Shop |
|---|---|---|
| [AXOR](https://axorhelmets.com/) | Prominent product imagery; promotional content; searchable catalogue; account/cart access; financing message | Large product-led campaign area, visible account/bag, local image gallery and clearly labelled demo instalment option |
| [Vega](https://vegaauto.com/) | Full-face/open-face/flip-up/kids categories; new arrivals; product variations and pricing | Category-led browsing, size inventory, product cards, current/previous prices and catalogue filters |
| [Steelbird](https://www.steelbirdhelmet.com/) | Helmet-type navigation, visual range discovery, product details, new launches and brand campaigns | Shop-by-type cards, a second row of promotional artwork and admin-controlled campaign content |

## Visual direction

A white retail canvas; charcoal navigation and text; orange reserved for campaign headlines, primary purchase actions and active controls. Condensed display typography reflects motorsport retail; quieter sans-serif body text keeps prices and forms readable. Large helmet photographs carry the design instead of generic illustrations, gradients or decorative dashboard cards on the storefront.

The homepage has a shop-first sequence: navigation/search → campaign → delivery/fit/payment information → requested brands → featured products → helmet types → campaigns → fit guide. Admin is a separate signed-in workspace with tables and focused forms.

## Local sales context

LKR pricing and a Sri Lankan delivery address form. AXOR, Vega, Vegas and Steelbird are editable brands. Vegas has no invented products. A retailer can replace the imagery, prices and brand content, then show its own catalogue in the same demo.

## Interaction choices

- Search and filters can be combined; filter selections are encoded in the URL.
- Products require an explicit size before adding to the bag.
- Client totals are informative; the server recalculates the payable amount.
- Card/Koko demonstrations explain that no real money is processed.
- Inventory is reserved atomically when an order is created; cancellation or unpaid expiry restores it once.
- Admin changes persist across restarts in SQLite.
- Promotional slides rotate every eight seconds and can be selected manually. Rotation respects reduced-motion preferences.

All promotional offers and stock in the seed data are examples. Product certification, warranty, stock and retailer policy statements must come from the actual merchant before a public launch.
