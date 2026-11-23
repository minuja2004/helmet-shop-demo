const $ = (s, root = document) => root.querySelector(s),
  $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const format = (n) =>
  "LKR " + Number(n).toLocaleString("en-LK", { maximumFractionDigits: 0 });
const paths = {
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  user: "M20 21v-2a6 6 0 0 0-12 0v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  bag: "M5 7h14l1 14H4L5 7Z M9 7V5a3 3 0 0 1 6 0v2",
  truck:
    "M1 4h13v13H1V4Z M14 9h5l3 4v4h-8 M7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M21 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6L12 2Z M8 12l3 3 5-6",
  return: "M3 10h12a6 6 0 0 1 0 12 M3 10l5-5 M3 10l5 5",
  card: "M2 4h20v16H2z M2 9h20 M6 15h4",
  close: "M6 6l12 12 M18 6 6 18",
  plus: "M12 5v14 M5 12h14",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  box: "M12 2 2 7v10l10 5 10-5V7L12 2Z M2 7l10 5 10-5 M12 12v10 M7 4.5l10 5",
  tag: "M20 13 11 22 2 13V2h11l9 9Z M7 7h.01",
  image: "M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M8 7h.01",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  check: "M20 6 9 17l-5-5",
  ruler: "M3 8 8 3l13 13-5 5L3 8Z M8 8l2-2 M11 11l2-2 M14 14l2-2",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  logout: "M9 3H3v18h6 M14 8l5 4-5 4 M8 12h11",
  mail: "M2 4h20v16H2z M2 4l10 9L22 4",
  minus: "M5 12h14",
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.box}"/></svg>`;
function storageGet(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}
function storageSet(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}
let cart = storageGet("zeez-bag", []),
  wishlist = storageGet("zeez-wishlist", []),
  store,
  auth = { user: null, csrf: null },
  adminData,
  currentProduct,
  selectedSize,
  selectedQuantity = 1,
  currentSlide = 0,
  toastTimer,
  renderVersion = 0;
cart = Array.isArray(cart)
  ? cart.filter(
      (i) =>
        i &&
        typeof i.productId === "string" &&
        typeof i.size === "string" &&
        Number.isInteger(i.quantity) &&
        i.quantity > 0 &&
        i.quantity <= 10,
    )
  : [];
wishlist = Array.isArray(wishlist)
  ? wishlist.filter((i) => typeof i === "string")
  : [];
let shoppingQueue = Promise.resolve();
let savedAddress = {};
function useShopping(saved) {
  cart = saved.cart;
  wishlist = saved.wishlist;
  savedAddress = saved.address || {};
}
async function loadShopping() {
  if (!auth.user) return;
  const hasGuestItems = cart.length || wishlist.length;
  const saved = hasGuestItems
    ? await api("/shopping", "PATCH", { action: "merge", cart, wishlist })
    : await api("/shopping");
  useShopping(saved);
  if (hasGuestItems) {
    storageSet("zeez-bag", []);
    storageSet("zeez-wishlist", []);
  }
}
function changeShopping(operation) {
  const pending = shoppingQueue.then(async () => {
    useShopping(await api("/shopping", "PATCH", operation()));
  });
  shoppingQueue = pending.catch(() => {});
  return pending;
}
function checkoutKeyFor(order) {
  const fingerprint = JSON.stringify([auth.user.id, order]);
  if (checkoutAttempt?.fingerprint !== fingerprint) {
    const key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    checkoutAttempt = { fingerprint, key };
    try {
      sessionStorage.setItem("zeez-checkout", JSON.stringify(checkoutAttempt));
    } catch {}
  }
  return checkoutAttempt.key;
}
let checkoutAttempt;
try {
  checkoutAttempt = JSON.parse(sessionStorage.getItem("zeez-checkout"));
} catch {}
function clearCheckoutAttempt() {
  checkoutAttempt = null;
  try {
    sessionStorage.removeItem("zeez-checkout");
  } catch {}
}
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(auth.csrf ? { "X-CSRF-Token": auth.csrf } : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Please try again.");
  return result;
}
function toast(message) {
  clearTimeout(toastTimer);
  $(".toast")?.remove();
  const n = document.createElement("div");
  n.className = "toast";
  n.setAttribute("role", "status");
  n.textContent = message;
  document.body.append(n);
  toastTimer = setTimeout(() => n.remove(), 4500);
}
const brandName = (id) =>
  store.brands.find((b) => b.id === id)?.name || "Helmet";
const categoryName = (id) =>
  store.categories.find((c) => c.id === id)?.name || "Helmet";
const available = (p) => p.variants.reduce((s, v) => s + v.stock, 0);
const productHref = (p) => "#product/" + encodeURIComponent(p.id);
const shopLink = (key, value) =>
  "#shop?" + new URLSearchParams({ [key]: value });
const payments = () =>
  `<div class="payments"><b>VISA</b><b>mastercard</b>${store.paymentMethods.includes("koko") ? '<b class="koko-mark">koko</b>' : ""}</div>`;
function header() {
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  return `<div class="topbar"><div class="container"><div>${esc(store.settings.announcement)}</div><div><a href="#guide">Find your fit</a> &nbsp; / &nbsp; <a href="#account">Track your order</a></div></div></div><header><div class="container main-header"><a class="logo" href="#home" aria-label="Zeez Helmet Shop home"><img src="/assets/logo.png" alt="Zeez Helmet Shop" width="208" height="68"></a><form class="search" id="header-search"><label class="sr-only" for="search-input">Search helmets</label><input id="search-input" name="q" placeholder="Search helmets, brands and more…" autocomplete="off"><button aria-label="Search">${icon("search")}</button></form><button type="button" class="nav-toggle icon-btn" id="toggle-nav" aria-controls="main-nav" aria-expanded="false">${icon("menu")} Menu</button><div class="header-actions"><a class="icon-btn" href="#account" aria-label="My account">${icon("user")}<span class="small account-label">${auth.user ? esc(auth.user.name.split(" ")[0]) : "My account"}</span></a><a class="icon-btn" href="#wishlist" aria-label="Wishlist">${icon("heart")}${wishlist.length ? `<span class="count">${wishlist.length}</span>` : ""}</a><a class="icon-btn" href="#cart" aria-label="Shopping bag">${icon("bag")}${count ? `<span class="count">${count}</span>` : ""}</a></div></div><div class="nav-border"><div class="container nav"><nav class="nav-links" id="main-nav" aria-label="Main navigation"><a href="#shop">All helmets</a>${store.categories.map((c) => `<a href="${shopLink("category", c.id)}">${esc(c.name)}</a>`).join("")}<a href="#brands">Shop by brand</a><a class="orange" href="#shop?sale=1">Sale</a><a class="mobile-help" href="#guide">Size guide</a>${auth.user?.role === "admin" ? '<a href="#admin">Admin</a>' : ""}</nav><span class="nav-note">${icon("shield")} Good rides start here.</span></div></div></header>`;
}
function footer() {
  return `<footer class="footer"><div class="container"><div class="footer-top"><div><a href="#home" class="footer-brand">ZEEZ<span>.</span> HELMET SHOP</a><p>For the everyday miles.<br>For the roads less travelled.<br>Find your helmet. Own your ride.</p>${payments()}</div><div><h3 class="small">Shop helmets</h3>${store.categories.map((c) => `<p><a href="${shopLink("category", c.id)}">${esc(c.name)} helmets</a></p>`).join("")}</div><div><h3 class="small">Here to help</h3><p><a href="#guide">Helmet size guide</a></p><p><a href="#delivery">Delivery & returns</a></p><p><a href="#account">My orders</a></p><p><a href="#privacy">Privacy policy</a></p></div><div><h3 class="small">Let's talk helmets</h3><p>${esc(store.settings.address)}</p><p><a href="mailto:${esc(store.settings.email)}">${esc(store.settings.email)}</a></p>${store.settings.phone ? `<p>${esc(store.settings.phone)}</p>` : ""}<p><a href="#admin">Store administration</a></p></div></div><div class="footer-bottom nav-border"><span class="small muted">© ${new Date().getFullYear()} ${esc(store.settings.name)}. All rights reserved.</span><span class="small muted">A retail experience by <a href="https://zeezlabs.com" target="_blank" rel="noopener">Zeez Labs</a></span></div></div></footer>`;
}
function breadcrumb(text) {
  return `<div class="breadcrumb"><a href="#home">Home</a><span>/</span><span>${esc(text)}</span></div>`;
}
function productCard(p) {
  return `<article class="product-card"><a class="product-photo" href="${productHref(p)}" aria-label="View ${esc(p.name)}">${p.badge ? `<span class="badge ${p.comparePrice ? "sale" : ""}">${esc(p.badge)}</span>` : ""}<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy" width="350" height="350"></a><button class="wish ${wishlist.includes(p.id) ? "saved" : ""}" data-wish="${esc(p.id)}" aria-label="${wishlist.includes(p.id) ? "Remove from" : "Add to"} wishlist" aria-pressed="${wishlist.includes(p.id)}">${icon("heart")}</button><div class="product-info"><div class="product-meta"><span>${esc(brandName(p.brandId))}</span><span>${esc(categoryName(p.categoryId))}</span></div><h3><a href="${productHref(p)}">${esc(p.name)}</a></h3><div><span class="price">${format(p.price)}</span>${p.comparePrice ? `<span class="old-price">${format(p.comparePrice)}</span>` : ""}</div><div class="product-bottom"><span>${
    available(p)
      ? p.variants
          .filter((v) => v.stock)
          .map((v) => v.size)
          .join(" · ")
      : "Currently sold out"
  }</span><a class="icon-btn" href="${productHref(p)}" aria-label="Choose size for ${esc(p.name)}">${icon("plus")}</a></div></div></article>`;
}
function heroMarkup() {
  const banners = [...store.banners].sort((a, b) =>
      a.id === "hero" ? -1 : b.id === "hero" ? 1 : 0,
    ),
    b = banners[currentSlide % banners.length] || {
      title: "Find your helmet.\nOwn your ride.",
      image: "/assets/helmet-1.webp",
      subtitle: "Discover your next helmet.",
      button: "Shop helmets",
    };
  const title = esc(b.title).split("\n");
  return `<section class="hero"><div class="hero-copy"><div class="eyebrow">${esc(b.eyebrow)}</div><h1>${title[0]}${title.length > 1 ? "<br><em>" + title.slice(1).join("<br>") + "</em>" : ""}</h1><p>${esc(b.subtitle)}</p><div class="hero-actions"><a class="btn" href="${b.categoryId ? shopLink("category", b.categoryId) : "#shop"}">${esc(b.button)}</a><a class="btn quiet" href="#guide">Find your fit</a></div><div class="hero-pagination" aria-label="Promotions">${banners.map((_, i) => `<button class="${i === currentSlide ? "selected" : ""}" data-slide="${i}" aria-label="Promotion ${i + 1}" aria-pressed="${i === currentSlide}"></button>`).join("")}</div></div><div class="hero-art" data-brand="${esc(brandName(store.products.find((p) => p.images.includes(b.image))?.brandId))}"><span class="hero-sticker">FRESH GEAR.<br>FRESH MILES.</span><img src="${esc(b.image)}" alt="Featured helmet" width="600" height="520" fetchpriority="high"><span class="hero-label">A NEW PERSPECTIVE<br>ON EVERY RIDE.</span></div></section>`;
}
function benefits() {
  return `<div class="benefits">${[
    ["truck", "Islandwide delivery", "Your next ride, delivered"],
    ["shield", "Brands you know", "A collection worth exploring"],
    ["ruler", "Find the right fit", "Sizes for every rider"],
    ["card", "Your way to pay", store.paymentMethods.includes("koko") ? "Card or Koko at checkout" : "Card payment at checkout"],
  ]
    .map(
      ([i, t, d]) =>
        `<div class="benefit">${icon(i)}<div><strong>${t}</strong><span>${d}</span></div></div>`,
    )
    .join("")}</div>`;
}
function home() {
  return `<div class="container"><div id="hero-area">${heroMarkup()}</div>${benefits()}<div class="brand-strip"><span>FIND YOUR<br>FAVOURITE BRAND</span>${store.brands.map((b) => `<a class="brand-word ${esc(b.id)}" href="${shopLink("brand", b.id)}">${esc(b.name.toUpperCase())}</a>`).join("")}</div><section class="section"><div class="section-head"><div><div class="eyebrow">READY FOR THE ROAD</div><h2>The rider favourites.</h2></div><a href="#shop" class="text-link">Shop all helmets</a></div><div class="products-grid">${store.products
    .filter((p) => p.featured)
    .slice(0, 4)
    .map(productCard)
    .join(
      "",
    )}</div></section><section class="section"><div class="section-head"><div><div class="eyebrow">YOUR RIDE. YOUR STYLE.</div><h2>A helmet for every journey.</h2></div></div><div class="category-grid">${store.categories
    .map((c) => {
      const p = store.products.find((p) => p.categoryId === c.id);
      return `<a href="${shopLink("category", c.id)}" class="category-card">${p ? `<img src="${esc(p.images[0])}" alt="${esc(c.name)} helmet" loading="lazy">` : ""}<h3>${esc(c.name)}</h3><span>Explore collection</span></a>`;
    })
    .join(
      "",
    )}</div></section><section class="section promo-grid">${store.banners
    .filter((b) => b.id !== "hero")
    .slice(0, 2)
    .map(
      (b) =>
        `<article class="promo"><div class="promo-copy"><div class="eyebrow">${esc(b.eyebrow)}</div><h2>${esc(b.title)}</h2><p>${esc(b.subtitle)}</p><a class="btn ${b.id === "city" ? "outline" : ""}" href="${b.categoryId ? shopLink("category", b.categoryId) : "#shop"}">${esc(b.button)}</a></div><img src="${esc(b.image)}" alt="${esc(b.title.replace("\n", " "))}" loading="lazy"></article>`,
    )
    .join(
      "",
    )}</section><section class="ride-guide"><div><div class="eyebrow orange">A LITTLE KNOW-HOW. A BETTER RIDE.</div><h2>Great style starts<br>with a great fit.</h2><p>Your helmet should feel just right. Take a minute to find your size before you head out.</p><div class="guide-steps"><div>${icon("ruler")}<strong>Measure up</strong>Wrap above your brows.</div><div>${icon("shield")}<strong>Check your fit</strong>Snug, even contact.</div><div>${icon("check")}<strong>Ready to ride</strong>Fasten. Check. Go.</div></div></div><div class="guide-card">${icon("ruler")}<div><h3>Find your perfect fit.</h3><p>Simple steps. The right size.</p><a class="btn quiet" href="#guide">Open the size guide</a></div></div></section><p class="store-note">Zeez Labs retail showcase. Product prices, offers and stock are illustrative.</p></div>`;
}
function filterValues() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}
function filteredProducts(params) {
  let p = [...store.products];
  const q = (params.get("q") || "").toLowerCase();
  if (q)
    p = p.filter((p) =>
      (p.name + " " + brandName(p.brandId) + " " + categoryName(p.categoryId))
        .toLowerCase()
        .includes(q),
    );
  for (const [k, field] of [
    ["brand", "brandId"],
    ["category", "categoryId"],
  ])
    if (params.get(k)) p = p.filter((p) => p[field] === params.get(k));
  if (params.get("size"))
    p = p.filter((p) =>
      p.variants.some((v) => v.size === params.get("size") && v.stock > 0),
    );
  if (params.get("max")) p = p.filter((p) => p.price <= +params.get("max"));
  if (params.get("stock")) p = p.filter((p) => available(p) > 0);
  if (params.get("sale")) p = p.filter((p) => p.comparePrice > p.price);
  const sort = params.get("sort");
  if (sort === "price-asc") p.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") p.sort((a, b) => b.price - a.price);
  if (sort === "name") p.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "new") p.sort((a, b) => b.created.localeCompare(a.created));
  return p;
}
function catalog() {
  const params = filterValues(),
    p = filteredProducts(params),
    title = params.get("q")
      ? "Results for “" + params.get("q") + "”"
      : params.get("brand")
        ? brandName(params.get("brand")) + " helmets"
        : params.get("category")
          ? categoryName(params.get("category")) + " helmets"
          : params.get("sale")
            ? "The sale edit."
            : "Find your next helmet.";
  return `<div class="container">${breadcrumb("Shop helmets")}<div class="page-heading"><div><div class="eyebrow orange">THE HELMET COLLECTION</div><h1>${esc(title)}</h1><p>From daily commutes to weekend escapes. Make every mile yours.</p></div></div><button class="btn outline mobile-filter" id="toggle-filters" aria-controls="catalog-filters" aria-expanded="false">Filters &amp; search</button><div class="catalog-layout"><aside class="filters" id="catalog-filters" aria-label="Filter helmets"><div class="filter-group"><h3>Search the collection</h3><form id="catalog-search"><input name="q" aria-label="Search collection" value="${esc(params.get("q") || "")}" placeholder="Search helmets…"></form></div>${[
    ["Brand", "brand", store.brands],
    ["Helmet type", "category", store.categories],
    [
      "Size",
      "size",
      ["XS", "S", "M", "L", "XL", "XXL"].map((s) => ({ id: s, name: s })),
    ],
  ]
    .map(
      ([name, key, items]) =>
        `<div class="filter-group"><h3>${name}</h3>${items.map((i) => `<label class="check-row"><input type="checkbox" data-filter="${key}" value="${esc(i.id)}" ${params.get(key) === i.id ? "checked" : ""}>${esc(i.name)}</label>`).join("")}</div>`,
    )
    .join(
      "",
    )}<div class="filter-group"><h3>Price range</h3><label class="sr-only" for="max-price">Maximum price</label><input type="range" id="max-price" min="0" max="75000" step="500" value="${esc(params.get("max") || 75000)}" data-filter="max"><div class="range-number"><span>LKR 0</span><span id="range-value">${format(params.get("max") || 75000)}</span></div></div><div class="filter-group"><label class="check-row"><input type="checkbox" data-filter="stock" value="1" ${params.has("stock") ? "checked" : ""}>In stock only</label><label class="check-row"><input type="checkbox" data-filter="sale" value="1" ${params.has("sale") ? "checked" : ""}>On sale</label><a href="#shop" class="btn quiet small">Clear all filters</a></div></aside><section><div class="catalog-bar"><span>${p.length} helmet${p.length === 1 ? "" : "s"} found</span><label><span class="sr-only">Sort products</span><select data-filter="sort"><option value="">Sort: Featured</option>${[
    ["new", "Newest first"],
    ["price-asc", "Price: low to high"],
    ["price-desc", "Price: high to low"],
    ["name", "Name: A–Z"],
  ]
    .map(
      ([v, t]) =>
        `<option value="${v}" ${params.get("sort") === v ? "selected" : ""}>${t}</option>`,
    )
    .join("")}</select></label></div>${
    params.size
      ? `<div class="chips">${[...params]
          .filter(([k]) => k !== "sort")
          .map(
            ([k, v]) =>
              `<button class="chip" data-clear-filter="${esc(k)}">${esc(k)}: ${esc(k === "brand" ? brandName(v) : k === "category" ? categoryName(v) : v)} ×</button>`,
          )
          .join("")}</div>`
      : ""
  }${p.length ? `<div class="products-grid">${p.map(productCard).join("")}</div>` : empty("No helmets found.", "Try a different brand, size or price range.", "#shop", "Reset filters")}</section></div></div>`;
}
function empty(title, text, href = "#shop", label = "Explore helmets") {
  return `<div class="empty">${icon("bag")}<h2>${esc(title)}</h2><p>${esc(text)}</p><a class="btn" href="${href}">${esc(label)}</a></div>`;
}
function detail(id) {
  const p = store.products.find((p) => p.id === id);
  if (!p)
    return `<div class="container section">${empty("Helmet unavailable.", "This product may have been removed. Explore the rest of the collection.")}</div>`;
  currentProduct = p;
  selectedSize = null;
  selectedQuantity = 1;
  return `<div class="container">${breadcrumb(brandName(p.brandId) + " / " + p.name)}<div class="product-detail"><div><div class="gallery-main"><img id="detail-image" src="${esc(p.images[0])}" alt="${esc(p.name)}" width="650" height="650"></div><div class="thumbnails">${p.images.map((src, i) => `<button class="${i === 0 ? "selected" : ""}" data-gallery="${esc(src)}" aria-label="View photograph ${i + 1}"><img src="${esc(src)}" alt="${esc(p.name)} view ${i + 1}"></button>`).join("")}</div></div><div class="detail-copy"><div class="eyebrow">${esc(brandName(p.brandId))} / ${esc(categoryName(p.categoryId))}</div><h1>${esc(p.name)}</h1><span class="price">${format(p.price)}</span>${p.comparePrice ? `<span class="old-price">${format(p.comparePrice)}</span>` : ""}<div class="koko-line">Or 3 instalments of <strong>${format(Math.ceil(p.price / 3))}</strong> with <b>koko</b>. ${store.paymentMode === "demo" ? "Demo checkout." : "Subject to merchant availability."}</div><p class="small muted">${esc(p.description)}</p><div class="detail-trust"><span>${icon("shield")} Carefully selected brands</span><span>${icon("truck")} Islandwide delivery</span></div><div class="filter-group"><span class="small">Choose your size</span><a href="#guide" class="text-link small" data-guide-link>Size guide</a><div class="thumbnails">${p.variants.map((v) => `<button class="size-btn" data-size="${v.size}" ${v.stock ? "" : "disabled"} aria-label="Size ${v.size}${v.stock ? "" : " sold out"}">${v.size}</button>`).join("")}</div><div id="stock-text" class="stock-text">${available(p) ? "Select a size to check availability." : "Currently sold out."}</div></div><div class="buy-row"><div class="quantity"><button data-qty="-1" aria-label="Decrease quantity">−</button><span id="quantity-value">1</span><button data-qty="1" aria-label="Increase quantity">+</button></div><button class="btn orange-btn" id="add-to-bag" ${available(p) ? "" : "disabled"}>${icon("bag")} Add to bag</button><button class="btn outline" data-wish="${esc(p.id)}" aria-label="Save helmet">${icon("heart")}</button></div><button class="btn outline full" id="buy-now">Buy it now</button><div class="detail-trust"><span>${icon("truck")} Free delivery over ${format(store.settings.freeShipping)}</span><span>${icon("card")} Secure hosted card checkout</span></div></div></div><section class="section"><div class="section-head"><div><div class="eyebrow">KEEP EXPLORING</div><h2>You might also like.</h2></div></div><div class="products-grid">${store.products
    .filter((x) => x.id !== id)
    .slice(0, 4)
    .map(productCard)
    .join("")}</div></section></div>`;
}
function cartItems() {
  return cart.map((i) => ({
    ...i,
    product: store.products.find((p) => p.id === i.productId),
  }));
}
function totals() {
  const subtotal = cartItems().reduce(
      (s, i) => s + (i.product?.price || 0) * i.quantity,
      0,
    ),
    shipping =
      subtotal >= store.settings.freeShipping || !cart.length
        ? 0
        : store.settings.shippingFee;
  return { subtotal, shipping, total: subtotal + shipping };
}
function summary(checkout = false) {
  const t = totals();
  return `<aside class="summary"><h2>Order summary</h2>${
    checkout
      ? cartItems()
          .map(
            (i) =>
              `<div class="checkout-mini"><img src="${esc(i.product?.images[0] || "/assets/helmet-1.webp")}" alt=""><div><strong>${esc(i.product?.name || "Unavailable helmet")}</strong><br><span class="muted">Size ${esc(i.size)} · Qty ${i.quantity}</span></div><span>${format((i.product?.price || 0) * i.quantity)}</span></div>`,
          )
          .join("")
      : ""
  }<div class="summary-line"><span>Subtotal</span><span>${format(t.subtotal)}</span></div><div class="summary-line"><span>Delivery</span><span>${t.shipping ? format(t.shipping) : "FREE"}</span></div><div class="summary-line summary-total"><span>Total</span><span>${format(t.total)}</span></div>${checkout ? "" : `<a href="#checkout" class="btn orange-btn full">Continue to checkout</a><div class="shipping-progress"><span class="progress-${t.subtotal >= store.settings.freeShipping ? 100 : t.subtotal >= store.settings.freeShipping * 0.75 ? 75 : t.subtotal >= store.settings.freeShipping * 0.5 ? 50 : 25}"></span></div><p class="small muted">${t.subtotal >= store.settings.freeShipping ? "Your order qualifies for free delivery." : `You're ${format(store.settings.freeShipping - t.subtotal)} away from free delivery.`}</p>`}${payments()}<p class="summary-note">${icon("shield")} ${store.paymentMode === "demo" ? "Demonstration checkout · No money is charged" : "Your card details stay with the payment provider"}</p></aside>`;
}
function bag() {
  return `<div class="container">${breadcrumb("Shopping bag")}<div class="page-heading"><div><h1>Your bag.</h1><p>${cart.length ? "Great choices. Your next ride is looking good." : "A fresh start for your next ride."}</p></div><a href="#shop" class="text-link">Continue shopping</a></div>${
    cart.length
      ? `<div class="bag-layout"><div>${cartItems()
          .map(
            (i, index) =>
              `<article class="bag-item"><img src="${esc(i.product?.images[0] || "/assets/helmet-1.webp")}" alt="${esc(i.product?.name || "Helmet")}"><div class="bag-copy"><h3><a href="#product/${encodeURIComponent(i.productId)}">${esc(i.product?.name || "This helmet is no longer available")}</a></h3><p>Size ${esc(i.size)} · ${i.product ? esc(brandName(i.product.brandId)) : "Unavailable"}</p><div class="quantity"><button data-cart-qty="${index}" data-change="-1" aria-label="Decrease quantity">−</button><span>${i.quantity}</span><button data-cart-qty="${index}" data-change="1" aria-label="Increase quantity">+</button></div></div><div class="bag-price"><span class="price">${format((i.product?.price || 0) * i.quantity)}</span><button class="icon-btn small" data-remove-cart="${index}" aria-label="Remove helmet">${icon("close")} Remove</button></div></article>`,
          )
          .join("")}</div>${summary()}</div>`
      : empty(
          "Your bag is waiting.",
          "Find something you’ll look forward to wearing on your next ride.",
        )
  }</div>`;
}
function field(
  name,
  label,
  value = "",
  type = "text",
  wide = false,
  extra = "",
) {
  return `<label class="field ${wide ? "wide" : ""}">${label}<input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
}
function checkout() {
  if (!cart.length)
    return `<div class="container section">${empty("Your bag is empty.", "Choose a helmet before checking out.")}</div>`;
  if (!auth.user) return authPage(false, "checkout");
  const a = savedAddress;
  return `<div class="container">${breadcrumb("Checkout")}<div class="page-heading"><div><h1>Ready for your next ride.</h1><p>Delivery details, a quick double-check, and you're all set.</p></div></div><form id="checkout-form"><div class="checkout-layout"><div><section class="form-card"><h2>1. Delivery details</h2><p class="small muted">Sri Lanka · All fields required unless marked optional.</p><br><div class="form-grid">${field("firstName", "First name", a.firstName || auth.user.name.split(" ")[0], "text", false, 'required autocomplete="given-name" maxlength="80"')}${field("lastName", "Last name", a.lastName || "", "text", false, 'required autocomplete="family-name" maxlength="80"')}${field("phone", "Phone number", a.phone || "", "tel", false, 'required autocomplete="tel" placeholder="077 123 4567"')}${field("email", "Email address", auth.user.email, "email", false, 'readonly autocomplete="email"')}${field("line1", "Street address", a.line1 || "", "text", true, 'required autocomplete="address-line1" maxlength="180"')}${field("line2", "Apartment / floor (optional)", a.line2 || "", "text", true, 'autocomplete="address-line2" maxlength="180"')}${field("city", "Town / city", a.city || "", "text", false, 'required autocomplete="address-level2" maxlength="100"')}<label class="field">District<select name="district" required><option value="">Choose district</option>${store.districts.map((d) => `<option ${a.district === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>${field("postalCode", "Postal code", a.postalCode || "", "text", false, 'required pattern="[0-9]{5}" inputmode="numeric" autocomplete="postal-code" maxlength="5"')}<label class="field wide">Delivery note (optional)<textarea name="note" maxlength="300">${esc(a.note || "")}</textarea></label></div></section><section class="form-card"><h2>2. Payment method</h2>${store.paymentMethods.includes("card") ? `<label class="payment-option"><input type="radio" name="paymentMethod" value="card" checked required><div><strong>Credit / debit card</strong><small>Visa · Mastercard · Secure hosted payment</small></div>${icon("card")}</label>` : ""}${store.paymentMethods.includes("koko") ? `<label class="payment-option"><input type="radio" name="paymentMethod" value="koko"><div><strong>Pay in 3 with Koko</strong><small>Three instalments of approximately ${format(Math.ceil(totals().total / 3))}.</small></div><b>koko</b></label>` : ""}<div class="verification-note">${store.paymentMode === "demo" ? "You are viewing a shop demonstration. No card details are collected and no money is charged." : "You will continue to PayHere to enter card details. Payment is confirmed only after the provider verifies it."}</div><label class="inline-check"><input type="checkbox" name="terms" required><span>I agree to the <a href="#delivery" target="_blank" rel="noopener" class="text-link">delivery and returns terms</a>.</span></label><div id="checkout-error" class="error-msg" role="alert"></div><button class="btn orange-btn full" type="submit">${store.paymentMode === "demo" ? "Place demo order" : "Continue to payment"}</button></section></div>${summary(true)}</div></form></div>`;
}
function authPage(register = false, redirect = "account") {
  return `<div class="container"><div class="auth-box"><div class="eyebrow orange">WELCOME TO ZEEZ</div><br><h1>${register ? "Join the ride." : "Good to see you."}</h1><p class="small muted">${register ? "Create an account to keep your orders in one place." : redirect === "admin" ? "Sign in with your store administrator account." : "Sign in to checkout and track your orders."}</p><form id="auth-form" data-register="${register}" data-redirect="${esc(redirect)}"><div class="form-grid section-spacer">${register ? field("name", "Your name", "", "text", true, 'required autocomplete="name" maxlength="100"') : ""}${field("email", "Email address", "", "email", true, 'required autocomplete="email"')}${field("password", "Password", "", "password", true, `required minlength="8" maxlength="128" autocomplete="${register ? "new-password" : "current-password"}"`)}</div><div id="auth-error" class="error-msg" role="alert"></div><button type="submit" class="btn full">${register ? "Create account" : "Sign in"}</button></form><p class="small muted section-spacer">${register ? "Already have an account?" : "New to Zeez?"} <button class="link-button" data-auth-toggle="${!register}" data-redirect="${esc(redirect)}">${register ? "Sign in" : "Create an account"}</button></p>${redirect === "admin" && store.paymentMode === "demo" ? '<div class="admin-tip">Demo admin<br><strong>admin@zeezhelmets.lk</strong><br>Use the password from the startup terminal or your .env file.</div>' : ""}</div></div>`;
}
function orderCard(o) {
  return `<article class="order-card"><div class="order-head"><div><h3>${esc(o.id)}</h3><span class="small muted">${date(o.created)} · ${esc(o.paymentMethod === "koko" ? "Koko" : "Card")}${o.demo ? " · Demo order" : ""}</span></div><span class="pill ${esc(o.status)}">${esc(o.status.replaceAll("-", " "))}</span><strong>${format(o.total)}</strong></div>${o.items.map((i) => `<div class="order-item"><img src="${esc(i.image)}" alt=""><div>${esc(i.name)}<br><span class="muted">Size ${esc(i.size)} · Qty ${i.quantity}</span></div><span>${format(i.price * i.quantity)}</span></div>`).join("")}<div class="order-actions">${o.status === "pending" ? `<button class="btn tiny" data-pay-order="${esc(o.id)}">${o.demo ? "Complete demo payment" : "Continue card payment"}</button>` : ""}${["pending", "confirmed"].includes(o.status) && (o.demo || o.paymentStatus !== "paid") ? `<button class="btn outline tiny" data-cancel-order="${esc(o.id)}">Cancel order</button>` : ""}</div></article>`;
}
async function account() {
  if (!auth.user) return authPage();
  const orders = await api("/orders");
  return `<div class="container">${breadcrumb("My account")}<div class="page-heading account-head"><div><h1>Hello, ${esc(auth.user.name.split(" ")[0])}.</h1><p>${esc(auth.user.email)} · Your orders, all in one place.</p></div><div class="flex-gap">${auth.user.role === "admin" ? '<a class="btn" href="#admin">Open admin</a>' : ""}<button class="btn outline" data-logout>Sign out</button></div></div><h2>My orders</h2>${orders.length ? orders.map(orderCard).join("") : `<div class="section-spacer">${empty("The open road is calling.", "Your first order starts with finding the right helmet.")}</div>`}</div>`;
}
async function success(id) {
  if (!auth.user) return authPage(false, "success/" + encodeURIComponent(id));
  const o = await api("/orders/" + encodeURIComponent(id));
  const confirmed = ["confirmed", "processing", "shipped", "delivered"].includes(o.status);
  const title = confirmed ? "Order confirmed." : "Order status";
  const message = confirmed
    ? `Your payment has been confirmed${o.demo ? " as a demonstration. No money was charged" : ""}.`
    : {
        pending: "Payment is awaiting confirmation. Check the status again before attempting another payment.",
        cancelled: "This order was cancelled.",
        expired: "This order has expired.",
        "payment-review": "The store is reviewing this payment.",
      }[o.status];
  return `<div class="container"><div class="success-panel">${confirmed ? icon("check") : ""}<h1>${title}</h1><p>Order <strong>${esc(o.id)}</strong> · ${esc(message)}</p><div class="success-actions"><a href="#account" class="btn">View my order</a>${o.status === "pending" ? '<button class="btn outline" data-refresh-order>Check payment status</button>' : '<a href="#shop" class="btn outline">Keep exploring</a>'}</div></div></div>`;
}
function brands() {
  return `<div class="container">${breadcrumb("Our brands")}<div class="page-heading"><div><h1>Good brands. Great rides.</h1><p>Explore the names behind the helmets.</p></div></div><div class="brand-directory">${store.brands.map((b) => `<a href="${shopLink("brand", b.id)}"><span class="brand-word ${esc(b.id)}">${esc(b.name.toUpperCase())}</span><small>${store.products.filter((p) => p.brandId === b.id).length} helmets<br>Explore collection</small></a>`).join("")}</div></div>`;
}
function legal(page) {
  const data = {
    delivery: [
      "Delivery & returns.",
      "A clear plan for your next delivery.",
      `<h2>Delivery</h2><p>We deliver across Sri Lanka. The demonstration delivery fee is ${format(store.settings.shippingFee)}; orders from ${format(store.settings.freeShipping)} qualify for free delivery. The final charge is calculated at checkout.</p><h2>Before you order</h2><p>Confirm the helmet model, fit, stock, certification and retailer warranty before purchasing. Delivery time and eligibility for an exchange must be confirmed with the retailer.</p><h2>Exchanges & cancellations</h2><p>You can cancel eligible pending or confirmed demonstration orders from your account. Shipped orders cannot be cancelled online. For paid live orders, contact the store to arrange any cancellation or refund.</p><h2>About this shop</h2><p>This is a Zeez Labs demonstration store. Prices, inventory and fulfilment are example data. A retailer must approve its delivery, warranty, exchange and privacy policies before using the website for real orders.</p>`,
    ],
    privacy: [
      "Your privacy.",
      "Simple, considered data handling.",
      "<h2>What is stored</h2><p>Your account name, email, password hash, delivery information and order history are stored in the store database. An essential session cookie keeps you signed in. Your shopping bag, wishlist and most recent address stay in your browser.</p><h2>Payments</h2><p>The demo does not request or store real card numbers, CVVs or Koko credentials. In configured card mode, PayHere hosts card entry. Payment metadata, such as provider payment ID and order status, is retained.</p><h2>Your choices</h2><p>Contact the store to request access or correction of personal information. Account records linked to orders may need to be retained for order administration. Store-specific retention terms and legal details must be approved before launch.</p>",
    ],
  };
  const [title, subtitle, copy] = data[page];
  return `<div class="container"><article class="legal-copy"><div class="eyebrow orange">HERE TO HELP</div><br><h1>${title}</h1><p>${subtitle}</p>${copy}</article></div>`;
}
function sizeGuide() {
  modal(
    `<h2>Find your fit.</h2><p>Use a soft measuring tape around the widest part of your head, just above your eyebrows and ears. Start with the measurement below, then confirm the brand's own size chart.</p><table><thead><tr><th>Size</th><th>Head circumference</th></tr></thead><tbody>${[
      ["XS", "53–54 cm"],
      ["S", "55–56 cm"],
      ["M", "57–58 cm"],
      ["L", "59–60 cm"],
      ["XL", "61–62 cm"],
      ["XXL", "63–64 cm"],
    ]
      .map(([s, m]) => `<tr><td>${s}</td><td>${m}</td></tr>`)
      .join(
        "",
      )}</tbody></table><p class="guide-copy">This is a general guide. Fit varies between brands and models. The helmet should sit evenly with firm, comfortable contact and should not roll off when fastened. Try it on and ask the retailer for a fit check.</p><button class="btn full" data-close-modal>Got it</button>`,
  );
}
const tabs = [
  ["overview", "Overview", "settings"],
  ["products", "Products", "box"],
  ["brands", "Brands", "tag"],
  ["categories", "Categories", "menu"],
  ["banners", "Promotions", "image"],
  ["orders", "Orders", "bag"],
  ["users", "Customers", "user"],
  ["settings", "Store settings", "settings"],
];
async function admin(page = "overview") {
  if (!auth.user) return authPage(false, "admin");
  if (auth.user.role !== "admin")
    return `<div class="container section">${empty("Administrator access required.", "Sign in with your administrator account to manage the store.", "#account", "My account")}</div>`;
  adminData = await api("/admin/data");
  if (!tabs.some((t) => t[0] === page)) page = "overview";
  return `<div class="container"><div class="admin-shell"><aside class="admin-sidebar"><div class="eyebrow">STORE MANAGEMENT</div>${tabs.map(([id, name, i]) => `<a href="#admin/${id}" class="${page === id ? "active" : ""}">${icon(i)}${name}</a>`).join("")}<a href="#shop">${icon("logout")}View storefront</a></aside><section class="admin-main">${adminContent(page)}</section></div></div>`;
}
function adminContent(page) {
  if (page === "overview") return dashboard();
  const names = {
    products: "Products",
    brands: "Brands",
    categories: "Categories",
    banners: "Promotions",
    orders: "Orders",
    users: "Customers",
    settings: "Store settings",
  };
  const sub = {
    products: "Manage helmets, pricing and stock for every size.",
    brands: "Build a collection around the brands your customers love.",
    categories: "Organise your helmets by riding style.",
    banners: "Keep your storefront fresh with campaign banners.",
    orders: "Manage payments, order progress and fulfilment.",
    users: "Manage your customer accounts.",
    settings: "Make this store your own.",
  };
  return `<div class="admin-heading"><div><div class="eyebrow orange">YOUR STORE, YOUR WAY</div><h1>${names[page]}</h1><p>${sub[page]}</p></div>${!["orders", "settings"].includes(page) ? `<button class="btn" data-admin-add="${page}">${icon("plus")}Add ${page === "categories" ? "category" : page === "banners" ? "promotion" : page === "users" ? "customer" : page.slice(0, -1)}</button>` : ""}</div>${page === "settings" ? settingsForm() : `<div class="admin-toolbar"><input id="admin-search" data-kind="${page}" placeholder="Search ${names[page].toLowerCase()}…" aria-label="Search ${page}"><span class="small muted">${adminData[page].length} records</span></div><div class="table-wrap" id="admin-table" tabindex="0" role="region" aria-label="${names[page]} table">${adminTable(page, adminData[page])}</div>`}`;
}
function dashboard() {
  const d = adminData,
    fulfilled = d.orders.filter((o) =>
      ["confirmed", "processing", "shipped", "delivered"].includes(o.status),
    ),
    sales = fulfilled.reduce((n, o) => n + o.total, 0),
    low = d.products.filter((p) => available(p) <= 10);
  return `<div class="admin-heading"><div><div class="eyebrow orange">WELCOME BACK</div><h1>Your store at a glance.</h1><p>Everything you need to keep the next ride moving.</p></div><a href="#shop" class="btn outline">View store</a></div><div class="stat-grid">${[
    ["Order value", format(sales)],
    ["Orders", d.orders.length],
    ["Helmets", d.products.length],
    ["Customers", d.users.filter((u) => u.role === "customer").length],
  ]
    .map(
      ([label, value]) =>
        `<div class="admin-panel stat"><span class="small muted">${label}</span><h2>${value}</h2></div>`,
    )
    .join(
      "",
    )}</div><div class="admin-tip">${store.paymentMode === "demo" ? "Demo environment: orders, stock and content are real saved records; payment confirmations are simulated." : "Card checkout is connected to PayHere. Verify the merchant sandbox/live setting before taking payments."}</div><div class="admin-columns section-spacer"><section class="admin-panel"><h2>Recent orders</h2>${
    d.orders.length
      ? d.orders
          .slice(0, 5)
          .map(
            (o) =>
              `<div class="low-stock-row"><a href="#admin/orders">${esc(o.id)}<br><span class="muted">${date(o.created)}</span></a><div><strong>${format(o.total)}</strong><br><span class="pill ${esc(o.status)}">${esc(o.status)}</span></div></div>`,
          )
          .join("")
      : '<p class="small muted">No orders yet. Place a demo order from the storefront to see it here.</p>'
  }</section><section class="admin-panel"><h2>Stock watch</h2>${
    low.length
      ? low
          .slice(0, 6)
          .map(
            (p) =>
              `<div class="low-stock-row"><span>${esc(p.name)}</span><strong>${available(p)} left</strong></div>`,
          )
          .join("")
      : '<p class="small muted">Your collection is well stocked.</p>'
  }<a href="#admin/products" class="btn quiet small">Manage inventory</a></section></div>`;
}
function adminTable(kind, records) {
  let heads, rows;
  if (kind === "products") {
    heads = ["Product", "Brand", "Price", "Stock", "Status", "Actions"];
    rows = records.map(
      (p) =>
        `<tr><td><div class="table-product"><img src="${esc(p.images[0])}" alt=""><span>${esc(p.name)}</span></div></td><td>${esc(adminData.brands.find((b) => b.id === p.brandId)?.name || "—")}</td><td>${format(p.price)}</td><td>${available(p)}</td><td><span class="pill ${p.active ? "" : "pending"}">${p.active ? "Active" : "Hidden"}</span></td><td>${adminActions(kind, p.id)}</td></tr>`,
    );
  } else if (kind === "brands" || kind === "categories") {
    heads = ["Name", "Products", "Status", "Actions"];
    rows = records.map(
      (r) =>
        `<tr><td><strong>${esc(r.name)}</strong><br><span class="small muted">${esc(r.description || "")}</span></td><td>${adminData.products.filter((p) => p[kind === "brands" ? "brandId" : "categoryId"] === r.id).length}</td><td><span class="pill ${r.active ? "" : "pending"}">${r.active ? "Active" : "Hidden"}</span></td><td>${adminActions(kind, r.id)}</td></tr>`,
    );
  } else if (kind === "banners") {
    heads = ["Promotion", "Heading", "Status", "Actions"];
    rows = records.map(
      (b) =>
        `<tr><td><div class="table-product"><img src="${esc(b.image)}" alt=""><span>${esc(b.eyebrow)}</span></div></td><td>${esc(b.title)}</td><td><span class="pill ${b.active ? "" : "pending"}">${b.active ? "Active" : "Hidden"}</span></td><td>${adminActions(kind, b.id)}</td></tr>`,
    );
  } else if (kind === "users") {
    heads = ["Customer", "Email", "Role", "Joined", "Actions"];
    rows = records.map(
      (u) =>
        `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="pill">${esc(u.role)}</span></td><td>${date(u.created)}</td><td>${u.role === "admin" ? '<span class="small muted">Protected</span>' : adminActions(kind, u.id)}</td></tr>`,
    );
  } else {
    heads = ["Order", "Customer", "Total", "Payment", "Status", "Actions"];
    rows = records.map(
      (o) =>
        `<tr><td><strong>${esc(o.id)}</strong><br><span class="small muted">${date(o.created)}</span></td><td>${esc(o.address.firstName)} ${esc(o.address.lastName)}<br><span class="small muted">${esc(o.email)}</span></td><td>${format(o.total)}</td><td>${esc(o.paymentMethod)}<br><span class="small muted">${esc(o.paymentStatus)}</span></td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td><div class="row-actions"><button data-view-order="${esc(o.id)}">Manage</button>${["cancelled", "expired"].includes(o.status) ? `<button data-admin-delete="orders" data-id="${esc(o.id)}">Delete</button>` : ""}</div></td></tr>`,
    );
  }
  return records.length
    ? `<table class="data-table"><thead><tr>${heads.map((t) => `<th>${t}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`
    : '<div class="admin-empty">No records found.</div>';
}
function adminActions(kind, id) {
  return `<div class="row-actions"><button data-admin-edit="${kind}" data-id="${esc(id)}">Edit</button><button data-admin-delete="${kind}" data-id="${esc(id)}">Delete</button></div>`;
}
function settingsForm() {
  const s = adminData.settings;
  return `<form id="settings-form" class="admin-settings form-card"><div class="form-grid">${field("name", "Store name", s.name, "text", true, 'required maxlength="80"')}${field("tagline", "Store tagline", s.tagline, "text", true, 'maxlength="200"')}${field("email", "Contact email", s.email, "email", false, 'required maxlength="100"')}${field("phone", "Contact phone (optional)", s.phone || "", "tel", false, 'maxlength="50"')}${field("address", "Store address", s.address, "text", true, 'maxlength="200"')}${field("shippingFee", "Delivery fee (LKR)", s.shippingFee, "number", false, 'required min="0" max="100000000" step="1"')}${field("freeShipping", "Free delivery from (LKR)", s.freeShipping, "number", false, 'required min="0" max="100000000" step="1"')}${field("announcement", "Top announcement", s.announcement, "text", true, 'maxlength="200"')}</div><div class="error-msg" id="settings-error" role="alert"></div><div class="form-footer"><button type="submit" class="btn orange-btn">Save store details</button></div></form>`;
}
function selectField(name, label, records, value, blank = false) {
  return `<label class="field">${label}<select name="${name}" ${blank ? "" : "required"}>${blank ? '<option value="">All helmets</option>' : ""}${records.map((r) => `<option value="${esc(r.id)}" ${value === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>`;
}
function checkField(name, label, checked) {
  return `<label class="inline-check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}>${label}</label>`;
}
function adminEditor(kind, id) {
  const r = adminData[kind].find((r) => r.id === id) || {},
    isEdit = !!id,
    label = {
      products: "helmet",
      brands: "brand",
      categories: "category",
      banners: "promotion",
      users: "customer",
    }[kind];
  let inputs = "";
  if (kind === "products") {
    inputs = `${field("name", "Product name", r.name || "", "text", true, 'required maxlength="120"')}${selectField("brandId", "Brand", adminData.brands, r.brandId)}${selectField("categoryId", "Category", adminData.categories, r.categoryId)}${field("price", "Price (LKR)", r.price || "", "number", false, 'required min="1" max="100000000" step="1"')}${field("comparePrice", "Original price (0 for none)", r.comparePrice || 0, "number", false, 'min="0" max="100000000" step="1"')}${field("color", "Colour / finish", r.color || "", "text", false, 'maxlength="60"')}${field("badge", "Product label", r.badge || "", "text", false, 'maxlength="30" placeholder="New arrival"')}<label class="field wide">Description<textarea name="description" maxlength="3000">${esc(r.description || "")}</textarea></label><div class="field wide"><span>Size inventory (leave blank to omit a size)</span><div class="variant-grid">${["XS", "S", "M", "L", "XL", "XXL"].map((size) => `<label>${size}<input type="number" name="stock_${size}" value="${r.variants?.find((v) => v.size === size)?.stock ?? ""}" min="0" max="100000" step="1" aria-label="Stock for ${size}"></label>`).join("")}</div></div>${imageField(r.images || [])}${checkField("featured", "Feature on home page", r.featured)}${checkField("active", "Visible in store", r.active !== false)}`;
  } else if (kind === "brands" || kind === "categories") {
    inputs = `${field("name", "Name", r.name || "", "text", true, 'required maxlength="60"')}<label class="field wide">Description<textarea name="description" maxlength="200">${esc(r.description || "")}</textarea></label>${checkField("active", "Visible in store", r.active !== false)}`;
  } else if (kind === "banners") {
    inputs = `${field("eyebrow", "Small headline", r.eyebrow || "", "text", true, 'maxlength="70"')}<label class="field wide">Heading (line breaks supported)<textarea name="title" required maxlength="100">${esc(r.title || "")}</textarea></label><label class="field wide">Supporting text<textarea name="subtitle" maxlength="250">${esc(r.subtitle || "")}</textarea></label>${field("button", "Button text", r.button || "Shop collection", "text", false, 'maxlength="50"')}${selectField("categoryId", "Button collection", adminData.categories, r.categoryId, true)}${imageField(r.image ? [r.image] : [])}${checkField("active", "Visible in store", r.active !== false)}`;
  } else
    inputs = `${field("name", "Customer name", r.name || "", "text", true, 'required maxlength="100"')}${field("email", "Email address", r.email || "", "email", true, "required")}${field("password", isEdit ? "New password (leave blank to keep)" : "Password", "", "password", true, `${isEdit ? "" : "required"} minlength="8" maxlength="128" autocomplete="new-password"`)}`;
  modal(
    `<h2>${isEdit ? "Edit" : "Add"} ${label}.</h2><form id="admin-editor" data-kind="${kind}" data-id="${esc(id || "")}"><div class="form-grid">${inputs}</div><div id="editor-error" class="error-msg" role="alert"></div><div class="form-footer"><button type="button" class="btn outline" data-close-modal>Cancel</button><button type="submit" class="btn orange-btn">Save ${label}</button></div></form>`,
  );
}
function imageField(images) {
  return `<div class="field wide"><span>Product / banner images</span><input type="hidden" name="images" value="${esc(JSON.stringify(images))}"><div class="image-preview">${images.map((src) => `<img src="${esc(src)}" alt="Current image">`).join("")}</div><input type="file" name="upload" class="file-field" accept="image/png,image/jpeg,image/webp" multiple aria-label="Upload images"><small>PNG, JPG or WebP. Up to 2 MB per image, maximum 5 images. New uploads replace this gallery.</small><label class="image-picker">Or use a bundled demo image<select name="bundledImage"><option value="">Keep current / use uploads</option>${Array.from({ length: 14 }, (_, i) => `<option value="/assets/helmet-${i + 1}.png">Helmet photograph ${i + 1}</option>`).join("")}</select></label><span class="upload-status"></span></div>`;
}
function orderEditor(id) {
  const o = adminData.orders.find((o) => o.id === id);
  const next =
    {
      pending: ["cancelled"],
      confirmed: ["processing", "cancelled"],
      processing: ["shipped"],
      shipped: ["delivered"],
    }[o.status] || [];
  modal(
    `<h2>Order ${esc(o.id)}.</h2><p>${date(o.created)} · ${esc(o.email)}<br>${esc(o.paymentMethod)} · ${esc(o.paymentStatus)}${o.demo ? " · Demonstration" : ""}</p><span class="pill ${esc(o.status)}">${esc(o.status)}</span><div class="admin-order-address"><strong>Deliver to ${esc(o.address.firstName)} ${esc(o.address.lastName)}</strong><br>${esc(o.address.line1)}<br>${esc(o.address.line2 || "")} ${esc(o.address.city)}, ${esc(o.address.district)} ${esc(o.address.postalCode)}<br>${esc(o.address.phone)}<br>${esc(o.address.note || "")}</div>${o.items.map((i) => `<div class="order-item"><img src="${esc(i.image)}" alt=""><div>${esc(i.name)}<br><span class="muted">${esc(i.size)} · Qty ${i.quantity}</span></div><strong>${format(i.price * i.quantity)}</strong></div>`).join("")}<div class="summary-line"><span>Delivery</span><span>${format(o.shipping)}</span></div><div class="summary-line summary-total"><span>Total</span><span>${format(o.total)}</span></div>${next.length ? `<form id="order-update-form" data-id="${esc(o.id)}"><label class="field">Update order status<select name="status">${next.map((n) => `<option value="${n}">${n[0].toUpperCase() + n.slice(1)}</option>`).join("")}</select></label><div id="order-error" class="error-msg" role="alert"></div><div class="form-footer"><button class="btn orange-btn" type="submit">Update order</button></div></form>` : "<p>No further fulfilment changes are available.</p>"}`,
  );
}
function modal(html) {
  closeModal();
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Shop dialog" tabindex="-1"><button class="icon-btn modal-close" data-close-modal aria-label="Close dialog">${icon("close")}</button>${html}</section></div>`;
  document.body.classList.add("modal-open");
  root._returnFocus = document.activeElement;
  root.querySelector(".modal").focus();
}
function closeModal() {
  const root = $("#modal-root");
  if (root) {
    root.innerHTML = "";
    document.body.classList.remove("modal-open");
    root._returnFocus?.focus?.();
  }
}
function confirmAction(title, text, action) {
  modal(
    `<h2>${esc(title)}</h2><p>${esc(text)}</p><div id="confirm-error" class="error-msg" role="alert"></div><div class="form-footer"><button class="btn outline" data-close-modal>Keep it</button><button class="btn orange-btn" id="confirm-action">Confirm</button></div>`,
  );
  $("#confirm-action").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await action();
      closeModal();
    } catch (err) {
      $("#confirm-error").textContent = err.message;
      e.target.disabled = false;
    }
  };
}
function date(s) {
  return new Date(s).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
let preserveScroll = false;
async function render() {
  const version = ++renderVersion;
  closeModal();
  const filtersOpen = preserveScroll && $("#toggle-filters")?.getAttribute("aria-expanded") === "true";
  const route = location.hash.slice(1) || "home",
    base = route.split("?")[0],
    previousScroll = scrollY;
  let content, title;
  try {
    if (base === "home") {
      content = home();
      title = "Find your helmet. Own your ride.";
    } else if (base === "shop") {
      content = catalog();
      title = "Shop helmets";
    } else if (base.startsWith("product/")) {
      content = detail(decodeURIComponent(base.slice(8)));
      title = currentProduct?.name || "Helmet";
    } else if (base === "cart") {
      content = bag();
      title = "Your bag";
    } else if (base === "checkout") {
      content = checkout();
      title = "Checkout";
    } else if (base === "account") {
      content = await account();
      title = "My account";
    } else if (base === "register") {
      content = authPage(
        true,
        new URLSearchParams(route.split("?")[1]).get("next") || "account",
      );
      title = "Create an account";
    } else if (base === "admin" || base.startsWith("admin/")) {
      content = await admin(base.split("/")[1] || "overview");
      title = "Store administration";
    } else if (base.startsWith("success/")) {
      content = await success(decodeURIComponent(base.slice(8)));
      title = "Order status";
    } else if (base === "brands") {
      content = brands();
      title = "Our brands";
    } else if (base === "wishlist") {
      content = `<div class="container">${breadcrumb("Wishlist")}<div class="page-heading"><div><h1>Saved for your next ride.</h1><p>A little inspiration, all in one place.</p></div></div>${
        store.products.some((p) => wishlist.includes(p.id))
          ? `<div class="products-grid">${store.products
              .filter((p) => wishlist.includes(p.id))
              .map(productCard)
              .join("")}</div>`
          : empty(
              "Your favourites live here.",
              "Tap the heart on any helmet to save it for later.",
            )
      }</div>`;
      title = "Wishlist";
    } else if (base === "guide") {
      content = `<div class="container"><article class="legal-copy"><div class="eyebrow orange">FIT COMES FIRST</div><br><h1>Find your helmet size.</h1><p>Measure around the widest part of your head, just above your eyebrows and ears. Check the specific brand and model sizing before you buy.</p><button class="btn" data-open-guide>Open size chart</button><h2>A snug, comfortable fit.</h2><p>Your helmet should make even contact around your head. It should stay securely in place when fastened and should not roll off. Ask your retailer to check your fit.</p><a href="#shop" class="text-link">Explore the collection</a></article></div>`;
      title = "Size guide";
    } else if (["delivery", "privacy"].includes(base)) {
      content = legal(base);
      title = base === "delivery" ? "Delivery and returns" : "Privacy";
    } else {
      content = `<div class="container section">${empty("This road ends here.", "The page you are looking for could not be found.", "#home", "Back to home")}</div>`;
      title = "Page not found";
    }
    if (version !== renderVersion) return;
    document.title = title + " · Zeez Helmet Shop";
    $("#app").innerHTML =
      `${header()}${store.paymentMode === "demo" && ["checkout", "account"].includes(base) ? '<div class="demo-ribbon">SHOP DEMONSTRATION · No real payments are processed</div>' : ""}<main id="main-content" tabindex="-1">${content}</main>${footer()}`;
    if (base === "shop" && filtersOpen) {
      $("#toggle-filters").setAttribute("aria-expanded", "true");
      $("#catalog-filters").classList.add("mobile-open");
    }
    if (preserveScroll) {
      scrollTo(0, previousScroll);
      preserveScroll = false;
    } else scrollTo(0, 0);
    if (base === "guide") sizeGuide();
  } catch (err) {
    if (version !== renderVersion) return;
    $("#app").innerHTML =
      `${header()}<main class="container section">${empty("Something needs a moment.", err.message, "#home", "Back to home")}</main>${footer()}`;
  }
}
function saveCart() {
  storageSet("zeez-bag", cart);
}
function refreshHeader() {
  const el = $("header");
  const top = $(".topbar");
  if (el && top) {
    const holder = document.createElement("div");
    holder.innerHTML = header();
    top.replaceWith(holder.firstElementChild);
    el.replaceWith(holder.firstElementChild);
  }
}
async function addToBag(go = false) {
  if (!selectedSize) {
    toast("Choose your helmet size first.");
    $(".filter-group .size-btn")?.focus();
    return;
  }
  const productId = currentProduct.id,
    size = selectedSize,
    increment = selectedQuantity,
    stock = currentProduct.variants.find((v) => v.size === size).stock;
  const operation = () => {
    const existing = cart.find((i) => i.productId === productId && i.size === size);
    const quantity = (existing?.quantity || 0) + increment;
    if (quantity > Math.min(10, stock))
      throw new Error("That quantity is not available in this size.");
    if (!existing && cart.length >= 30)
      throw new Error("Your bag can hold up to 30 different helmet sizes.");
    return { action: "cart", productId, size, quantity };
  };
  if (auth.user) await changeShopping(operation);
  else {
    const { quantity } = operation();
    const existing = cart.find((i) => i.productId === productId && i.size === size);
    if (existing) existing.quantity = quantity;
    else cart.push({ productId, size, quantity });
    saveCart();
  }
  refreshHeader();
  toast("Added to your bag.");
  if (go) location.hash = "checkout";
}
async function refreshStore() {
  store = await api("/store");
}
function updateFilter(key, value) {
  const params = filterValues();
  if (value === null || value === "") params.delete(key);
  else params.set(key, value);
  preserveScroll = true;
  location.hash = "shop" + (params.size ? "?" + params : "");
}
async function payOrder(id) {
  const o = await api("/orders/" + encodeURIComponent(id));
  if (o.status !== "pending") {
    location.hash = "success/" + encodeURIComponent(id);
    return;
  }
  if (o.demo) {
    modal(
      `<h2>${o.paymentMethod === "koko" ? "Pay in 3 with Koko." : "Card checkout."}</h2><p>Order ${esc(o.id)} · ${format(o.total)}</p><div class="payment-demo"><b>Demonstration payment</b><span class="small muted">This simulates a ${o.paymentMethod === "koko" ? "Koko instalment" : "card"} payment. Do not enter any banking information. No money is charged.</span></div>${o.paymentMethod === "koko" ? `<div class="summary-line"><span>3 demo instalments</span><strong>≈ ${format(Math.ceil(o.total / 3))} each</strong></div>` : ""}<div id="demo-payment-error" class="error-msg" role="alert"></div><button class="btn orange-btn full" id="confirm-demo-payment" data-order-id="${esc(o.id)}">Confirm demo payment</button><button class="btn quiet" data-close-modal>Pay later from my account</button>`,
    );
  } else {
    const p = await api(
      "/orders/" + encodeURIComponent(id) + "/payment",
      "POST",
      {},
    );
    const form = document.createElement("form");
    form.method = "POST";
    form.action = p.action;
    for (const [name, value] of Object.entries(p.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }
}
async function uploadedImages(form) {
  const bundled = form.elements.bundledImage?.value;
  if (bundled) return [bundled];
  const files = [...(form.elements.upload?.files || [])];
  if (!files.length) return JSON.parse(form.elements.images?.value || "[]");
  if (files.length > 5) throw new Error("Upload up to 5 images.");
  const urls = [];
  for (const file of files) {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("Each image must be 2 MB or smaller.");
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Could not read the image."));
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.readAsDataURL(file);
    });
    const result = await api("/admin/upload", "POST", { data });
    urls.push(result.url);
  }
  return urls;
}
document.addEventListener("click", async (e) => {
  const target = e.target.closest("button,a");
  if (!target) return;
  try {
    if (target.matches('a[href="#main-content"]') && $("#main-content")) {
      e.preventDefault();
      $("#main-content").focus();
      return;
    }
    if (target.id === "toggle-nav") {
      const expanded = target.getAttribute("aria-expanded") === "true";
      target.setAttribute("aria-expanded", String(!expanded));
      return;
    }
    if (target.closest("#main-nav")) $("#toggle-nav").setAttribute("aria-expanded", "false");
    if (target.matches("[data-auth-toggle]")) {
      $("#main-content").innerHTML = authPage(
        target.dataset.authToggle === "true",
        target.dataset.redirect,
      );
      return;
    }
    if (target.matches("[data-close-modal]")) {
      e.preventDefault();
      closeModal();
      return;
    }
    if (target.matches("[data-open-guide],[data-guide-link]")) {
      e.preventDefault();
      sizeGuide();
      return;
    }
    if (target.matches("[data-slide]")) {
      currentSlide = Number(target.dataset.slide);
      $("#hero-area").innerHTML = heroMarkup();
      return;
    }
    if (target.matches("[data-wish]")) {
      const id = target.dataset.wish;
      if (auth.user) await changeShopping(() => ({
        action: "wishlist", productId: id, saved: !wishlist.includes(id),
      }));
      else {
        wishlist = wishlist.includes(id)
          ? wishlist.filter((i) => i !== id)
          : [...wishlist, id];
        storageSet("zeez-wishlist", wishlist);
      }
      target.classList.toggle("saved", wishlist.includes(id));
      target.setAttribute("aria-pressed", wishlist.includes(id));
      target.setAttribute(
        "aria-label",
        wishlist.includes(id) ? "Remove from wishlist" : "Add to wishlist",
      );
      refreshHeader();
      if (location.hash === "#wishlist") await render();
      else
        toast(
          wishlist.includes(id)
            ? "Saved to your wishlist."
            : "Removed from your wishlist.",
        );
      return;
    }
    if (target.matches("[data-size]")) {
      selectedSize = target.dataset.size;
      $$("[data-size]").forEach((b) => {
        b.classList.toggle("selected", b.dataset.size === selectedSize);
        b.setAttribute("aria-pressed", b.dataset.size === selectedSize);
      });
      const stock = currentProduct.variants.find(
        (v) => v.size === selectedSize,
      ).stock;
      $("#stock-text").textContent = `${stock} available in ${selectedSize}.`;
      selectedQuantity = Math.min(selectedQuantity, stock);
      $("#quantity-value").textContent = selectedQuantity;
      return;
    }
    if (target.matches("[data-gallery]")) {
      $("#detail-image").src = target.dataset.gallery;
      $$("[data-gallery]").forEach((b) =>
        b.classList.toggle("selected", b === target),
      );
      return;
    }
    if (target.matches("[data-qty]")) {
      const max = Math.min(
        10,
        currentProduct.variants.find((v) => v.size === selectedSize)?.stock ||
          10,
      );
      selectedQuantity = Math.max(
        1,
        Math.min(max, selectedQuantity + Number(target.dataset.qty)),
      );
      $("#quantity-value").textContent = selectedQuantity;
      return;
    }
    if (target.id === "add-to-bag" || target.id === "buy-now") {
      await addToBag(target.id === "buy-now");
      return;
    }
    if (target.matches("[data-remove-cart],[data-cart-qty]")) {
      const { removeCart, cartQty, change } = target.dataset;
      const index = Number(removeCart ?? cartQty);
      const { productId, size } = cart[index];
      const operation = () => {
        const current = cart.find((i) => i.productId === productId && i.size === size)?.quantity || 0;
        const quantity = removeCart === undefined ? Math.max(0, current + Number(change)) : 0;
        const stock = store.products.find((p) => p.id === productId)
          ?.variants.find((v) => v.size === size)?.stock || 0;
        if (quantity > current && quantity > Math.min(10, stock))
          throw new Error("There is not enough stock for that quantity.");
        return { action: "cart", productId, size, quantity };
      };
      if (auth.user) await changeShopping(operation);
      else {
        const { quantity } = operation();
        if (quantity) cart[index].quantity = quantity;
        else cart.splice(index, 1);
        saveCart();
      }
      if (location.hash === "#cart") {
        preserveScroll = true;
        await render();
      } else refreshHeader();
      return;
    }
    if (target.matches("[data-clear-filter]")) {
      updateFilter(target.dataset.clearFilter, null);
      return;
    }
    if (target.id === "toggle-filters") {
      $(".filters").classList.toggle("mobile-open");
      target.setAttribute(
        "aria-expanded",
        $(".filters").classList.contains("mobile-open"),
      );
      return;
    }
    if (target.matches("[data-logout]")) {
      await shoppingQueue;
      await api("/auth/logout", "POST", {});
      auth = { user: null, csrf: null };
      useShopping({ cart: storageGet("zeez-bag", []), wishlist: storageGet("zeez-wishlist", []) });
      clearCheckoutAttempt();
      await render();
      toast("You have signed out.");
      return;
    }
    if (target.matches("[data-pay-order]")) {
      target.disabled = true;
      try {
        await payOrder(target.dataset.payOrder);
      } finally {
        target.disabled = false;
      }
      return;
    }
    if (target.matches("[data-refresh-order]")) {
      await render();
      return;
    }
    if (target.id === "confirm-demo-payment") {
      target.disabled = true;
      try {
        const id = target.dataset.orderId;
        await api(
          "/orders/" + encodeURIComponent(id) + "/demo-pay",
          "POST",
          {},
        );
        closeModal();
        await refreshStore();
        location.hash = "success/" + id;
      } catch (err) {
        $("#demo-payment-error").textContent = err.message;
        target.disabled = false;
      }
      return;
    }
    if (target.matches("[data-cancel-order]")) {
      confirmAction(
        "Cancel this order?",
        "The reserved items will be returned to stock.",
        async () => {
          await api(
            "/orders/" +
              encodeURIComponent(target.dataset.cancelOrder) +
              "/cancel",
            "POST",
            {},
          );
          await refreshStore();
          await render();
          toast("Order cancelled.");
        },
      );
      return;
    }
    if (target.matches("[data-admin-add]")) {
      adminEditor(target.dataset.adminAdd);
      return;
    }
    if (target.matches("[data-admin-edit]")) {
      adminEditor(target.dataset.adminEdit, target.dataset.id);
      return;
    }
    if (target.matches("[data-admin-delete]")) {
      const kind = target.dataset.adminDelete,
        id = target.dataset.id;
      confirmAction(
        "Delete this record?",
        "This removes the selected record. Linked records may need to be moved first.",
        async () => {
          await api("/admin/" + kind + "/" + encodeURIComponent(id), "DELETE");
          await refreshStore();
          await render();
          toast("Record deleted.");
        },
      );
      return;
    }
    if (target.matches("[data-view-order]")) {
      orderEditor(target.dataset.viewOrder);
      return;
    }
  } catch (err) {
    target.disabled = false;
    toast(err.message);
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches("[data-filter]"))
    updateFilter(
      el.dataset.filter,
      el.type === "checkbox" ? (el.checked ? el.value : null) : el.value,
    );
  if (el.name === "upload") {
    const status = $(".upload-status", el.closest("form"));
    if (status)
      status.textContent = `${el.files.length} image${el.files.length === 1 ? "" : "s"} selected.`;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "max-price")
    $("#range-value").textContent = format(e.target.value);
  if (e.target.id === "admin-search") {
    const kind = e.target.dataset.kind,
      q = e.target.value.toLowerCase();
    const records = adminData[kind].filter((r) =>
      JSON.stringify(r).toLowerCase().includes(q),
    );
    $("#admin-table").innerHTML = adminTable(kind, records);
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)),
    button = $("[type=submit]", form) || $("button", form);
  const error = $(".error-msg", form);
  if (error) error.textContent = "";
  if (button) button.disabled = true;
  try {
    if (form.id === "header-search" || form.id === "catalog-search") {
      if (form.id === "header-search") location.hash = shopLink("q", data.q);
      else updateFilter("q", data.q);
      return;
    }
    if (form.id === "auth-form") {
      const result = await api(
        "/auth/" + (form.dataset.register === "true" ? "register" : "login"),
        "POST",
        data,
      );
      auth = result;
      await loadShopping();
      const next = form.dataset.redirect || "account";
      if (next === "admin" && auth.user.role !== "admin")
        toast("This account does not have administrator access.");
      history.replaceState(null, "", "#" + next);
      await render();
      return;
    }
    if (form.id === "checkout-form") {
      if (!data.terms)
        throw new Error("Please accept the delivery and returns terms.");
      const address = { ...data };
      delete address.paymentMethod;
      delete address.terms;
      delete address.email;
      await shoppingQueue;
      const payload = {
        items: cart,
        paymentMethod: data.paymentMethod,
        address,
      };
      const order = await api("/orders", "POST", {
        ...payload,
        idempotencyKey: checkoutKeyFor(payload),
      });
      clearCheckoutAttempt();
      useShopping(order.shopping);
      history.replaceState(null, "", "#account");
      await refreshStore().catch(() => {});
      await render();
      await payOrder(order.id);
      return;
    }
    if (form.id === "settings-form") {
      await api("/admin/settings", "PUT", {
        ...data,
        shippingFee: Number(data.shippingFee),
        freeShipping: Number(data.freeShipping),
      });
      await refreshStore();
      await render();
      toast("Store details saved.");
      return;
    }
    if (form.id === "admin-editor") {
      const kind = form.dataset.kind,
        id = form.dataset.id;
      let payload = {
        ...data,
        active: form.elements.active?.checked,
        featured: form.elements.featured?.checked,
      };
      if (kind === "products") {
        payload.price = Number(data.price);
        payload.comparePrice = Number(data.comparePrice || 0);
        payload.variants = ["XS", "S", "M", "L", "XL", "XXL"]
          .filter((s) => data["stock_" + s] !== "")
          .map((s) => ({ size: s, stock: Number(data["stock_" + s]) }));
        payload.images = await uploadedImages(form);
      }
      if (kind === "banners") payload.image = (await uploadedImages(form))[0];
      delete payload.upload;
      await api(
        "/admin/" + kind + (id ? "/" + encodeURIComponent(id) : ""),
        id ? "PUT" : "POST",
        payload,
      );
      closeModal();
      await refreshStore();
      await render();
      toast("Changes saved.");
      return;
    }
    if (form.id === "order-update-form") {
      await api(
        "/admin/orders/" + encodeURIComponent(form.dataset.id),
        "PUT",
        data,
      );
      closeModal();
      await refreshStore();
      await render();
      toast("Order updated.");
      return;
    }
  } catch (err) {
    if (error && error.isConnected) error.textContent = err.message;
    else toast(err.message);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (!$(".modal-backdrop")) {
    const toggle = $("#toggle-nav[aria-expanded='true']");
    if (e.key === "Escape" && toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
    return;
  }
  if (e.key === "Escape") {
    closeModal();
    return;
  }
  if (e.key === "Tab") {
    const items = $$(
        'button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]',
        $(".modal"),
      ),
      first = items[0],
      last = items.at(-1);
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === $(".modal"))
    ) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
window.addEventListener("hashchange", render);
window.addEventListener("storage", (e) => {
  if (auth.user) return;
  if (e.key === "zeez-bag") {
    cart = storageGet("zeez-bag", []);
    render();
  }
  if (e.key === "zeez-wishlist") {
    wishlist = storageGet("zeez-wishlist", []);
    render();
  }
});
async function init() {
  try {
    [store, auth] = await Promise.all([api("/store"), api("/auth/me")]);
    await loadShopping();
    await render();
  } catch (err) {
    $("#app").innerHTML =
      `<main class="container section"><h1>We’ll be right back.</h1><p>${esc(err.message)}</p><p>Make sure the Node.js server is running, then reload.</p></main>`;
  }
}
init();

setInterval(() => {
  if (
    (!location.hash || location.hash === "#home") &&
    store?.banners.length > 1 &&
    !document.hidden &&
    !$(".modal") &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    currentSlide = (currentSlide + 1) % store.banners.length;
    const area = $("#hero-area");
    if (area) area.innerHTML = heroMarkup();
  }
}, 8000);
