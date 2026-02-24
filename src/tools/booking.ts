import axios from "axios";

// ── Afiliado Awin/Booking — HARDCODED (no override via env) ───────────────
// Publisher: MCP Colombia | ID: 2784246 | Merchant Booking.com: 6776
const AWIN_PUBLISHER_ID  = "2784246";
const BOOKING_MERCHANT   = "6776";

function awinLink(destinationUrl: string): string {
  return `https://www.awin1.com/cread.php?awinmid=${BOOKING_MERCHANT}&awinaffid=${AWIN_PUBLISHER_ID}&ued=${encodeURIComponent(destinationUrl)}`;
}

const CO_CITIES: Record<string, string> = {
  bogota:           "-554521",
  medellin:         "-573949",
  cartagena:        "-570867",
  cali:             "-554874",
  barranquilla:     "-553173",
  "santa marta":    "-574455",
  pereira:          "-573819",
  manizales:        "-573469",
  bucaramanga:      "-553955",
  "san andres":     "-574153",
  "villavicencio":  "-574611",
  "armenia":        "-553573",
};

// ── Buscar hoteles ─────────────────────────────────────────────────────────
export async function searchHotels(args: {
  ciudad:        string;
  checkin:       string;
  checkout:      string;
  adultos?:      number;
  habitaciones?: number;
  precio_max?:   number;
}) {
  const { ciudad, checkin, checkout, adultos = 2, habitaciones = 1, precio_max } = args;

  const cityKey = ciudad.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const dest_id = CO_CITIES[cityKey] ?? null;

  const checkinDate  = new Date(checkin);
  const checkoutDate = new Date(checkout);
  const noches = Math.round((checkoutDate.getTime() - checkinDate.getTime()) / 86400000);

  const bookingBase = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(ciudad)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adultos}&no_rooms=${habitaciones}${dest_id ? `&dest_id=${dest_id}&dest_type=city` : ""}${precio_max ? `&nflt=price%3DCOP-min-${precio_max}-1` : ""}`;

  const searchUrl = awinLink(bookingBase);

  const destacados: Record<string, any[]> = {
    bogota: [
      { nombre: "Hotel Sofitel Bogotá Victoria Regia",  estrellas: 5, zona: "Chapinero",          precio_desde: "450,000 COP/noche" },
      { nombre: "Hotel Click Clack",                    estrellas: 4, zona: "Chapinero",          precio_desde: "280,000 COP/noche" },
      { nombre: "NH Collection Bogotá Royal",           estrellas: 5, zona: "Zona Rosa",          precio_desde: "520,000 COP/noche" },
      { nombre: "Hotel Cosmos 100",                     estrellas: 4, zona: "Chapinero Norte",    precio_desde: "220,000 COP/noche" },
    ],
    cartagena: [
      { nombre: "Hotel Las Américas",                   estrellas: 5, zona: "Bocagrande",         precio_desde: "650,000 COP/noche" },
      { nombre: "Bastión Luxury Hotel",                 estrellas: 5, zona: "Ciudad Amurallada",  precio_desde: "800,000 COP/noche" },
      { nombre: "Hotel Then Cartagena",                 estrellas: 4, zona: "Centro",             precio_desde: "320,000 COP/noche" },
      { nombre: "Ananda Hotel Boutique",                estrellas: 4, zona: "Getsemaní",          precio_desde: "280,000 COP/noche" },
    ],
    medellin: [
      { nombre: "Hotel Dann Carlton",                   estrellas: 5, zona: "El Poblado",         precio_desde: "380,000 COP/noche" },
      { nombre: "The Charlee Hotel",                    estrellas: 4, zona: "El Poblado",         precio_desde: "420,000 COP/noche" },
      { nombre: "Diez Hotel Categoría Colombia",        estrellas: 5, zona: "Laureles",           precio_desde: "350,000 COP/noche" },
      { nombre: "Hotel Park 10",                        estrellas: 4, zona: "El Poblado",         precio_desde: "260,000 COP/noche" },
    ],
    cali: [
      { nombre: "Hotel Dann Carlton Cali",              estrellas: 5, zona: "Norte",              precio_desde: "320,000 COP/noche" },
      { nombre: "GHL Hotel Barranquilla",               estrellas: 4, zona: "Granada",            precio_desde: "240,000 COP/noche" },
    ],
    "santa marta": [
      { nombre: "Irotama Resort",                       estrellas: 5, zona: "El Rodadero",        precio_desde: "450,000 COP/noche" },
      { nombre: "Hotel Tamacá Beach Resort",            estrellas: 4, zona: "El Rodadero",        precio_desde: "300,000 COP/noche" },
    ],
    "san andres": [
      { nombre: "Decameron Aquarium",                   estrellas: 4, zona: "San Luis",           precio_desde: "600,000 COP/noche" },
      { nombre: "Hotel Sunrise Beach",                  estrellas: 4, zona: "Spratt Bight",       precio_desde: "380,000 COP/noche" },
    ],
    barranquilla: [
      { nombre: "Hotel Dann Carlton Barranquilla",      estrellas: 5, zona: "El Prado",           precio_desde: "350,000 COP/noche" },
      { nombre: "GHL Grand Hotel Barranquilla",         estrellas: 4, zona: "Centro",             precio_desde: "220,000 COP/noche" },
    ],
  };

  const sugerencias = (destacados[cityKey] ?? []).map(h => ({
    ...h,
    link: awinLink(`https://www.booking.com/search.html?ss=${encodeURIComponent(h.nombre)}`),
  }));

  return {
    ciudad,
    checkin,
    checkout,
    noches,
    adultos,
    habitaciones,
    reservar_en_booking: searchUrl,
    sugerencias_curadas: sugerencias,
    nota: "Links con afiliado Awin/Booking.com — precios en tiempo real al abrir.",
  };
}

// ── Buscar vuelos ──────────────────────────────────────────────────────────
export async function searchFlights(args: {
  origen:          string;
  destino:         string;
  fecha:           string;
  ida_vuelta?:     boolean;
  fecha_regreso?:  string;
  pasajeros?:      number;
}) {
  const { origen, destino, fecha, ida_vuelta = false, fecha_regreso, pasajeros = 1 } = args;

  const orig = origen.toUpperCase();
  const dest = destino.toUpperCase();

  const aviancaLink = `https://www.avianca.com/co/es/vuelos/?origin=${orig}&destination=${dest}&departureDate=${fecha}&returnDate=${fecha_regreso ?? ""}&adults=${pasajeros}&tripType=${ida_vuelta ? "RT" : "OW"}`;
  const latamLink   = `https://www.latamairlines.com/co/es/ofertas-vuelos?origin=${orig}&inbound=${fecha_regreso ?? ""}&outbound=${fecha}&adt=${pasajeros}&chd=0&inf=0&trip=${ida_vuelta ? "RT" : "OW"}&destination=${dest}`;

  const skyBase     = `https://www.skyscanner.com.co/vuelos/${orig.toLowerCase()}/${dest.toLowerCase()}/${fecha.replace(/-/g,"")}`;

  return {
    ruta:     `${orig} → ${dest}`,
    fecha,
    pasajeros,
    tipo:     ida_vuelta ? "Ida y vuelta" : "Solo ida",
    opciones: [
      { aerolinea: "Avianca",                  link: aviancaLink },
      { aerolinea: "LATAM",                    link: latamLink },
      { aerolinea: "Skyscanner (comparador)",  link: skyBase },
    ],
    nota: "Precios en tiempo real en cada aerolínea.",
  };
}
