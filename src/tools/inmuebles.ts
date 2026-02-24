import axios from "axios";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";

interface BuscarInmueblesArgs {
  ciudad:        string;
  tipo:          "arriendo" | "venta";
  habitaciones?: number;
  precio_max?:   number;
  precio_min?:   number;
  zona?:         string;
  limit?:        number;
}

function formatCOP(n: number): string {
  return "$" + n.toLocaleString("es-CO") + " COP";
}

// Slugs de ciudad para Ciencuadras
const CIUDAD_SLUG: Record<string, string> = {
  "bogotá": "bogota", "bogota": "bogota",
  "medellín": "medellin", "medellin": "medellin",
  "cali": "cali",
  "barranquilla": "barranquilla",
  "bucaramanga": "bucaramanga",
  "cartagena": "cartagena-de-indias",
  "pereira": "pereira",
  "manizales": "manizales",
  "santa marta": "santa-marta",
  "villavicencio": "villavicencio",
};

// ── Scrape Ciencuadras (JSON-LD) ──────────────────────────────────────────────
async function scrapeCiencuadras(args: BuscarInmueblesArgs): Promise<any[]> {
  const ciudadSlug = CIUDAD_SLUG[args.ciudad.toLowerCase()] ?? args.ciudad.toLowerCase().replace(/\s+/g, "-");
  const tipo       = args.tipo === "arriendo" ? "arriendo" : "venta";

  let url = `https://www.ciencuadras.com/${tipo}/apartamento/${ciudadSlug}?`;
  if (args.habitaciones) url += `habitaciones=${args.habitaciones}&`;
  if (args.precio_max)   url += `precio-hasta=${args.precio_max}&`;
  if (args.precio_min)   url += `precio-desde=${args.precio_min}&`;
  if (args.zona) {
    const zonaSlug = args.zona.toLowerCase().replace(/\s+/g, "-");
    url += `barrio=${encodeURIComponent(zonaSlug)}&`;
  }

  try {
    const resp = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "es-CO,es;q=0.9",
      },
      timeout: 10000,
      maxRedirects: 5,
    });

    const html: string = resp.data;

    // Extraer JSON-LD ItemList
    const match = html.match(/\{"@context":"https:\/\/schema\.org","@type":"ItemList".*?\}<\/script>/s)
                ?? html.match(/\{"@context":"https:\/\/schema\.org","@type":"ItemList".*$/s);

    if (!match) return [];

    let jsonStr = match[0].replace(/<\/script>.*$/s, "").replace(/^[^{]+/, "");
    const data = JSON.parse(jsonStr);
    const items: any[] = data.itemListElement ?? [];

    const results: any[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const it      = item.item ?? item;
      const itemUrl = item.url ?? it.url ?? "";
      if (seen.has(itemUrl)) continue;
      seen.add(itemUrl);

      const name   = it.name ?? "";
      const offers = it.offers ?? {};
      const priceRaw = typeof offers === "object" ? (offers.price ?? 0) : 0;
      const price  = typeof priceRaw === "number" ? priceRaw : parseInt(String(priceRaw));

      // Filtrar ruido: venta mezclada en arriendo (precios > 50M), duplicados
      if (price > 50_000_000) continue;
      if (args.precio_max && price > args.precio_max) continue;
      if (args.precio_min && price < args.precio_min) continue;
      if (price === 0) continue;

      // Extraer barrio del nombre: "Apartamento en arriendo - Bogotá/Chapinero"
      const barrioMatch = name.match(/Bogotá\/(.+)$/i) ?? name.match(/Colombia\/(.+)$/i) ?? name.match(/\/(.+)$/);
      const barrio      = barrioMatch
        ? barrioMatch[1].trim().replace(/\s{2,}/g, " ")
        : "";

      results.push({
        titulo:   `Apartamento en ${tipo} — ${(barrio || args.ciudad).trim()}`,
        precio:   formatCOP(price),
        barrio:   (barrio || args.ciudad).trim(),
        link:     itemUrl,
        fuente:   "ciencuadras",
      });
    }

    return results.slice(0, args.limit ?? 8);
  } catch {
    return [];
  }
}

// ── Búsqueda via Brave (fallback + FincaRaíz) ────────────────────────────────
async function searchViaBrave(args: BuscarInmueblesArgs): Promise<any[]> {
  if (!BRAVE_API_KEY) return [];

  const hab    = args.habitaciones ? `${args.habitaciones} habitaciones` : "";
  const precio = args.precio_max   ? `menos de ${formatCOP(args.precio_max)}` : "";
  const zona   = args.zona ?? "";
  const query  = `site:fincaraiz.com.co apartamento ${args.tipo} ${args.ciudad} ${hab} ${zona} ${precio}`.trim();

  try {
    const resp = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params: { q: query, count: 5 },
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      timeout: 8000,
    });

    const results = resp.data.web?.results ?? [];
    return results
      .filter((r: any) => (r.url ?? "").includes("fincaraiz.com.co"))
      .slice(0, 3)
      .map((r: any) => ({
        titulo:      r.title?.replace(/\s*[-|]?\s*(FincaRaíz|Finca Raiz).*$/i, "").trim(),
        precio:      "Ver en portal",
        barrio:      "",
        link:        r.url,
        descripcion: (r.description ?? "").slice(0, 100),
        fuente:      "fincaraiz",
      }));
  } catch {
    return [];
  }
}

// ── Links de búsqueda ─────────────────────────────────────────────────────────
function buildPortalLinks(args: BuscarInmueblesArgs) {
  const ciudadFR = (CIUDAD_SLUG[args.ciudad.toLowerCase()] ?? args.ciudad.toLowerCase().replace(/\s+/g, "-")) + "-dc"
    .replace("bogota-dc-dc", "bogota-dc");
  const ciudadMC = CIUDAD_SLUG[args.ciudad.toLowerCase()] ?? args.ciudad.toLowerCase();
  const ciudadCC = CIUDAD_SLUG[args.ciudad.toLowerCase()] ?? args.ciudad.toLowerCase();
  const tipo     = args.tipo;

  let fr = `https://www.fincaraiz.com.co/${tipo}/apartamentos/${ciudadFR}/?`;
  if (args.habitaciones) fr += `habitaciones=${args.habitaciones}&`;
  if (args.precio_max)   fr += `precioMaximo=${args.precio_max}&`;

  let mc = `https://www.metrocuadrado.com/apartamento/${tipo}/${ciudadMC}/?`;
  if (args.habitaciones) mc += `rooms=${args.habitaciones}&`;
  if (args.precio_max)   mc += `priceMax=${args.precio_max}&`;

  let cc = `https://www.ciencuadras.com/${tipo}/apartamento/${ciudadCC}?`;
  if (args.habitaciones) cc += `habitaciones=${args.habitaciones}&`;
  if (args.precio_max)   cc += `precio-hasta=${args.precio_max}&`;

  return { fincaraiz: fr, metrocuadrado: mc, ciencuadras: cc };
}

// ── Export principal ──────────────────────────────────────────────────────────
export async function buscarInmuebles(args: BuscarInmueblesArgs) {
  const [ciencuadras, brave] = await Promise.all([
    scrapeCiencuadras(args),
    searchViaBrave(args),
  ]);

  // Ciencuadras primero (tiene precios reales), luego FincaRaíz como complemento
  const todos = [...ciencuadras, ...brave].slice(0, args.limit ?? 8);

  return {
    ciudad:           args.ciudad,
    tipo:             args.tipo,
    habitaciones:     args.habitaciones ?? "cualquiera",
    precio_max:       args.precio_max ? formatCOP(args.precio_max) : "sin límite",
    zona:             args.zona ?? "toda la ciudad",
    total_resultados: todos.length,
    propiedades:      todos,
    buscar_mas:       buildPortalLinks(args),
    nota:             "Fuente: Ciencuadras.com + FincaRaíz. Precios de referencia — confirma disponibilidad en el portal.",
  };
}
