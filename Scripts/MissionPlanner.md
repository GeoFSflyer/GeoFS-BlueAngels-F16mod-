# GeoFS Mission Planner (V2)

## Doel

De Mission Planner is een centrale mission-databron voor GeoFS add-ons (zoals MFD/HUD systemen).  
De planner laat gebruikers een missie opbouwen op de kaart én stelt dezelfde data beschikbaar via een publieke JavaScript API.

Belangrijk:
- Alle wijzigingen worden automatisch opgeslagen in local storage.
- Missiedata kan direct opgehaald worden door vliegtuigsystemen.
- Flight plan uit opgeslagen missie kan bij load teruggezet worden in GeoFS.

---

## Mogelijkheden

De planner ondersteunt:

- Mission metadata
  - missie naam
  - timestamps (`createdAt`, `updatedAt`)

- Flight plan
  - sync met `geofs.flightPlan.waypointArray`
  - import/export via missie JSON

- Markpoints
  - toevoegen via map center of map popup
  - bewerken en verwijderen
  - type-gebaseerde kleurweergave

- Areas
  - varianten: `POLYGON`, `SQUARE`, `CIRCLE`
  - type/group/order configuratie
  - tekenen op de kaart

- Navaids
  - toevoegen vanuit navaid popup
  - toevoegen vanuit runway popup (met of zonder ILS)
  - mission-type instelbaar voor tactische weergave

- Checklists
  - FLP-checklists toevoegen/bewerken/verwijderen

- IFF codebook
  - 14 codes (`01`..`14`)
  - responses bewerkbaar en regenereerbaar

---

## Datamodel

### Root Mission object

```json
{
  "version": 1,
  "name": "string",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "flightPlan": [],
  "markpoints": [],
  "areas": [],
  "navaids": [],
  "checklists": [],
  "iffCodes": []
}
```

### `flightPlan[]` item

```json
{
  "id": 0,
  "ident": "string",
  "lat": 0,
  "lon": 0,
  "type": "string",
  "alt": 0,
  "spd": 0,
  "heading": 0,
  "track": 0
}
```

### `markpoints[]` item

```json
{
  "id": 1,
  "name": "string",
  "abbreviation": "string",
  "lat": 0,
  "lon": 0,
  "type": "TARGET|FRIENDLY|RESQUE|CIVILIAN"
}
```

### `areas[]` item

Gemeenschappelijk:

```json
{
  "id": 123,
  "name": "string",
  "variant": "POLYGON|SQUARE|CIRCLE",
  "type": "SAM|NOFLY|UNRESTRICTED|DANGER|AREA",
  "group": "FRIENDLY|FOO|CIVILIAN|UNKNOWN",
  "order": 1
}
```

Variant-specifiek:
- `CIRCLE`: `center: [lat, lon]`, `radius: meters`
- `POLYGON`/`SQUARE`: `points: [[lat, lon], ...]`

### `navaids[]` item

```json
{
  "id": 0,
  "ident": "string",
  "name": "string",
  "icao": "string",
  "type": "string",
  "missionType": "CIVILIAN|FOO|FRIEND|ALTERNATE",
  "lat": 0,
  "lon": 0,
  "freq": "number|string"
}
```

### `checklists[]` item

```json
{
  "id": 1,
  "type": "FLP",
  "title": "string",
  "items": ["string", "..."]
}
```

### `iffCodes[]` item

```json
{
  "key": "01..14",
  "response": "3-digit string"
}
```

---

## Enumeraties en kleuren

### Area styles (`AREA_STYLE_BY_TYPE`)

- `SAM` → color/fill `#ff5252`
- `NOFLY` → color/fill `#ff9800`
- `UNRESTRICTED` → color/fill `#4caf50`
- `DANGER` → color/fill `#9c27b0`
- `AREA` → color/fill `#03a9f4`

### Markpoint kleuren (`MARKPOINT_COLOR_BY_TYPE`)

- `TARGET` → `#f44336`
- `FRIENDLY` → `#2196f3`
- `RESQUE` → `#ff9800`
- `CIVILIAN` → `#4caf50`

### Navaid mission kleuren (`NAVAID_COLOR_BY_MISSION_TYPE`)

- `CIVILIAN` → `#4caf50`
- `FOO` → `#f44336`
- `FRIEND` → `#2196f3`
- `ALTERNATE` → `#ff9800`

---

## Publieke API (voor MFD / andere add-ons)

Globale namespace:

```js
window.GeoFSMissionPlanner
```

### Eigenschappen

- `version` (script versie)
- `apiVersion` (API contract versie)
- `app` (interne app referentie)

### Methoden

- `getMissionData()`  
  Retourneert een deep-copy van de missie in JSON-vorm (direct MFD-consumeerbaar).

- `getMissionJson()`  
  Retourneert de missie als JSON-string.

- `getDataModel()`  
  Retourneert:
  - enums (`areaTypes`, `areaGroups`, `areaVariants`, `markpointTypes`, `navaidMissionTypes`)
  - defaults (checklists, storage key, etc.)
  - kleur/style mappings

- `getMissionForDisplay()`  
  Retourneert:
  - `mission` (ruwe data)
  - `derived` (vooraf berekende display-info, zoals kleuren per markpoint/navaid/area)

- `onUpdate(callback)`  
  Subscribe op missiewijzigingen. Geeft unsubscribe functie terug.

  Event bron:
  - `window` event: `GeoFSMissionPlanner:updated`

---

## Voorbeeld (MFD integratie)

```js
const api = window.GeoFSMissionPlanner;
if (api) {
  const snapshot = api.getMissionForDisplay();
  renderMfd(snapshot.mission, snapshot.derived);

  const unsubscribe = api.onUpdate((mission) => {
    renderMfd(mission);
  });
}
```

Deze opzet is bedoeld zodat AI/codegen voor MFD direct alle benodigde structuur, enums, functies en kleuren kan afleiden.