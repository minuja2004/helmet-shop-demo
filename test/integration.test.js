import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  tmp = mkdtempSync(join(tmpdir(), "zeez-tests-")),
  children = [];
const adminPassword = randomUUID();
async function start(extra = {}, name = "demo") {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const dbPath = join(tmp, name + ".sqlite"),
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        DB_PATH: dbPath,
        NODE_ENV: "test",
        PAYMENT_MODE: "demo",
        ADMIN_EMAIL: "admin@zeezhelmets.lk",
        ADMIN_PASSWORD: adminPassword,
        PUBLIC_URL: "",
        ...extra,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  children.push(child);
  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Server startup timeout")),
      10000,
    );
    child.stdout.on("data", (d) => {
      if (String(d).includes("Zeez Helmet Shop:")) {
        clearTimeout(t);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(t);
      reject(new Error("Server exited " + code));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  function client() {
    let cookie = "",
      csrf = "";
    return {
      async request(path, method = "GET", data, headers = {}) {
        const r = await fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
            ...headers,
          },
          ...(data !== undefined
            ? { body: typeof data === "string" ? data : JSON.stringify(data) }
            : {}),
        });
        const set = r.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0];
        const text = await r.text();
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
        if (body.csrf) csrf = body.csrf;
        return { status: r.status, body, headers: r.headers };
      },
      get cookie() {
        return cookie;
      },
      get csrf() {
        return csrf;
      },
    };
  }
  return { base, dbPath, client, child };
}
let app, admin, alice, bob, catalog, p, order;
const address = {
  firstName: "Test",
  lastName: "Rider",
  phone: "0771234567",
  line1: "Test address",
  city: "Colombo",
  district: "Colombo",
  postalCode: "00100",
};
const orderData = (product, extra = {}) => ({
  items: [{ productId: product.id, size: "M", quantity: 1 }],
  address,
  paymentMethod: "card",
  idempotencyKey: randomUUID(),
  ...extra,
});
before(async () => {
  app = await start();
  admin = app.client();
  alice = app.client();
  bob = app.client();
});
after(async () => {
  for (const c of children)
    if (c.exitCode === null && c.signalCode === null) {
      c.kill("SIGTERM");
      await once(c, "exit");
    }
  rmSync(tmp, { recursive: true, force: true });
});
test("complete commerce, admin and security workflow", async (t) => {
  await t.test(
    "store returns complete demo catalogue and four requested brands",
    async () => {
      const r = await alice.request("/api/store");
      assert.equal(r.status, 200);
      catalog = r.body;
      p = catalog.products[0];
      assert.equal(catalog.products.length, 14);
      assert.deepEqual(
        catalog.brands.map((b) => b.id),
        ["axor", "vega", "vegas", "steelbird"],
      );
      assert(catalog.products.some((p) => p.categoryId === "kids"));
      assert.deepEqual(catalog.paymentMethods, ["card", "koko"]);
    },
  );
  await t.test(
    "every bundled product, logo and font asset exists",
    async () => {
      for (const p of catalog.products)
        for (const i of p.images) assert(existsSync(join(root, "public", i)));
      for (const file of [
        "/",
        "/app.js",
        "/styles.css",
        "/fonts.css",
        "/assets/logo.png",
      ])
        assert.equal((await alice.request(file)).status, 200);
      const html = readFileSync(join(root, "public/index.html"), "utf8");
      assert.equal((html.match(/id="app"/g) || []).length, 1);
      assert.equal((html.match(/<script/g) || []).length, 1);
    },
  );
  await t.test("admin routes reject anonymous access", async () => {
    assert.equal((await alice.request("/api/admin/data")).status, 401);
    assert.equal(
      (await alice.request("/api/orders", "POST", orderData(p))).status,
      401,
    );
  });
  await t.test(
    "invalid request bodies produce useful 400 responses",
    async () => {
      for (const body of ["null", "[]", "{"])
        assert.equal(
          (await alice.request("/api/auth/register", "POST", body)).status,
          400,
        );
    },
  );
  await t.test(
    "customer registration is case insensitive, password never returned",
    async () => {
      let r = await alice.request("/api/auth/register", "POST", {
        name: "Test Rider",
        email: "Alice@example.com",
        password: "TestRider!2026",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.user.email, "alice@example.com");
      assert(!r.body.user.hash);
      assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
      assert.equal(
        (
          await bob.request("/api/auth/register", "POST", {
            name: "Other",
            email: "ALICE@example.com",
            password: "TestRider!2026",
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "ordinary users cannot read admin data or set their role",
    async () => {
      assert.equal((await alice.request("/api/admin/data")).status, 403);
      const r = await bob.request("/api/auth/register", "POST", {
        name: "Other Rider",
        email: "bob@example.com",
        password: "TestRider!2026",
        role: "admin",
      });
      assert.equal(r.body.user.role, "customer");
    },
  );
  await t.test("CSRF and foreign origins are rejected", async () => {
    assert.equal(
      (
        await alice.request("/api/orders", "POST", orderData(p), {
          "X-CSRF-Token": "",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await alice.request("/api/orders", "POST", orderData(p), {
          Origin: "https://foreign.example",
        })
      ).status,
      403,
    );
  });
  await t.test("invalid addresses and quantities are rejected", async () => {
    assert.equal(
      (await alice.request("/api/orders", "POST", orderData(p, {
        address: { ...address, district: "Unknown district" },
      }))).status,
      400,
    );
    assert.equal(
      (
        await alice.request(
          "/api/orders",
          "POST",
          orderData(p, { address: { ...address, phone: "123" } }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await alice.request(
          "/api/orders",
          "POST",
          orderData(p, {
            items: [{ productId: p.id, size: "M", quantity: -2 }],
          }),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await alice.request(
          "/api/orders",
          "POST",
          orderData(p, { items: [null] }),
        )
      ).status,
      400,
    );
  });
  await t.test("shopping data follows the account across sessions", async () => {
    const item = { productId: p.id, size: "M", quantity: 2 };
    const guest = app.client();
    assert.equal((await guest.request("/api/shopping")).status, 401);
    const merge = { action: "merge", cart: [item, null], wishlist: [p.id, p.id] };
    assert.equal((await alice.request("/api/shopping", "PATCH", merge)).status, 200);
    assert.equal((await alice.request("/api/shopping", "PATCH", merge)).status, 200);
    const secondSession = app.client();
    assert.equal((await secondSession.request("/api/auth/login", "POST", {
      email: "alice@example.com",
      password: "TestRider!2026",
    })).status, 200);
    assert.deepEqual((await secondSession.request("/api/shopping")).body, {
      cart: [item], wishlist: [p.id], address: {},
    });
    assert.deepEqual((await bob.request("/api/shopping")).body, {
      cart: [], wishlist: [], address: {},
    });
  });
  await t.test(
    "order totals are server calculated and stock is reserved",
    async () => {
      const r = await alice.request(
        "/api/orders",
        "POST",
        orderData(p, {
          total: 1,
          items: [{ productId: p.id, size: "M", quantity: 1, price: 1 }],
        }),
      );
      assert.equal(r.status, 201);
      order = r.body;
      assert.equal(order.total, p.price);
      assert.equal(order.items[0].price, p.price);
      assert.equal(order.status, "pending");
      assert.deepEqual(order.shopping.cart, [{ productId: p.id, size: "M", quantity: 1 }]);
      assert.deepEqual(order.shopping.address, address);
      const data = (await alice.request("/api/store")).body;
      assert.equal(
        data.products[0].variants.find((v) => v.size === "M").stock,
        p.variants.find((v) => v.size === "M").stock - 1,
      );
    },
  );
  await t.test("checkout retries do not reserve or create twice", async () => {
    const r = await alice.request(
      "/api/orders",
      "POST",
      orderData(p, { idempotencyKey: order.key }),
    );
    assert.equal(r.body.id, order.id);
    assert.equal(r.body.shopping.cart[0].quantity, 1);
    assert.equal((await alice.request("/api/orders")).body.length, 1);
  });
  await t.test("orders are isolated by account", async () => {
    assert.equal((await bob.request("/api/orders")).body.length, 0);
    const path = "/api/orders/" + order.id;
    assert.equal((await bob.request(path)).status, 404);
    assert.equal((await alice.request(path)).body.status, "pending");
    assert.equal(
      (await bob.request("/api/orders/" + order.id + "/demo-pay", "POST", {}))
        .status,
      404,
    );
  });
  await t.test("demo payment confirmation is idempotent", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await alice.request(
        "/api/orders/" + order.id + "/demo-pay",
        "POST",
        {},
      );
      assert.equal(r.body.status, "confirmed");
      assert.equal(r.body.paymentStatus, "demo-paid");
    }
  });
  await t.test("cancellation returns stock exactly once", async () => {
    assert.equal(
      (await alice.request("/api/orders/" + order.id + "/cancel", "POST", {}))
        .body.status,
      "cancelled",
    );
    assert.equal(
      (await alice.request("/api/orders/" + order.id + "/cancel", "POST", {}))
        .status,
      400,
    );
    const data = (await alice.request("/api/store")).body;
    assert.equal(
      data.products[0].variants.find((v) => v.size === "M").stock,
      p.variants.find((v) => v.size === "M").stock,
    );
  });
  await t.test(
    "admin login works and correct password is required",
    async () => {
      assert.equal(
        (
          await admin.request("/api/auth/login", "POST", {
            email: "admin@zeezhelmets.lk",
            password: "Incorrect!2026",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await admin.request("/api/auth/login", "POST", {
            email: "admin@zeezhelmets.lk",
            password: adminPassword,
          })
        ).body.user.role,
        "admin",
      );
    },
  );
  await t.test(
    "brand, category, product and promotion support saved CRUD",
    async () => {
      const brand = (
          await admin.request("/api/admin/brands", "POST", {
            name: "Test brand",
            active: true,
          })
        ).body,
        category = (
          await admin.request("/api/admin/categories", "POST", {
            name: "Test collection",
            active: true,
          })
        ).body;
      let product = (
        await admin.request("/api/admin/products", "POST", {
          ...p,
          id: undefined,
          name: "Test helmet",
          brandId: brand.id,
          categoryId: category.id,
          price: 10000,
          comparePrice: 12000,
          variants: [{ size: "M", stock: 1 }],
        })
      ).body;
      assert(product.id);
      assert.equal(
        (await admin.request("/api/admin/brands/" + brand.id, "DELETE")).status,
        409,
      );
      product = (
        await admin.request("/api/admin/products/" + product.id, "PUT", {
          ...product,
          price: 10500,
        })
      ).body;
      assert.equal(product.price, 10500);
      const banner = (
        await admin.request("/api/admin/banners", "POST", {
          title: "Test promotion",
          image: p.images[0],
          categoryId: category.id,
          active: true,
        })
      ).body;
      assert(banner.id);
      assert.equal(
        (
          await admin.request("/api/admin/banners/" + banner.id, "PUT", {
            ...banner,
            title: "Updated promotion",
          })
        ).body.title,
        "Updated promotion",
      );
      assert.equal(
        (await admin.request("/api/admin/products/" + product.id, "DELETE"))
          .status,
        200,
      );
      assert.equal(
        (await admin.request("/api/admin/banners/" + banner.id, "DELETE"))
          .status,
        200,
      );
      assert.equal(
        (await admin.request("/api/admin/categories/" + category.id, "DELETE"))
          .status,
        200,
      );
      assert.equal(
        (await admin.request("/api/admin/brands/" + brand.id, "DELETE")).status,
        200,
      );
    },
  );
  await t.test(
    "overselling and duplicate bag rows roll back the whole transaction",
    async () => {
      const r = await alice.request(
        "/api/orders",
        "POST",
        orderData(p, {
          items: [
            { productId: p.id, size: "M", quantity: 1 },
            { productId: p.id, size: "M", quantity: 1 },
          ],
        }),
      );
      assert.equal(r.status, 400);
      const before = (
        await alice.request("/api/store")
      ).body.products[0].variants.find((v) => v.size === "M").stock;
      const results = await Promise.all(
        Array.from({ length: before + 2 }, () =>
          alice.request("/api/orders", "POST", orderData(p)),
        ),
      );
      assert.equal(results.filter((r) => r.status === 201).length, before);
      assert.equal(results.filter((r) => r.status === 409).length, 2);
      for (const r of results.filter((r) => r.status === 201))
        await alice.request("/api/orders/" + r.body.id + "/cancel", "POST", {});
    },
  );
  await t.test(
    "customer CRUD protects administrators and order history",
    async () => {
      const u = (
        await admin.request("/api/admin/users", "POST", {
          name: "Editable Customer",
          email: "edit@example.com",
          password: "Customer!2026",
        })
      ).body;
      assert(u.id);
      assert.equal(
        (
          await admin.request("/api/admin/users/" + u.id, "PUT", {
            name: "Edited",
            email: "edited@example.com",
          })
        ).body.name,
        "Edited",
      );
      assert.equal(
        (await admin.request("/api/admin/users/" + u.id, "DELETE")).status,
        200,
      );
      const data = (await admin.request("/api/admin/data")).body;
      assert.equal(
        (
          await admin.request(
            "/api/admin/users/" + data.users.find((u) => u.role === "admin").id,
            "DELETE",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await admin.request(
            "/api/admin/users/" +
              data.users.find((u) => u.email === "alice@example.com").id,
            "DELETE",
          )
        ).status,
        400,
      );
    },
  );
  await t.test(
    "order administration follows valid fulfilment transitions",
    async () => {
      const o = (
        await alice.request(
          "/api/orders",
          "POST",
          orderData(p, { paymentMethod: "koko" }),
        )
      ).body;
      await alice.request("/api/orders/" + o.id + "/demo-pay", "POST", {});
      assert.equal(
        (
          await admin.request("/api/admin/orders/" + o.id, "PUT", {
            status: "delivered",
          })
        ).status,
        400,
      );
      for (const status of ["processing", "shipped", "delivered"])
        assert.equal(
          (await admin.request("/api/admin/orders/" + o.id, "PUT", { status }))
            .body.status,
          status,
        );
      assert.equal(
        (await admin.request("/api/admin/orders/" + o.id, "DELETE")).status,
        400,
      );
      assert.equal(
        (await admin.request("/api/admin/orders/" + order.id, "DELETE")).status,
        200,
      );
    },
  );
  await t.test("unpaid reservations expire and cannot be paid", async () => {
    const o = (await alice.request("/api/orders", "POST", orderData(p))).body;
    const db = new DatabaseSync(app.dbPath);
    o.created = new Date(Date.now() - 31 * 60000).toISOString();
    db.prepare("UPDATE records SET data=? WHERE kind=? AND id=?").run(
      JSON.stringify(o),
      "orders",
      o.id,
    );
    db.close();
    assert.equal(
      (await alice.request("/api/orders/" + o.id + "/demo-pay", "POST", {}))
        .status,
      409,
    );
    assert.equal(
      (await alice.request("/api/orders")).body.find((r) => r.id === o.id)
        .status,
      "expired",
    );
  });
  await t.test("store settings persist and unsafe uploads fail", async () => {
    const s = (await admin.request("/api/admin/data")).body.settings;
    assert.equal(
      (
        await admin.request("/api/admin/settings", "PUT", {
          ...s,
          announcement: "Updated for a retailer",
        })
      ).body.announcement,
      "Updated for a retailer",
    );
    assert.equal(
      (
        await admin.request("/api/admin/upload", "POST", {
          data: Buffer.from("<svg><script>alert(1)</script></svg>").toString(
            "base64",
          ),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin.request("/api/admin/products", "POST", {
          ...p,
          images: ["javascript:alert(1)"],
        })
      ).status,
      400,
    );
  });
  await t.test(
    "database survives a restart and logout invalidates session",
    async () => {
      app.child.kill("SIGTERM");
      await once(app.child, "exit");
      const port = Number(new URL(app.base).port);
      const child = spawn(process.execPath, ["src/server.js"], {
        cwd: root,
        env: {
          ...process.env,
          PORT: String(port),
          DB_PATH: app.dbPath,
          NODE_ENV: "test",
          PAYMENT_MODE: "demo",
          PUBLIC_URL: "",
          ADMIN_PASSWORD: adminPassword,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      await new Promise((r) =>
        child.stdout.on(
          "data",
          (d) => String(d).includes("Zeez Helmet Shop:") && r(),
        ),
      );
      assert.equal(
        (await alice.request("/api/store")).body.settings.announcement,
        "Updated for a retailer",
      );
      assert((await alice.request("/api/orders")).body.length > 0);
      assert.deepEqual((await alice.request("/api/shopping")).body.wishlist, [p.id]);
      assert.equal(
        (await alice.request("/api/auth/logout", "POST", {})).status,
        200,
      );
      assert.equal((await alice.request("/api/orders")).status, 401);
    },
  );
});
const md5 = (x) => createHash("md5").update(x).digest("hex").toUpperCase();
test("configured PayHere adapter verifies signatures, totals and duplicate notifications", async () => {
  const app = await start(
      {
        PAYMENT_MODE: "payhere",
        PAYHERE_MERCHANT_ID: "TEST123",
        PAYHERE_MERCHANT_SECRET: "test-only-secret",
        PUBLIC_URL: "https://test.example",
      },
      "payhere",
    ),
    c = app.client();
  await c.request("/api/auth/register", "POST", {
    name: "Card Test",
    email: "card@example.com",
    password: "CardTest!2026",
  });
  const store = (await c.request("/api/store")).body;
  assert.deepEqual(store.paymentMethods, ["card"]);
  const p = store.products[0];
  assert.equal(
    (
      await c.request(
        "/api/orders",
        "POST",
        orderData(p, { paymentMethod: "koko" }),
      )
    ).status,
    400,
  );
  const o = (await c.request("/api/orders", "POST", orderData(p))).body;
  const payment = (
    await c.request("/api/orders/" + o.id + "/payment", "POST", {})
  ).body;
  assert.equal(payment.action, "https://sandbox.payhere.lk/pay/checkout");
  assert.equal(payment.fields.return_url, "https://test.example/#success/" + o.id);
  assert.equal(
    payment.fields.hash,
    md5(
      "TEST123" + o.id + o.total.toFixed(2) + "LKR" + md5("test-only-secret"),
    ),
  );
  assert.equal(
    (await c.request("/api/orders/" + o.id + "/demo-pay", "POST", {})).status,
    403,
  );
  const notify = {
    merchant_id: "TEST123",
    order_id: o.id,
    payhere_amount: o.total.toFixed(2),
    payhere_currency: "LKR",
    status_code: "2",
    payment_id: "TEST_PAYMENT",
  };
  const sign = (n) =>
    md5(
      n.merchant_id +
        n.order_id +
        n.payhere_amount +
        n.payhere_currency +
        n.status_code +
        md5("test-only-secret"),
    );
  const anonymous = app.client();
  assert.equal(
    (
      await anonymous.request("/api/payments/payhere/notify", "POST", {
        ...notify,
        md5sig: "0".repeat(32),
      })
    ).status,
    403,
  );
  const wrong = { ...notify, payhere_amount: "1.00" };
  assert.equal(
    (
      await anonymous.request("/api/payments/payhere/notify", "POST", {
        ...wrong,
        md5sig: sign(wrong),
      })
    ).status,
    400,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await anonymous.request(
          "/api/payments/payhere/notify",
          "POST",
          new URLSearchParams({ ...notify, md5sig: sign(notify) }).toString(),
          { "Content-Type": "application/x-www-form-urlencoded" },
        )
      ).status,
      200,
    );
  assert.equal((await c.request("/api/orders")).body[0].paymentStatus, "paid");
  assert.equal(
    (await c.request("/api/orders/" + o.id + "/cancel", "POST", {})).status,
    409,
  );
  const chargeback = { ...notify, status_code: "-3" };
  assert.equal(
    (
      await anonymous.request("/api/payments/payhere/notify", "POST", {
        ...chargeback,
        md5sig: sign(chargeback),
      })
    ).status,
    200,
  );
  assert.equal(
    (await c.request("/api/orders")).body[0].status,
    "payment-review",
  );
  assert.equal(
    (
      await anonymous.request("/api/payments/payhere/notify", "POST", {
        ...notify,
        md5sig: sign(notify),
      })
    ).status,
    200,
  );
  assert.equal(
    (await c.request("/api/orders")).body[0].paymentStatus,
    "chargeback",
  );
  const late = (await c.request("/api/orders", "POST", orderData(p))).body;
  await c.request("/api/orders/" + late.id + "/cancel", "POST", {});
  const lateNotify = {
    ...notify,
    order_id: late.id,
    payment_id: "LATE_PAYMENT",
  };
  assert.equal(
    (
      await anonymous.request("/api/payments/payhere/notify", "POST", {
        ...lateNotify,
        md5sig: sign(lateNotify),
      })
    ).status,
    200,
  );
  assert.equal(
    (await c.request("/api/orders")).body.find((o) => o.id === late.id).status,
    "payment-review",
  );
  const overdue = (await c.request("/api/orders", "POST", orderData(p))).body;
  const db = new DatabaseSync(app.dbPath);
  const { shopping, ...record } = overdue;
  record.created = new Date(Date.now() - 31 * 60_000).toISOString();
  db.prepare("UPDATE records SET data=? WHERE kind='orders' AND id=?")
    .run(JSON.stringify(record), overdue.id);
  db.close();
  const overdueNotify = { ...notify, order_id: overdue.id, payment_id: "OVERDUE" };
  assert.equal(
    (await anonymous.request("/api/payments/payhere/notify", "POST", {
      ...overdueNotify,
      md5sig: sign(overdueNotify),
    })).status,
    200,
  );
  assert.equal(
    (await c.request("/api/orders/" + overdue.id)).body.status,
    "payment-review",
  );
});
