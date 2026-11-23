import { readFileSync } from "node:fs";
export function seed(put) {
  for (const [id, name] of [
    ["axor", "AXOR"],
    ["vega", "Vega"],
    ["vegas", "Vegas"],
    ["steelbird", "Steelbird"],
  ])
    put("brands", {
      id,
      name,
      active: true,
      description:
        id === "vegas"
          ? "Ready for your own Vegas product range."
          : "Explore the " + name + " collection.",
    });
  for (const [id, name] of [
    ["full-face", "Full face"],
    ["open-face", "Open face"],
    ["flip-up", "Flip-up"],
    ["kids", "Kids"],
  ])
    put("categories", {
      id,
      name,
      description: "Find your next " + name.toLowerCase() + " helmet.",
      active: true,
    });
  for (const p of JSON.parse(
    readFileSync(new URL("./catalog.json", import.meta.url)),
  ))
    put("products", p);
  put("settings", {
    id: "store",
    name: "Zeez Helmet Shop",
    tagline: "Good rides start with the right helmet.",
    email: "hello@zeezlabs.com",
    phone: "",
    address: "Sri Lanka · Online helmet store",
    shippingFee: 450,
    freeShipping: 25000,
    announcement:
      "Islandwide delivery · Free shipping on orders over LKR 25,000",
  });
  put("banners", {
    id: "hero",
    eyebrow: "THE NEXT RIDE STARTS HERE",
    title: "Find your helmet.\nOwn your ride.",
    subtitle:
      "From the everyday commute to the open road. Find a helmet that feels as good as it looks.",
    button: "Find my helmet",
    image: "/assets/helmet-1.webp",
    categoryId: "",
    active: true,
  });
  put("banners", {
    id: "weekend",
    eyebrow: "THE WEEKEND EDIT",
    title: "More road.\nLess ordinary.",
    subtitle:
      "Standout graphics. A fresh perspective. Discover the AXOR collection.",
    button: "Explore full face",
    image: "/assets/helmet-2.webp",
    categoryId: "full-face",
    active: true,
  });
  put("banners", {
    id: "city",
    eyebrow: "MADE FOR YOUR EVERYDAY",
    title: "City miles.\nEasy style.",
    subtitle: "Keep it light with our open face collection.",
    button: "Shop open face",
    image: "/assets/helmet-8.webp",
    categoryId: "open-face",
    active: true,
  });
}
