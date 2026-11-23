import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
const root = resolve(import.meta.dirname, "..");
const adminPassword = randomUUID();
async function until(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("UI state did not settle: " + String(fn));
}
test("customer and admin DOM workflows against the real Node API", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "zeez-ui-")),
    probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DB_PATH: join(tmp, "ui.sqlite"),
      NODE_ENV: "test",
      PUBLIC_URL: base,
      PAYMENT_MODE: "demo",
      ADMIN_EMAIL: "admin@zeezhelmets.lk",
      ADMIN_PASSWORD: adminPassword,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((res, rej) => {
    const timer = setTimeout(
      () => rej(new Error("UI server startup timeout")),
      10000,
    );
    child.stdout.on("data", (d) => {
      if (String(d).includes("Zeez Helmet Shop:")) {
        clearTimeout(timer);
        res();
      }
    });
  });
  const errors = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(readFileSync(join(root, "public/index.html"), "utf8"), {
    url: base,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window,
    d = w.document;
  let cookie = "";
  w.scrollTo = () => {};
  w.crypto.randomUUID = randomUUID;
  w.fetch = async (path, options = {}) => {
    const r = await fetch(new URL(path, base), {
      ...options,
      headers: {
        ...options.headers,
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const c = r.headers.get("set-cookie");
    if (c) cookie = c.split(";")[0];
    return r;
  };
  const $ = (s) => d.querySelector(s),
    click = (s) => {
      const el = $(s);
      assert(el, "Missing " + s);
      el.click();
    },
    submit = (s) => {
      const form = $(s);
      assert(form, "Missing " + s);
      form.dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    },
    fill = (s, value) => {
      const el = $(s);
      assert(el, "Missing " + s);
      el.value = value;
    },
    route = async (hash) => {
      w.location.hash = hash;
      await until(() => !!$("#main-content"));
      await new Promise((r) => setTimeout(r, 30));
    };
  try {
    w.eval(readFileSync(join(root, "public/app.js"), "utf8"));
    await until(() => !!$(".hero"));
    await t.test(
      "home renders one header, complete image cards and no duplicate IDs",
      () => {
        assert.equal(d.querySelectorAll("header").length, 1);
        assert.equal(d.querySelectorAll(".logo").length, 1);
        assert.equal(
          d.querySelectorAll(".products-grid .product-card").length,
          4,
        );
        assert.match($(".hero h1").textContent, /Find your helmet/);
        const ids = [...d.querySelectorAll("[id]")].map((x) => x.id);
        assert.equal(new Set(ids).size, ids.length);
      },
    );
    await t.test(
      "catalogue search and combined brand/size filters work",
      async () => {
        await route("shop?brand=vega&size=M");
        assert.equal(d.querySelectorAll(".product-card").length, 5);
        fill("#catalog-search input", "JET");
        submit("#catalog-search");
        await until(() =>
          $(".page-heading h1")?.textContent.includes("Results for"),
        );
        assert.equal(d.querySelectorAll(".product-card").length, 1);
      },
    );
    await t.test(
      "product gallery, size validation and bag flow work",
      async () => {
        await route("product/helmet-1");
        click("#add-to-bag");
        assert.match($(".toast").textContent, /Choose/);
        click('[data-size="M"]');
        click('[data-gallery="/assets/helmet-1-alt.webp"]');
        assert.equal(
          $("#detail-image").getAttribute("src"),
          "/assets/helmet-1-alt.webp",
        );
        click("#add-to-bag");
        assert.match($(".toast").textContent, /Added/);
        await route("cart");
        assert.equal(d.querySelectorAll(".bag-item").length, 1);
        assert.match($(".summary-total").textContent, /28,500/);
      },
    );
    await t.test("wishlist persists without an account", async () => {
      await route("product/helmet-1");
      click('[data-wish="helmet-1"]');
      await route("wishlist");
      assert.equal(d.querySelectorAll(".product-card").length, 1);
      click('[data-wish="helmet-1"]');
      await until(() => !!$(".empty"));
    });
    await t.test(
      "checkout registration returns to the delivery form",
      async () => {
        await route("checkout");
        click("[data-auth-toggle]");
        assert($('#auth-form input[name="name"]'));
        fill('[name="name"]', "UI Rider");
        fill('[name="email"]', "ui@example.com");
        fill('[name="password"]', "UITest!2026");
        submit("#auth-form");
        await until(() => !!$("#checkout-form"));
        assert.match($("#main-content h1").textContent, /Ready/);
      },
    );
    await t.test(
      "address + Koko demo payment creates an order and confirmation",
      async () => {
        for (const [name, value] of Object.entries({
          firstName: "UI",
          lastName: "Rider",
          phone: "0771234567",
          line1: "Example test road",
          city: "Colombo",
          district: "Colombo",
          postalCode: "00100",
        }))
          fill(`[name="${name}"]`, value);
        $('[name="paymentMethod"][value="koko"]').checked = true;
        $('[name="terms"]').checked = true;
        submit("#checkout-form");
        await until(() => !!$("#confirm-demo-payment"));
        assert.match($(".modal").textContent, /Koko/);
        assert.match($(".modal").textContent, /No money is charged/);
        click("#confirm-demo-payment");
        await until(() => !!$(".success-panel"));
        assert.match($(".success-panel").textContent, /confirmed/);
      },
    );
    await t.test("order cancellation updates account history", async () => {
      await route("account");
      assert.equal(d.querySelectorAll(".order-card").length, 1);
      assert.match($(".order-card").textContent, /demo/i);
      click("[data-cancel-order]");
      click("#confirm-action");
      await until(() => $(".order-card .pill")?.textContent === "cancelled");
    });
    await t.test(
      "admin sign in renders dashboard and search works",
      async () => {
        click("[data-logout]");
        await until(() => !!$("#auth-form"));
        await route("admin");
        fill('[name="email"]', "admin@zeezhelmets.lk");
        fill('[name="password"]', adminPassword);
        submit("#auth-form");
        await until(() => !!$(".admin-shell"));
        assert.equal(d.querySelectorAll(".stat-grid .stat").length, 4);
        await route("admin/products");
        fill("#admin-search", "Apex Scratch");
        $("#admin-search").dispatchEvent(
          new w.Event("input", { bubbles: true }),
        );
        assert.equal(d.querySelectorAll("tbody tr").length, 1);
      },
    );
    await t.test(
      "product editor persists changes and validates stock variants",
      async () => {
        click('[data-admin-edit="products"]');
        fill('#admin-editor [name="name"]', "Updated UI Helmet");
        fill('#admin-editor [name="price"]', "27500");
        fill('[name="stock_M"]', "9");
        submit("#admin-editor");
        await until(
          () =>
            !$(".modal") &&
            $("#admin-table").textContent.includes("Updated UI Helmet"),
        );
        assert.match($("#admin-table").textContent, /Updated UI Helmet/);
        assert.match($("#admin-table").textContent, /27,500/);
      },
    );
    await t.test(
      "category create, edit and delete all work through forms",
      async () => {
        await route("admin/categories");
        click("[data-admin-add]");
        fill('#admin-editor [name="name"]', "UI Collection");
        submit("#admin-editor");
        await until(
          () =>
            !$(".modal") &&
            $("#admin-table").textContent.includes("UI Collection"),
        );
        const row = [...d.querySelectorAll("tbody tr")].find((r) =>
          r.textContent.includes("UI Collection"),
        );
        assert(row);
        row.querySelector("[data-admin-edit]").click();
        fill('#admin-editor [name="name"]', "UI Collection Updated");
        submit("#admin-editor");
        await until(
          () =>
            !$(".modal") &&
            $("#admin-table").textContent.includes("UI Collection Updated"),
        );
        const updated = [...d.querySelectorAll("tbody tr")].find((r) =>
          r.textContent.includes("UI Collection Updated"),
        );
        updated.querySelector("[data-admin-delete]").click();
        click("#confirm-action");
        await until(
          () =>
            !$("#admin-table").textContent.includes("UI Collection Updated"),
        );
      },
    );
    await t.test("promotion editor and store settings persist", async () => {
      await route("admin/banners");
      click("[data-admin-edit]");
      fill('[name="title"]', "UI promotion");
      submit("#admin-editor");
      await until(
        () =>
          !$(".modal") &&
          $("#admin-table").textContent.includes("UI promotion"),
      );
      assert.match($("#admin-table").textContent, /UI promotion/);
      await route("admin/settings");
      fill('[name="announcement"]', "Retailer announcement");
      submit("#settings-form");
      await until(() =>
        $(".topbar").textContent.includes("Retailer announcement"),
      );
    });
    await t.test("customer editor creates and updates records", async () => {
      await route("admin/users");
      click("[data-admin-add]");
      fill('#admin-editor [name="name"]', "New UI Customer");
      fill('#admin-editor [name="email"]', "new-ui@example.com");
      fill('#admin-editor [name="password"]', "CustomerUI!2026");
      submit("#admin-editor");
      await until(() =>
        $("#admin-table").textContent.includes("New UI Customer"),
      );
      assert.match($("#admin-table").textContent, /New UI Customer/);
    });
    await t.test(
      "all help pages and modal keyboard closing render correctly",
      async () => {
        await route("guide");
        assert($(".modal table"));
        d.dispatchEvent(
          new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        assert(!$(".modal"));
        for (const page of ["delivery", "privacy", "brands"]) {
          await route(page);
          assert(
            !$("#main-content").textContent.includes(
              "Something needs a moment",
            ),
          );
        }
      },
    );
    await t.test("no uncaught DOM errors during the flows", () =>
      assert.deepEqual(errors, []),
    );
  } finally {
    w.close();
    child.kill("SIGTERM");
    await once(child, "exit");
    rmSync(tmp, { recursive: true, force: true });
  }
});
