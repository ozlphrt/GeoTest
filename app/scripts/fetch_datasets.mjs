import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')

const RAW_DIR = path.join(appRoot, 'src', 'data', 'raw')
const OUT_DIR = path.join(appRoot, 'src', 'data')
const FLAG_SVG_DIR = path.join(appRoot, 'public', 'flags', 'svg')
const FLAG_PNG_DIR = path.join(appRoot, 'public', 'flags', 'png')

const NE_GEOJSON_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_sovereignty.geojson'
const NE_RIVERS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines_scale_rank.geojson'
const NE_GEO_REGIONS_POLYS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_polys.geojson'
const NE_ELEVATION_POINTS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_elevation_points.geojson'
const COUNTRIES_URL =
  'https://raw.githubusercontent.com/mledoze/countries/master/countries.json'
const CITIES_URL =
  'https://raw.githubusercontent.com/samayo/country-json/master/src/country-by-cities.json'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const RANGE_KEYWORDS = ['mountain', 'range']
const REGION_KEYWORDS = [
  'desert',
  'rainforest',
  'savanna',
  'tundra',
  'taiga',
  'steppe',
  'grassland',
  'forest',
  'jungle',
  'plain',
  'plateau',
  'highland',
  'lowland',
  'basin',
  'glacier',
]

async function ensureDirs() {
  await mkdir(RAW_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(FLAG_SVG_DIR, { recursive: true })
  await mkdir(FLAG_PNG_DIR, { recursive: true })
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return res.text()
}

async function fileExists(filepath) {
  try {
    await stat(filepath)
    return true
  } catch {
    return false
  }
}

async function downloadFile(url, filepath) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed fetch ${url}: ${res.status} ${res.statusText}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  await writeFile(filepath, buffer)
}

function normalizeCca3(value) {
  if (!value || value === '-99') return null
  return value.toUpperCase()
}

function buildCurrencyList(currencies) {
  if (!currencies) return []
  return Object.entries(currencies).map(([code, info]) => ({
    code,
    name: info?.name ?? '',
    symbol: info?.symbol ?? '',
  }))
}

function buildLanguageList(languages) {
  if (!languages) return []
  return Object.values(languages).filter(Boolean)
}

function normalizeName(value) {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildNameIndex(countries) {
  const index = new Map()
  for (const country of countries) {
    const names = new Set()
    if (country.name?.common) names.add(country.name.common)
    if (country.name?.official) names.add(country.name.official)
    if (Array.isArray(country.altSpellings)) {
      country.altSpellings.forEach((name) => names.add(name))
    }
    for (const name of names) {
      const key = normalizeName(name)
      if (key && !index.has(key)) {
        index.set(key, country)
      }
    }
  }
  return index
}

function toLineSegments(geometry) {
  if (!geometry) return []
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return []
}

function computeBBoxFromLine(coordinates) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lng, lat] of coordinates) {
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return [west, south, east, north]
}

function computeBBoxFromPolygon(geometry) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  forEachPolygonCoordinate(geometry, (lng, lat) => {
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  })
  return [west, south, east, north]
}

function isPointInBBox(lng, lat, bbox) {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

function isPointInRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function isPointInPolygon(point, polygon) {
  const [outer, ...holes] = polygon
  if (!outer || !isPointInRing(point, outer)) return false
  for (const hole of holes) {
    if (isPointInRing(point, hole)) return false
  }
  return true
}

function isPointInGeometry(point, geometry) {
  if (geometry.type === 'Polygon') {
    return isPointInPolygon(point, geometry.coordinates)
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => isPointInPolygon(point, polygon))
  }
  return false
}

function forEachPolygonCoordinate(geometry, handler) {
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      for (const coordinate of ring) {
        handler(coordinate[0], coordinate[1])
      }
    }
    return
  }
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        handler(coordinate[0], coordinate[1])
      }
    }
  }
}

function sampleLinePoints(coordinates, maxSamples = 8) {
  if (coordinates.length <= maxSamples) return coordinates
  const step = Math.max(1, Math.floor(coordinates.length / maxSamples))
  const sampled = []
  for (let i = 0; i < coordinates.length; i += step) {
    sampled.push(coordinates[i])
  }
  if (sampled.at(-1) !== coordinates.at(-1)) {
    sampled.push(coordinates.at(-1))
  }
  return sampled
}

function samplePolygonPoints(geometry, maxSamples = 10) {
  if (!geometry) return []
  const points = []
  forEachPolygonCoordinate(geometry, (lng, lat) => {
    points.push([lng, lat])
  })
  if (!points.length) return []
  const bbox = computeBBoxFromPolygon(geometry)
  const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  const sampled = [center]
  if (points.length <= maxSamples) {
    sampled.push(...points)
    return sampled
  }
  const step = Math.max(1, Math.floor(points.length / maxSamples))
  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i])
  }
  return sampled
}

function getGeoRegionName(properties) {
  return (
    properties?.NAME ??
    properties?.NAME_EN ??
    properties?.LABEL ??
    properties?.NAMEALT ??
    null
  )
}

function toCca2Lower(value) {
  if (!value) return null
  return value.toLowerCase()
}

async function downloadFlags(countries) {
  const concurrency = 8
  let index = 0
  let completed = 0
  const total = countries.length

  async function worker() {
    while (index < total) {
      const currentIndex = index
      index += 1
      const country = countries[currentIndex]
      if (!country.cca2) continue
      const cca2 = toCca2Lower(country.cca2)
      if (!cca2) continue

      const svgTarget = path.join(FLAG_SVG_DIR, `${country.cca2}.svg`)
      const pngTarget = path.join(FLAG_PNG_DIR, `${country.cca2}.png`)
      const svgUrl = `https://flagcdn.com/${cca2}.svg`
      const pngUrl = `https://flagcdn.com/w320/${cca2}.png`

      try {
        if (!(await fileExists(svgTarget))) {
          await downloadFile(svgUrl, svgTarget)
        }
        if (!(await fileExists(pngTarget))) {
          await downloadFile(pngUrl, pngTarget)
        }
      } catch (error) {
        console.warn(`Flag fetch failed for ${country.cca2}:`, error.message)
      } finally {
        completed += 1
        if (completed % 25 === 0 || completed === total) {
          console.log(`Flags: ${completed}/${total}`)
        }
      }
      await sleep(50)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

async function main() {
  await ensureDirs()

  console.log('Downloading Natural Earth geojson...')
  const neText = await fetchText(NE_GEOJSON_URL)
  const nePath = path.join(RAW_DIR, 'ne_10m_admin_0_sovereignty.geojson')
  await writeFile(nePath, neText, 'utf-8')

  console.log('Downloading country metadata...')
  const countries = await fetchJson(COUNTRIES_URL)
  const countriesPath = path.join(RAW_DIR, 'countries.json')
  await writeFile(countriesPath, JSON.stringify(countries, null, 2), 'utf-8')

  console.log('Downloading city dataset...')
  const cityEntries = await fetchJson(CITIES_URL)
  const citiesPath = path.join(RAW_DIR, 'country_by_cities.json')
  await writeFile(citiesPath, JSON.stringify(cityEntries, null, 2), 'utf-8')

  console.log('Downloading Natural Earth rivers...')
  const riversText = await fetchText(NE_RIVERS_URL)
  const riversPath = path.join(RAW_DIR, 'ne_50m_rivers.geojson')
  await writeFile(riversPath, riversText, 'utf-8')

  console.log('Downloading Natural Earth geography regions...')
  const regionsText = await fetchText(NE_GEO_REGIONS_POLYS_URL)
  const regionsPath = path.join(RAW_DIR, 'ne_10m_geography_regions_polys.geojson')
  await writeFile(regionsPath, regionsText, 'utf-8')

  console.log('Downloading Natural Earth elevation points...')
  const elevationText = await fetchText(NE_ELEVATION_POINTS_URL)
  const elevationPath = path.join(RAW_DIR, 'ne_10m_geography_regions_elevation_points.geojson')
  await writeFile(elevationPath, elevationText, 'utf-8')

  console.log('Downloading flags...')
  await downloadFlags(countries)

  const nameIndex = buildNameIndex(countries)
  const cityMap = new Map()
  for (const entry of cityEntries) {
    const nameKey = normalizeName(entry.country)
    const matched = nameIndex.get(nameKey)
    if (!matched) continue
    const cca3 = matched.cca3
    if (!cca3) continue
    const cities = Array.isArray(entry.cities) ? entry.cities : []
    cityMap.set(cca3, cities)
  }

  const merged = countries.map((country) => ({
    cca2: country.cca2 ?? null,
    cca3: country.cca3 ?? null,
    ccn3: country.ccn3 ?? null,
    name: country.name?.common ?? '',
    officialName: country.name?.official ?? '',
    capital: Array.isArray(country.capital) ? country.capital : [],
    region: country.region ?? '',
    subregion: country.subregion ?? '',
    population: country.population ?? 0,
    area: country.area ?? 0,
    latlng: Array.isArray(country.latlng) ? country.latlng : [],
    landlocked: Boolean(country.landlocked),
    currencies: buildCurrencyList(country.currencies),
    languages: buildLanguageList(country.languages),
    borders: Array.isArray(country.borders) ? country.borders : [],
    cities: cityMap.get(country.cca3) ?? [],
    rivers: [],
    highestPeak: null,
    mountainRanges: [],
    physicalRegions: [],
    flagSvg: country.cca2 ? `/flags/svg/${country.cca2}.svg` : null,
    flagPng: country.cca2 ? `/flags/png/${country.cca2}.png` : null,
  }))

  const mergedPath = path.join(OUT_DIR, 'countries_merged.json')

  console.log('Preparing Natural Earth features...')
  const neGeojson = JSON.parse(neText)
  const features = neGeojson.features || []
  const unresolved = []

  for (const feature of features) {
    const properties = feature.properties || {}
    const cca3 = normalizeCca3(properties.ADM0_A3 || properties.ISO_A3)
    if (!cca3) {
      unresolved.push(properties.ADMIN || properties.NAME)
    } else {
      feature.properties = {
        ...properties,
        cca3,
      }
    }
  }

  const neOutPath = path.join(OUT_DIR, 'admin0_sovereignty.geojson')
  await writeFile(neOutPath, JSON.stringify(neGeojson), 'utf-8')

  console.log('Assigning rivers to countries...')
  const riversGeojson = JSON.parse(riversText)
  const riverFeatures = riversGeojson.features || []
  const countryFeatures = features
    .filter((feature) => feature.properties?.cca3)
    .map((feature) => ({
      cca3: feature.properties.cca3,
      geometry: feature.geometry,
      bbox: computeBBoxFromPolygon(feature.geometry),
    }))

  const riversByCountry = new Map()
  for (const river of riverFeatures) {
    const name = river.properties?.name || river.properties?.name_en
    if (!name || !river.geometry) continue
    const segments = toLineSegments(river.geometry)
    if (!segments.length) continue

    const riverBbox = segments.reduce(
      (bbox, segment) => {
        const segmentBbox = computeBBoxFromLine(segment)
        return [
          Math.min(bbox[0], segmentBbox[0]),
          Math.min(bbox[1], segmentBbox[1]),
          Math.max(bbox[2], segmentBbox[2]),
          Math.max(bbox[3], segmentBbox[3]),
        ]
      },
      [Infinity, Infinity, -Infinity, -Infinity],
    )

    const candidates = countryFeatures.filter((country) => {
      if (
        riverBbox[2] < country.bbox[0] ||
        riverBbox[0] > country.bbox[2] ||
        riverBbox[3] < country.bbox[1] ||
        riverBbox[1] > country.bbox[3]
      ) {
        return false
      }
      return true
    })

    if (!candidates.length) continue

    const sampledPoints = []
    for (const segment of segments) {
      sampledPoints.push(...sampleLinePoints(segment, 6))
    }

    for (const country of candidates) {
      if (!country.geometry) continue
      const isMatch = sampledPoints.some((point) => isPointInGeometry(point, country.geometry))
      if (!isMatch) continue
      if (!riversByCountry.has(country.cca3)) {
        riversByCountry.set(country.cca3, new Set())
      }
      riversByCountry.get(country.cca3).add(name)
    }
  }

  for (const country of merged) {
    if (!country.cca3) continue
    const rivers = riversByCountry.get(country.cca3)
    if (rivers) {
      country.rivers = Array.from(rivers).slice(0, 8)
    }
  }

  console.log('Assigning peaks to countries...')
  const elevationGeojson = JSON.parse(elevationText)
  const elevationFeatures = elevationGeojson.features || []
  const peaksByCountry = new Map()

  for (const feature of elevationFeatures) {
    const properties = feature.properties || {}
    const geometry = feature.geometry
    if (!geometry || geometry.type !== 'Point') continue
    const elevation = Number(properties.elevation)
    if (!Number.isFinite(elevation)) continue
    const name =
      properties.name ?? properties.name_en ?? properties.label ?? properties.name_alt ?? null
    if (!name) continue
    const [lng, lat] = geometry.coordinates

    const candidates = countryFeatures.filter((country) =>
      isPointInBBox(lng, lat, country.bbox),
    )
    if (!candidates.length) continue

    for (const country of candidates) {
      if (!country.geometry) continue
      if (!isPointInGeometry([lng, lat], country.geometry)) continue
      const prev = peaksByCountry.get(country.cca3)
      if (!prev || elevation > prev.elevation) {
        peaksByCountry.set(country.cca3, { name, elevation })
      }
    }
  }

  console.log('Assigning geography regions to countries...')
  const regionsGeojson = JSON.parse(regionsText)
  const regionFeatures = regionsGeojson.features || []
  const rangesByCountry = new Map()
  const regionsByCountry = new Map()

  for (const feature of regionFeatures) {
    const properties = feature.properties || {}
    const geometry = feature.geometry
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue
    const name = getGeoRegionName(properties)
    if (!name) continue

    const featureClass = String(properties.FEATURECLA ?? '')
    const descriptor = `${featureClass} ${name}`.toLowerCase()
    const isRange = RANGE_KEYWORDS.some((keyword) => descriptor.includes(keyword))
    const isRegion =
      !isRange && REGION_KEYWORDS.some((keyword) => descriptor.includes(keyword))
    if (!isRange && !isRegion) continue

    const regionBbox = computeBBoxFromPolygon(geometry)
    const candidates = countryFeatures.filter((country) => {
      if (
        regionBbox[2] < country.bbox[0] ||
        regionBbox[0] > country.bbox[2] ||
        regionBbox[3] < country.bbox[1] ||
        regionBbox[1] > country.bbox[3]
      ) {
        return false
      }
      return true
    })
    if (!candidates.length) continue

    const sampledPoints = samplePolygonPoints(geometry, 8)
    for (const country of candidates) {
      if (!country.geometry) continue
      const isMatch = sampledPoints.some((point) => isPointInGeometry(point, country.geometry))
      if (!isMatch) continue
      const bucket = isRange ? rangesByCountry : regionsByCountry
      if (!bucket.has(country.cca3)) {
        bucket.set(country.cca3, new Set())
      }
      bucket.get(country.cca3).add(name)
    }
  }

  for (const country of merged) {
    if (!country.cca3) continue
    const peak = peaksByCountry.get(country.cca3)
    if (peak) {
      country.highestPeak = peak
    }
    const ranges = rangesByCountry.get(country.cca3)
    if (ranges) {
      country.mountainRanges = Array.from(ranges).slice(0, 8)
    }
    const regions = regionsByCountry.get(country.cca3)
    if (regions) {
      country.physicalRegions = Array.from(regions).slice(0, 8)
    }
  }

  await writeFile(mergedPath, JSON.stringify(merged, null, 2), 'utf-8')

  console.log(`Unresolved features: ${unresolved.length}`)
  if (unresolved.length) {
    console.log(unresolved.slice(0, 15))
  }
  console.log('Done.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
