import axios from "axios";

// ── Config ─────────────────────────────────────────────────────────────────
const AWIN_PUBLISHER_ID  = "2784246";
const BOOKING_MERCHANT   = "6776";
const BRAVE_API_KEY      = process.env.BRAVE_API_KEY || "";

function awinLink(destinationUrl: string): string {
  return `https://www.awin1.com/cread.php?awinmid=${BOOKING_MERCHANT}&awinaffid=${AWIN_PUBLISHER_ID}&ued=${encodeURIComponent(destinationUrl)}`;
}

const CO_CITIES: Record<string, string> = {
  bogota: "-554521", medellin: "-573949", cartagena: "-570867",
  cali: "-554874", barranquilla: "-553173", "santa marta": "-574455",
  pereira: "-573819", manizales: "-573469", bucaramanga: "-553955",
  "san andres": "-574153", villavicencio: "-574611", armenia: "-553573",
};

function citySlug(ciudad: string) {
  return ciudad.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// ── Fetch de hoteles reales desde Booking.com ─────────────────────────────
async function fetchBookingHotels(
  ciudad: string, checkin: string, checkout: string,
  adultos: number, habitaciones: number, dest_id: string | null,
  precio_max?: number,
): Promise<any[]> {
  // Intentar la API de búsqueda de Booking.com (retorna JSON en headers adecuados)
  try {
    const params: Record<string, any> = {
      ss:             ciudad,
      checkin,
      checkout,
      group_adults:   adultos,
      no_rooms:       habitaciones,
      lang:           "es",
      selected_currency: "COP",
      rows:           10,
      offset:         0,
      shp:            true,
    };
    if (dest_id) { params.dest_id = dest_id; params.dest_type = "city"; }
    if (precio_max) params.nflt = `price%3DCOP-min-${precio_max}-1`;

    const resp = await axios.get("https://www.booking.com/searchresults.html", {
      params,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept":     "text/html,application/xhtml+xml",
        "Accept-Language": "es-CO,es;q=0.9",
      },
      timeout: 10000,
    });

    const html: string = resp.data;

    // Extraer JSON-LD de hoteles (schema.org Hotel)
    const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const hotels: any[] = [];

    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item["@type"] === "Hotel" || item["@type"] === "LodgingBusiness") {
            const priceMatch = html.match(/data-price="(\d+)"/);
            hotels.push({
              nombre:        item.name ?? "Hotel",
              estrellas:     item.starRating?.ratingValue ?? "N/A",
              zona:          item.address?.addressLocality ?? ciudad,
              descripcion:   item.description?.slice(0, 120),
              precio_desde:  priceMatch ? `${parseInt(priceMatch[1]).toLocaleString("es-CO")} COP/noche` : "Ver en Booking",
              link:          item.url ? awinLink(item.url) : null,
            });
          }
        }
      } catch { /* skip */ }
    }

    if (hotels.length > 0) return hotels.slice(0, 6);
  } catch { /* fall through */ }

  return [];
}

// ── Buscar hoteles via Brave Search (datos reales) ─────────────────────────
async function searchHotelsBrave(
  ciudad: string, checkin: string, checkout: string,
): Promise<any[]> {
  if (!BRAVE_API_KEY) return [];
  try {
    const query = `hoteles ${ciudad} booking.com ${checkin} precio noche COP`;
    const resp = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params: { q: query, count: 8 },
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
      timeout: 8000,
    });

    const results = resp.data.web?.results ?? [];
    return results
      .filter((r: any) => r.url?.includes("booking.com"))
      .slice(0, 5)
      .map((r: any) => {
        // Extraer precio del snippet si aparece
        const priceMatch = r.description?.match(/(\d[\d.,]+)\s*(?:COP|cop|pesos?)(?:\s*\/\s*noche)?/i);
        const price = priceMatch ? `${parseInt(priceMatch[1].replace(/[.,]/g,"")).toLocaleString("es-CO")} COP/noche` : null;

        // Extraer nombre del hotel del título
        const name = r.title?.replace(/ ?[|-]? ?(?:Booking\.com|Reservas?|Hotel?s?).*$/i,"").trim();

        return {
          nombre:       name ?? r.title,
          precio_desde: price ?? "Ver precio en Booking",
          descripcion:  r.description?.slice(0, 150),
          link:         awinLink(r.url),
        };
      })
      .filter((h: any) => h.nombre?.length > 2);
  } catch { return []; }
}

// ── Datos curados de respaldo ──────────────────────────────────────────────
const HOTELES_CURADOS: Record<string, any[]> = {
  bogota: [
    { nombre: "Hotel Sofitel Bogotá Victoria Regia",  estrellas: 5, zona: "Chapinero",       precio_desde: "~450.000 COP/noche" },
    { nombre: "Hotel Click Clack",                    estrellas: 4, zona: "Chapinero",       precio_desde: "~280.000 COP/noche" },
    { nombre: "NH Collection Bogotá Royal",           estrellas: 5, zona: "Zona Rosa",       precio_desde: "~520.000 COP/noche" },
    { nombre: "Hotel Cosmos 100",                     estrellas: 4, zona: "Chapinero Norte", precio_desde: "~220.000 COP/noche" },
  ],
  cartagena: [
    { nombre: "Hotel Las Américas",    estrellas: 5, zona: "Bocagrande",        precio_desde: "~650.000 COP/noche" },
    { nombre: "Bastión Luxury Hotel",  estrellas: 5, zona: "Ciudad Amurallada", precio_desde: "~800.000 COP/noche" },
    { nombre: "Ananda Hotel Boutique", estrellas: 4, zona: "Getsemaní",         precio_desde: "~280.000 COP/noche" },
  ],
  medellin: [
    { nombre: "Hotel Dann Carlton",  estrellas: 5, zona: "El Poblado", precio_desde: "~380.000 COP/noche" },
    { nombre: "The Charlee Hotel",   estrellas: 4, zona: "El Poblado", precio_desde: "~420.000 COP/noche" },
    { nombre: "Hotel Park 10",       estrellas: 4, zona: "El Poblado", precio_desde: "~260.000 COP/noche" },
  ],
  cali:          [{ nombre: "Hotel Dann Carlton Cali",         estrellas: 5, zona: "Norte",       precio_desde: "~320.000 COP/noche" }],
  "santa marta": [{ nombre: "Irotama Resort",                   estrellas: 5, zona: "El Rodadero", precio_desde: "~450.000 COP/noche" }],
  "san andres":  [{ nombre: "Decameron Aquarium",               estrellas: 4, zona: "San Luis",    precio_desde: "~600.000 COP/noche" }],
  barranquilla:  [{ nombre: "Hotel Dann Carlton Barranquilla",  estrellas: 5, zona: "El Prado",    precio_desde: "~350.000 COP/noche" }],
};

// ── Tool principal: searchHotels ───────────────────────────────────────────
export async function searchHotels(args: {
  ciudad:        string;
  checkin:       string;
  checkout:      string;
  adultos?:      number;
  habitaciones?: number;
  precio_max?:   number;
}) {
  const { ciudad, checkin, checkout, adultos = 2, habitaciones = 1, precio_max } = args;
  const slug    = citySlug(ciudad);
  const dest_id = CO_CITIES[slug] ?? null;
  const noches  = Math.round(
    (new Date(checkout).getTime() - new Date(checkin).getTime()) / 86400000
  );

  const bookingBase = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(ciudad)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adultos}&no_rooms=${habitaciones}${dest_id ? `&dest_id=${dest_id}&dest_type=city` : ""}`;
  const searchUrl   = awinLink(bookingBase);

  // 1. Intentar datos reales desde Booking.com
  let hoteles = await fetchBookingHotels(ciudad, checkin, checkout, adultos, habitaciones, dest_id, precio_max);

  // 2. Si no hay datos, usar Brave Search
  if (hoteles.length === 0) {
    hoteles = await searchHotelsBrave(ciudad, checkin, checkout);
  }

  // 3. Fallback a datos curados
  const fuente = hoteles.length > 0 ? "tiempo_real" : "curados";
  if (hoteles.length === 0) {
    hoteles = (HOTELES_CURADOS[slug] ?? []).map(h => ({
      ...h,
      link: awinLink(`https://www.booking.com/search.html?ss=${encodeURIComponent(h.nombre)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adultos}`),
    }));
  }

  return {
    ciudad,
    checkin,
    checkout,
    noches,
    adultos,
    habitaciones,
    buscar_todos_en_booking: searchUrl,
    hoteles,
    fuente,
    nota: fuente === "tiempo_real"
      ? "✅ Precios en tiempo real obtenidos de Booking.com."
      : "⚠️ Precios aproximados — abre el link de Booking para ver disponibilidad exacta.",
  };
}

// ── Vuelos reales desde aerolíneas ─────────────────────────────────────────
async function fetchFlightOffers(
  origin: string, dest: string, fecha: string,
  ida_vuelta: boolean, fecha_regreso: string | undefined, pasajeros: number,
): Promise<any[]> {
  if (!BRAVE_API_KEY) return [];
  try {
    const query = `vuelos ${origin} ${dest} ${fecha} precio COP site:avianca.com OR site:latamairlines.com`;
    const resp = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params: { q: query, count: 5 },
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      timeout: 8000,
    });
    const results = resp.data.web?.results ?? [];
    return results.map((r: any) => {
      const priceMatch = r.description?.match(/(\d[\d.]+)\s*(?:COP|cop)/i);
      const price = priceMatch ? `${parseInt(priceMatch[1].replace(/\./g,"")).toLocaleString("es-CO")} COP` : null;
      return { fuente: r.title?.split("|")[0]?.trim(), precio: price ?? "Ver en sitio", link: r.url };
    }).filter((f: any) => f.fuente);
  } catch { return []; }
}

// ── Tool principal: searchFlights ──────────────────────────────────────────
export async function searchFlights(args: {
  origen:         string;
  destino:        string;
  fecha:          string;
  ida_vuelta?:    boolean;
  fecha_regreso?: string;
  pasajeros?:     number;
}) {
  const { origen, destino, fecha, ida_vuelta = false, fecha_regreso, pasajeros = 1 } = args;
  const orig = origen.toUpperCase();
  const dest = destino.toUpperCase();

  const aviancaLink = `https://www.avianca.com/co/es/vuelos/?origin=${orig}&destination=${dest}&departureDate=${fecha}&returnDate=${fecha_regreso ?? ""}&adults=${pasajeros}&tripType=${ida_vuelta ? "RT" : "OW"}`;
  const latamLink   = `https://www.latamairlines.com/co/es/ofertas-vuelos?origin=${orig}&inbound=${fecha_regreso ?? ""}&outbound=${fecha}&adt=${pasajeros}&chd=0&inf=0&trip=${ida_vuelta ? "RT" : "OW"}&destination=${dest}`;
  const skyBase     = `https://www.skyscanner.com.co/vuelos/${orig.toLowerCase()}/${dest.toLowerCase()}/${fecha.replace(/-/g,"")}`;

  // Intentar obtener precios reales via Brave
  const ofertas = await fetchFlightOffers(orig, dest, fecha, ida_vuelta, fecha_regreso, pasajeros);

  return {
    ruta:     `${orig} → ${dest}`,
    fecha,
    pasajeros,
    tipo:     ida_vuelta ? "Ida y vuelta" : "Solo ida",
    fecha_regreso: fecha_regreso ?? null,
    opciones_directas: [
      { aerolinea: "Avianca",                 link: aviancaLink, info: "Buscar vuelo directo en Avianca" },
      { aerolinea: "LATAM",                   link: latamLink,   info: "Buscar vuelo directo en LATAM" },
      { aerolinea: "Skyscanner (comparador)", link: skyBase,     info: "Comparar todas las aerolíneas" },
    ],
    precios_encontrados: ofertas,
    nota: ofertas.length > 0
      ? `✅ Se encontraron ${ofertas.length} referencias de precio. Confirma disponibilidad en el sitio.`
      : "Precios en tiempo real disponibles al abrir los links de cada aerolínea.",
  };
}
