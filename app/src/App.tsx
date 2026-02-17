import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import countriesData from './data/countries_merged.json'
import admin0GeoJsonUrl from './data/admin0_sovereignty.geojson?url'
import riversGeoJsonUrl from './data/raw/ne_50m_rivers.geojson?url'
import gdpData from './data/gdp_by_country.json'
import exportsData from './data/exports_by_country.json'
import unescoData from './data/unesco_sites.json'
import landmarksData from './data/landmarks.json'

type QuestionType =
  | 'map_tap'
  | 'flag_match'
  | 'capital_mcq'
  | 'neighbor_mcq'
  | 'currency_mcq'
  | 'city_mcq'
  | 'river_mcq'
  | 'language_mcq'
  | 'population_pair'
  | 'area_pair'
  | 'landlocked_mcq'
  | 'peak_mcq'
  | 'range_mcq'
  | 'region_mcq'
  | 'subregion_outlier'
  | 'neighbor_count_mcq'
  | 'population_rank'
  | 'silhouette_mcq'
  | 'coastline_mcq'
  | 'flag_colors_mcq'
  | 'unesco_mcq'
  | 'landmark_photo_mcq'
  | 'population_tier'
  | 'population_more_than'
  | 'gdp_tier'
  | 'economy_exports_mcq'
  | 'journey_puzzle'
  | 'region_builder'

type CountryMeta = {
  cca2: string | null
  cca3: string | null
  name: string
  officialName: string
  capital: string[]
  region: string
  subregion: string
  population: number
  area: number
  latlng: number[]
  landlocked: boolean
  currencies: { code: string; name: string; symbol: string }[]
  languages: string[]
  borders: string[]
  cities: string[]
  rivers: string[]
  highestPeak: { name: string; elevation: number } | null
  mountainRanges: string[]
  physicalRegions: string[]
  flagSvg: string | null
  flagPng: string | null
  gdpUsd?: number | null
  gdpYear?: number | null
  gdpRank?: number | null
  topExports?: { hs2: string | null; label: string; tradeValue: number }[]
  unescoSites?: string[]
}

type GeoFeature = {
  type: 'Feature'
  properties: { cca3?: string }
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

type FeatureRecord = {
  feature: GeoFeature
  bbox: [number, number, number, number]
}

type RiverFeature = {
  type: 'Feature'
  properties?: { name?: string; name_en?: string }
  geometry?: {
    type: 'LineString' | 'MultiLineString'
    coordinates: number[][] | number[][][]
  }
}

type RiverRecord = {
  bbox: [number, number, number, number]
}

type Question = {
  id: string
  type: QuestionType
  prompt: string
  options?: string[]
  correctIndex?: number
  optionCca3s?: (string | null | undefined)[]
  flagSvg?: string | null
  flagPng?: string | null
  imagePath?: string | null
  targetFeature?: FeatureRecord
  targetCca3?: string
  displayCca3s?: string[]
  continent?: string
  hideLabels?: boolean
  journeyPath?: string[] // For journey_puzzle: [start, ...intermediate, end]
  selectedCountries?: string[] // For region_builder: selected country CCA3s
  correctCountries?: string[] // For region_builder: correct country CCA3s
}

type LandmarkEntry = {
  id: string
  title: string
  country: string
  cca3: string
  imagePath: string
  license: string
  sourceUrl: string
  credit: string
}


function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const flagFallbackRef = useRef(false)
  const flashTimeoutRef = useRef<number | null>(null)
  const flashedIdsRef = useRef<string[]>([])
  const focusedIdsRef = useRef<string[]>([])
  const nextTimeoutRef = useRef<number | null>(null)
  const settingsRef = useRef<HTMLDivElement | null>(null)
  const processingRef = useRef(false)
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [isDataLoaded, setIsDataLoaded] = useState(false)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [featureIndex, setFeatureIndex] = useState<Map<string, FeatureRecord>>(new Map())
  const [riverIndex, setRiverIndex] = useState<Map<string, RiverRecord>>(new Map())
  const [score, setScore] = useState(0)
  const [displayScore, setDisplayScore] = useState(0)
  const [currentStreak, setCurrentStreak] = useState(0)
  const [hearts, setHearts] = useState(3)
  const [gameOver, setGameOver] = useState(false)
  const [removedIndices, setRemovedIndices] = useState<number[]>([])
  const [showShimmer, setShowShimmer] = useState(false)
  const [hintsLeft, setHintsLeft] = useState(3)
  const [skipsLeft, setSkipsLeft] = useState(3)
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [level, setLevel] = useState(1)
  const [correctInLevel, setCorrectInLevel] = useState(0)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [isMuted, setIsMuted] = useState(false)
  const [shakeIndex, setShakeIndex] = useState<number | null>(null)
  const [isLevelUp, setIsLevelUp] = useState(false)
  const [mastery, setMastery] = useState<Record<string, number>>({})
  const [completedQuestions, setCompletedQuestions] = useState<string[]>([])
  const [performanceStats, setPerformanceStats] = useState<Record<QuestionType, { correct: number; total: number; totalResponseTime: number }>>({} as Record<QuestionType, { correct: number; total: number; totalResponseTime: number }>)
  const questionStartTimeRef = useRef<number>(0)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const [isAtlasOpen, setIsAtlasOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [achievements, setAchievements] = useState<string[]>([])
  const [notification, setNotification] = useState<{ id: string; title: string } | null>(null)
  const [levelStartScore, setLevelStartScore] = useState(0)
  const [comboTip, setComboTip] = useState<{ message: string; visible: boolean }>({ message: '', visible: false })
  const [guidanceTip, setGuidanceTip] = useState<string | null>(null)
  const [scorePopups, setScorePopups] = useState<{ id: string; x: number; y: number; value: string }[]>([])
  const [mapShake, setMapShake] = useState(false)
  const rotationTimeoutRef = useRef<number | null>(null)
  const [atlasTab, setAtlasTab] = useState<'atlas' | 'stats'>('atlas')

  const countryPools = useMemo(() => {
    const countries = countriesData as CountryMeta[]
    const gdpValues =
      (gdpData as { values?: Record<string, { value: number; year: number }> }).values ?? {}
    const exportValues =
      (exportsData as {
        values?: Record<string, { hs2: string | null; label: string; tradeValue: number }[]>
      }).values ?? {}
    const unescoSites =
      (unescoData as { sites?: { name: string; cca3s: string[] }[] }).sites ?? []
    const landmarks = landmarksData as LandmarkEntry[]

    const unescoByCca3 = new Map<string, string[]>()
    for (const site of unescoSites) {
      if (!Array.isArray(site.cca3s)) continue
      for (const cca3 of site.cca3s) {
        if (!unescoByCca3.has(cca3)) unescoByCca3.set(cca3, [])
        unescoByCca3.get(cca3)?.push(site.name)
      }
    }

    const landmarkByCca3 = new Map<string, LandmarkEntry[]>()
    for (const entry of landmarks) {
      if (!entry.cca3) continue
      if (!landmarkByCca3.has(entry.cca3)) {
        landmarkByCca3.set(entry.cca3, [])
      }
      landmarkByCca3.get(entry.cca3)?.push(entry)
    }

    const enrichedCountries = countries.map((country) => {
      const cca3 = country.cca3 ?? ''
      const gdpEntry = gdpValues[cca3]
      const topExports = exportValues[cca3] ?? country.topExports ?? []
      const unescoList = unescoByCca3.get(cca3) ?? country.unescoSites ?? []
      return {
        ...country,
        gdpUsd: gdpEntry?.value ?? country.gdpUsd ?? null,
        gdpYear: gdpEntry?.year ?? country.gdpYear ?? null,
        topExports,
        unescoSites: unescoList,
      }
    })

    const countriesByCca3 = new Map<string, CountryMeta>()
    for (const country of enrichedCountries) {
      if (country.cca3) {
        countriesByCca3.set(country.cca3, country)
      }
    }

    const sorted = [...enrichedCountries].sort((a, b) => {
      const scoreA = (a.population || 0) + (a.area || 0) / 10
      const scoreB = (b.population || 0) + (b.area || 0) / 10
      return scoreB - scoreA
    })
    const filterAndSort = (pool: CountryMeta[]) =>
      [...pool].sort((a, b) => {
        const scoreA = (a.population || 0) + (a.area || 0) / 10
        const scoreB = (b.population || 0) + (b.area || 0) / 10
        return scoreB - scoreA
      })

    const populationRankByCca3 = new Map<string, number>()
    const populationSorted = [...enrichedCountries]
      .filter((country) => (country.population ?? 0) > 0)
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    populationSorted.forEach((country, idx) => {
      if (country.cca3) populationRankByCca3.set(country.cca3, idx + 1)
    })

    const gdpRankByCca3 = new Map<string, number>()
    const gdpSorted = [...enrichedCountries]
      .filter((country) => (country.gdpUsd ?? 0) > 0)
      .sort((a, b) => (b.gdpUsd ?? 0) - (a.gdpUsd ?? 0))
    gdpSorted.forEach((country, idx) => {
      if (country.cca3) gdpRankByCca3.set(country.cca3, idx + 1)
    })

    const mapPool = filterAndSort(
      enrichedCountries.filter((country) => country.cca3 && featureIndex.has(country.cca3)),
    )
    const flagPool = filterAndSort(
      enrichedCountries.filter((country) => country.cca2 && (country.flagSvg || country.flagPng)),
    )
    const capitalPool = filterAndSort(enrichedCountries.filter((country) => country.capital?.length))
    const neighborPool = filterAndSort(
      enrichedCountries.filter(
        (country) =>
          country.borders?.length && country.borders.some((code) => countriesByCca3.has(code)),
      ),
    )
    const currencyPool = filterAndSort(enrichedCountries.filter((country) => country.currencies?.length))
    const cityPool = filterAndSort(enrichedCountries.filter((country) => country.cities?.length))
    const riverPool = filterAndSort(enrichedCountries.filter((country) => country.rivers?.length))
    const languagePool = filterAndSort(enrichedCountries.filter((country) => country.languages?.length))
    const populationPool = filterAndSort(
      enrichedCountries.filter((country) => (country.population ?? 0) > 0),
    )
    const areaPool = filterAndSort(enrichedCountries.filter((country) => (country.area ?? 0) > 0))
    const landlockedPool = filterAndSort(
      enrichedCountries.filter((country) => typeof country.landlocked === 'boolean'),
    )
    const peakPool = filterAndSort(enrichedCountries.filter((country) => country.highestPeak?.name))
    const rangePool = filterAndSort(enrichedCountries.filter((country) => country.mountainRanges?.length))
    const regionPool = filterAndSort(
      enrichedCountries.filter((country) => country.physicalRegions?.length),
    )
    const unescoPool = filterAndSort(
      enrichedCountries.filter((country) => country.unescoSites?.length),
    )
    const exportsPool = filterAndSort(
      enrichedCountries.filter((country) => country.topExports?.length),
    )
    const gdpPool = filterAndSort(enrichedCountries.filter((country) => (country.gdpUsd ?? 0) > 0))
    const landmarkPool = filterAndSort(
      enrichedCountries.filter((country) => country.cca3 && landmarkByCca3.has(country.cca3)),
    )
    return {
      countries: sorted,
      countriesByCca3,
      mapPool,
      flagPool,
      capitalPool,
      neighborPool,
      currencyPool,
      cityPool,
      riverPool,
      languagePool,
      populationPool,
      areaPool,
      landlockedPool,
      peakPool,
      rangePool,
      regionPool,
      unescoPool,
      exportsPool,
      gdpPool,
      landmarkPool,
      landmarkByCca3,
      populationRankByCca3,
      gdpRankByCca3,
    }
  }, [countriesData, featureIndex])

  const atlasByContinent = useMemo(() => {
    const groups: Record<string, CountryMeta[]> = {}
    countryPools.countries.forEach(c => {
      const region = c.region || 'Other'
      if (!groups[region]) groups[region] = []
      groups[region].push(c)
    })
    return groups
  }, [countryPools.countries])

  const triggerAchievement = (id: string, title: string) => {
    setAchievements((prev) => {
      if (prev.includes(id)) return prev
      setNotification({ id, title })
      playGameSound('powerup', isMuted)
      return [...prev, id]
    })
  }

  const handleNext = useCallback(() => {
    const question = buildNextQuestion({
      pools: countryPools,
      featureIndex,
      queueRef,
      typeIndexRef,
      level,
      idPrefix: `${Date.now()} -${Math.random().toString(36).substring(7)} `,
      completedQuestions,
      performanceStats,
    })
    setCurrentQuestion(question)
    // Track question start time for response time calculation
    questionStartTimeRef.current = Date.now()
  }, [countryPools, featureIndex, level, completedQuestions, performanceStats])

  const queueRef = useRef<Record<QuestionType, string[]>>({
    map_tap: [],
    flag_match: [],
    capital_mcq: [],
    neighbor_mcq: [],
    currency_mcq: [],
    city_mcq: [],
    river_mcq: [],
    language_mcq: [],
    population_pair: [],
    area_pair: [],
    landlocked_mcq: [],
    peak_mcq: [],
    range_mcq: [],
    region_mcq: [],
    subregion_outlier: [],
    neighbor_count_mcq: [],
    population_rank: [],
    silhouette_mcq: [],
    coastline_mcq: [],
    flag_colors_mcq: [],
    unesco_mcq: [],
    landmark_photo_mcq: [],
    population_tier: [],
    population_more_than: [],
    gdp_tier: [],
    economy_exports_mcq: [],
    journey_puzzle: [],
    region_builder: [],
  })
  const typeIndexRef = useRef(0)

  const restartGame = () => {
    setHearts(3)
    setGameOver(false)
    // Progress (score, level, correctInLevel) is now preserved for a "persistent" experience
    setCurrentStreak(0)
    setHintsLeft(3)
    setSkipsLeft(3)
    if (nextTimeoutRef.current) {
      window.clearTimeout(nextTimeoutRef.current)
      nextTimeoutRef.current = null
    }

    // Penalty logic: Reset score to start of level
    setScore(levelStartScore)
    setGuidanceTip("Game Over! Score reverted to Level start.")
    setTimeout(() => setGuidanceTip(null), 3500)
    setComboTip({ message: 'Score Reverted!', visible: true })
    setTimeout(() => setComboTip(prev => ({ ...prev, visible: false })), 2000)

    // Refresh question if it was stuck
    const question = buildNextQuestion({
      pools: countryPools,
      featureIndex,
      queueRef,
      typeIndexRef,
      level,
      idPrefix: `reset - ${Date.now()} `,
      completedQuestions,
    })
    setCurrentQuestion(question)
  }

  const fullResetGame = () => {
    if (!window.confirm("Are you sure you want to reset all progress? This will wipe your score, level, mastery, and achievements forever.")) {
      return
    }

    // Reset all progress states
    setScore(0)
    setDisplayScore(0)
    setLevel(1)
    setHearts(3)
    setCorrectInLevel(0)
    setCurrentStreak(0)
    setMastery({})
    setAchievements([])
    setCompletedQuestions([])
    setHintsLeft(3)
    setSkipsLeft(3)
    setSessionSeconds(0)
    setLevelStartScore(0)
    setGameOver(false)
    setRemovedIndices([])
    setNotification(null)
    setGuidanceTip("Progress Reset Complete")
    setTimeout(() => setGuidanceTip(null), 3000)

    // Clear local storage
    localStorage.removeItem('geotest-progress')

    // Refresh UI
    setIsSettingsOpen(false)
    handleNext()
  }

  const [isProgressLoaded, setIsProgressLoaded] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('geotest-progress')
    if (saved) {
      try {
        const data = JSON.parse(saved)
        if (typeof data.score === 'number') setScore(data.score)
        if (typeof data.level === 'number') setLevel(data.level)

        // If they left with 0 hearts, keep them at Game Over
        if (typeof data.hearts === 'number') {
          setHearts(data.hearts)
          if (data.hearts <= 0) setGameOver(true)
        }

        if (typeof data.correctInLevel === 'number') setCorrectInLevel(data.correctInLevel)
        if (typeof data.streak === 'number') setCurrentStreak(data.streak)
        if (data.theme === 'light' || data.theme === 'dark') setTheme(data.theme)
        if (typeof data.isMuted === 'boolean') setIsMuted(data.isMuted)
        if (data.mastery) setMastery(data.mastery)
        if (Array.isArray(data.achievements)) setAchievements(data.achievements)
        if (Array.isArray(data.completedQuestions)) setCompletedQuestions(data.completedQuestions)
        if (data.performanceStats) {
          // Migrate old performanceStats format (without totalResponseTime)
          const migratedStats: Record<QuestionType, { correct: number; total: number; totalResponseTime: number }> = {} as any
          for (const [type, stat] of Object.entries(data.performanceStats)) {
            const statData = stat as { correct?: number; total?: number; totalResponseTime?: number }
            migratedStats[type as QuestionType] = {
              correct: statData.correct || 0,
              total: statData.total || 0,
              totalResponseTime: statData.totalResponseTime || 0
            }
          }
          setPerformanceStats(migratedStats)
        }

        if (typeof data.levelStartScore === 'number') {
          setLevelStartScore(data.levelStartScore)
        } else if (typeof data.score === 'number') {
          // Migration: If no level start score saved, assume current score is the floor
          setLevelStartScore(data.score)
        }
      } catch (e) {
        console.error('Failed to load progress', e)
      }
    } else {
      // Default to system preference if no saved theme
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        setTheme('light')
      }
    }
    setIsProgressLoaded(true)
  }, [])

  useEffect(() => {
    if (!isProgressLoaded) return
    localStorage.setItem('geotest-progress', JSON.stringify({
      score,
      level,
      hearts,
      correctInLevel,
      streak: currentStreak,
      theme,
      isMuted,
      mastery,
      achievements,
      completedQuestions,
      levelStartScore,
      performanceStats
    }))
    document.body.classList.toggle('light-mode', theme === 'light')
  }, [score, level, hearts, correctInLevel, currentStreak, theme, isMuted, mastery, achievements, completedQuestions, levelStartScore, performanceStats, isProgressLoaded])

  useEffect(() => {
    if (!notification) return
    const timer = setTimeout(() => setNotification(null), 4000)
    return () => clearTimeout(timer)
  }, [notification])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const colors = theme === 'dark'
      ? { bg: '#0b0f14', fill: '#1a202a', border: '#2d3644' }
      : { bg: '#f0f4f8', fill: '#e1e8ed', border: '#b0c4de' }

    if (map.getLayer('background')) {
      map.setPaintProperty('background', 'background-color', colors.bg)
    }
    if (map.getLayer('country-fill')) {
      map.setPaintProperty('country-fill', 'fill-color', [
        'case',
        ['==', ['feature-state', 'flash'], 'correct'],
        '#2ecc71',
        ['==', ['feature-state', 'flash'], 'incorrect'],
        '#e74c3c',
        colors.fill,
      ])
    }
    if (map.getLayer('country-borders')) {
      map.setPaintProperty('country-borders', 'line-color', [
        'case',
        ['==', ['feature-state', 'flash'], 'correct'],
        '#38d27a',
        ['==', ['feature-state', 'flash'], 'incorrect'],
        '#ff5a5a',
        colors.border,
      ])
    }
  }, [theme, isDataLoaded])

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (displayScore === score) return
    const diff = score - displayScore
    const step = Math.max(1, Math.floor(diff / 10))
    const timer = setTimeout(() => {
      setDisplayScore((s) => Math.min(s + step, score))
    }, 30)
    return () => clearTimeout(timer)
  }, [score, displayScore])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false)
      }
    }
    if (isSettingsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSettingsOpen])

  useEffect(() => {
    let isActive = true

    const loadGeoJson = async () => {
      try {
        setLoadingProgress((p) => p + 10)
        const response = await fetch(admin0GeoJsonUrl)
        if (!response.ok) {
          throw new Error(`GeoJSON fetch failed: ${response.status} `)
        }
        setLoadingProgress((p) => p + 30)
        const data = (await response.json()) as { features: GeoFeature[] }
        const index = new Map<string, FeatureRecord>()
        const features = data.features ?? []
        for (const feature of features) {
          const cca3 = feature.properties?.cca3
          if (!cca3) continue
          if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue
          const bbox = computeBBox(feature.geometry)
          index.set(cca3, { feature, bbox })
        }
        if (isActive) {
          setFeatureIndex(index)
          setLoadingProgress((p) => p + 10)
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadGeoJson()
    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    let isActive = true

    const loadRivers = async () => {
      try {
        setLoadingProgress((p) => p + 10)
        const response = await fetch(riversGeoJsonUrl)
        if (!response.ok) {
          throw new Error(`Rivers fetch failed: ${response.status} `)
        }
        setLoadingProgress((p) => p + 30)
        const data = (await response.json()) as { features: RiverFeature[] }
        const index = new Map<string, RiverRecord>()
        for (const feature of data.features ?? []) {
          const name = getRiverName(feature.properties)
          if (!name || !feature.geometry) continue
          const bbox = computeRiverBBox(feature.geometry)
          if (!bbox) continue
          const key = normalizeLabel(name)
          const existing = index.get(key)
          const merged = existing ? mergeBBoxes(existing.bbox, bbox) : bbox
          index.set(key, { bbox: merged })
        }
        if (isActive) {
          setRiverIndex(index)
          setLoadingProgress(100)
          setTimeout(() => setIsDataLoaded(true), 500)
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadRivers()
    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      attributionControl: false,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': theme === 'dark' ? '#0b0f14' : '#f0f4f8',
            },
          },
        ],
      },
      center: [0, 20],
      zoom: 1.5,
    })

    mapRef.current = map

    map.on('load', () => {
      map.addSource('countries', {
        type: 'geojson',
        data: admin0GeoJsonUrl,
        promoteId: 'cca3',
      })
      map.addLayer({
        id: 'country-fill',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': [
            'case',
            ['==', ['feature-state', 'flash'], 'correct'],
            '#2ecc71',
            ['==', ['feature-state', 'flash'], 'incorrect'],
            '#e74c3c',
            theme === 'dark' ? '#1a202a' : '#e1e8ed',
          ],
          'fill-opacity': [
            'case',
            ['==', ['feature-state', 'flash'], 'correct'],
            0.9,
            ['==', ['feature-state', 'flash'], 'incorrect'],
            0.85,
            0.6,
          ],
        },
      })
      map.addLayer({
        id: 'country-flash',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': [
            'case',
            ['==', ['feature-state', 'flash'], 'correct'],
            '#38d27a',
            ['==', ['feature-state', 'flash'], 'incorrect'],
            '#ff5a5a',
            theme === 'dark' ? '#2d3644' : '#b0c4de',
          ],
          'line-width': [
            'case',
            ['==', ['feature-state', 'flash'], 'correct'],
            6,
            ['==', ['feature-state', 'flash'], 'incorrect'],
            5,
            1,
          ],
          'line-blur': [
            'case',
            ['==', ['feature-state', 'flash'], 'correct'],
            2,
            ['==', ['feature-state', 'flash'], 'incorrect'],
            1.6,
            0,
          ],
        },
      })
      map.addLayer({
        id: 'country-focus',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'focus'], false],
            '#4cc4ff',
            'rgba(0,0,0,0)',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'focus'], false],
            2.5,
            0,
          ],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'focus'], false],
            0.9,
            0,
          ],
        },
      })
      map.addLayer({
        id: 'country-borders',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': theme === 'dark' ? '#2d3644' : '#cbd5e1',
          'line-width': 1,
        },
      })
      setMapLoaded(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    setSelectedIndex(null)
    flagFallbackRef.current = false
    setRemovedIndices([])
    processingRef.current = false
  }, [currentQuestion?.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !currentQuestion) return

    const handleMapTap = (event: maplibregl.MapMouseEvent) => {
      if (processingRef.current) return
      if (currentQuestion.type !== 'map_tap' || !currentQuestion.targetFeature) return
      processingRef.current = true
      const { lng, lat } = event.lngLat
      // MapLibre reports WGS84 lon/lat (world -> geographic).
      const clickBounds: [maplibregl.PointLike, maplibregl.PointLike] = [
        [event.point.x - 6, event.point.y - 6],
        [event.point.x + 6, event.point.y + 6],
      ]
      const clickedFeatures = map.queryRenderedFeatures(clickBounds, {
        layers: ['country-fill'],
      })
      const clickedFeature = clickedFeatures[0]
      const clickedCca3 = clickedFeature?.properties?.cca3 as string | undefined
      const correctCca3 = currentQuestion.targetFeature.feature.properties.cca3
      const isCorrect =
        isPointInFeature(lng, lat, currentQuestion.targetFeature) ||
        clickedFeatures.some((feature) => feature.properties?.cca3 === correctCca3) ||
        isSmallTargetHit(map, currentQuestion.targetFeature.bbox, event.point)

      flashCountrySelection(map, {
        clickedCca3,
        correctCca3,
        isCorrect,
        flashedIdsRef,
        flashTimeoutRef,
      })

      if (!isCorrect) {
        setHearts((h) => {
          const next = h - 1
          if (next <= 0) {
            setGameOver(true)
          }
          return next
        })
      }

      if (isCorrect && correctCca3) {
        setMastery((prev) => {
          const nextVal = (prev[correctCca3] ?? 0) + 1
          const next = { ...prev, [correctCca3]: nextVal }

          // Mastery Achievements
          const masteredCount = Object.values(next).filter((v: number) => v >= 1).length
          if (masteredCount === 100) triggerAchievement('atlas100', 'World Completionist (100 Mastered)')
          else if (masteredCount === 50) triggerAchievement('atlas50', 'Atlas Pro (50 Mastered)')
          else if (masteredCount === 25) triggerAchievement('atlas25', 'Globe Trotter (25 Mastered)')

          return next
        })
        setCompletedQuestions(prev => [...prev, `${currentQuestion.type}-${correctCca3}`])
        const comboMult = 1 + (currentStreak * 0.2)
        const basePoints = getPointsForQuestion(currentQuestion.type)
        const points = Math.round(basePoints * (1 + (level - 1) * 0.2) * comboMult)

        // Popup logic
        const popupId = `${Date.now()}-${Math.random()}`
        setScorePopups(prev => [...prev, { id: popupId, x: event.point.x, y: event.point.y, value: `+${formatScore(points)}` }])
        setTimeout(() => setScorePopups(prev => prev.filter(p => p.id !== popupId)), 1000)

        setScore((s) => {
          const next = s + points
          return next
        })

        if (currentStreak > 0 && (currentStreak + 1) % 5 === 0) {
          const nextMult = 1 + ((currentStreak + 1) * 0.2)
          setGuidanceTip(`Combo x${nextMult.toFixed(1)}! Earnings significantly boosted.`)
          setTimeout(() => setGuidanceTip(null), 3000)
          setComboTip({ message: `Combo x${nextMult.toFixed(1)}!`, visible: true })
          setTimeout(() => setComboTip(prev => ({ ...prev, visible: false })), 1500)
        }

        setCorrectInLevel((prev) => {
          const next = prev + 1
          if (next >= 5) {
            setLevel((l) => l + 1)
            setHearts((h) => Math.min(h + 1, 3))
            return 0
          }
          return next
        })

        setCurrentStreak((prev) => {
          const next = prev + 1
          if (next % 5 === 0) {
            setHearts((h) => Math.min(h + 1, 3))
          }
          return next
        })
        if (nextTimeoutRef.current) {
          window.clearTimeout(nextTimeoutRef.current)
        }
        nextTimeoutRef.current = window.setTimeout(() => {
          handleNext()
          nextTimeoutRef.current = null
        }, 700)
      } else {
        setCorrectInLevel(0)
        setCurrentStreak(0)
        setMapShake(true)
        setTimeout(() => setMapShake(false), 500)
        if (nextTimeoutRef.current) {
          window.clearTimeout(nextTimeoutRef.current)
        }
        const isDead = hearts <= 1
        if (!isDead) {
          nextTimeoutRef.current = window.setTimeout(() => {
            handleNext()
            nextTimeoutRef.current = null
          }, 3000)
        }
      }
    }

    map.on('click', handleMapTap)
    return () => {
      map.off('click', handleMapTap)
    }
  }, [currentQuestion, level, currentStreak, hearts, score, setCorrectInLevel, setGameOver, setHearts, setLevel, setScore, setCurrentStreak, handleNext, countryPools, featureIndex])

  useEffect(() => {
    if (!currentQuestion) return
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Skip camera movement for journey_puzzle and region_builder (handled separately)
    if (currentQuestion.type === 'journey_puzzle' || currentQuestion.type === 'region_builder') {
      return
    }

    if (!currentQuestion.targetFeature) return

    // Clear any pending rotation
    if (rotationTimeoutRef.current) {
      window.clearTimeout(rotationTimeoutRef.current)
      rotationTimeoutRef.current = null
    }

    // Values are recalculated inside setTimeout, so no need to calculate here

    // Cancel any pending rotation when new question appears
    if (rotationTimeoutRef.current) {
      window.clearTimeout(rotationTimeoutRef.current)
      rotationTimeoutRef.current = null
    }

    // Don't stop animations - let MapLibre handle transitions naturally
    // MapLibre's flyTo will smoothly transition from current state
    const questionId = currentQuestion.id
    
    // Small delay to batch rapid question changes and ensure map is ready
    const animationTimeout = setTimeout(() => {
      const currentMap = mapRef.current
      if (!currentMap || !currentQuestion || currentQuestion.id !== questionId || !currentQuestion.targetFeature) {
        return
      }
      
      // Ensure map is in a valid state before animating
      try {
        // Check if map is loaded and ready
        if (!currentMap.loaded() || !currentMap.getCenter()) {
          return
        }
      } catch (e) {
        return
      }
      
      try {
        // Recalculate values to ensure they're fresh
        const currentIsMapTap = currentQuestion.type === 'map_tap'
        const currentIsCoastline = currentQuestion.type === 'coastline_mcq'
        const currentIsSilhouette = currentQuestion.type === 'silhouette_mcq'
        let currentZoom = currentIsCoastline ? 2.5 : (currentIsMapTap ? 0.85 : (currentIsSilhouette ? 2.0 : 1.2))
        const currentCenter = bboxCenter(currentQuestion.targetFeature.bbox)
        const currentBearing = (Math.random() - 0.5) * 20
        
        const currentTargetCca3 = currentQuestion.targetCca3
        const currentCountry = currentTargetCca3 ? countryPools.countriesByCca3.get(currentTargetCca3) ?? null : null
        const currentCountryType = getCountryType(currentCountry)
        
        let currentPitch: number
        if (currentIsCoastline) {
          currentPitch = 0
        } else {
          switch (currentCountryType) {
            case 'island':
              currentPitch = 20 + Math.random() * 15
              break
            case 'mountainous':
              currentPitch = 60 + Math.random() * 20
              break
            case 'large':
              currentZoom = Math.max(currentZoom - 0.3, 0.5)
              currentPitch = 30 + Math.random() * 20
              break
            case 'small':
              currentZoom = Math.min(currentZoom + 0.2, 3.0)
              currentPitch = 40 + Math.random() * 20
              break
            default:
              currentPitch = 35 + Math.random() * 25
          }
        }

        // Validate values before calling flyTo
        if (!currentCenter || !isFinite(currentCenter[0]) || !isFinite(currentCenter[1]) ||
            !isFinite(currentZoom) || !isFinite(currentPitch) || !isFinite(currentBearing)) {
          console.warn('Invalid camera parameters, skipping animation')
          return
        }

        // FlyTo without stopping - MapLibre handles smooth transitions
        currentMap.flyTo({
          center: currentCenter,
          zoom: currentZoom,
          duration: 1500,
          pitch: currentPitch,
          bearing: currentBearing,
          essential: true
        })
      } catch (error) {
        // Silently handle - map might be transitioning
        console.warn('Camera animation skipped:', error)
      }
    }, 150) // Slightly longer delay to ensure map state is stable

    return () => {
      clearTimeout(animationTimeout)
    }
  }, [currentQuestion?.id, mapLoaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !currentQuestion) return

    // Clear previous focus and silhouette states
    for (const id of focusedIdsRef.current) {
      map.setFeatureState({ source: 'countries', id }, { focus: false, silhouette: false })
    }
    focusedIdsRef.current = []

    if (currentQuestion.type === 'map_tap') return

    // Skip if camera movement is handled by the flyTo effect (questions with targetFeature)
    // This prevents conflicts between flyTo and fitBounds
    if (currentQuestion.targetFeature && 
        currentQuestion.type !== 'journey_puzzle' && 
        currentQuestion.type !== 'region_builder') {
      // Camera movement handled by flyTo effect above
      // Just set focus states for highlighting
      const displayCca3s = (currentQuestion.displayCca3s ?? []).filter(Boolean)
      for (const cca3 of displayCca3s) {
        map.setFeatureState({ source: 'countries', id: cca3 }, { focus: true })
        focusedIdsRef.current.push(cca3)
      }
      return
    }

    // Handle journey_puzzle: show path
    if (currentQuestion.type === 'journey_puzzle' && currentQuestion.journeyPath) {
      const pathCca3s = currentQuestion.journeyPath.filter(Boolean)
      for (const cca3 of pathCca3s) {
        map.setFeatureState({ source: 'countries', id: cca3 }, { focus: true })
        focusedIdsRef.current.push(cca3)
      }
      
      const bboxes = pathCca3s
        .map((cca3) => featureIndex.get(cca3)?.bbox)
        .filter(Boolean) as [number, number, number, number][]
      if (bboxes.length > 0) {
        const merged = bboxes.reduce(mergeBBoxes)
        requestAnimationFrame(() => {
          if (!map || !currentQuestion) return
          map.fitBounds(
            [
              [merged[0], merged[1]],
              [merged[2], merged[3]],
            ],
            { padding: 130, duration: 1500, maxZoom: 2.0, pitch: 45 },
          )
        })
      }
      return
    }

    // Handle region_builder: show correct countries
    if (currentQuestion.type === 'region_builder' && currentQuestion.displayCca3s) {
      const displayCca3s = currentQuestion.displayCca3s.filter(Boolean)
      for (const cca3 of displayCca3s) {
        map.setFeatureState({ source: 'countries', id: cca3 }, { focus: true })
        focusedIdsRef.current.push(cca3)
      }
      
      const bboxes = displayCca3s
        .map((cca3) => featureIndex.get(cca3)?.bbox)
        .filter(Boolean) as [number, number, number, number][]
      if (bboxes.length > 0) {
        const merged = bboxes.reduce(mergeBBoxes)
        requestAnimationFrame(() => {
          if (!map || !currentQuestion) return
          map.fitBounds(
            [
              [merged[0], merged[1]],
              [merged[2], merged[3]],
            ],
            { padding: 130, duration: 1500, maxZoom: 2.0, pitch: 45 },
          )
        })
      }
      return
    }

    // For questions without targetFeature but with displayCca3s
    const displayCca3s = (currentQuestion.displayCca3s ?? []).filter(Boolean)
    if (!displayCca3s.length) return

    for (const cca3 of displayCca3s) {
      map.setFeatureState({ source: 'countries', id: cca3 }, { focus: true })
      focusedIdsRef.current.push(cca3)
    }

    const bboxes = displayCca3s
      .map((cca3) => featureIndex.get(cca3)?.bbox)
      .filter(Boolean) as [number, number, number, number][]
    if (!bboxes.length) return
    const merged = bboxes.reduce(mergeBBoxes)
    
    requestAnimationFrame(() => {
      if (!map || !currentQuestion) return
      map.fitBounds(
        [
          [merged[0], merged[1]],
          [merged[2], merged[3]],
        ],
        { padding: 130, duration: 1500, maxZoom: 2.0, pitch: 45 },
      )
    })
  }, [currentQuestion?.id, featureIndex, currentQuestion?.journeyPath, currentQuestion?.selectedCountries, currentQuestion?.targetFeature])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    
    const isSilhouette = currentQuestion?.hideLabels
    const targetCca3 = currentQuestion?.targetCca3
    
    // Clear all silhouette states first
    const allFocusedIds = [...focusedIdsRef.current]
    if (targetCca3 && !allFocusedIds.includes(targetCca3)) {
      allFocusedIds.push(targetCca3)
    }
    for (const id of allFocusedIds) {
      try {
        map.setFeatureState({ source: 'countries', id }, { silhouette: false })
      } catch (e) {
        // Ignore errors for invalid IDs
      }
    }
    
    // Set silhouette state for the target country, then update paint property
    if (isSilhouette && targetCca3) {
      try {
        map.setFeatureState({ source: 'countries', id: targetCca3 }, { silhouette: true })
      } catch (e) {
        console.warn('Failed to set silhouette state:', e)
      }
    }
    
    // Use requestAnimationFrame to ensure state is set before updating paint
    requestAnimationFrame(() => {
      if (!map || !mapLoaded) return
      
      map.setPaintProperty('country-fill', 'fill-color', [
        'case',
        ['==', ['feature-state', 'flash'], 'correct'],
        '#2ecc71',
        ['==', ['feature-state', 'flash'], 'incorrect'],
        '#e74c3c',
        ['==', ['feature-state', 'silhouette'], true],
        '#ffffff',
        (theme === 'dark' ? '#1a202a' : '#e1e8ed'),
      ])
      // Revert borders/background to standard theme even in silhouette mode
      map.setPaintProperty('country-borders', 'line-color', theme === 'dark' ? '#2d3644' : '#cbd5e1')
      map.setPaintProperty('background', 'background-color', theme === 'dark' ? '#0b0f14' : '#f0f4f8')
    })
  }, [currentQuestion?.hideLabels, currentQuestion?.targetCca3, currentQuestion?.id, theme, mapLoaded])

  useEffect(() => {
    if (!currentQuestion || currentQuestion.type !== 'river_mcq') return
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const riverName = currentQuestion.options?.[currentQuestion.correctIndex ?? -1]
    if (!riverName) return
    const record = riverIndex.get(normalizeLabel(riverName))
    if (!record) return
    map.fitBounds(
      [
        [record.bbox[0], record.bbox[1]],
        [record.bbox[2], record.bbox[3]],
      ],

      { padding: 80, duration: 1500, pitch: 45 },
    )
  }, [currentQuestion?.id, riverIndex])

  useEffect(() => {
    if (currentQuestion) return // RESTORED FIX: if we have a question, do nothing.
    if (!countryPools.countries.length || featureIndex.size === 0) return
    handleNext()
  }, [countryPools, featureIndex, currentQuestion, handleNext])

  // Trigger shimmer animation 1 second after new question appears
  useEffect(() => {
    if (!currentQuestion) {
      setShowShimmer(false)
      return
    }
    
    setShowShimmer(false) // Reset shimmer state
    const timer = setTimeout(() => {
      setShowShimmer(true)
      // Remove shimmer-active after animation completes (1.5s)
      setTimeout(() => {
        setShowShimmer(false)
      }, 1500)
    }, 1000) // 1 second delay
    
    return () => {
      clearTimeout(timer)
    }
  }, [currentQuestion?.id]) // Trigger when question ID changes

  const handleOptionSelect = (index: number, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (processingRef.current) return
    if (!currentQuestion) return
    
    // Handle region_builder (multi-select)
    if (currentQuestion.type === 'region_builder') {
      const selectedCca3 = currentQuestion.optionCca3s?.[index]
      if (!selectedCca3) return
      
      const currentSelected = currentQuestion.selectedCountries || []
      const isSelected = currentSelected.includes(selectedCca3)
      
      const newSelected = isSelected
        ? currentSelected.filter(c => c !== selectedCca3)
        : [...currentSelected, selectedCca3]
      
      setCurrentQuestion({
        ...currentQuestion,
        selectedCountries: newSelected
      })
      return // Don't process answer yet, wait for submit
    }
    
    if (currentQuestion.correctIndex === undefined) return
    if (event) event.currentTarget?.blur()
    processingRef.current = true
    setSelectedIndex(index)
    const isCorrect = index === currentQuestion.correctIndex
    const correctCca3 =
      currentQuestion.optionCca3s?.[currentQuestion.correctIndex] ??
      currentQuestion.targetCca3


    if (isCorrect) {
      if (correctCca3) {
        // Track last correct country (for potential future use)
        setMastery((prev) => {
          const nextVal = (prev[correctCca3] ?? 0) + 1
          const next = { ...prev, [correctCca3]: nextVal }

          // Mastery Achievements
          const masteredCount = Object.values(next).filter(v => v >= 1).length
          if (masteredCount === 100) triggerAchievement('atlas100', 'World Completionist (100 Mastered)')
          else if (masteredCount === 50) triggerAchievement('atlas50', 'Atlas Pro (50 Mastered)')
          else if (masteredCount === 25) triggerAchievement('atlas25', 'Globe Trotter (25 Mastered)')

          return next
        })
        
        // Post-answer rotation: rotate around the country after correct answer
        // Disabled to prevent conflicts with new question animations
        // const map = mapRef.current
        // if (map && currentQuestion.targetFeature) {
        //   // Wait for flash animation to complete, then rotate
        //   rotationTimeoutRef.current = window.setTimeout(() => {
        //     const currentBearing = map.getBearing()
        //     try {
        //       map.rotateTo({
        //         bearing: currentBearing + 360,
        //         duration: 6000, // 6 second rotation
        //         easing: (t) => t // Linear rotation
        //       })
        //     } catch (error) {
        //       console.warn('Rotation skipped:', error)
        //     }
        //     rotationTimeoutRef.current = null
        //   }, 1000) // Start rotation 1 second after answer
        // }
      }
      setCompletedQuestions(prev => [...prev, `${currentQuestion.type}-${correctCca3}`])
      
      // Update performance stats with response time
      const responseTime = questionStartTimeRef.current > 0 ? Date.now() - questionStartTimeRef.current : 0
      setPerformanceStats(prev => {
        const current = prev[currentQuestion.type] || { correct: 0, total: 0, totalResponseTime: 0 }
        return {
          ...prev,
          [currentQuestion.type]: {
            correct: current.correct + 1,
            total: current.total + 1,
            totalResponseTime: current.totalResponseTime + responseTime
          }
        }
      })
      
      playGameSound('correct', isMuted)
      const basePoints = getPointsForQuestion(currentQuestion.type)
      const points = Math.round(basePoints * (1 + currentStreak * 0.1) * (1 + (level - 1) * 0.2))
      setScore((s) => {
        const next = s + points

        // Popup logic
        const popupId = `${Date.now()}-${Math.random()}`
        // Center of screen for MCQ popups
        const x = event?.clientX ?? window.innerWidth / 2
        const y = event?.clientY ?? window.innerHeight / 2
        setScorePopups(prev => [...prev, { id: popupId, x, y, value: `+${formatScore(points)}` }])
        setTimeout(() => setScorePopups(prev => prev.filter(p => p.id !== popupId)), 1000)


        // Tiered Score Achievements
        if (next >= 1000000) triggerAchievement('legend', 'Geographic Legend (1M Pts)')
        else if (next >= 500000) triggerAchievement('master', 'Atlas Master (500k Pts)')
        else if (next >= 100000) triggerAchievement('star', 'Rising Star (100k Pts)')
        else if (next >= 25000) triggerAchievement('elite', 'Geographic Elite (25k Pts)')

        return next
      })

      setCorrectInLevel((prev) => {
        const next = prev + 1
        if (next >= 5) {
          const nextLevel = level + 1
          setLevel(nextLevel)

          // Tiered Level Achievements
          if (nextLevel === 50) triggerAchievement('lvl50', 'World Sovereign (Level 50)')
          else if (nextLevel === 30) triggerAchievement('lvl30', 'Earth Master (Level 30)')
          else if (nextLevel === 15) triggerAchievement('lvl15', 'Global Navigator (Level 15)')
          else if (nextLevel === 8) triggerAchievement('lvl8', 'Veteran Traveler (Level 8)')

          setIsLevelUp(true)
          playGameSound('levelup', isMuted)
          setTimeout(() => setIsLevelUp(false), 2000)
          setHearts((h) => Math.min(h + 1, 3))

          // Lock-in score
          setLevelStartScore(score + points)
          setGuidanceTip("Progress Saved! Points locked in.")
          setTimeout(() => setGuidanceTip(null), 3000)

          return 0
        }
        return next
      })

      setCurrentStreak((prev) => {
        const next = prev + 1

        // Multiplier guidance
        if (next > 0 && next % 5 === 0) {
          const mult = 1 + (next * 0.2)
          setGuidanceTip(`Combo x${mult.toFixed(1)}! Points are now heavily multiplied.`)
          setTimeout(() => setGuidanceTip(null), 3000)
        }

        // Tiered Streak Achievements
        if (next === 50) triggerAchievement('streak50', 'Untouchable Legend (50 Streak)')
        else if (next === 25) triggerAchievement('streak25', 'Master of Focus (25 Streak)')
        else if (next === 10) triggerAchievement('streak10', 'Unstoppable! (10 Streak)')

        if (next % 5 === 0) {
          setHearts((h) => Math.min(h + 1, 3))
        }
        return next
      })
    } else {
      // Update performance stats for incorrect answer with response time
      const responseTime = questionStartTimeRef.current > 0 ? Date.now() - questionStartTimeRef.current : 0
      setPerformanceStats(prev => {
        const current = prev[currentQuestion.type] || { correct: 0, total: 0, totalResponseTime: 0 }
        return {
          ...prev,
          [currentQuestion.type]: {
            correct: current.correct,
            total: current.total + 1,
            totalResponseTime: current.totalResponseTime + responseTime
          }
        }
      })
      
      setCorrectInLevel(0)
      setShakeIndex(index)
      playGameSound('incorrect', isMuted)
      setTimeout(() => setShakeIndex(null), 500)
      setCurrentStreak(0)
      setHearts((h) => {
        const next = h - 1
        if (next <= 0) {
          setGameOver(true)
        }
        return next
      })
    }

    const selectedCca3 = currentQuestion.optionCca3s?.[index]
    
    // Handle journey_puzzle: flash the path
    if (currentQuestion.type === 'journey_puzzle' && mapRef.current && currentQuestion.journeyPath) {
      const pathCca3s = currentQuestion.journeyPath.filter(Boolean)
      if (isCorrect) {
        // Flash entire path green
        pathCca3s.forEach(cca3 => {
          mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: 'correct' })
        })
        setTimeout(() => {
          pathCca3s.forEach(cca3 => {
            mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: null })
          })
        }, 1500)
      } else {
        // Flash selected incorrect, then show correct path
        if (selectedCca3) {
          mapRef.current.setFeatureState({ source: 'countries', id: selectedCca3 }, { flash: 'incorrect' })
        }
        setTimeout(() => {
          if (selectedCca3) {
            mapRef.current?.setFeatureState({ source: 'countries', id: selectedCca3 }, { flash: null })
          }
          pathCca3s.forEach(cca3 => {
            mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: 'correct' })
          })
          setTimeout(() => {
            pathCca3s.forEach(cca3 => {
              mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: null })
            })
          }, 1500)
        }, 500)
      }
    } else if (correctCca3 && mapRef.current) {
      flashCountrySelection(mapRef.current, {
        clickedCca3: selectedCca3 ?? undefined,
        correctCca3,
        isCorrect,
        flashedIdsRef,
        flashTimeoutRef,
      })
    }

    if (nextTimeoutRef.current) {
      window.clearTimeout(nextTimeoutRef.current)
    }
    const isDead = !isCorrect && hearts <= 1
    if (!isDead) {
      nextTimeoutRef.current = window.setTimeout(() => {
        handleNext()
        nextTimeoutRef.current = null
      }, isCorrect ? 700 : 3000)
    } else {
      nextTimeoutRef.current = null
    }
  }

  const handleHint = () => {
    if (!currentQuestion || !currentQuestion.options || currentQuestion.options.length < 4) return
    if (hintsLeft <= 0 || removedIndices.length > 0) return

    const correct = currentQuestion.correctIndex ?? -1
    const wrongs = currentQuestion.options
      .map((_, i) => i)
      .filter((i) => i !== correct)

    // Pick 2 at random
    const toRemove = shuffle(wrongs).slice(0, 2)
    setRemovedIndices(toRemove)
    setHintsLeft((prev) => prev - 1)
    playGameSound('powerup', isMuted)
  }

  const handleSkip = () => {
    if (skipsLeft <= 0) return
    setSkipsLeft((prev) => prev - 1)
    playGameSound('powerup', isMuted)
    handleNext()
  }

  const handleRegionBuilderSubmit = () => {
    if (!currentQuestion || currentQuestion.type !== 'region_builder') return
    if (processingRef.current) return
    
    const selected = currentQuestion.selectedCountries || []
    const correct = currentQuestion.correctCountries || []
    
    // Check if all correct are selected and no incorrect ones
    const selectedSet = new Set(selected)
    const correctSet = new Set(correct)
    const allCorrectSelected = correct.every(c => selectedSet.has(c))
    const noIncorrectSelected = selected.every(s => correctSet.has(s))
    const isCorrect = allCorrectSelected && noIncorrectSelected && selected.length === correct.length
    
    processingRef.current = true
    
    // Process answer similar to regular questions
    if (isCorrect) {
      // Award mastery for all correct countries
      correct.forEach(cca3 => {
        if (cca3) {
          setMastery((prev) => {
            const nextVal = (prev[cca3] ?? 0) + 1
            return { ...prev, [cca3]: nextVal }
          })
        }
      })
      
      setCompletedQuestions(prev => [...prev, `${currentQuestion.type}-${correct.join(',')}`])
      
      const responseTime = questionStartTimeRef.current > 0 ? Date.now() - questionStartTimeRef.current : 0
      setPerformanceStats(prev => {
        const current = prev[currentQuestion.type] || { correct: 0, total: 0, totalResponseTime: 0 }
        return {
          ...prev,
          [currentQuestion.type]: {
            correct: current.correct + 1,
            total: current.total + 1,
            totalResponseTime: current.totalResponseTime + responseTime
          }
        }
      })
      
      playGameSound('correct', isMuted)
      const basePoints = getPointsForQuestion(currentQuestion.type)
      const points = Math.round(basePoints * (1 + currentStreak * 0.1) * (1 + (level - 1) * 0.2))
      setScore((s) => s + points)
      
      // Flash correct countries
      if (mapRef.current && correct.length > 0) {
        correct.forEach(cca3 => {
          if (cca3) {
            mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: 'correct' })
          }
        })
        setTimeout(() => {
          correct.forEach(cca3 => {
            if (cca3) {
              mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: null })
            }
          })
        }, 1000)
      }
      
      nextTimeoutRef.current = window.setTimeout(() => {
        handleNext()
        nextTimeoutRef.current = null
      }, 1500)
    } else {
      playGameSound('incorrect', isMuted)
      setCurrentStreak(0)
      setHearts((h) => {
        const next = h - 1
        if (next <= 0) {
          setGameOver(true)
        }
        return next
      })
      
      // Flash incorrect selections
      if (mapRef.current) {
        selected.forEach(cca3 => {
          if (cca3 && !correct.includes(cca3)) {
            mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: 'incorrect' })
          }
        })
        correct.forEach(cca3 => {
          if (cca3) {
            mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: 'correct' })
          }
        })
        setTimeout(() => {
          selected.forEach(cca3 => {
            if (cca3) mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: null })
          })
          correct.forEach(cca3 => {
            if (cca3) mapRef.current?.setFeatureState({ source: 'countries', id: cca3 }, { flash: null })
          })
        }, 2000)
      }
      
      nextTimeoutRef.current = window.setTimeout(() => {
        handleNext()
        nextTimeoutRef.current = null
      }, 3000)
    }
    
    processingRef.current = false
  }
  const flagSrc = resolvePublicAsset(
    currentQuestion?.flagSvg && !flagFallbackRef.current
      ? currentQuestion.flagSvg
      : currentQuestion?.flagPng ?? null,
  )

  const handleFlagError = () => {
    flagFallbackRef.current = true
  }

  const handleUpdate = () => {
    updateServiceWorker(true)
  }

  const isMapTap = currentQuestion?.type === 'map_tap'

  return (
    <div className={`app ${mapShake ? 'animate-map-shake' : ''}`}>
      <div className="map" ref={mapContainerRef} />

      {guidanceTip && <div className="guidance-tip animate-pop">{guidanceTip}</div>}

      {scorePopups.map(popup => (
        <div
          key={popup.id}
          className="score-popup"
          style={{ left: popup.x, top: popup.y }}
        >
          {popup.value}
        </div>
      ))}

      {!isDataLoaded && (
        <div className="loader-screen">
          <div className="loader-content">
            <h1 className="loader-title">GEOTEST</h1>
            <div className="loader-bar-container">
              <div
                className="loader-bar"
                style={{ width: `${loadingProgress}% ` }}
              />
            </div>
            <div className="loader-status">
              PREPARING {loadingProgress}%
            </div>
          </div>
        </div>
      )}

      <div className="utility-controls" ref={settingsRef}>
        <button
          className={`settings-cog ${isSettingsOpen ? 'active' : ''} `}
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          title="Settings"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {isSettingsOpen && (
          <div className="settings-menu animate-pop">
            <button
              className="theme-toggle"
              onClick={() => setIsMuted(m => !m)}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
              <span>{isMuted ? "Unmute Audio" : "Mute Audio"}</span>
            </button>

            <button
              className="theme-toggle"
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
              <span>{theme === 'dark' ? "Light Mode" : "Dark Mode"}</span>
            </button>

            <button
              className="theme-toggle"
              onClick={() => {
                setIsAtlasOpen(true)
                setIsSettingsOpen(false)
              }}
              title="Open Atlas (Mastery Tracker)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span>Progress Atlas</span>
            </button>

            <div className="settings-divider" style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />

            <button
              className="theme-toggle reset-btn"
              onClick={fullResetGame}
              title="Reset All Progress"
              style={{ color: '#ff4d4d' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>Reset Progress</span>
            </button>
          </div>
        )}
      </div>

      {notification && (
        <div className="achievement-toast animate-pop-centered animate-rotate-in shimmer-active">
          <div className="achievement-icon animate-scale-in">🏆</div>
          <div className="achievement-text">
            <div className="achievement-status">Achievement Unlocked!</div>
            <div className="achievement-title">{notification.title}</div>
          </div>
        </div>
      )}

      {isDataLoaded && (
        <>
          <div className={`scoreboard shimmer ${isLevelUp ? 'shimmer-active' : ''}`}>
            <div className={`stat-group ${displayScore !== score ? 'animate-score-bump' : ''} `}>
              <div className="stat-label">Score</div>
              <div className="stat-value text-gold" key={score}>
                {formatScore(score)}
                {comboTip.visible && (
                  <div className="combo-popover animate-bounce">{comboTip.message}</div>
                )}
              </div>
            </div>

            <div className="divider" />

            <div className="stat-group">
              <div className="stat-label">Time</div>
              <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formatTime(sessionSeconds)}
              </div>
            </div>

            <div className="divider" />

            <div className="stat-group">
              <div className="circular-container">
                <svg className="circular-progress" viewBox="0 0 44 44">
                  <circle className="circular-bg" cx="22" cy="22" r="18" />
                  <circle
                    className={`circular-value ${isLevelUp ? 'animate-pulse' : ''} `}
                    cx="22" cy="22" r="18"
                    strokeDasharray="113.1"
                    strokeDashoffset={113.1 * (1 - correctInLevel / 5)}
                  />
                </svg>
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, calc(-50% + 0.05em))',
                  fontSize: '0.9rem',
                  fontWeight: '900',
                  color: 'var(--text-main)',
                  lineHeight: '1',
                  margin: 0,
                  padding: 0,
                  textAlign: 'center',
                  whiteSpace: 'nowrap'
                }}>
                  {level}
                </div>
              </div>
            </div>

            <div className="divider" />

            <div className="hearts-container">
              {Array.from({ length: 3 }).map((_, i) => {
                const wasJustRegenerated = i === hearts - 1 && hearts > 0
                return (
                  <svg
                    key={i}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    className={`${i < hearts ? "pulse-heart" : ""} ${wasJustRegenerated ? "heart-pulse" : ""}`}
                    fill={i < hearts ? "#ff4d4d" : "rgba(255,255,255,0.05)"}
                    style={{
                      opacity: i < hearts ? 1 : 0.3,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                  </svg>
                )
              })}
            </div>

          </div>
          {!isOnline && (
            <div className="offline-banner">
              Offline mode: map tiles unavailable, quiz continues.
            </div>
          )}

          {needRefresh && (
            <div className="update-banner animate-slide-in">
              <span>🚀 A new version of GeoTest is available!</span>
              <button className="btn-update" onClick={handleUpdate}>
                Update Now
              </button>
            </div>
          )}

          {!gameOver && (
            // Quiz Panel section - transparency forced in CSS
            <section className={`quiz-panel ${isMapTap ? 'compact' : ''} shimmer ${showShimmer ? 'shimmer-active' : ''}`} aria-live="polite">
              {isMapTap ? (
                <div className="compact-prompt">
                  <div className="compact-prompt-header">
                    {currentQuestion?.flagSvg || currentQuestion?.flagPng ? (
                      <img
                        src={resolvePublicAsset(currentQuestion.flagSvg || currentQuestion.flagPng || undefined)}
                        className="compact-flag"
                        alt=""
                      />
                    ) : null}
                    <span className="compact-continent">{currentQuestion?.continent}</span>
                  </div>
                  <div className="compact-country-name">
                    {currentQuestion ? currentQuestion.prompt : 'Loading...'}
                  </div>
                </div>
              ) : (
                <div className="quiz-prompt">
                  {currentQuestion ? currentQuestion.prompt : 'Preparing datasets...'}
                </div>
              )}

              {currentQuestion?.type === 'flag_match' && flagSrc && (
                <div className="flag-preview">
                  <img src={flagSrc} alt="Country flag" onError={handleFlagError} />
                </div>
              )}

              {currentQuestion?.type === 'landmark_photo_mcq' && currentQuestion.imagePath && (
                <div className="landmark-preview">
                  <img
                    src={resolvePublicAsset(currentQuestion.imagePath)}
                    alt=""
                    loading="lazy"
                  />
                </div>
              )}

              <div className="powerups">
                {currentQuestion?.options && currentQuestion.options.length >= 4 && (
                  <button
                    className="powerup-btn"
                    onClick={handleHint}
                    disabled={hintsLeft <= 0 || removedIndices.length > 0}
                    title={`Spend Hint Charge(${hintsLeft} left).Removes 2 wrong answers`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="15.7" />
                      <path d="M12 2v20M2 12h20" opacity="0.2" />
                    </svg>
                    <span>50/50</span>
                    <span className="powerup-badge">{hintsLeft}</span>
                  </button>
                )}
                <button
                  className="powerup-btn"
                  onClick={handleSkip}
                  disabled={skipsLeft <= 0}
                  title={`Spend Skip Charge(${skipsLeft} left).Preserves streak`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 17 5-5-5-5M13 17l5-5-5-5" />
                  </svg>
                  <span>Skip</span>
                  <span className="powerup-badge">{skipsLeft}</span>
                </button>
              </div>

              {currentQuestion?.type === 'region_builder' && currentQuestion.options ? (
                <div className="region-builder-options">
                  {currentQuestion.options.map((option, index) => {
                    const cca3 = currentQuestion.optionCca3s?.[index]
                    const isSelected = cca3 && (currentQuestion.selectedCountries || []).includes(cca3)
                    return (
                      <div
                        key={option}
                        className={`region-builder-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleOptionSelect(index)}
                      >
                        <input
                          type="checkbox"
                          checked={!!isSelected}
                          onChange={() => {}}
                          readOnly
                        />
                        <span>{option}</span>
                      </div>
                    )
                  })}
                  <button
                    className="region-builder-submit"
                    onClick={handleRegionBuilderSubmit}
                    disabled={!currentQuestion.selectedCountries || currentQuestion.selectedCountries.length === 0}
                  >
                    Submit Selection
                  </button>
                </div>
              ) : currentQuestion?.options ? (
                <div className="options">
                  {currentQuestion.options.map((option, index) => (
                    <button
                      className={buildOptionClassName(
                        index,
                        selectedIndex,
                        currentQuestion.correctIndex ?? null,
                        shakeIndex,
                      )}
                      key={option}
                      onClick={(e) => handleOptionSelect(index, e)}
                      style={{ visibility: removedIndices.includes(index) ? 'hidden' : 'visible' }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}

              {!isMapTap && currentQuestion?.type === 'map_tap' && (
                <div className="map-instruction">
                  Tap on the map to answer
                </div>
              )}

              <div className="panel-footer" />
            </section>
          )}

          {isAtlasOpen && (
            <div className="atlas-modal">
              <div className="atlas-header">
                <h2 className="atlas-title">Progress Atlas</h2>
                <button className="atlas-close" onClick={() => setIsAtlasOpen(false)}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="atlas-tabs">
                <button
                  className={`atlas-tab ${atlasTab === 'atlas' ? 'active' : ''}`}
                  onClick={() => setAtlasTab('atlas')}
                >
                  Atlas
                </button>
                <button
                  className={`atlas-tab ${atlasTab === 'stats' ? 'active' : ''}`}
                  onClick={() => setAtlasTab('stats')}
                >
                  Statistics
                </button>
              </div>
              <div className="atlas-content">
                {atlasTab === 'atlas' ? (
                  Object.entries(atlasByContinent).map(([continent, countries]) => (
                    <div key={continent} className="atlas-continent-section">
                      <h3>{continent}</h3>
                      <div className="atlas-grid">
                        {countries.map(c => {
                          const mCount = mastery[c.cca3!] || 0
                          const isMastered = mCount > 0
                          const progress = Math.min(100, (mCount / 3) * 100)
                          return (
                            <div key={c.cca3} className={`atlas-item ${isMastered ? '' : 'unmastered'}`}>
                              {c.flagSvg || c.flagPng ? (
                                <img
                                  src={resolvePublicAsset(c.flagSvg || c.flagPng || undefined)}
                                  className="atlas-item-flag"
                                  alt=""
                                />
                              ) : (
                                <div className="atlas-item-flag" style={{ background: 'rgba(255,255,255,0.05)' }} />
                              )}
                              <div className="atlas-item-name">{c.name}</div>
                              <div className="atlas-mastery-bar">
                                <div className="atlas-mastery-fill" style={{ width: `${progress}%` }} />
                              </div>
                              {progress >= 100 && <div className="atlas-mastery-text">Mastered</div>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="stats-dashboard">
                    <div className="stats-section">
                      <h3 className="stats-section-title">Overview</h3>
                      <div className="stats-grid">
                        <div className="stat-card">
                          <div className="stat-card-label">Total Questions</div>
                          <div className="stat-card-value">
                            {Object.values(performanceStats).reduce((sum, stat) => sum + stat.total, 0)}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">Countries Mastered</div>
                          <div className="stat-card-value">
                            {Object.values(mastery).filter(v => v > 0).length}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">Overall Accuracy</div>
                          <div className="stat-card-value">
                            {(() => {
                              const total = Object.values(performanceStats).reduce((sum, stat) => sum + stat.total, 0)
                              const correct = Object.values(performanceStats).reduce((sum, stat) => sum + stat.correct, 0)
                              return total > 0 ? `${Math.round((correct / total) * 100)}%` : '0%'
                            })()}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">Avg Response Time</div>
                          <div className="stat-card-value">
                            {(() => {
                              const total = Object.values(performanceStats).reduce((sum, stat) => sum + stat.total, 0)
                              const totalTime = Object.values(performanceStats).reduce((sum, stat) => sum + stat.totalResponseTime, 0)
                              return total > 0 ? `${Math.round(totalTime / total / 1000)}s` : '0s'
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="stats-section">
                      <h3 className="stats-section-title">Accuracy by Question Type</h3>
                      <div className="stats-list">
                        {Object.entries(performanceStats)
                          .filter(([_, stat]) => stat.total > 0)
                          .sort(([_, a], [__, b]) => b.total - a.total)
                          .map(([type, stat]) => {
                            const accuracy = stat.total > 0 ? (stat.correct / stat.total) * 100 : 0
                            const avgTime = stat.total > 0 ? stat.totalResponseTime / stat.total / 1000 : 0
                            const typeLabel = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                            return (
                              <div key={type} className="stats-item">
                                <div className="stats-item-header">
                                  <span className="stats-item-type">{typeLabel}</span>
                                  <span className="stats-item-accuracy">{Math.round(accuracy)}%</span>
                                </div>
                                <div className="stats-item-bar">
                                  <div
                                    className="stats-item-bar-fill"
                                    style={{
                                      width: `${accuracy}%`,
                                      backgroundColor: accuracy >= 80 ? 'var(--success-green)' : accuracy >= 50 ? 'var(--accent-blue)' : 'var(--error-red)'
                                    }}
                                  />
                                </div>
                                <div className="stats-item-footer">
                                  <span className="stats-item-count">{stat.correct}/{stat.total} correct</span>
                                  <span className="stats-item-time">Avg: {Math.round(avgTime)}s</span>
                                </div>
                              </div>
                            )
                          })}
                        {Object.values(performanceStats).filter(stat => stat.total > 0).length === 0 && (
                          <div className="stats-empty">No statistics yet. Start playing to see your performance!</div>
                        )}
                      </div>
                    </div>

                    <div className="stats-section">
                      <h3 className="stats-section-title">Mastery Heat Map</h3>
                      <div className="mastery-heatmap">
                        {Object.entries(atlasByContinent).map(([continent, countries]) => {
                          const continentMastered = countries.filter(c => (mastery[c.cca3!] || 0) > 0).length
                          const continentTotal = countries.length
                          const continentProgress = continentTotal > 0 ? (continentMastered / continentTotal) * 100 : 0
                          return (
                            <div key={continent} className="heatmap-continent">
                              <div className="heatmap-continent-header">
                                <span className="heatmap-continent-name">{continent}</span>
                                <span className="heatmap-continent-progress">{continentMastered}/{continentTotal}</span>
                              </div>
                              <div className="heatmap-continent-bar">
                                <div
                                  className="heatmap-continent-fill"
                                  style={{
                                    width: `${continentProgress}%`,
                                    backgroundColor: continentProgress >= 80 ? 'var(--success-green)' : continentProgress >= 50 ? 'var(--accent-blue)' : 'var(--text-dimmer)'
                                  }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {gameOver && (
            <div className="answer-modal">
              <div className="answer-modal-card" style={{ textAlign: 'center' }}>
                <div className="answer-modal-title" style={{ fontSize: '1.5rem', color: '#ff4d4d' }}>Game Over</div>
                <div className="answer-modal-body" style={{ marginBottom: '20px' }}>
                  You ran out of lives!<br />
                  Final Score: <strong>{formatScore(score)}</strong>
                </div>
                <button className="option correct" onClick={restartGame} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                  Try Again
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default App

function playGameSound(type: 'correct' | 'incorrect' | 'levelup' | 'powerup', muted: boolean) {
  if (muted) return
  const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
  if (!AudioContextClass) return

  try {
    const ctx = new AudioContextClass()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const now = ctx.currentTime

    if (type === 'correct') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, now)
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05)
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
      osc.start(now)
      osc.stop(now + 0.08)
    } else if (type === 'incorrect') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(180, now)
      osc.frequency.linearRampToValueAtTime(100, now + 0.1)
      gain.gain.setValueAtTime(0.06, now)
      gain.gain.linearRampToValueAtTime(0.001, now + 0.1)
      osc.start(now)
      osc.stop(now + 0.1)
    } else if (type === 'levelup') {
      osc.type = 'sine'
      // Ascending double blip
      osc.frequency.setValueAtTime(660, now)
      osc.frequency.setValueAtTime(990, now + 0.1)
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
      osc.start(now)
      osc.stop(now + 0.2)
    } else if (type === 'powerup') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(400, now)
      osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1)
      gain.gain.setValueAtTime(0.05, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
      osc.start(now)
      osc.stop(now + 0.12)
    }

    osc.connect(gain)
    gain.connect(ctx.destination)

    // Auto-close context
    setTimeout(() => ctx.close(), 1000)
  } catch (e) {
    console.error('Audio failed', e)
  }
}

function buildOptionClassName(
  index: number,
  selectedIndex: number | null,
  correctIndex: number | null,
  shakeIndex: number | null,
) {
  let base = 'option'
  if (shakeIndex === index) base += ' animate-shake'
  if (selectedIndex === null) return base
  if (index === correctIndex) return 'option correct'
  if (index === selectedIndex) return 'option incorrect'
  return 'option'
}

function pickMetricPair(pool: CountryMeta[], key: 'population' | 'area') {
  if (pool.length < 2) return null
  const shuffled = shuffle(pool)

  // Try to find a pair within a reasonable ratio (e.g. 1.05x to 5x larger)
  // This makes the choice much harder than comparing a giant to a tiny island.
  for (let attempt = 0; attempt < 50; attempt++) {
    const a = shuffled[Math.floor(Math.random() * shuffled.length)]
    const b = shuffled[Math.floor(Math.random() * shuffled.length)]

    if (a.cca3 === b.cca3) continue

    const valA = a[key] ?? 0
    const valB = b[key] ?? 0
    if (valA === 0 || valB === 0) continue

    const ratio = Math.max(valA, valB) / Math.min(valA, valB)

    // Target ratio: between 1.05 (too close is confusing) and 5.0
    if (ratio > 1.05 && ratio < 5.0) {
      return { a, b }
    }
  }

  // Fallback: Just return any two different countries with non-zero values
  for (let i = 0; i < shuffled.length - 1; i += 1) {
    for (let j = i + 1; j < shuffled.length; j += 1) {
      const a = shuffled[i]
      const b = shuffled[j]
      if ((a[key] ?? 0) > 0 && (b[key] ?? 0) > 0 && a[key] !== b[key]) {
        return { a, b }
      }
    }
  }
  return null
}

function buildNextQuestion(args: {
  pools: {
    countries: CountryMeta[]
    countriesByCca3: Map<string, CountryMeta>
    mapPool: CountryMeta[]
    flagPool: CountryMeta[]
    capitalPool: CountryMeta[]
    neighborPool: CountryMeta[]
    currencyPool: CountryMeta[]
    cityPool: CountryMeta[]
    riverPool: CountryMeta[]
    languagePool: CountryMeta[]
    populationPool: CountryMeta[]
    areaPool: CountryMeta[]
    landlockedPool: CountryMeta[]
    peakPool: CountryMeta[]
    rangePool: CountryMeta[]
    regionPool: CountryMeta[]
    unescoPool: CountryMeta[]
    exportsPool: CountryMeta[]
    gdpPool: CountryMeta[]
    landmarkPool: CountryMeta[]
    landmarkByCca3: Map<string, LandmarkEntry[]>
    populationRankByCca3: Map<string, number>
    gdpRankByCca3: Map<string, number>
  }
  featureIndex: Map<string, FeatureRecord>
  queueRef: MutableRefObject<Record<QuestionType, string[]>>
  typeIndexRef: MutableRefObject<number>
  level: number
  idPrefix: string
  completedQuestions: string[]
  performanceStats?: Record<QuestionType, { correct: number; total: number; totalResponseTime: number }>
}) {
  const allTypes: QuestionType[] = [
    'map_tap',
    'flag_match',
    'capital_mcq',
    'neighbor_mcq',
    'currency_mcq',
    'city_mcq',
    'river_mcq',
    'language_mcq',
    'population_pair',
    'area_pair',
    'landlocked_mcq',
    'peak_mcq',
    'range_mcq',
    'region_mcq',
    'subregion_outlier',
    'neighbor_count_mcq',
    'population_rank',
    'population_tier',
    'population_more_than',
    'gdp_tier',
    'economy_exports_mcq',
    'unesco_mcq',
    'landmark_photo_mcq',
    'silhouette_mcq',
    'coastline_mcq',
    'journey_puzzle',
    'region_builder',
  ]

  // Filter types by level - Gradual difficulty progression
  const levelTypes: QuestionType[] = []

  // Level 1-3: Intro with Visuals (Easiest)
  levelTypes.push('flag_match', 'map_tap')

  // Level 4-5: Shapes & Neighbors (Visual + Basic Geography)
  if (args.level >= 4) levelTypes.push('silhouette_mcq', 'neighbor_mcq')

  // Level 6-7: Capitals (Common Knowledge)
  if (args.level >= 6) levelTypes.push('capital_mcq')

  // Level 8-9: Basic Characteristics (Easy Data Questions)
  if (args.level >= 8) {
    levelTypes.push('population_pair', 'area_pair', 'city_mcq', 'currency_mcq', 'landlocked_mcq', 'population_tier')
  }

  // Level 10-11: Physical Geography - Large Countries Only (Peaks)
  if (args.level >= 10) {
    levelTypes.push('peak_mcq')
  }

  // Level 12-13: Cultural & Hydrography (Moderate Difficulty)
  if (args.level >= 12) {
    levelTypes.push('river_mcq', 'language_mcq', 'population_more_than')
  }

  // Level 14-15: Physical Geography - Mountain Ranges (Harder)
  if (args.level >= 14) {
    levelTypes.push('range_mcq')
  }

  // Level 15+: Trivia & Knowledge
  if (args.level >= 15) {
    levelTypes.push('flag_colors_mcq', 'gdp_tier', 'economy_exports_mcq', 'unesco_mcq')
  }

  // Level 16+: High Logic & Complexity
  if (args.level >= 16) {
    levelTypes.push('subregion_outlier', 'neighbor_count_mcq', 'population_rank')
  }

  // Level 18+: Physical Regions (Very Hard - Small Countries)
  if (args.level >= 18) {
    levelTypes.push('region_mcq')
  }

  // Level 20+: Visual Mastery
  if (args.level >= 20) levelTypes.push('coastline_mcq', 'landmark_photo_mcq')

  // Level 22+: Multi-Step Puzzles
  if (args.level >= 22) {
    levelTypes.push('journey_puzzle', 'region_builder')
  }

  const types = levelTypes.length > 0 ? levelTypes : allTypes

  for (let attempt = 0; attempt < types.length; attempt += 1) {
    const type = types[args.typeIndexRef.current % types.length]
    args.typeIndexRef.current += 1
    const question = buildQuestionForType(type, { ...args, completedQuestions: args.completedQuestions, performanceStats: args.performanceStats })
    if (question) {
      question.id = `${args.idPrefix} -${question.id} `
      return question
    }
  }

  return {
    id: 'no-data',
    type: 'flag_match' as QuestionType,
    prompt: 'No country data available.',
    options: ['Retry'],
    correctIndex: 0,
  }
}

// Helper function to find a path through countries (BFS)
function findJourneyPath(
  start: CountryMeta,
  end: CountryMeta,
  intermediate: CountryMeta[],
  countriesByCca3: Map<string, CountryMeta>,
  maxDepth: number = 4
): string[] | null {
  if (start.cca3 === end.cca3) return null
  
  // Build path: start -> intermediate countries -> end
  const path: string[] = [start.cca3!]
  
  let current = start
  for (const target of intermediate) {
    const segment = findPathBetween(current, target, countriesByCca3, maxDepth)
    if (!segment || segment.length === 0) return null
    // Add path excluding the start (already in path)
    path.push(...segment.slice(1))
    current = target
  }
  
  // Final segment to end
  const finalSegment = findPathBetween(current, end, countriesByCca3, maxDepth)
  if (!finalSegment || finalSegment.length === 0) return null
  path.push(...finalSegment.slice(1))
  
  return path
}

// BFS to find path between two countries
function findPathBetween(
  start: CountryMeta,
  end: CountryMeta,
  countriesByCca3: Map<string, CountryMeta>,
  maxDepth: number = 3
): string[] | null {
  if (start.cca3 === end.cca3) return [start.cca3!]
  
  const queue: { country: CountryMeta; path: string[] }[] = [{ country: start, path: [start.cca3!] }]
  const visited = new Set<string>([start.cca3!])
  
  while (queue.length > 0 && queue[0].path.length <= maxDepth) {
    const { country, path } = queue.shift()!
    
    for (const borderCode of country.borders || []) {
      if (visited.has(borderCode)) continue
      visited.add(borderCode)
      
      const neighbor = countriesByCca3.get(borderCode)
      if (!neighbor) continue
      
      const newPath = [...path, borderCode]
      
      if (borderCode === end.cca3) {
        return newPath
      }
      
      queue.push({ country: neighbor, path: newPath })
    }
  }
  
  return null
}

function buildQuestionForType(
  type: QuestionType,
  args: {
    pools: {
      countries: CountryMeta[]
      countriesByCca3: Map<string, CountryMeta>
      mapPool: CountryMeta[]
      flagPool: CountryMeta[]
      capitalPool: CountryMeta[]
      neighborPool: CountryMeta[]
      currencyPool: CountryMeta[]
      cityPool: CountryMeta[]
      riverPool: CountryMeta[]
      languagePool: CountryMeta[]
      populationPool: CountryMeta[]
      areaPool: CountryMeta[]
      landlockedPool: CountryMeta[]
      peakPool: CountryMeta[]
      rangePool: CountryMeta[]
      regionPool: CountryMeta[]
      unescoPool: CountryMeta[]
      exportsPool: CountryMeta[]
      gdpPool: CountryMeta[]
      landmarkPool: CountryMeta[]
      landmarkByCca3: Map<string, LandmarkEntry[]>
      populationRankByCca3: Map<string, number>
      gdpRankByCca3: Map<string, number>
    }
    featureIndex: Map<string, FeatureRecord>
    queueRef: MutableRefObject<Record<QuestionType, string[]>>
    level: number
    completedQuestions: string[]
    performanceStats?: Record<QuestionType, { correct: number; total: number; totalResponseTime: number }>
  },
) {
  // Journey puzzle and region builder don't use getNextCountryForType
  if (type === 'journey_puzzle') {
    // Find countries with good border connectivity
    const countriesWithBorders = args.pools.neighborPool.filter(c => (c.borders?.length ?? 0) >= 2)
    if (countriesWithBorders.length < 3) return null

    const shuffled = shuffle(countriesWithBorders)
    const start = shuffled[0]
    
    // Try to find a 2-3 step journey
    let end: CountryMeta | null = null
    let intermediate: CountryMeta[] = []
    let journeyPath: string[] | null = null

    for (let attempts = 0; attempts < 50; attempts++) {
      const candidateEnd = shuffled[Math.floor(Math.random() * shuffled.length)]
      if (candidateEnd.cca3 === start.cca3) continue

      // Try with 1 intermediate country
      const candidateIntermediate = shuffled.filter(c => 
        c.cca3 !== start.cca3 && 
        c.cca3 !== candidateEnd.cca3 &&
        (c.borders?.length ?? 0) >= 2
      )
      
      if (candidateIntermediate.length > 0) {
        const inter = candidateIntermediate[0]
        journeyPath = findJourneyPath(start, candidateEnd, [inter], args.pools.countriesByCca3, 4)
        if (journeyPath && journeyPath.length >= 3 && journeyPath.length <= 5) {
          end = candidateEnd
          intermediate = [inter]
          break
        }
      }

      // Try direct path if no intermediate works
      journeyPath = findPathBetween(start, candidateEnd, args.pools.countriesByCca3, 3)
      if (journeyPath && journeyPath.length >= 2 && journeyPath.length <= 4) {
        end = candidateEnd
        intermediate = []
        journeyPath = [start.cca3!, ...journeyPath.slice(1)]
        break
      }
    }

    if (!end || !journeyPath) return null

    // Build options: correct answer + distractors
    const optionCandidates = [{ name: end.name, cca3: end.cca3 }]
    const excludedCca3s = new Set([start.cca3, end.cca3, ...intermediate.map(i => i.cca3)])
    
    const distractors = shuffle(args.pools.neighborPool.filter(c => 
      !excludedCca3s.has(c.cca3) &&
      c.region === start.region // Same region for difficulty
    )).slice(0, 3)

    for (const distractor of distractors) {
      optionCandidates.push({ name: distractor.name, cca3: distractor.cca3 })
    }

    const finalCandidates = shuffle(optionCandidates)
    const finalOptions = finalCandidates.map(item => item.name)
    const optionCca3s = finalCandidates.map(item => item.cca3)

    const pathDescription = intermediate.length > 0
      ? `Starting in ${start.name}, travel through ${intermediate.map(i => i.name).join(' and ')}, then continue. Where do you end up?`
      : `Starting in ${start.name}, travel through neighboring countries. Where do you end up?`

    // Get feature for start country for camera positioning
    const startFeature = args.featureIndex.get(start.cca3!)

    return {
      id: `${type}-${start.cca3}-${end.cca3}`,
      type,
      prompt: pathDescription,
      options: finalOptions,
      correctIndex: finalOptions.indexOf(end.name),
      optionCca3s,
      targetCca3: end.cca3 ?? undefined,
      displayCca3s: journeyPath,
      journeyPath,
      targetFeature: startFeature, // Use start country for camera
    }
  }

  if (type === 'region_builder') {
    // Pick a region/subregion and find countries in it
    const regions = new Set(args.pools.countries.map(c => c.region).filter(Boolean))
    const regionArray = Array.from(regions)
    if (regionArray.length === 0) return null

    const targetRegion = shuffle(regionArray)[0]
    const regionCountries = args.pools.countries.filter(c => c.region === targetRegion)
    
    if (regionCountries.length < 3) return null
    
    // Use a subset (3-6 countries) for the question
    const questionSize = Math.min(6, Math.max(3, Math.floor(regionCountries.length * 0.4)))
    const correctCountries = shuffle(regionCountries).slice(0, questionSize)
    const correctCca3s = correctCountries.map(c => c.cca3!).filter(Boolean)

    // Build distractors from other regions (same number as correct)
    const distractors = shuffle(args.pools.countries.filter(c => 
      c.region !== targetRegion &&
      !correctCca3s.includes(c.cca3!)
    )).slice(0, questionSize)

    const allOptions = shuffle([...correctCountries, ...distractors])
    const optionCca3s = allOptions.map(c => c.cca3!).filter(Boolean)

    // Get feature for first correct country for camera positioning
    const firstFeature = correctCca3s.length > 0 ? args.featureIndex.get(correctCca3s[0]) : undefined

    return {
      id: `${type}-${targetRegion}-${Date.now()}`,
      type,
      prompt: `Select all countries in ${targetRegion}`,
      options: allOptions.map(c => c.name),
      correctIndex: undefined, // Multi-select, no single correct index
      optionCca3s,
      targetCca3: undefined,
      displayCca3s: correctCca3s,
      correctCountries: correctCca3s,
      selectedCountries: [],
      targetFeature: firstFeature, // Use first country for camera
    }
  }

  const country = getNextCountryForType(type, {
    pools: args.pools,
    queueRef: args.queueRef,
    level: args.level,
    completedQuestions: args.completedQuestions,
    performanceStats: args.performanceStats
  })
  if (!country || !country.cca3) return null

  if (type === 'map_tap') {
    const targetFeature = args.featureIndex.get(country.cca3) ?? undefined
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: country.name,
      continent: country.region,
      flagSvg: country.flagSvg,
      flagPng: country.flagPng,
      targetFeature,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'flag_match') {
    const slicedPool = getPoolForLevel(args.pools.flagPool, args.level)
    const { options, correctIndex, optionCca3s } = buildOptionSetForCountries(
      slicedPool,
      country,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: 'Which country matches this flag?',
      options,
      correctIndex,
      optionCca3s,
      flagSvg: country.flagSvg,
      flagPng: country.flagPng,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'capital_mcq') {
    const capital = country.capital?.[0] ?? ''
    if (!capital) return null
    const slicedPool = getPoolForLevel(args.pools.capitalPool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.capital?.[0] ?? '',
      capital,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Capital of ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'neighbor_mcq') {
    const neighbors = (country.borders || [])
      .map((code) => args.pools.countriesByCca3.get(code))
      .filter(Boolean) as CountryMeta[]
    if (!neighbors.length) return null

    const correctNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)]
    const optionCandidates = [{ name: correctNeighbor.name, cca3: correctNeighbor.cca3 }]

    // Difficulty boost: Pick distractors from the same area
    const isExcluded = (c: CountryMeta) =>
      c.cca3 === country.cca3 ||
      country.borders.includes(c.cca3 || '') ||
      c.cca3 === correctNeighbor.cca3

    // 1. Same subregion
    const subregionDistractors = shuffle(args.pools.countries.filter(
      (c) => c.subregion === country.subregion && !isExcluded(c)
    ))

    // 2. Same region (continent)
    const regionDistractors = shuffle(args.pools.countries.filter(
      (c) => c.region === country.region && !isExcluded(c) && !subregionDistractors.find(s => s.cca3 === c.cca3)
    ))

    // 3. Fallback to general pool
    const generalPool = getPoolForLevel(args.pools.countries, args.level)
    const globalDistractors = shuffle(generalPool.filter(
      (c) => !isExcluded(c) &&
        !subregionDistractors.find(s => s.cca3 === c.cca3) &&
        !regionDistractors.find(r => r.cca3 === c.cca3)
    ))

    const distractors = [...subregionDistractors, ...regionDistractors, ...globalDistractors]

    for (const item of distractors) {
      optionCandidates.push({ name: item.name, cca3: item.cca3 })
      if (optionCandidates.length >= 4) break
    }
    const finalCandidates = shuffle(optionCandidates)
    const finalOptions = finalCandidates.map((item) => item.name)
    const optionCca3s = finalCandidates.map((item) => item.cca3)
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which country borders ${country.name}?`,
      options: finalOptions,
      correctIndex: finalOptions.indexOf(correctNeighbor.name),
      optionCca3s,
      targetCca3: correctNeighbor.cca3 ?? undefined,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'currency_mcq') {
    const currencyCode = country.currencies?.[0]?.code ?? ''
    if (!currencyCode) return null
    const slicedPool = getPoolForLevel(args.pools.currencyPool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.currencies?.[0]?.code ?? '',
      currencyCode,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Currency code for ${country.name} ? `,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'city_mcq') {
    const city = country.cities?.[0] ?? ''
    if (!city) return null
    const slicedPool = getPoolForLevel(args.pools.cityPool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.cities?.[0] ?? '',
      city,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which city is in ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'river_mcq') {
    const river = country.rivers?.[0] ?? ''
    if (!river) return null
    const slicedPool = getPoolForLevel(args.pools.riverPool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.rivers?.[0] ?? '',
      river,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `River in ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'language_mcq') {
    const language = country.languages?.[0] ?? ''
    if (!language) return null
    const slicedPool = getPoolForLevel(args.pools.languagePool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.languages?.[0] ?? '',
      language,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Language of ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'landlocked_mcq') {
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Is ${country.name} landlocked or coastal ? `,
      options: ['Landlocked', 'Coastal'],
      correctIndex: country.landlocked ? 0 : 1,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'peak_mcq') {
    const peakName = country.highestPeak?.name ?? ''
    if (!peakName) return null
    // Prefer larger countries at lower levels (levels 10-14)
    const slicedPool = getPoolForLevel(args.pools.peakPool, args.level, args.level < 15)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.highestPeak?.name ?? '',
      peakName,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Highest peak in ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'range_mcq') {
    const rangeName = country.mountainRanges?.[0] ?? ''
    if (!rangeName) return null
    // Prefer larger countries at lower levels (levels 14-16)
    const slicedPool = getPoolForLevel(args.pools.rangePool, args.level, args.level < 17)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.mountainRanges?.[0] ?? '',
      rangeName,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which mountain range is in ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'region_mcq') {
    const regionName = country.physicalRegions?.[0] ?? ''
    if (!regionName) return null
    // Prefer larger countries at lower levels (levels 18-20)
    const slicedPool = getPoolForLevel(args.pools.regionPool, args.level, args.level < 21)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.physicalRegions?.[0] ?? '',
      regionName,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which physical region is in ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'population_pair') {
    const slicedPool = getPoolForLevel(args.pools.populationPool, args.level)
    const pair = pickMetricPair(slicedPool, 'population')
    if (!pair) return null
    return {
      id: `${type} -${pair.a.cca3} -${pair.b.cca3} `,
      type,
      prompt: 'Which is more populous?',
      options: [pair.a.name, pair.b.name],
      optionCca3s: [pair.a.cca3, pair.b.cca3],
      correctIndex: pair.a.population > pair.b.population ? 0 : 1,
      displayCca3s: [pair.a.cca3, pair.b.cca3].filter(Boolean) as string[],
    }
  }

  if (type === 'area_pair') {
    const slicedPool = getPoolForLevel(args.pools.areaPool, args.level)
    const pair = pickMetricPair(slicedPool, 'area')
    if (!pair) return null
    return {
      id: `${type} -${pair.a.cca3} -${pair.b.cca3} `,
      type,
      prompt: 'Which is larger by area?',
      options: [pair.a.name, pair.b.name],
      optionCca3s: [pair.a.cca3, pair.b.cca3],
      correctIndex: (pair.a.area ?? 0) > (pair.b.area ?? 0) ? 0 : 1,
      displayCca3s: [pair.a.cca3, pair.b.cca3].filter(Boolean) as string[],
    }
  }

  if (type === 'subregion_outlier') {
    const subregion = country.subregion
    const continent = country.region
    const sameSub = shuffle(args.pools.countries.filter(c => c.subregion === subregion && c.cca3 !== country.cca3)).slice(0, 2)
    if (sameSub.length < 2) return null

    // Pick 1 outlier from same continent but different subregion
    const outliers = shuffle(args.pools.countries.filter(c => c.region === continent && c.subregion !== subregion))
    if (!outliers.length) return null
    const correctOutlier = outliers[0]

    const finalCandidates = shuffle([country, ...sameSub, correctOutlier])
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which country does NOT belong in ${subregion}?`,
      options: finalCandidates.map(c => c.name),
      correctIndex: finalCandidates.indexOf(correctOutlier),
      targetCca3: country.cca3,
      displayCca3s: finalCandidates.map(c => c.cca3).filter(Boolean) as string[],
    }
  }

  if (type === 'neighbor_count_mcq') {
    const count = country.borders?.length ?? 0
    const distractors = shuffle([count + 1, count - 1, count + 2].filter(v => v >= 0 && v !== count))
    const finalOptions = shuffle([count, ...distractors.slice(0, 3)])

    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `How many countries share a land border with ${country.name}?`,
      options: finalOptions.map(String),
      correctIndex: finalOptions.indexOf(count),
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'population_rank') {
    const continentPool = args.pools.countries.filter(c => c.region === country.region && c.population > 0)
    if (continentPool.length < 3) return null
    const triplet = shuffle(continentPool).slice(0, 3)
    const sorted = [...triplet].sort((a, b) => b.population - a.population)
    const options = [
      sorted.map(c => c.name).join(' > '),
      shuffle([...sorted]).map(c => c.name).join(' > '),
    ]
    if (options[0] === options[1]) {
      options[1] = [sorted[1], sorted[0], sorted[2]].map(c => c.name).join(' > ')
    }
    const finalOptions = shuffle(options)

    return {
      id: `${type} -${triplet.map(c => c.cca3).join('-')} `,
      type,
      prompt: `Which is the correct order from MOST to LEAST populous ? `,
      options: finalOptions,
      correctIndex: finalOptions.indexOf(options[0]),
      displayCca3s: triplet.map(c => c.cca3).filter(Boolean) as string[],
    }
  }

  if (type === 'population_tier') {
    const rank = args.pools.populationRankByCca3.get(country.cca3)
    if (!rank) return null
    const tiers = [
      { label: 'Top 10', max: 10 },
      { label: 'Top 20', max: 20 },
      { label: 'Top 50', max: 50 },
      { label: 'Outside Top 50', max: Infinity },
    ]
    const correctIndex = tiers.findIndex((tier) => rank <= tier.max)
    if (correctIndex < 0) return null
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which population tier is ${country.name} in? `,
      options: tiers.map((tier) => tier.label),
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'population_more_than') {
    const slicedPool = getPoolForLevel(args.pools.populationPool, args.level)
    const pair = pickMetricPair(slicedPool, 'population')
    if (!pair) return null
    const flip = Math.random() > 0.5
    const first = flip ? pair.b : pair.a
    const second = flip ? pair.a : pair.b
    const isMore = (first.population ?? 0) > (second.population ?? 0)
    return {
      id: `${type} -${first.cca3} -${second.cca3} `,
      type,
      prompt: `Is ${first.name} more populous than ${second.name}?`,
      options: ['Yes', 'No'],
      correctIndex: isMore ? 0 : 1,
      optionCca3s: [first.cca3, second.cca3],
      displayCca3s: [first.cca3, second.cca3].filter(Boolean) as string[],
    }
  }

  if (type === 'gdp_tier') {
    const rank = args.pools.gdpRankByCca3.get(country.cca3)
    if (!rank) return null
    const tiers = [
      { label: 'Top 10', max: 10 },
      { label: 'Top 25', max: 25 },
      { label: 'Top 50', max: 50 },
      { label: 'Outside Top 50', max: Infinity },
    ]
    const correctIndex = tiers.findIndex((tier) => rank <= tier.max)
    if (correctIndex < 0) return null
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which GDP tier is ${country.name} in? `,
      options: tiers.map((tier) => tier.label),
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'economy_exports_mcq') {
    const exportLabel = country.topExports?.[0]?.label ?? ''
    if (!exportLabel) return null
    const exportPool = args.pools.exportsPool.flatMap((item) => item.topExports ?? [])
    const { options, correctIndex } = buildOptionSetFromValues(
      exportPool.map((item) => item.label),
      exportLabel,
    )
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Top export category for ${country.name} ? `,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'unesco_mcq') {
    const siteName = country.unescoSites?.[0] ?? ''
    if (!siteName) return null
    const sitePool = args.pools.unescoPool.flatMap((item) => item.unescoSites ?? [])
    const { options, correctIndex } = buildOptionSetFromValues(sitePool, siteName)
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which UNESCO World Heritage site is in ${country.name}?`,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'landmark_photo_mcq') {
    const landmarks = args.pools.landmarkByCca3.get(country.cca3 ?? '') ?? []
    if (!landmarks.length) return null
    const landmark = landmarks[Math.floor(Math.random() * landmarks.length)]
    const slicedPool = getPoolForLevel(args.pools.countries, args.level)
    const { options, correctIndex, optionCca3s } = buildOptionSetForCountries(
      slicedPool,
      country,
    )
    return {
      id: `${type} -${country.cca3} -${landmark.id} `,
      type,
      prompt: `Which country is shown in this landmark photo ? `,
      options,
      correctIndex,
      optionCca3s,
      imagePath: landmark.imagePath,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'silhouette_mcq') {
    const slicedPool = getPoolForLevel(args.pools.mapPool, args.level)
    const { options, correctIndex, optionCca3s } = buildOptionSetForCountries(slicedPool, country)
    const targetFeature = args.featureIndex.get(country.cca3 ?? '')
    if (!targetFeature) return null
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Identify this country by its shape: `,
      options: options,
      correctIndex,
      optionCca3s,
      targetCca3: country.cca3,
      targetFeature,
      displayCca3s: [country.cca3],
      hideLabels: true,
    }
  }

  if (type === 'coastline_mcq') {
    const targetFeature = args.featureIndex.get(country.cca3 ?? '')
    if (!targetFeature) return null
    const slicedPool = getPoolForLevel(args.pools.countries, args.level)
    const { options, correctIndex } = buildOptionSetForCountries(slicedPool, country)
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Which island or coastline is shown here ? `,
      options,
      correctIndex,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
      targetFeature,
    }
  }

  if (type === 'flag_colors_mcq') {
    const hasThree = [
      'FRA', 'DEU', 'ITA', 'BEL', 'ROU', 'COL', 'VEN', 'ECU', 'EST', 'LTU', 'LVA',
      'RUS', 'NLD', 'LUX', 'BUL', 'IRL', 'HUN', 'SLE', 'GAB', 'TCD', 'MLI', 'GIN', 'CIV'
    ].includes(country.cca3 ?? '')
    return {
      id: `${type} -${country.cca3} `,
      type,
      prompt: `Does the flag of ${country.name} have at least THREE distinct colors ? `,
      options: ['Yes', 'No'],
      correctIndex: hasThree ? 0 : 1,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'journey_puzzle') {
    // Find countries with good border connectivity
    const countriesWithBorders = args.pools.neighborPool.filter(c => (c.borders?.length ?? 0) >= 2)
    if (countriesWithBorders.length < 3) return null

    const shuffled = shuffle(countriesWithBorders)
    const start = shuffled[0]
    
    // Try to find a 2-3 step journey
    let end: CountryMeta | null = null
    let intermediate: CountryMeta[] = []
    let journeyPath: string[] | null = null

    for (let attempts = 0; attempts < 50; attempts++) {
      const candidateEnd = shuffled[Math.floor(Math.random() * shuffled.length)]
      if (candidateEnd.cca3 === start.cca3) continue

      // Try with 1 intermediate country
      const candidateIntermediate = shuffled.filter(c => 
        c.cca3 !== start.cca3 && 
        c.cca3 !== candidateEnd.cca3 &&
        (c.borders?.length ?? 0) >= 2
      )
      
      if (candidateIntermediate.length > 0) {
        const inter = candidateIntermediate[0]
        journeyPath = findJourneyPath(start, candidateEnd, [inter], args.pools.countriesByCca3, 4)
        if (journeyPath && journeyPath.length >= 3 && journeyPath.length <= 5) {
          end = candidateEnd
          intermediate = [inter]
          break
        }
      }

      // Try direct path if no intermediate works
      journeyPath = findPathBetween(start, candidateEnd, args.pools.countriesByCca3, 3)
      if (journeyPath && journeyPath.length >= 2 && journeyPath.length <= 4) {
        end = candidateEnd
        intermediate = []
        journeyPath = [start.cca3!, ...journeyPath.slice(1)]
        break
      }
    }

    if (!end || !journeyPath) return null

    // Build options: correct answer + distractors
    const optionCandidates = [{ name: end.name, cca3: end.cca3 }]
    const excludedCca3s = new Set([start.cca3, end.cca3, ...intermediate.map(i => i.cca3)])
    
    const distractors = shuffle(args.pools.neighborPool.filter(c => 
      !excludedCca3s.has(c.cca3) &&
      c.region === start.region // Same region for difficulty
    )).slice(0, 3)

    for (const distractor of distractors) {
      optionCandidates.push({ name: distractor.name, cca3: distractor.cca3 })
    }

    const finalCandidates = shuffle(optionCandidates)
    const finalOptions = finalCandidates.map(item => item.name)
    const optionCca3s = finalCandidates.map(item => item.cca3)

    const pathDescription = intermediate.length > 0
      ? `Starting in ${start.name}, travel through ${intermediate.map(i => i.name).join(' and ')}, then continue. Where do you end up?`
      : `Starting in ${start.name}, travel through neighboring countries. Where do you end up?`

    // Get feature for start country for camera positioning
    const startFeature = args.featureIndex.get(start.cca3!)

    return {
      id: `${type}-${start.cca3}-${end.cca3}`,
      type,
      prompt: pathDescription,
      options: finalOptions,
      correctIndex: finalOptions.indexOf(end.name),
      optionCca3s,
      targetCca3: end.cca3 ?? undefined,
      displayCca3s: journeyPath,
      journeyPath,
      targetFeature: startFeature, // Use start country for camera
    }
  }

  if (type === 'region_builder') {
    // Pick a region/subregion and find countries in it
    const regions = new Set(args.pools.countries.map(c => c.region).filter(Boolean))
    const regionArray = Array.from(regions)
    if (regionArray.length === 0) return null

    const targetRegion = shuffle(regionArray)[0]
    const regionCountries = args.pools.countries.filter(c => c.region === targetRegion)
    
    if (regionCountries.length < 3) return null
    
    // Use a subset (3-6 countries) for the question
    const questionSize = Math.min(6, Math.max(3, Math.floor(regionCountries.length * 0.4)))
    const correctCountries = shuffle(regionCountries).slice(0, questionSize)
    const correctCca3s = correctCountries.map(c => c.cca3!).filter(Boolean)

    // Build distractors from other regions (same number as correct)
    const distractors = shuffle(args.pools.countries.filter(c => 
      c.region !== targetRegion &&
      !correctCca3s.includes(c.cca3!)
    )).slice(0, questionSize)

    const allOptions = shuffle([...correctCountries, ...distractors])
    const optionCca3s = allOptions.map(c => c.cca3!).filter(Boolean)

    // Get feature for first correct country for camera positioning
    const firstFeature = correctCca3s.length > 0 ? args.featureIndex.get(correctCca3s[0]) : undefined

    return {
      id: `${type}-${targetRegion}-${Date.now()}`,
      type,
      prompt: `Select all countries in ${targetRegion}`,
      options: allOptions.map(c => c.name),
      correctIndex: undefined, // Multi-select, no single correct index
      optionCca3s,
      targetCca3: undefined,
      displayCca3s: correctCca3s,
      correctCountries: correctCca3s,
      selectedCountries: [],
      targetFeature: firstFeature, // Use first country for camera
    }
  }

  return null
}

function getNextCountryForType(
  type: QuestionType,
  args: {
    pools: {
      mapPool: CountryMeta[]
      flagPool: CountryMeta[]
      capitalPool: CountryMeta[]
      neighborPool: CountryMeta[]
      currencyPool: CountryMeta[]
      cityPool: CountryMeta[]
      riverPool: CountryMeta[]
      languagePool: CountryMeta[]
      populationPool: CountryMeta[]
      areaPool: CountryMeta[]
      landlockedPool: CountryMeta[]
      peakPool: CountryMeta[]
      rangePool: CountryMeta[]
      regionPool: CountryMeta[]
      unescoPool: CountryMeta[]
      exportsPool: CountryMeta[]
      gdpPool: CountryMeta[]
      landmarkPool: CountryMeta[]
      countries: CountryMeta[]
    }
    queueRef: MutableRefObject<Record<QuestionType, string[]>>
    level: number
    completedQuestions: string[]
    performanceStats?: Record<QuestionType, { correct: number; total: number; totalResponseTime: number }>
  },
) {
  const pool =
    type === 'map_tap'
      ? args.pools.mapPool
      : type === 'flag_match'
        ? args.pools.flagPool
        : type === 'capital_mcq'
          ? args.pools.capitalPool
          : type === 'neighbor_mcq' || type === 'neighbor_count_mcq' || type === 'journey_puzzle'
            ? args.pools.neighborPool
            : type === 'currency_mcq'
              ? args.pools.currencyPool
              : type === 'city_mcq'
                ? args.pools.cityPool
                : type === 'river_mcq'
                  ? args.pools.riverPool
                  : type === 'language_mcq'
                    ? args.pools.languagePool
                    : type === 'population_pair' ||
                      type === 'population_rank' ||
                      type === 'population_tier' ||
                      type === 'population_more_than'
                      ? args.pools.populationPool
                      : type === 'area_pair'
                        ? args.pools.areaPool
                        : type === 'landlocked_mcq'
                          ? args.pools.landlockedPool
                          : type === 'peak_mcq'
                            ? args.pools.peakPool
                            : type === 'range_mcq'
                              ? args.pools.rangePool
                              : type === 'region_mcq' || type === 'subregion_outlier' || type === 'region_builder'
                                ? args.pools.regionPool
                                : type === 'unesco_mcq'
                                  ? args.pools.unescoPool
                                  : type === 'economy_exports_mcq'
                                    ? args.pools.exportsPool
                                    : type === 'gdp_tier'
                                      ? args.pools.gdpPool
                                      : type === 'landmark_photo_mcq'
                                        ? args.pools.landmarkPool
                                        : args.pools.countries
  if (!pool.length) return null

  // Adaptive difficulty: adjust level based on performance
  let adjustedLevel = args.level
  if (args.performanceStats && args.performanceStats[type]) {
    const stats = args.performanceStats[type]
    if (stats.total >= 5) { // Need at least 5 attempts for meaningful stats
      const accuracy = stats.correct / stats.total
      if (accuracy > 0.8) {
        // High accuracy: increase difficulty by expanding pool
        adjustedLevel = Math.min(args.level + 2, 50)
      } else if (accuracy < 0.5) {
        // Low accuracy: decrease difficulty
        adjustedLevel = Math.max(args.level - 1, 1)
      }
    }
  }

  // Slice pool based on adjusted level
  // For difficult question types, prefer larger countries at lower levels
  const preferLarge = (type === 'peak_mcq' && adjustedLevel < 15) ||
                      (type === 'range_mcq' && adjustedLevel < 17) ||
                      (type === 'region_mcq' && adjustedLevel < 21)
  const basePool = getPoolForLevel(pool, adjustedLevel, preferLarge)

  // Filter out completed questions for this specific type
  let currentPool = basePool.filter(c => !args.completedQuestions.includes(`${type}-${c.cca3}`))

  // If we've exhausted everything in this level's pool for this type, 
  // we have no choice but to recycle (or pull from all countries if user wants infinity).
  // But for now, we recycle the oldest ones by clearing the history for this type-pool combo.
  if (currentPool.length === 0) {
    currentPool = basePool
  }

  const queue = args.queueRef.current[type]
  if (queue.length === 0) {
    args.queueRef.current[type] = shuffle(currentPool.map((country) => country.cca3).filter(Boolean) as string[])
  }

  const nextCca3 = args.queueRef.current[type].shift()
  return currentPool.find((country) => country.cca3 === nextCca3) ?? currentPool[0]
}

function getPoolForLevel<T extends { area?: number; population?: number } | any>(pool: T[], level: number, preferLargeCountries: boolean = false): T[] {
  // Slower, smoother difficulty curve
  // Pool size grows by 4 every level (was 5)
  // Level 1: 20
  // Level 8: 48 (was 60) -> gentler introduction
  // Level 15: 76
  // Level 50: ~220 (Full World)
  const end = Math.min(pool.length, 16 + level * 4)

  // Safety Net: Keep top countries until Level 12
  // Then slowly phase them out.
  const start = level < 12 ? 0 : Math.min(pool.length - 20, (level - 12) * 2)

  let result = pool.slice(start, end)

  // For difficult question types, prefer larger countries at lower levels
  if (preferLargeCountries && level < 15) {
    // Sort by area (descending) and take top portion
    // Type guard to check if items have area property
    const hasArea = (item: any): item is { area?: number } => typeof item === 'object' && item !== null && 'area' in item
    const sorted = [...result].sort((a, b) => {
      const areaA = hasArea(a) ? (a.area ?? 0) : 0
      const areaB = hasArea(b) ? (b.area ?? 0) : 0
      return areaB - areaA
    })
    // At level 10-12, use top 60% of pool (larger countries)
    // At level 13-14, use top 80% of pool
    const ratio = level < 13 ? 0.6 : 0.8
    const topCount = Math.max(10, Math.floor(sorted.length * ratio))
    result = sorted.slice(0, topCount)
  }

  return result
}

function buildOptionSet(
  pool: CountryMeta[],
  correct: CountryMeta,
  valueSelector: (country: CountryMeta) => string,
  preferredValue?: string,
) {
  const options = new Set<string>()
  const correctValue = preferredValue ?? valueSelector(correct)
  options.add(correctValue)

  const sameContinent = pool.filter((c) => c.region === correct.region)

  // Favor same-continent distractors if the pool is large enough
  const primaryPool = sameContinent.length >= 4 ? sameContinent : pool
  const shuffled = shuffle(primaryPool)

  for (const country of shuffled) {
    const value = valueSelector(country)
    if (!value || value === correctValue) continue
    options.add(value)
    if (options.size >= 4) break
  }

  // Fallback if not enough distractors on the same continent
  if (options.size < 4) {
    const fallbackShuffled = shuffle(pool)
    for (const country of fallbackShuffled) {
      const value = valueSelector(country)
      if (!value || value === correctValue) continue
      options.add(value)
      if (options.size >= 4) break
    }
  }

  const finalOptions = shuffle(Array.from(options))
  const correctIndex = finalOptions.indexOf(correctValue)
  return { options: finalOptions, correctIndex }
}

function buildOptionSetFromValues(values: string[], correctValue: string) {
  const options = new Set<string>()
  if (correctValue) options.add(correctValue)
  const shuffled = shuffle(values.filter(Boolean))
  for (const value of shuffled) {
    if (!value || value === correctValue) continue
    options.add(value)
    if (options.size >= 4) break
  }
  const finalOptions = shuffle(Array.from(options))
  const correctIndex = finalOptions.indexOf(correctValue)
  return { options: finalOptions, correctIndex }
}

function buildOptionSetForCountries(pool: CountryMeta[], correct: CountryMeta) {
  const options = new Set<string>()
  const optionCca3s: (string | null | undefined)[] = []
  const correctValue = correct.name
  options.add(correctValue)

  const sameContinent = pool.filter((c) => c.region === correct.region && c.name !== correctValue)
  const sameSubregion = pool.filter((c) => c.subregion === correct.subregion && c.name !== correctValue)

  // Use subregion distractors at high levels to make it harder
  const distractorPool = pool.length > 50 && sameSubregion.length >= 3 ? sameSubregion : sameContinent.length >= 3 ? sameContinent : pool

  const shuffled = shuffle(distractorPool)
  for (const country of shuffled) {
    const value = country.name
    if (!value || value === correctValue) continue
    options.add(value)
    if (options.size >= 4) break
  }

  // If still not enough options, fallback to full pool
  if (options.size < 4) {
    const fallbackShuffled = shuffle(pool)
    for (const country of fallbackShuffled) {
      const value = country.name
      if (!value || value === correctValue) continue
      options.add(value)
      if (options.size >= 4) break
    }
  }

  const finalOptions = shuffle(Array.from(options))
  for (const option of finalOptions) {
    const match = pool.find((country) => country.name === option)
    optionCca3s.push(match?.cca3 ?? null)
  }
  const correctIndex = finalOptions.indexOf(correctValue)
  return { options: finalOptions, correctIndex, optionCca3s }
}

function shuffle<T>(items: T[]) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}


function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')} `
}

function formatScore(n: number) {
  return n.toLocaleString('en-US')
}

function getPointsForQuestion(type: QuestionType): number {
  switch (type) {
    case 'journey_puzzle':
      return 1200 // High value for multi-step puzzle
    case 'region_builder':
      return 1000 // High value for multi-select puzzle
    case 'map_tap':
      return 1000
    case 'coastline_mcq':
    case 'silhouette_mcq':
      return 900
    case 'river_mcq':
      return 800
    case 'landmark_photo_mcq':
      return 750
    case 'neighbor_count_mcq':
    case 'subregion_outlier':
    case 'neighbor_mcq':
    case 'peak_mcq':
    case 'range_mcq':
    case 'unesco_mcq':
    case 'economy_exports_mcq':
    case 'gdp_tier':
    case 'journey_puzzle':
      return 600
    case 'population_rank':
    case 'capital_mcq':
    case 'currency_mcq':
    case 'language_mcq':
    case 'city_mcq':
    case 'flag_colors_mcq':
    case 'population_tier':
    case 'population_more_than':
      return 500
    case 'flag_match':
    case 'population_pair':
    case 'area_pair':
    case 'landlocked_mcq':
    case 'region_mcq':
    default:
      return 400
  }
}


function resolvePublicAsset(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  if (!path.startsWith('/')) return path
  const baseUrl = import.meta.env.BASE_URL || '/'
  return `${baseUrl}${path.slice(1)} `
}

function computeBBox(geometry: GeoFeature['geometry']): [number, number, number, number] {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  forEachCoordinate(geometry, (lng, lat) => {
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  })

  return [west, south, east, north]
}

function bboxCenter(bbox: [number, number, number, number]) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as [number, number]
}

// Custom easing functions removed - using MapLibre default easing for stability

// Determine country type for contextual camera behavior
function getCountryType(country: CountryMeta | null): 'island' | 'mountainous' | 'large' | 'small' | 'standard' {
  if (!country) return 'standard'
  
  // Island: not landlocked, small area, or in island-heavy regions
  const isIsland = !country.landlocked && (
    country.area < 50000 || // Small area (km²)
    ['Oceania', 'Caribbean'].includes(country.subregion) ||
    country.subregion.includes('Island')
  )
  
  // Mountainous: has mountain ranges or high peaks
  const isMountainous = (country.mountainRanges?.length ?? 0) > 0 || 
                        (country.highestPeak?.elevation ?? 0) > 3000
  
  // Large: area > 1M km²
  const isLarge = country.area > 1000000
  
  // Small: area < 100k km²
  const isSmall = country.area < 100000
  
  if (isIsland) return 'island'
  if (isMountainous) return 'mountainous'
  if (isLarge) return 'large'
  if (isSmall) return 'small'
  return 'standard'
}

function isPointInFeature(lng: number, lat: number, record: FeatureRecord) {
  if (!isPointInBBox(lng, lat, record.bbox)) return false
  const geometry = record.feature.geometry
  if (geometry.type === 'Polygon') {
    return isPointInPolygon([lng, lat], geometry.coordinates as number[][][])
  }
  return (geometry.coordinates as number[][][][]).some((polygon) =>
    isPointInPolygon([lng, lat], polygon),
  )
}

function isPointInBBox(lng: number, lat: number, bbox: [number, number, number, number]) {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

function isPointInPolygon(point: [number, number], polygon: number[][][]) {
  const [outer, ...holes] = polygon
  if (!outer || !isPointInRing(point, outer)) return false
  for (const hole of holes) {
    if (isPointInRing(point, hole)) return false
  }
  return true
}

function isPointInRing(point: [number, number], ring: number[][]) {
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

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function getRiverName(properties?: { name?: string; name_en?: string }) {
  return properties?.name ?? properties?.name_en ?? null
}

function computeBBoxFromLine(coordinates: number[][]): [number, number, number, number] {
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

function mergeBBoxes(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ]
}

function computeRiverBBox(
  geometry: RiverFeature['geometry'],
): [number, number, number, number] | null {
  if (!geometry) return null
  if (geometry.type === 'LineString') {
    return computeBBoxFromLine(geometry.coordinates as number[][])
  }
  if (geometry.type === 'MultiLineString') {
    let bbox: [number, number, number, number] | null = null
    for (const segment of geometry.coordinates as number[][][]) {
      const segmentBbox = computeBBoxFromLine(segment)
      bbox = bbox ? mergeBBoxes(bbox, segmentBbox) : segmentBbox
    }
    return bbox
  }
  return null
}

function isSmallTargetHit(
  map: maplibregl.Map,
  bbox: [number, number, number, number],
  clickPoint: maplibregl.Point,
) {
  const [west, south, east, north] = bbox
  const topLeft = map.project([west, north])
  const bottomRight = map.project([east, south])
  const width = Math.abs(bottomRight.x - topLeft.x)
  const height = Math.abs(bottomRight.y - topLeft.y)
  if (Math.max(width, height) > 12) return false
  const center = bboxCenter(bbox)
  const centerPoint = map.project(center)
  const dx = clickPoint.x - centerPoint.x
  const dy = clickPoint.y - centerPoint.y
  return Math.hypot(dx, dy) <= 28
}

function forEachCoordinate(
  geometry: GeoFeature['geometry'],
  handler: (lng: number, lat: number) => void,
) {
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates as number[][][]) {
      for (const coordinate of ring) {
        handler(coordinate[0], coordinate[1])
      }
    }
    return
  }

  for (const polygon of geometry.coordinates as number[][][][]) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        handler(coordinate[0], coordinate[1])
      }
    }
  }
}

function flashCountrySelection(
  map: maplibregl.Map,
  args: {
    clickedCca3?: string
    correctCca3?: string
    isCorrect: boolean
    flashedIdsRef: React.MutableRefObject<string[]>
    flashTimeoutRef: React.MutableRefObject<number | null>
  },
) {
  if (!args.correctCca3) return

  if (args.flashTimeoutRef.current) {
    window.clearTimeout(args.flashTimeoutRef.current)
  }

  for (const id of args.flashedIdsRef.current) {
    map.setFeatureState({ source: 'countries', id }, { flash: null })
  }
  args.flashedIdsRef.current = []

  const idsToFlash: { id: string; state: 'correct' | 'incorrect' }[] = []
  if (args.isCorrect) {
    idsToFlash.push({ id: args.correctCca3, state: 'correct' })
  } else {
    if (args.clickedCca3) {
      idsToFlash.push({ id: args.clickedCca3, state: 'incorrect' })
    }
    idsToFlash.push({ id: args.correctCca3, state: 'correct' })
  }

  for (const item of idsToFlash) {
    map.setFeatureState({ source: 'countries', id: item.id }, { flash: item.state })
    args.flashedIdsRef.current.push(item.id)
  }

  args.flashTimeoutRef.current = window.setTimeout(() => {
    for (const id of args.flashedIdsRef.current) {
      map.setFeatureState({ source: 'countries', id }, { flash: null })
    }
    args.flashedIdsRef.current = []
    args.flashTimeoutRef.current = null
  }, 650)
}
