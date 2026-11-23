import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { seed } from "./seed.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const production = process.env.NODE_ENV === "production";
const mode = process.env.PAYMENT_MODE || "demo";
const adminPassword = process.env.ADMIN_PASSWORD;
if (production && (!adminPassword || adminPassword.length < 12))
  throw new Error(
    "Set a unique ADMIN_PASSWORD of at least 12 characters before production startup.",
  );
if (!["demo", "payhere"].includes(mode))
  throw new Error("PAYMENT_MODE must be demo or payhere.");
if (
  mode === "payhere" &&
  (!process.env.PAYHERE_MERCHANT_ID ||
    !process.env.PAYHERE_MERCHANT_SECRET ||
    !process.env.PUBLIC_URL?.startsWith("https://"))
)
  throw new Error(
    "PayHere requires merchant credentials and an HTTPS PUBLIC_URL.",
  );
const dbPath = resolve(
  process.env.DB_PATH || resolve(root, "data/shop.sqlite"),
);
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, hash TEXT NOT NULL, created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL);",
);
const list = (kind) =>
  db
    .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
    .all(kind)
    .map((r) => JSON.parse(r.data));
const get = (kind, id) => {
  const r = db
    .prepare("SELECT data FROM records WHERE kind=? AND id=?")
    .get(kind, id);
  return r && JSON.parse(r.data);
};
const put = (kind, v) => {
  db.prepare(
    "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
  ).run(kind, v.id, JSON.stringify(v));
  return v;
};
const remove = (kind, id) =>
  db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
const hash = (p) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(p, salt, 64).toString("hex")}`;
};
const verify = (p, h) => {
  const [salt, key] = h.split(":");
  return timingSafeEqual(scryptSync(p, salt, 64), Buffer.from(key, "hex"));
};
if (!get("settings", "store")) seed(put);
const existingAdmin = db
  .prepare("SELECT * FROM users WHERE role=?")
  .get("admin");
if (!existingAdmin) {
  const initialPassword = adminPassword || randomBytes(18).toString("base64url");
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
    randomUUID(),
    (process.env.ADMIN_EMAIL || "admin@zeezhelmets.lk").toLowerCase(),
    "Store administrator",
    "admin",
    hash(initialPassword),
    new Date().toISOString(),
  );
  if (!adminPassword) console.log(`Demo admin password: ${initialPassword}`);
} else if (adminPassword && !verify(adminPassword, existingAdmin.hash)) {
  db.prepare("UPDATE users SET hash=?,email=? WHERE id=?").run(
    hash(adminPassword),
    (process.env.ADMIN_EMAIL || existingAdmin.email).toLowerCase(),
    existingAdmin.id,
  );
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(existingAdmin.id);
}
const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const clean = (s, max = 200) =>
  typeof s === "string" ? s.trim().slice(0, max) : "";
const money = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 100000000;
const safeImage = (s) =>
  typeof s === "string" && /^\/(assets|uploads)\/[a-zA-Z0-9_.-]+$/.test(s);
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  created: u.created,
});
const tokenHash = (t) => createHash("sha256").update(t).digest("hex");
const md5 = (x) => createHash("md5").update(x).digest("hex").toUpperCase();
const setting = () => get("settings", "store");
const sizes = ["XS", "S", "M", "L", "XL", "XXL"];
const districts = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo",
  "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara", "Kandy",
  "Kegalle", "Kilinochchi", "Kurunegala", "Mannar", "Matale", "Matara",
  "Monaragala", "Mullaitivu", "Nuwara Eliya", "Polonnaruwa", "Puttalam",
  "Ratnapura", "Trincomalee", "Vavuniya",
];
const visibleProduct = (p) =>
  p?.active &&
  get("brands", p.brandId)?.active &&
  get("categories", p.categoryId)?.active;
function shopping(id) {
  const saved = get("shopping", id) || { id, cart: [], wishlist: [] };
  if (!saved.address) {
    const row = db.prepare(
      "SELECT json_extract(data, '$.address') AS address FROM records WHERE kind='orders' AND json_extract(data, '$.userId')=? ORDER BY json_extract(data, '$.created') DESC LIMIT 1",
    ).get(id);
    const { note, ...address } = row ? JSON.parse(row.address) : {};
    saved.address = address;
  }
  return saved;
}
const publicShopping = ({ cart, wishlist, address }) => ({ cart, wishlist, address });
const validProductId = (id) =>
  typeof id === "string" && id.length > 0 && id.length <= 80;
const sameVariant = (a, b) => a.productId === b.productId && a.size === b.size;

function updateShopping(id, body) {
  const saved = shopping(id);
  if (body.action === "merge") {
    if (!Array.isArray(body.cart) || !Array.isArray(body.wishlist))
      fail("Invalid guest shopping data.");
    for (const item of body.cart.slice(0, 30)) {
      if (!validProductId(item?.productId) || !sizes.includes(item.size) ||
          !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10)
        continue;
      const product = get("products", item.productId);
      if (!visibleProduct(product) || !product.variants.some((v) => v.size === item.size))
        continue;
      const existing = saved.cart.find((row) => sameVariant(row, item));
      if (existing) existing.quantity = Math.max(existing.quantity, item.quantity);
      else if (saved.cart.length < 30)
        saved.cart.push({ productId: item.productId, size: item.size, quantity: item.quantity });
    }
    for (const productId of body.wishlist.slice(0, 500)) {
      if (saved.wishlist.length >= 500) break;
      if (validProductId(productId) && !saved.wishlist.includes(productId) &&
          visibleProduct(get("products", productId)))
        saved.wishlist.push(productId);
    }
  } else {
    const { productId, size, quantity } = body;
    if (!validProductId(productId)) fail("Invalid helmet.");
    if (body.action === "cart") {
      if (!sizes.includes(size) || !Number.isInteger(quantity) || quantity < 0 || quantity > 10)
        fail("Invalid size or quantity.");
      const item = { productId, size, quantity };
      const existing = saved.cart.findIndex((row) => sameVariant(row, item));
      if (quantity === 0) {
        if (existing >= 0) saved.cart.splice(existing, 1);
      } else {
        const product = get("products", productId);
        const stock = product?.variants.find((v) => v.size === size)?.stock ?? 0;
        const previous = saved.cart[existing]?.quantity ?? 0;
        if (quantity > previous && (!visibleProduct(product) || quantity > stock))
          fail("This size has insufficient stock.", 409);
        if (existing >= 0) saved.cart[existing] = item;
        else if (saved.cart.length < 30) saved.cart.push(item);
        else fail("Your bag can hold up to 30 different helmet sizes.");
      }
    } else if (body.action === "wishlist" && typeof body.saved === "boolean") {
      if (!body.saved) saved.wishlist = saved.wishlist.filter((id) => id !== productId);
      else if (!saved.wishlist.includes(productId)) {
        if (!visibleProduct(get("products", productId))) fail("Helmet not found.", 404);
        if (saved.wishlist.length >= 500) fail("Your wishlist is full.");
        saved.wishlist.push(productId);
      }
    } else fail("Invalid shopping action.");
  }
  return put("shopping", saved);
}

const expiredOrders = () => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const expired = db.prepare(
    "SELECT data FROM records WHERE kind='orders' AND json_extract(data, '$.status')='pending' AND json_extract(data, '$.created') < ?",
  ).all(cutoff);
  for (const row of expired) cancelOrder(JSON.parse(row.data), "expired");
};
function cancelOrder(o, status = "cancelled") {
  if (!["pending", "confirmed"].includes(o.status))
    fail("This order cannot be cancelled.");
  for (const item of o.items) {
    const p = get("products", item.productId);
    if (p) {
      const v = p.variants.find((v) => v.size === item.size);
      if (v) v.stock += item.quantity;
      put("products", p);
    }
  }
  o.status = status;
  o.updated = new Date().toISOString();
  put("orders", o);
}
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 4 * 1024 * 1024) fail("Upload or request is too large.", 413);
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString();
  if (!text) return {};
  if (
    req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")
  )
    return Object.fromEntries(new URLSearchParams(text));
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("Invalid JSON.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    fail("Request body must be an object.");
  return parsed;
}
const rate = new Map();
function throttle(req, key, limit = 30) {
  const id = `${req.socket.remoteAddress}:${key}`;
  let r = rate.get(id);
  if (!r || Date.now() > r.end) {
    r = { n: 0, end: Date.now() + 600000 };
    rate.set(id, r);
  }
  if (++r.n > limit) fail("Too many attempts. Please try again later.", 429);
}
function validate(kind, b, old) {
  const id = old?.id || randomUUID();
  if (kind === "products") {
    const name = clean(b.name, 120),
      brandId = clean(b.brandId),
      categoryId = clean(b.categoryId);
    if (!name || !get("brands", brandId) || !get("categories", categoryId))
      fail("Name, valid brand and category are required.");
    if (
      !money(b.price) ||
      b.price === 0 ||
      !money(b.comparePrice ?? 0) ||
      ((b.comparePrice || 0) > 0 && b.comparePrice < b.price)
    )
      fail("Enter valid prices in LKR.");
    if (
      !Array.isArray(b.variants) ||
      !b.variants.length ||
      b.variants.length > 8 ||
      new Set(b.variants.map((v) => v?.size)).size !== b.variants.length ||
      b.variants.some(
        (v) =>
          !v ||
          typeof v !== "object" ||
          !sizes.includes(v.size) ||
          !Number.isInteger(v.stock) ||
          v.stock < 0 ||
          v.stock > 100000,
      )
    )
      fail("Enter unique helmet sizes with valid stock quantities.");
    const images = (Array.isArray(b.images) ? b.images : [])
      .filter(safeImage)
      .slice(0, 5);
    if (!images.length) fail("Choose an uploaded or bundled product image.");
    return {
      id,
      name,
      brandId,
      categoryId,
      price: b.price,
      comparePrice: b.comparePrice || 0,
      images,
      variants: b.variants.map((v) => ({ size: v.size, stock: v.stock })),
      color: clean(b.color, 60),
      description: clean(b.description, 3000),
      badge: clean(b.badge, 30),
      featured: !!b.featured,
      active: b.active !== false,
      created: old?.created || new Date().toISOString(),
    };
  }
  if (kind === "brands" || kind === "categories") {
    if (!clean(b.name, 60)) fail("Name is required.");
    return {
      id,
      name: clean(b.name, 60),
      description: clean(b.description, 200),
      active: b.active !== false,
    };
  }
  if (kind === "banners") {
    if (!clean(b.title, 100)) fail("Banner title is required.");
    if (b.image && !safeImage(b.image)) fail("Use an uploaded image.");
    if (b.categoryId && !get("categories", b.categoryId))
      fail("Select a valid banner category.");
    return {
      id,
      title: clean(b.title, 100),
      eyebrow: clean(b.eyebrow, 70),
      subtitle: clean(b.subtitle, 250),
      button: clean(b.button, 50) || "Shop collection",
      image: b.image || "/assets/helmet-1.webp",
      categoryId: clean(b.categoryId),
      active: b.active !== false,
    };
  }
}
const server = http.createServer(async (req, res) => {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self' https://sandbox.payhere.lk https://www.payhere.lk; base-uri 'self'; frame-ancestors 'none'",
  };
  const send = (status, data, extra = {}) => {
    res.writeHead(status, {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    });
    res.end(JSON.stringify(data));
  };
  try {
    let body;
    const url = new URL(req.url, "http://local"),
      path = url.pathname;
    const rawToken = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("zeez_session="))
      ?.slice(13);
    const session =
      rawToken &&
      db
        .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
        .get(tokenHash(rawToken), Date.now());
    const user =
      session &&
      db.prepare("SELECT * FROM users WHERE id=?").get(session.user_id);
    const auth = () => {
      if (!user) fail("Please sign in first.", 401);
    };
    const admin = () => {
      auth();
      if (user.role !== "admin") fail("Administrator access required.", 403);
    };
    if (path.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(req.method)) {
        if (path !== "/api/payments/payhere/notify") {
          const origin = req.headers.origin;
          if (origin) {
            const requestOrigin = `http://${req.headers.host}`;
            const configuredOrigin = new URL(process.env.PUBLIC_URL || requestOrigin).origin;
            if (origin !== configuredOrigin && (production || origin !== requestOrigin))
              fail("Request origin is not allowed.", 403);
          }
          if (user && req.headers["x-csrf-token"] !== session.csrf)
            fail("Refresh the page and try again.", 403);
        }
        body = await readBody(req);
      }
      if (path === "/api/health") return send(200, { ok: true });
      if (path === "/api/store" && req.method === "GET") {
        transaction(expiredOrders);
        return send(200, {
          settings: setting(),
          products: list("products").filter(visibleProduct),
          brands: list("brands").filter((v) => v.active),
          categories: list("categories").filter((v) => v.active),
          banners: list("banners").filter((v) => v.active),
          districts,
          paymentMode: mode,
          paymentMethods: mode === "demo" ? ["card", "koko"] : ["card"],
        });
      }
      if (path === "/api/auth/me" && req.method === "GET")
        return send(200, {
          user: user ? publicUser(user) : null,
          csrf: session?.csrf || null,
        });
      if (
        ["/api/auth/login", "/api/auth/register"].includes(path) &&
        req.method === "POST"
      ) {
        throttle(req, "auth");
        const email = clean(body.email).toLowerCase(),
          password = body.password;
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          typeof password !== "string" ||
          password.length < 8 ||
          password.length > 128
        )
          fail("Enter a valid email and a password of 8–128 characters.");
        let u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        if (path.endsWith("register")) {
          if (u) fail("This email is already registered.", 409);
          const name = clean(body.name, 100);
          if (!name) fail("Your name is required.");
          db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
            randomUUID(),
            email,
            name,
            "customer",
            hash(password),
            new Date().toISOString(),
          );
          u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        } else if (!u || !verify(password, u.hash))
          fail("Email or password is incorrect.", 401);
        const t = randomBytes(32).toString("hex"),
          csrf = randomBytes(24).toString("hex");
        db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
        db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
          tokenHash(t),
          u.id,
          csrf,
          Date.now() + 86400000,
        );
        return send(
          200,
          { user: publicUser(u), csrf },
          {
            "Set-Cookie": `zeez_session=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${production ? "; Secure" : ""}`,
          },
        );
      }
      if (path === "/api/auth/logout" && req.method === "POST") {
        if (rawToken)
          db.prepare("DELETE FROM sessions WHERE token=?").run(
            tokenHash(rawToken),
          );
        return send(
          200,
          { ok: true },
          {
            "Set-Cookie":
              "zeez_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
          },
        );
      }
      if (path === "/api/shopping" && ["GET", "PATCH"].includes(req.method)) {
        auth();
        const saved = req.method === "GET"
          ? shopping(user.id)
          : transaction(() => {
              expiredOrders();
              return updateShopping(user.id, body);
            });
        return send(200, publicShopping(saved));
      }
      if (path === "/api/orders" && req.method === "GET") {
        auth();
        transaction(expiredOrders);
        return send(
          200,
          list("orders")
            .filter((o) => o.userId === user.id)
            .sort((a, b) => b.created.localeCompare(a.created)),
        );
      }
      if (path === "/api/orders" && req.method === "POST") {
        auth();
        throttle(req, "orders", 80);
        if (
          !["card", "koko"].includes(body.paymentMethod) ||
          (mode !== "demo" && body.paymentMethod === "koko")
        )
          fail("This payment method is not configured.");
        const a = body.address || {};
        for (const field of [
          "firstName",
          "lastName",
          "phone",
          "line1",
          "city",
          "district",
          "postalCode",
        ])
          if (!clean(a[field], 180)) fail(`Delivery ${field} is required.`);
        if (!/^(?:\+94|0)[1-9]\d{8}$/.test(clean(a.phone).replace(/[\s-]/g, "")))
          fail("Enter a valid Sri Lankan telephone number.");
        if (!/^\d{5}$/.test(clean(a.postalCode)))
          fail("Enter a five-digit postal code.");
        if (!districts.includes(clean(a.district))) fail("Choose a valid delivery district.");
        const address = {};
        for (const field of [
          "firstName", "lastName", "phone", "line1", "line2", "city", "district", "postalCode", "note",
        ]) {
          if (field in a) address[field] = clean(a[field], 300);
        }
        const key = clean(body.idempotencyKey, 80);
        if (!key) fail("Missing checkout key.");
        const o = transaction(() => {
          expiredOrders();
          const existing = list("orders").find(
            (o) => o.userId === user.id && o.key === key,
          );
          if (existing) return existing;
          if (
            !Array.isArray(body.items) ||
            !body.items.length ||
            body.items.length > 30
          )
            fail("Your bag is empty or too large.");
          const seen = new Set();
          const items = body.items.map((item) => {
            if (!item || typeof item !== "object") fail("Invalid bag item.");
            const pid = clean(item.productId),
              variantKey = pid + ":" + item.size;
            if (seen.has(variantKey)) fail("Duplicate bag item.");
            seen.add(variantKey);
            const p = get("products", pid),
              v = p?.variants.find((v) => v.size === item.size);
            if (
              !visibleProduct(p) ||
              !v ||
              !Number.isInteger(item.quantity) ||
              item.quantity < 1 ||
              item.quantity > 10 ||
              v.stock < item.quantity
            )
              fail("An item is unavailable or has insufficient stock.", 409);
            v.stock -= item.quantity;
            put("products", p);
            return {
              productId: p.id,
              name: p.name,
              size: v.size,
              quantity: item.quantity,
              price: p.price,
              image: p.images[0],
            };
          });
          const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0),
            s = setting(),
            shipping = subtotal >= s.freeShipping ? 0 : s.shippingFee;
          const saved = shopping(user.id);
          for (const row of saved.cart) {
            const ordered = items.find((item) => sameVariant(row, item));
            if (ordered) row.quantity -= ordered.quantity;
          }
          saved.cart = saved.cart.filter((row) => row.quantity > 0);
          const { note, ...deliveryAddress } = address;
          saved.address = deliveryAddress;
          put("shopping", saved);
          return put("orders", {
            id: "ZH-" + randomBytes(5).toString("hex").toUpperCase(),
            key,
            userId: user.id,
            email: user.email,
            address,
            items,
            subtotal,
            shipping,
            total: subtotal + shipping,
            paymentMethod: body.paymentMethod,
            paymentStatus: "unpaid",
            status: "pending",
            demo: mode === "demo",
            created: new Date().toISOString(),
          });
        });
        return send(201, { ...o, shopping: publicShopping(shopping(user.id)) });
      }
      const orderDetail = path.match(/^\/api\/orders\/([^/]+)$/);
      if (orderDetail && req.method === "GET") {
        auth();
        transaction(expiredOrders);
        const o = get("orders", orderDetail[1]);
        if (!o || o.userId !== user.id) fail("Order not found.", 404);
        return send(200, o);
      }
      const orderAction = path.match(
        /^\/api\/orders\/([^/]+)\/(cancel|demo-pay|payment)$/,
      );
      if (orderAction && req.method === "POST") {
        auth();
        transaction(expiredOrders);
        const o = get("orders", orderAction[1]);
        if (!o || o.userId !== user.id) fail("Order not found.", 404);
        if (orderAction[2] === "cancel") {
          if (!o.demo && o.paymentStatus === "paid")
            fail(
              "Contact the store to arrange a refund before cancellation.",
              409,
            );
          transaction(() => cancelOrder(o));
          return send(200, o);
        }
        if (orderAction[2] === "demo-pay") {
          if (mode !== "demo" || !o.demo)
            fail("Demo payment is disabled.", 403);
          if (o.status === "pending") {
            o.paymentStatus = "demo-paid";
            o.status = "confirmed";
            put("orders", o);
          } else if (o.status !== "confirmed")
            fail("This order is no longer awaiting payment.", 409);
          return send(200, o);
        }
        if (
          mode !== "payhere" ||
          o.demo ||
          o.paymentMethod !== "card" ||
          o.status !== "pending"
        )
          fail("Card checkout is not available for this order.");
        const merchant = process.env.PAYHERE_MERCHANT_ID,
          amount = o.total.toFixed(2),
          base = process.env.PUBLIC_URL.replace(/\/$/, "");
        return send(200, {
          action:
            process.env.PAYHERE_SANDBOX === "false"
              ? "https://www.payhere.lk/pay/checkout"
              : "https://sandbox.payhere.lk/pay/checkout",
          fields: {
            merchant_id: merchant,
            return_url: base + "/#success/" + encodeURIComponent(o.id),
            cancel_url: base + "/#account",
            notify_url: base + "/api/payments/payhere/notify",
            order_id: o.id,
            items: o.items
              .map((i) => i.name)
              .join(", ")
              .slice(0, 250),
            currency: "LKR",
            amount,
            first_name: o.address.firstName,
            last_name: o.address.lastName,
            email: o.email,
            phone: o.address.phone,
            address: o.address.line1,
            city: o.address.city,
            country: "Sri Lanka",
            hash: md5(
              merchant +
                o.id +
                amount +
                "LKR" +
                md5(process.env.PAYHERE_MERCHANT_SECRET),
            ),
          },
        });
      }
      if (path === "/api/payments/payhere/notify" && req.method === "POST") {
        if (mode !== "payhere") fail("Payments are not enabled.", 404);
        const b = body,
          expected = md5(
            b.merchant_id +
              b.order_id +
              b.payhere_amount +
              b.payhere_currency +
              b.status_code +
              md5(process.env.PAYHERE_MERCHANT_SECRET),
          );
        if (
          typeof b.md5sig !== "string" ||
          !/^[0-9a-fA-F]{32}$/.test(b.md5sig) ||
          !timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(b.md5sig.toUpperCase()),
          ) ||
          b.merchant_id !== process.env.PAYHERE_MERCHANT_ID
        )
          fail("Invalid payment signature.", 403);
        transaction(() => {
          expiredOrders();
          const o = get("orders", b.order_id);
          if (
            !o ||
            o.demo ||
            o.paymentMethod !== "card" ||
            b.payhere_currency !== "LKR" ||
            b.payhere_amount !== o.total.toFixed(2)
          )
            fail("Payment does not match the order.");
          if (b.status_code === "2") {
            if (["paid", "chargeback"].includes(o.paymentStatus)) return;
            o.paymentStatus = "paid";
            o.paymentId = clean(b.payment_id);
            if (["cancelled", "expired"].includes(o.status))
              o.status = "payment-review";
            else o.status = "confirmed";
            put("orders", o);
          } else if (b.status_code === "-3" && o.paymentStatus === "paid") {
            o.paymentStatus = "chargeback";
            o.status = "payment-review";
            put("orders", o);
          }
        });
        return send(200, { ok: true });
      }
      if (path.startsWith("/api/admin")) {
        admin();
        transaction(expiredOrders);
        if (path === "/api/admin/data" && req.method === "GET")
          return send(200, {
            products: list("products"),
            brands: list("brands"),
            categories: list("categories"),
            banners: list("banners"),
            orders: list("orders").sort((a, b) =>
              b.created.localeCompare(a.created),
            ),
            users: db.prepare("SELECT * FROM users").all().map(publicUser),
            settings: setting(),
          });
        if (path === "/api/admin/settings" && req.method === "PUT") {
          if (
            !clean(body.name, 80) ||
            !money(body.shippingFee) ||
            !money(body.freeShipping)
          )
            fail("Enter a store name and valid shipping amounts.");
          return send(
            200,
            put("settings", {
              id: "store",
              name: clean(body.name, 80),
              tagline: clean(body.tagline, 200),
              email: clean(body.email, 100),
              phone: clean(body.phone, 50),
              address: clean(body.address, 200),
              shippingFee: body.shippingFee,
              freeShipping: body.freeShipping,
              announcement: clean(body.announcement, 200),
            }),
          );
        }
        if (path === "/api/admin/upload" && req.method === "POST") {
          if (typeof body.data !== "string" || body.data.length > 2800000)
            fail("Choose a JPG, PNG or WebP smaller than 2 MB.");
          const buf = Buffer.from(body.data, "base64");
          let ext;
          if (
            buf
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          )
            ext = "png";
          else if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255)
            ext = "jpg";
          else if (
            buf.toString("ascii", 0, 4) === "RIFF" &&
            buf.toString("ascii", 8, 12) === "WEBP"
          )
            ext = "webp";
          if (!ext || buf.length > 2 * 1024 * 1024)
            fail("Only PNG, JPEG and WebP images up to 2 MB are accepted.");
          const dir = resolve(root, "public/uploads");
          mkdirSync(dir, { recursive: true });
          const name = randomUUID() + "." + ext;
          writeFileSync(resolve(dir, name), buf);
          return send(201, { url: "/uploads/" + name });
        }
        const m = path.match(
          /^\/api\/admin\/(products|brands|categories|banners|orders|users)(?:\/([^/]+))?$/,
        );
        if (m) {
          const [, kind, id] = m;
          if (kind === "users") {
            if (req.method === "POST" && !id) {
              const email = clean(body.email).toLowerCase(),
                name = clean(body.name, 100),
                password = body.password;
              if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
                !name ||
                typeof password !== "string" ||
                password.length < 8 ||
                password.length > 128
              )
                fail(
                  "Enter a name, valid email and an 8–128 character password.",
                );
              if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
                fail("This email is already registered.", 409);
              const uid = randomUUID();
              db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
                uid,
                email,
                name,
                "customer",
                hash(password),
                new Date().toISOString(),
              );
              return send(
                201,
                publicUser(
                  db.prepare("SELECT * FROM users WHERE id=?").get(uid),
                ),
              );
            }
            const u = db
              .prepare("SELECT * FROM users WHERE id=?")
              .get(id || "");
            if (!u) fail("Customer not found.", 404);
            if (u.role === "admin")
              fail("Administrator accounts are protected.");
            if (req.method === "PUT") {
              const name = clean(body.name, 100),
                email = clean(body.email).toLowerCase();
              if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                fail("Enter a name and valid email.");
              if (
                db
                  .prepare("SELECT id FROM users WHERE email=? AND id!=?")
                  .get(email, id)
              )
                fail("This email is already registered.", 409);
              if (
                body.password &&
                (typeof body.password !== "string" ||
                  body.password.length < 8 ||
                  body.password.length > 128)
              )
                fail("Use an 8–128 character password.");
              db.prepare(
                "UPDATE users SET name=?,email=?,hash=? WHERE id=?",
              ).run(
                name,
                email,
                body.password ? hash(body.password) : u.hash,
                id,
              );
              if (body.password)
                db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
              return send(
                200,
                publicUser(
                  db.prepare("SELECT * FROM users WHERE id=?").get(id),
                ),
              );
            }
            if (req.method === "DELETE") {
              if (list("orders").some((o) => o.userId === id))
                fail("Customers with order history cannot be deleted.");
              transaction(() => {
                db.prepare("DELETE FROM users WHERE id=?").run(id);
                remove("shopping", id);
              });
              return send(200, { ok: true });
            }
          } else if (kind === "orders") {
            const o = get(kind, id);
            if (!o) fail("Order not found.", 404);
            if (req.method === "PUT") {
              const next =
                {
                  pending: ["cancelled"],
                  confirmed: ["processing", "cancelled"],
                  processing: ["shipped"],
                  shipped: ["delivered"],
                }[o.status] || [];
              if (!next.includes(body.status))
                fail("Invalid order status change.");
              if (body.status === "cancelled") {
                if (!o.demo && o.paymentStatus === "paid")
                  fail("Refund must be arranged before cancellation.");
                transaction(() => cancelOrder(o));
              } else {
                o.status = body.status;
                put(kind, o);
              }
              return send(200, o);
            }
            if (req.method === "DELETE") {
              if (
                !["cancelled", "expired"].includes(o.status) ||
                o.paymentStatus === "paid"
              )
                fail(
                  "Only cancelled or expired unpaid/demo orders can be deleted.",
                );
              remove(kind, id);
              return send(200, { ok: true });
            }
          } else {
            const old = id && get(kind, id);
            if (id && !old) fail("Record not found.", 404);
            if (req.method === "POST" && !id)
              return send(201, put(kind, validate(kind, body)));
            if (req.method === "PUT" && id)
              return send(200, put(kind, validate(kind, body, old)));
            if (req.method === "DELETE" && id) {
              if (
                ["brands", "categories"].includes(kind) &&
                list("products").some(
                  (p) => p[kind === "brands" ? "brandId" : "categoryId"] === id,
                )
              )
                fail("Move or delete this group’s products first.", 409);
              if (
                kind === "categories" &&
                list("banners").some((b) => b.categoryId === id)
              )
                fail("Update the banners using this category first.", 409);
              remove(kind, id);
              return send(200, { ok: true });
            }
          }
        }
      }
      fail("Endpoint not found.", 404);
    }
    if (!["GET", "HEAD"].includes(req.method)) fail("Method not allowed.", 405);
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      fail("Invalid path.");
    }
    const pub = resolve(root, "public"),
      file = resolve(pub, "." + (decoded === "/" ? "/index.html" : decoded));
    if (!file.startsWith(pub + sep)) fail("Not found.", 404);
    if (!existsSync(file) || !statSync(file).isFile()) fail("Not found.", 404);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".ico": "image/x-icon",
    };
    res.writeHead(200, {
      ...headers,
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": [".html", ".js", ".css"].includes(extname(file))
        ? "no-cache"
        : "public,max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent)
      send(e.status || 500, {
        error: e.status ? e.message : "Something went wrong. Please try again.",
      });
    else res.end();
  }
});
const cliPort = process.argv.indexOf("--port"),
  cliHost = process.argv.indexOf("--host");
server.listen(
  Number(cliPort >= 0 ? process.argv[cliPort + 1] : process.env.PORT) || 3000,
  (cliHost >= 0 ? process.argv[cliHost + 1] : process.env.HOST) || "0.0.0.0",
  () =>
    console.log(
      `Zeez Helmet Shop: http://localhost:${server.address().port} (${mode} payments)`,
    ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
