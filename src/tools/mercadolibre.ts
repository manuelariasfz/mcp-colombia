import axios from "axios";

// ── Configuración ──────────────────────────────────────────────────────────
const ML_AFFILIATE_ID   = process.env.ML_AFFILIATE_ID   || "";
const ML_AFFILIATE_NAME = process.env.ML_AFFILIATE_NAME || "";
const ML_CLIENT_ID      = process.env.ML_CLIENT_ID || "";
const ML_CLIENT_SECRET  = process.env.ML_CLIENT_SECRET || "";
const ML_ACCESS_TOKEN   = process.env.ML_ACCESS_TOKEN || "";
const BRAVE_API_KEY     = process.env.BRAVE_API_KEY || "";

let _tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string | null> {
  if (ML_ACCESS_TOKEN) return ML_ACCESS_TOKEN;
  if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) return null;
  if (_tokenCache && Date.now() < _tokenCache.exp) return _tokenCache.token;
  try {
    const resp = await axios.post("https://api.mercadolibre.com/oauth/token", null, {
      params: { grant_type: "client_credentials", client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET },
      timeout: 6000,
    });
    _tokenCache = { token: resp.data.access_token, exp: Date.now() + (resp.data.expires_in - 60) * 1000 };
    return _tokenCache.token;
  } catch { return null; }
}

function buildAffiliateUrl(url: string): string {
  if (!ML_AFFILIATE_ID || !url) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("matt_tool", ML_AFFILIATE_ID);
    if (ML_AFFILIATE_NAME) u.searchParams.set("matt_word", ML_AFFILIATE_NAME);
    return u.toString();
  } catch { return url; }
}

// ── Scrape precio de página ML cuando la API no responde ──────────────────
async function scrapePriceFromPage(url: string): Promise<string | null> {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" },
      timeout: 6000,
    });
    const html: string = resp.data;
    // Buscar precio significativo (>10,000 COP para evitar falsos positivos)
    const matches = [...html.matchAll(/"price":(\d+)/g)].map(m => parseInt(m[1])).filter(p => p > 10000);
    if (matches.length) return `$${matches[0].toLocaleString("es-CO")} COP`;
    return null;
  } catch { return null; }
}

// ── Buscar via Brave Search API ─────────────────────────────────────────────
async function searchViaBrave(query: string, limit: number): Promise<any[]> {
  if (!BRAVE_API_KEY) return [];
  try {
    // Buscar primero en articulo.mercadolibre.com.co (productos individuales con precio en HTML)
    const resp = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params: { q: `site:articulo.mercadolibre.com.co ${query}`, count: Math.min(limit + 2, 10) },
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      timeout: 8000,
    });
    const results = resp.data.web?.results ?? [];
    return results
      .filter((r: any) => (r.url ?? "").includes("articulo.mercadolibre.com.co"))
      .slice(0, limit)
      .map((r: any) => {
        const priceMatch = r.description?.match(/[\$\s]*([\d.,]+\.[\d]{3})/);
        const price = priceMatch ? priceMatch[1].replace(/\./g,"") : null;
        const idMatch = (r.url ?? "").match(/MCO-?(\d+)/i);
        return {
          titulo:      r.title?.replace(/ ?[|-]? ?(?:MercadoLibre|Cuotas sin interés).*$/i,"").trim(),
          precio:      price ? `$${parseInt(price).toLocaleString("es-CO")} COP` : "Ver en ML",
          link:        buildAffiliateUrl(r.url ?? ""),
          item_id:     idMatch ? `MCO${idMatch[1]}` : null,
          descripcion: r.description?.slice(0, 120),
        };
      });
  } catch { return []; }
}

// ── Buscar via ML API ──────────────────────────────────────────────────────
async function searchViaAPI(query: string, limit: number, opts: any): Promise<any[] | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const params: Record<string, any> = { q: query, limit };
    if (opts.precio_min && opts.precio_max) params.price = `${opts.precio_min}-${opts.precio_max}`;
    else if (opts.precio_min) params.price = `${opts.precio_min}-`;
    else if (opts.precio_max) params.price = `*-${opts.precio_max}`;
    if (opts.ordenar === "precio_asc")  params.sort = "price_asc";
    if (opts.ordenar === "precio_desc") params.sort = "price_desc";

    const resp = await axios.get("https://api.mercadolibre.com/sites/MCO/search", {
      params, headers: { Authorization: `Bearer ${token}` }, timeout: 8000,
    });
    const items = resp.data.results ?? [];
    if (!items.length) return null;

    return items.map((item: any) => ({
      titulo:       item.title,
      precio:       `$${Number(item.price).toLocaleString("es-CO")} COP`,
      condicion:    item.condition === "new" ? "Nuevo" : "Usado",
      vendedor:     item.seller?.nickname ?? "—",
      envio_gratis: item.shipping?.free_shipping ?? false,
      ventas:       item.sold_quantity ?? 0,
      imagen:       item.thumbnail?.replace("I.jpg", "O.jpg"),
      item_id:      item.id,
      link:         buildAffiliateUrl(item.permalink),
    }));
  } catch { return null; }
}

// ── Buscar productos públicos ──────────────────────────────────────────────
export async function searchProducts(args: {
  query:      string;
  categoria?: string;
  limit?:     number;
  precio_min?: number;
  precio_max?: number;
  ordenar?:   "precio_asc" | "precio_desc" | "relevancia";
}) {
  const { query, limit = 5 } = args;

  let productos = await searchViaAPI(query, limit, args);
  let fuente = "ml_api";

  if (!productos) {
    productos = await searchViaBrave(query, limit);
    fuente = "brave_search";
  }

  const searchUrl = buildAffiliateUrl(
    `https://listado.mercadolibre.com.co/${encodeURIComponent(query.replace(/ /g,"-"))}`
  );

  if (!productos || productos.length === 0) {
    return { query, productos: [], buscar_directamente: searchUrl,
             mensaje: "Busca directamente en MercadoLibre Colombia." };
  }

  // Enriquecer con precios reales para artículos directos (MCO-XXXXXXX)
  if (fuente === "brave_search") {
    await Promise.all(productos.map(async (p: any) => {
      if (p.precio === "Ver en ML" && p.link?.includes("mercadolibre.com.co") &&
          (p.link.includes("articulo.mercadolibre") || p.link.includes("/p/MCO"))) {
        const price = await scrapePriceFromPage(p.link);
        if (price) p.precio = price;
      }
    }));
  }

  return { total: productos.length, query, fuente, productos,
           afiliado_activo: !!ML_AFFILIATE_ID, buscar_mas: searchUrl };
}

// ── Detalle de producto ─────────────────────────────────────────────────────
export async function getProduct(args: { item_id: string }) {
  const token = await getToken();
  if (!token) return {
    mensaje: "Requiere ML_CLIENT_ID y ML_CLIENT_SECRET.",
    link: buildAffiliateUrl(`https://www.mercadolibre.com.co/p/${args.item_id}`),
  };
  try {
    const resp = await axios.get(`https://api.mercadolibre.com/items/${args.item_id}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 8000,
    });
    const item = resp.data;
    return {
      titulo:     item.title,
      precio:     `$${Number(item.price).toLocaleString("es-CO")} COP`,
      condicion:  item.condition === "new" ? "Nuevo" : "Usado",
      disponible: item.available_quantity,
      garantia:   item.warranty ?? "No especificada",
      atributos:  (item.attributes ?? []).slice(0, 8).map((a: any) => `${a.name}: ${a.value_name}`),
      link:       buildAffiliateUrl(item.permalink),
      imagenes:   (item.pictures ?? []).slice(0, 3).map((p: any) => p.url),
    };
  } catch (e: any) {
    return { error: e.message, item_id: args.item_id };
  }
}
