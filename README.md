# 🇨🇴 mcp-colombia

**MCP server** que conecta cualquier agente de IA con productos, viajes y servicios financieros de **Colombia**.

Instala una sola vez y permite que Claude, Cursor, ChatGPT, Copilot o cualquier AI compatible con MCP busque neveras en MercadoLibre, compare CDTs, busque hoteles en Cartagena o simule un crédito — todo en pesos colombianos.

[![npm](https://img.shields.io/npm/v/mcp-colombia)](https://www.npmjs.com/package/mcp-colombia)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🚀 Instalación en 30 segundos

### Claude Desktop

Edita `claude_desktop_config.json`:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-colombia": {
      "command": "npx",
      "args": ["-y", "mcp-colombia"]
    }
  }
}
```

Reinicia Claude Desktop. Listo ✅

---

### Cursor

Crea o edita `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mcp-colombia": {
      "command": "npx",
      "args": ["-y", "mcp-colombia"]
    }
  }
}
```

---

### Windsurf / Cline / Continue

```json
{
  "mcpServers": {
    "mcp-colombia": {
      "command": "npx",
      "args": ["-y", "mcp-colombia"]
    }
  }
}
```

---

### mcporter (OpenClaw / CLI)

```bash
npm install -g mcporter
mcporter config add mcp-colombia --command "npx -y mcp-colombia"
mcporter call mcp-colombia.finanzas_comparar_cdt monto=5000000 plazo_dias=180
```

---

## 🛠️ Variables de entorno opcionales

Para resultados en tiempo real de MercadoLibre vía su API oficial:

```env
ML_CLIENT_ID=tu_app_id          # developers.mercadolibre.com.co → crear app
ML_CLIENT_SECRET=tu_secret
ML_AFFILIATE_ID=tu_publisher_id  # mercadolibre.com.co/afiliados (opcional)
BRAVE_API_KEY=tu_key             # api.search.brave.com (fallback búsqueda)
```

Sin variables de entorno el servidor funciona con búsqueda web y datos curados.

---

## 🧰 Herramientas disponibles (7 tools)

### 🛒 MercadoLibre Colombia

#### `ml_buscar_productos`
Busca productos en MercadoLibre Colombia con precio, vendedor y link de compra.

**Parámetros:**
| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `query` | string | ✅ | Qué buscar (ej: "nevera No Frost Samsung") |
| `categoria` | string | — | electronica, celulares, hogar, ropa, deportes... |
| `limit` | number | — | Cantidad de resultados (1–10, default 5) |
| `precio_min` | number | — | Precio mínimo en COP |
| `precio_max` | number | — | Precio máximo en COP |
| `ordenar` | string | — | precio_asc, precio_desc, relevancia |

**Ejemplo:**
```
"Busca televisores Samsung de menos de $2 millones"
→ ml_buscar_productos(query="televisor Samsung", precio_max=2000000, ordenar="precio_asc")
```

---

#### `ml_detalle_producto`
Obtiene el detalle completo de un producto por su ID de MercadoLibre (formato MCO...).

**Parámetros:**
| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `item_id` | string | ✅ | ID del producto (ej: MCO2645041778) |

---

### ✈️ Viajes

#### `viajes_buscar_hotel`
Busca hoteles en ciudades colombianas con disponibilidad real en Booking.com.

**Ciudades soportadas:** Bogotá, Medellín, Cartagena, Cali, Santa Marta, Barranquilla, San Andrés, Pereira, Manizales, Bucaramanga, Villavicencio, Armenia.

**Parámetros:**
| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `ciudad` | string | ✅ | Ciudad destino |
| `checkin` | string | ✅ | Fecha entrada YYYY-MM-DD |
| `checkout` | string | ✅ | Fecha salida YYYY-MM-DD |
| `adultos` | number | — | Número de adultos (default 2) |
| `habitaciones` | number | — | Número de habitaciones (default 1) |
| `precio_max` | number | — | Precio máximo por noche en COP |

**Ejemplo:**
```
"Hoteles en Cartagena del 20 al 25 de junio para 2 personas"
→ viajes_buscar_hotel(ciudad="Cartagena", checkin="2026-06-20", checkout="2026-06-25")
```

---

#### `viajes_buscar_vuelos`
Busca vuelos desde/hacia Colombia en Avianca, LATAM y Skyscanner.

**Parámetros:**
| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `origen` | string | ✅ | Ciudad o código IATA (ej: BOG, Bogotá) |
| `destino` | string | ✅ | Ciudad o código IATA (ej: MDE, MIA, JFK) |
| `fecha` | string | ✅ | Fecha de salida YYYY-MM-DD |
| `ida_vuelta` | boolean | — | true para vuelo de regreso |
| `fecha_regreso` | string | — | Fecha de regreso YYYY-MM-DD |
| `pasajeros` | number | — | Número de pasajeros (default 1) |

**Ejemplo:**
```
"Vuelos Bogotá a Miami en Semana Santa, ida y vuelta"
→ viajes_buscar_vuelos(origen="BOG", destino="MIA", fecha="2026-04-02", ida_vuelta=true, fecha_regreso="2026-04-09")
```

---

### 💰 Finanzas Colombia

#### `finanzas_comparar_cdt`
Compara los mejores CDTs disponibles en Colombia según tu monto y plazo. Muestra tasa EA, rendimiento real en COP y link directo al banco.

**Bancos incluidos:** Nu Colombia (Nubank), Lulo Bank, Davivienda, Scotiabank Colpatria, Itaú, Bancolombia, Banco de Bogotá, Banco Popular, AV Villas, BBVA Colombia.

**Parámetros:**
| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `monto` | number | ✅ | Monto a invertir en COP |
| `plazo_dias` | number | ✅ | Plazo: 30, 60, 90, 180 o 360 días |
| `top` | number | — | Cuántos bancos mostrar (default 5) |

**Ejemplo:**
```
"Tengo $10 millones, ¿cuál CDT me conviene a 6 meses?"
→ finanzas_comparar_cdt(monto=10000000, plazo_dias=180)
```

---

#### `finanzas_simular_credito`
Simula un crédito de consumo o libre inversión en los principales bancos y fintechs de Colombia. Calcula cuota mensual, total a pagar y costo total del crédito.

**Entidades incluidas:** Bancolombia, Davivienda, Banco de Bogotá, Nequi, Addi, Lulo Bank.

**Parámetros:**
| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `monto` | number | ✅ | Monto del crédito en COP |
| `cuotas` | number | ✅ | Número de cuotas mensuales (1–84) |
| `proposito` | string | — | Para qué es el crédito (ej: comprar moto) |

**Ejemplo:**
```
"Quiero pedir $5 millones a 24 meses para remodelar"
→ finanzas_simular_credito(monto=5000000, cuotas=24, proposito="remodelación")
```

---

#### `finanzas_comparar_cuentas`
Compara cuentas de ahorros y billeteras digitales en Colombia. Muestra rendimiento EA, cuota de manejo y GMF.

**Parámetros:**
| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `tipo` | string | — | ahorros, digital o todos (default: todos) |

**Ejemplo:**
```
"¿Qué billetera digital me da más rendimiento?"
→ finanzas_comparar_cuentas(tipo="digital")
```

---

## 💬 Ejemplos de uso con IA

Una vez instalado, puedes decirle a tu IA:

> *"Busca los mejores celulares Samsung de menos de $1.5 millones en MercadoLibre Colombia"*

> *"¿Cuánto ganaría si invierto $20 millones en un CDT a 1 año?"*

> *"Quiero irme a Medellín 3 noches en marzo, busca hoteles con piscina"*

> *"Simula un crédito de $8 millones a 36 cuotas para comprar una moto"*

> *"¿Cuál cuenta de ahorros me da más rendimiento en Colombia?"*

> *"Vuelos de Bogotá a Cartagena para el puente de mayo, 2 personas"*

---

## 🗺️ Roadmap

- [ ] Inmuebles: FincaRaíz + MetroCuadrado
- [ ] Empleos: Computrabajo + ElEmpleo
- [ ] Domicilios: Rappi + iFood
- [ ] Seguros: comparador SOAT, vida, hogar
- [ ] Tasas CDT en tiempo real via Superfinanciera
- [ ] Comparador de créditos hipotecarios

---

## 🤝 Contribuir

Pull requests bienvenidos. Revisa `src/tools/` para agregar nuevas integraciones.

## 📄 Licencia

MIT — libre para uso personal y comercial.

---

*¿Tienes un negocio colombiano y quieres que tu servicio sea descubrible por agentes de IA? Abre un issue.*
