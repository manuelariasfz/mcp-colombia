import axios from "axios";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";

// ── Portales de empleo en Colombia ────────────────────────────────────────
const PORTALES = [
  { nombre: "El Empleo",     domain: "elempleo.com",     base: "https://www.elempleo.com/co/ofertas-trabajo/" },
  { nombre: "Computrabajo",  domain: "co.computrabajo.com", base: "https://co.computrabajo.com/trabajo-de-" },
  { nombre: "LinkedIn",      domain: "linkedin.com/jobs", base: "https://www.linkedin.com/jobs/search/?location=Colombia" },
  { nombre: "Indeed",        domain: "co.indeed.com",    base: "https://co.indeed.com/jobs?l=Colombia" },
];

export interface JobListing {
  titulo:    string;
  empresa:   string | null;
  ciudad:    string;
  portal:    string;
  link:      string;
  salario:   string | null;
  descripcion: string | null;
}

// ── Buscar vacantes reales via Brave Search ───────────────────────────────
export async function buscarVacantes(
  cargo: string,
  ciudad: string,
  modalidad: string,
): Promise<JobListing[]> {
  if (!BRAVE_API_KEY) return [];

  const modalidadStr = modalidad === "remoto" ? "remoto teletrabajo" :
                       modalidad === "híbrido" ? "híbrido" : ciudad;

  const query = `"${cargo}" empleo Colombia ${modalidadStr} site:elempleo.com OR site:co.computrabajo.com OR site:co.indeed.com OR site:linkedin.com/jobs`;

  try {
    const resp = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params: { q: query, count: 8 },
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
      timeout: 8000,
    });

    const results = resp.data.web?.results ?? [];
    const listings: JobListing[] = [];

    for (const r of results) {
      const url: string = r.url ?? "";
      // Detectar portal
      const portal = PORTALES.find(p => url.includes(p.domain));
      if (!portal) continue;

      // Extraer empresa del snippet (patrón: "Empresa: X" o "en X")
      let empresa: string | null = null;
      const empMatch = r.description?.match(/(?:empresa|compañía|en)\s*:?\s*([A-ZÁÉÍÓÚ][a-záéíóúA-ZÁÉÍÓÚ\s&.,]{3,40})/i);
      if (empMatch) empresa = empMatch[1].trim();

      // Extraer salario si aparece
      let salario: string | null = null;
      const salMatch = r.description?.match(/(\$[\d.,]+|\d[\d.,]+\s*(?:COP|millones?|mil)(?:\s*\/\s*mes)?)/i);
      if (salMatch) salario = salMatch[0];

      listings.push({
        titulo:      r.title?.replace(/ ?[|-]? ?(?:El Empleo|Computrabajo|LinkedIn|Indeed).*$/i,"").trim(),
        empresa,
        ciudad:      ciudad,
        portal:      portal.nombre,
        link:        url,
        salario,
        descripcion: r.description?.slice(0, 180),
      });
    }

    return listings.slice(0, 5);
  } catch { return []; }
}

// ── Generar links de búsqueda por portal ─────────────────────────────────
export function getPortalLinks(cargo: string, ciudad: string, modalidad: string): Record<string, string> {
  const cargoSlug    = encodeURIComponent(cargo);
  const ciudadSlug   = encodeURIComponent(ciudad);
  const remoto       = modalidad === "remoto";

  return {
    elempleo:      `https://www.elempleo.com/co/ofertas-trabajo/?textoBusqueda=${cargoSlug}&ciudad=${ciudadSlug}`,
    computrabajo:  `https://co.computrabajo.com/trabajo-de-${cargo.toLowerCase().replace(/\s+/g,"-")}?p=${ciudadSlug.toLowerCase()}`,
    linkedin:      `https://www.linkedin.com/jobs/search/?keywords=${cargoSlug}&location=${remoto ? "Colombia" : ciudadSlug}&f_WT=${remoto ? "2" : "1"}`,
    indeed:        `https://co.indeed.com/jobs?q=${cargoSlug}&l=${remoto ? "Remoto" : ciudadSlug}`,
  };
}
