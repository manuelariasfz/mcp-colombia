import axios from "axios";

// ── Datos CDTs actualizados (actualizar semanalmente) ──────────────────────
// Fuente: bancos directamente / Superfinanciera
// TODO: automatizar scraping de tasas.com.co o superfinanciera.gov.co

const CDT_TASAS = [
  { banco: "Bancolombia",    tasa_ea: 10.8,  min_monto: 1_000_000,  plazo_dias: [30,60,90,180,360], link: "https://www.bancolombia.com/personas/productos-servicios/ahorro-inversion/cdt" },
  { banco: "Davivienda",     tasa_ea: 11.2,  min_monto: 500_000,    plazo_dias: [30,60,90,180,360], link: "https://www.davivienda.com/cdt" },
  { banco: "BBVA Colombia",  tasa_ea: 10.5,  min_monto: 1_000_000,  plazo_dias: [90,180,360],       link: "https://www.bbva.com.co/personas/productos/ahorro/cdt.html" },
  { banco: "Banco de Bogotá",tasa_ea: 10.6,  min_monto: 1_000_000,  plazo_dias: [30,60,90,180,360], link: "https://www.bancodebogota.com/wps/portal/banco-de-bogota/bogota/productos/para-invertir/cdt" },
  { banco: "Banco Popular",  tasa_ea: 10.9,  min_monto: 500_000,    plazo_dias: [30,60,90,180,360], link: "https://www.bancopopular.com.co/wps/portal/BancoPopular/InicioBP/productos/inversion/cdt" },
  { banco: "Itaú Colombia",  tasa_ea: 11.0,  min_monto: 1_000_000,  plazo_dias: [90,180,360],       link: "https://www.itau.co/personas/cdt" },
  { banco: "AV Villas",      tasa_ea: 10.7,  min_monto: 500_000,    plazo_dias: [30,60,90,180,360], link: "https://www.avvillas.com.co/wps/portal/avvillas/a/personas/productosyservicios/inversion/cdt" },
  { banco: "Scotiabank Colpatria", tasa_ea: 11.1, min_monto: 1_000_000, plazo_dias: [90,180,360], link: "https://www.scotiabankcolpatria.com/personas/ahorro/cdt" },
  { banco: "Lulo Bank",      tasa_ea: 12.5,  min_monto: 100_000,    plazo_dias: [30,60,90,180,360], link: "https://www.lulobank.com/cdt", nota: "100% digital" },
  { banco: "Nu Colombia (Nubank)", tasa_ea: 13.2, min_monto: 1_000, plazo_dias: [30,60,90], link: "https://nubank.com.co/caja-de-ahorro/", nota: "Caja de ahorro, no CDT — liquidez inmediata" },
];

function calcularRendimiento(monto: number, tasa_ea: number, dias: number): number {
  const tasa_diaria = Math.pow(1 + tasa_ea / 100, 1 / 365) - 1;
  return Math.round(monto * Math.pow(1 + tasa_diaria, dias) - monto);
}

// ── Comparar CDTs ──────────────────────────────────────────────────────────
export async function compararCDT(args: {
  monto:      number;   // COP
  plazo_dias: number;   // 30, 60, 90, 180, 360
  top?:       number;
}) {
  const { monto, plazo_dias, top = 5 } = args;

  const disponibles = CDT_TASAS
    .filter(b => b.min_monto <= monto && b.plazo_dias.includes(plazo_dias))
    .map(b => ({
      banco:       b.banco,
      tasa_ea:     b.tasa_ea,
      rendimiento: calcularRendimiento(monto, b.tasa_ea, plazo_dias),
      monto_final: monto + calcularRendimiento(monto, b.tasa_ea, plazo_dias),
      min_monto:   b.min_monto,
      nota:        b.nota ?? null,
      link:        b.link,
    }))
    .sort((a, b) => b.tasa_ea - a.tasa_ea)
    .slice(0, top);

  if (!disponibles.length) {
    return {
      error: `No hay CDTs disponibles para $${monto.toLocaleString("es-CO")} COP a ${plazo_dias} días. Intenta con un monto mayor o plazo diferente.`,
    };
  }

  const mejor = disponibles[0];

  return {
    monto:       `$${monto.toLocaleString("es-CO")} COP`,
    plazo:       `${plazo_dias} días`,
    comparacion: disponibles,
    recomendacion: {
      banco:       mejor.banco,
      tasa_ea:     `${mejor.tasa_ea}% EA`,
      ganarías:    `$${mejor.rendimiento.toLocaleString("es-CO")} COP`,
      monto_final: `$${mejor.monto_final.toLocaleString("es-CO")} COP`,
      link:        mejor.link,
    },
    nota:       "Tasas indicativas. Confirmar con el banco antes de invertir. Última actualización: Feb 2026.",
    tasas_referencia_url: "https://www.superfinanciera.gov.co",
  };
}

// ── Simular crédito ────────────────────────────────────────────────────────
const CREDITO_ENTIDADES = [
  { entidad: "Bancolombia",   tasa_mv: 1.8,  min: 500_000,   max: 80_000_000,  link: "https://www.bancolombia.com/personas/credito-de-consumo" },
  { entidad: "Davivienda",    tasa_mv: 1.9,  min: 500_000,   max: 70_000_000,  link: "https://www.davivienda.com/credito-libre-inversion" },
  { entidad: "Banco Bogotá",  tasa_mv: 2.0,  min: 1_000_000, max: 50_000_000,  link: "https://www.bancodebogota.com" },
  { entidad: "Nequi (Bancolombia)", tasa_mv: 2.5, min: 100_000, max: 2_000_000, link: "https://www.nequi.com.co/prestamos/", nota: "Crédito digital inmediato" },
  { entidad: "Addi",          tasa_mv: 2.8,  min: 50_000,    max: 5_000_000,   link: "https://co.addi.com", nota: "Compra ahora, paga después — e-commerce" },
  { entidad: "Lulo Bank",     tasa_mv: 2.2,  min: 500_000,   max: 20_000_000,  link: "https://www.lulobank.com/credito", nota: "100% digital" },
];

export async function simularCredito(args: {
  monto:      number;
  cuotas:     number;
  proposito?: string;
}) {
  const { monto, cuotas, proposito } = args;

  const opciones = CREDITO_ENTIDADES
    .filter(e => monto >= e.min && monto <= e.max)
    .map(e => {
      const r    = e.tasa_mv / 100;
      const cuota_mensual = Math.round(monto * r * Math.pow(1+r, cuotas) / (Math.pow(1+r, cuotas)-1));
      const total_pagar   = cuota_mensual * cuotas;
      const costo_total   = total_pagar - monto;
      return {
        entidad:        e.entidad,
        tasa_mensual:   `${e.tasa_mv}% MV`,
        cuota_mensual:  `$${cuota_mensual.toLocaleString("es-CO")}`,
        total_pagar:    `$${total_pagar.toLocaleString("es-CO")}`,
        costo_credito:  `$${costo_total.toLocaleString("es-CO")}`,
        nota:           e.nota ?? null,
        link:           e.link,
      };
    })
    .sort((a, b) => parseFloat(a.tasa_mensual) - parseFloat(b.tasa_mensual));

  const mejor = opciones[0];

  return {
    monto:     `$${monto.toLocaleString("es-CO")} COP`,
    cuotas,
    proposito: proposito ?? "libre inversión",
    opciones,
    mejor_opcion: mejor ?? null,
    consejo: "Compara CEA (Costo Efectivo Anual) antes de firmar. El banco con tasa más baja no siempre tiene el CEA más bajo.",
  };
}

// ── Comparar cuentas de ahorros / billeteras ───────────────────────────────
export async function compararCuentas(args: { tipo?: "ahorros" | "digital" | "todos" }) {
  const { tipo = "todos" } = args;

  const cuentas = [
    {
      entidad:   "Nubank (Nu Colombia)",
      tipo:      "digital",
      rendimiento: "13.2% EA en Caja de Ahorro",
      cuota_manejo: "$0",
      retiros:   "4 gratis/mes en Servibanca",
      gmf:       "Exento si se certificó",
      link:      "https://nubank.com.co",
      nota:      "🏆 Mejor rendimiento del mercado",
    },
    {
      entidad:   "Lulo Bank",
      tipo:      "digital",
      rendimiento: "12.5% EA",
      cuota_manejo: "$0",
      retiros:   "Gratis en red propia",
      gmf:       "Exento si se certificó",
      link:      "https://www.lulobank.com",
      nota:      "Abre 100% digital en minutos",
    },
    {
      entidad:   "Nequi (Bancolombia)",
      tipo:      "digital",
      rendimiento: "~9.5% EA en bolsillos",
      cuota_manejo: "$0",
      retiros:   "Gratis en cajeros Bancolombia",
      gmf:       "Exento si se certificó",
      link:      "https://www.nequi.com.co",
      nota:      "La más usada en Colombia, muy fácil",
    },
    {
      entidad:   "Daviplata",
      tipo:      "digital",
      rendimiento: "N/A",
      cuota_manejo: "$0",
      retiros:   "Bajo costo",
      gmf:       "Aplica",
      link:      "https://www.daviplata.com",
    },
    {
      entidad:   "Bancolombia (cuenta de ahorros)",
      tipo:      "ahorros",
      rendimiento: "~3% EA",
      cuota_manejo: "$18,400/mes aprox",
      retiros:   "Incluidos en cuota",
      gmf:       "Aplica",
      link:      "https://www.bancolombia.com/personas/productos-servicios/ahorro-inversion/cuenta-de-ahorros",
    },
    {
      entidad:   "Davivienda",
      tipo:      "ahorros",
      rendimiento: "~3.5% EA",
      cuota_manejo: "$17,000/mes aprox",
      retiros:   "Incluidos",
      gmf:       "Aplica",
      link:      "https://www.davivienda.com/cuenta-de-ahorros",
    },
  ];

  const filtradas = tipo === "todos" ? cuentas : cuentas.filter(c => c.tipo === tipo);

  return {
    cuentas:   filtradas,
    resumen:   "Para rendimiento: Nubank > Lulo > Nequi. Para integración bancaria tradicional: Bancolombia o Davivienda.",
    fuente:    "Tasas referencia Feb 2026 — verificar con cada entidad.",
  };
}
