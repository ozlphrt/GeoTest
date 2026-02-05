import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import countriesData from './data/countries_merged.json'
import admin0GeoJsonUrl from './data/admin0_sovereignty.geojson?url'
import riversGeoJsonUrl from './data/raw/ne_50m_rivers.geojson?url'

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
  targetFeature?: FeatureRecord
  targetCca3?: string
  displayCca3s?: string[]
  continent?: string
}

function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const flagFallbackRef = useRef(false)
  const flashTimeoutRef = useRef<number | null>(null)
  const flashedIdsRef = useRef<string[]>([])
  const focusedIdsRef = useRef<string[]>([])
  const nextTimeoutRef = useRef<number | null>(null)
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [messageOverlay, setMessageOverlay] = useState<{
    isOpen: boolean
    message: string
    type: 'correct' | 'incorrect'
  }>({ isOpen: false, message: '', type: 'incorrect' })
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [isDataLoaded, setIsDataLoaded] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [featureIndex, setFeatureIndex] = useState<Map<string, FeatureRecord>>(new Map())
  const [riverIndex, setRiverIndex] = useState<Map<string, RiverRecord>>(new Map())
  const [score, setScore] = useState(0)
  const [displayScore, setDisplayScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [currentStreak, setCurrentStreak] = useState(0)
  const [hearts, setHearts] = useState(3)
  const [gameOver, setGameOver] = useState(false)
  const [removedIndices, setRemovedIndices] = useState<number[]>([])
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
  const [isAtlasOpen, setIsAtlasOpen] = useState(false)
  const [achievements, setAchievements] = useState<string[]>([])
  const [notification, setNotification] = useState<{ id: string; title: string } | null>(null)

  const countryPools = useMemo(() => {
    const countries = countriesData as CountryMeta[]
    const countriesByCca3 = new Map<string, CountryMeta>()
    for (const country of countries) {
      if (country.cca3) {
        countriesByCca3.set(country.cca3, country)
      }
    }
    const sorted = [...countries].sort((a, b) => {
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

    const mapPool = filterAndSort(countries.filter((country) => country.cca3 && featureIndex.has(country.cca3)))
    const flagPool = filterAndSort(countries.filter((country) => country.cca2 && (country.flagSvg || country.flagPng)))
    const capitalPool = filterAndSort(countries.filter((country) => country.capital?.length))
    const neighborPool = filterAndSort(countries.filter(
      (country) => country.borders?.length && country.borders.some((code) => countriesByCca3.has(code)),
    ))
    const currencyPool = filterAndSort(countries.filter((country) => country.currencies?.length))
    const cityPool = filterAndSort(countries.filter((country) => country.cities?.length))
    const riverPool = filterAndSort(countries.filter((country) => country.rivers?.length))
    const languagePool = filterAndSort(countries.filter((country) => country.languages?.length))
    const populationPool = filterAndSort(countries.filter((country) => (country.population ?? 0) > 0))
    const areaPool = filterAndSort(countries.filter((country) => (country.area ?? 0) > 0))
    const landlockedPool = filterAndSort(countries.filter((country) => typeof country.landlocked === 'boolean'))
    const peakPool = filterAndSort(countries.filter((country) => country.highestPeak?.name))
    const rangePool = filterAndSort(countries.filter((country) => country.mountainRanges?.length))
    const regionPool = filterAndSort(countries.filter((country) => country.physicalRegions?.length))
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
    })
    setCurrentQuestion(question)
  }, [countryPools, featureIndex, level])

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
  })
  const typeIndexRef = useRef(0)

  const restartGame = () => {
    setHearts(3)
    setGameOver(false)
    setScore(0)
    setCurrentStreak(0)
    setHintsLeft(3)
    setSkipsLeft(3)
    setLevel(1)
    setCorrectInLevel(0)
    setMessageOverlay({ isOpen: false, message: '', type: 'incorrect' })
    // Reset queue?
    queueRef.current = {
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
    }
    const question = buildNextQuestion({
      pools: countryPools,
      featureIndex,
      queueRef,
      typeIndexRef,
      level: 1,
    })
    setCurrentQuestion(question)
  }

  useEffect(() => {
    const saved = localStorage.getItem('geotest-progress')
    if (saved) {
      try {
        const data = JSON.parse(saved)
        if (typeof data.highScore === 'number') setHighScore(data.highScore)
        if (typeof data.score === 'number') setScore(data.score)
        if (typeof data.level === 'number') setLevel(data.level)
        if (typeof data.hearts === 'number') setHearts(data.hearts)
        if (typeof data.correctInLevel === 'number') setCorrectInLevel(data.correctInLevel)
        if (typeof data.streak === 'number') setCurrentStreak(data.streak)
        if (data.theme === 'light' || data.theme === 'dark') setTheme(data.theme)
        if (typeof data.isMuted === 'boolean') setIsMuted(data.isMuted)
        if (data.mastery) setMastery(data.mastery)
        if (Array.isArray(data.achievements)) setAchievements(data.achievements)
      } catch (e) {
        console.error('Failed to load progress', e)
      }
    } else {
      // Default to system preference if no saved theme
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        setTheme('light')
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('geotest-progress', JSON.stringify({
      highScore,
      score,
      level,
      hearts,
      correctInLevel,
      streak: currentStreak,
      theme,
      isMuted,
      mastery,
      achievements
    }))
    document.body.classList.toggle('light-mode', theme === 'light')
  }, [highScore, score, level, hearts, correctInLevel, currentStreak, theme, isMuted, mastery, achievements])

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
    let isActive = true

    const loadGeoJson = async () => {
      try {
        setLoadingProgress((p) => p + 10)
        const response = await fetch(admin0GeoJsonUrl)
        if (!response.ok) {
          throw new Error(`GeoJSON fetch failed: ${response.status}`)
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
          throw new Error(`Rivers fetch failed: ${response.status}`)
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
          'line-color': '#2d3644',
          'line-width': 1,
        },
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    setSelectedIndex(null)
    flagFallbackRef.current = false
    setMessageOverlay({ isOpen: false, message: '', type: 'incorrect' })
    setRemovedIndices([])
  }, [currentQuestion?.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !currentQuestion) return

    const handleMapTap = (event: maplibregl.MapMouseEvent) => {
      if (currentQuestion.type !== 'map_tap' || !currentQuestion.targetFeature) return
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

      const clickedName =
        clickedCca3 && countryPools.countriesByCca3.get(clickedCca3)?.name
      if (!isCorrect) {
        const errorLabel = clickedName ? clickedName : 'WRONG AREA'
        setMessageOverlay({
          isOpen: true,
          message: errorLabel,
          type: 'incorrect'
        })

        setHearts((h) => {
          const next = h - 1
          if (next <= 0) {
            setGameOver(true)
          }
          return next
        })
      } else {
        setMessageOverlay({ isOpen: true, message: 'CORRECT!', type: 'correct' })
      }

      if (isCorrect) {
        const basePoints = getPointsForQuestion(currentQuestion.type)
        const points = Math.round(basePoints * (1 + currentStreak * 0.1) * (1 + (level - 1) * 0.2))
        setScore((s) => {
          const next = s + points
          if (next > highScore) setHighScore(next)
          return next
        })

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
        if (nextTimeoutRef.current) {
          window.clearTimeout(nextTimeoutRef.current)
        }
        nextTimeoutRef.current = window.setTimeout(() => {
          handleNext()
          nextTimeoutRef.current = null
        }, 3000)
      }
    }

    map.on('click', handleMapTap)
    return () => {
      map.off('click', handleMapTap)
    }
  }, [currentQuestion, level, currentStreak, hearts, score, setCorrectInLevel, setGameOver, setHearts, setLevel, setMessageOverlay, setScore, setCurrentStreak, handleNext, countryPools, featureIndex])

  useEffect(() => {
    if (!currentQuestion) return
    const map = mapRef.current
    if (!map || currentQuestion.type !== 'map_tap' || !currentQuestion.targetFeature) return
    const center = bboxCenter(currentQuestion.targetFeature.bbox)
    map.flyTo({ center, zoom: 0.85, duration: 1500, pitch: 45 })
  }, [currentQuestion])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !currentQuestion) return

    // Clear previous focus
    for (const id of focusedIdsRef.current) {
      map.setFeatureState({ source: 'countries', id }, { focus: false })
    }
    focusedIdsRef.current = []

    if (currentQuestion.type === 'map_tap') return

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
    map.fitBounds(
      [
        [merged[0], merged[1]],
        [merged[2], merged[3]],
      ],

      { padding: 130, duration: 1500, maxZoom: 2.0, pitch: 45 },
    )
  }, [currentQuestion?.id, featureIndex])

  useEffect(() => {
    if (!currentQuestion || currentQuestion.type !== 'river_mcq') return
    const map = mapRef.current
    if (!map) return
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

  const handleOptionSelect = (index: number) => {
    if (!currentQuestion || currentQuestion.correctIndex === undefined) return
    setSelectedIndex(index)
    const isCorrect = index === currentQuestion.correctIndex
    const correctCca3 =
      currentQuestion.optionCca3s?.[currentQuestion.correctIndex] ??
      currentQuestion.targetCca3


    if (isCorrect) {
      if (correctCca3) {
        setMastery((prev) => ({
          ...prev,
          [correctCca3]: (prev[correctCca3] ?? 0) + 1,
        }))
      }
      playGameSound('correct', isMuted)
      setMessageOverlay({ isOpen: true, message: 'CORRECT!', type: 'correct' })
      const basePoints = getPointsForQuestion(currentQuestion.type)
      const points = Math.round(basePoints * (1 + currentStreak * 0.1) * (1 + (level - 1) * 0.2))
      setScore((s) => {
        const next = s + points
        if (next > highScore) setHighScore(next)
        if (next >= 10000) triggerAchievement('elite', 'Geographic Elite (10k Pts)')
        return next
      })

      setCorrectInLevel((prev) => {
        const next = prev + 1
        if (next >= 5) {
          const nextLevel = level + 1
          setLevel(nextLevel)
          if (nextLevel === 5) triggerAchievement('lvl5', 'Veteran Traveler (Level 5)')
          setIsLevelUp(true)
          playGameSound('levelup', isMuted)
          setTimeout(() => setIsLevelUp(false), 2000)
          setHearts((h) => Math.min(h + 1, 3))
          return 0
        }
        return next
      })

      setCurrentStreak((prev) => {
        const next = prev + 1
        if (next === 10) triggerAchievement('streak10', 'Unstoppable! (10 Streak)')
        if (next % 5 === 0) {
          setHearts((h) => Math.min(h + 1, 3))
        }
        return next
      })
    } else {
      setCorrectInLevel(0)
      setShakeIndex(index)
      playGameSound('incorrect', isMuted)
      setTimeout(() => setShakeIndex(null), 500)
      const selectedOption = currentQuestion.options?.[index]
      const errorLabel = selectedOption ? selectedOption : 'INCORRECT'

      setMessageOverlay({
        isOpen: true,
        message: errorLabel,
        type: 'incorrect'
      })

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
    if (correctCca3 && mapRef.current) {
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
    nextTimeoutRef.current = window.setTimeout(() => {
      handleNext()
      nextTimeoutRef.current = null
    }, isCorrect ? 700 : 3000)
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
  const flagSrc = resolvePublicAsset(
    currentQuestion?.flagSvg && !flagFallbackRef.current
      ? currentQuestion.flagSvg
      : currentQuestion?.flagPng ?? null,
  )

  const handleFlagError = () => {
    flagFallbackRef.current = true
  }

  const isMapTap = currentQuestion?.type === 'map_tap'

  return (
    <div className="app">
      <div className="map" ref={mapContainerRef} />

      {!isDataLoaded && (
        <div className="loader-screen">
          <div className="loader-content">
            <h1 className="loader-title">GEOTEST</h1>
            <div className="loader-bar-container">
              <div
                className="loader-bar"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <div className="loader-status">
              PREPARING {loadingProgress}%
            </div>
          </div>
        </div>
      )}

      <div className="utility-toggles">
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
        </button>

        <button
          className="theme-toggle"
          onClick={() => setIsAtlasOpen(true)}
          title="Open Atlas (Mastery Tracker)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </button>
      </div>

      {notification && (
        <div className="achievement-toast animate-pop">
          <div className="achievement-icon">🏆</div>
          <div className="achievement-text">
            <div className="achievement-status">Achievement Unlocked!</div>
            <div className="achievement-title">{notification.title}</div>
          </div>
        </div>
      )}

      {isDataLoaded && (
        <>
          <div className="scoreboard">
            <div className={`stat-group ${displayScore !== score ? 'animate-score-bump' : ''}`}>
              <div className="stat-label">Score</div>
              <div className="stat-value">{formatScore(displayScore)}</div>
              <div className="stat-sub">BEST: {formatScore(highScore)}</div>
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
              <div className="stat-label">Progress</div>
              <div className={`stat-value accent ${isLevelUp ? 'animate-pulse' : ''}`}>
                L.{level}
              </div>
              <div className="stat-sub">{correctInLevel}/5 NEXT</div>
            </div>

            <div className="divider" />

            <div className="hearts-container">
              {Array.from({ length: 3 }).map((_, i) => (
                <svg
                  key={i}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  className={i < hearts ? "pulse-heart" : ""}
                  fill={i < hearts ? "#ff4d4d" : "rgba(255,255,255,0.05)"}
                  style={{
                    opacity: i < hearts ? 1 : 0.3,
                    transition: 'all 0.3s ease'
                  }}
                >
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                </svg>
              ))}
            </div>
          </div>
          {!isOnline && (
            <div className="offline-banner">
              Offline mode: map tiles unavailable, quiz continues.
            </div>
          )}

          {!gameOver && (
            <section className={`quiz-panel ${isMapTap ? 'compact' : ''}`} aria-live="polite">
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

              <div className="powerups">
                {currentQuestion?.options && currentQuestion.options.length >= 4 && (
                  <button
                    className="powerup-btn"
                    onClick={handleHint}
                    disabled={hintsLeft <= 0 || removedIndices.length > 0}
                    title={`Spend Hint Charge (${hintsLeft} left). Removes 2 wrong answers`}
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
                  title={`Spend Skip Charge (${skipsLeft} left). Preserves streak`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 17 5-5-5-5M13 17l5-5-5-5" />
                  </svg>
                  <span>Skip</span>
                  <span className="powerup-badge">{skipsLeft}</span>
                </button>
              </div>

              {currentQuestion?.options && (
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
                      onClick={() => handleOptionSelect(index)}
                      style={{ visibility: removedIndices.includes(index) ? 'hidden' : 'visible' }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              {!isMapTap && currentQuestion?.type === 'map_tap' && (
                <div className="map-instruction">
                  Tap to answer.
                </div>
              )}

              <div className="panel-footer" />
            </section>
          )}

          {messageOverlay.isOpen && (
            <div className={`incorrect-overlay ${messageOverlay.type}`}>
              <div className="incorrect-overlay-text">{messageOverlay.message}</div>
            </div>
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
              <div className="atlas-content">
                {Object.entries(atlasByContinent).map(([continent, countries]) => (
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
                ))}
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
      )
      }
    </div >
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
  }
  featureIndex: Map<string, FeatureRecord>
  queueRef: MutableRefObject<Record<QuestionType, string[]>>
  typeIndexRef: MutableRefObject<number>
  level: number
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
  ]

  // Filter types by level
  const levelTypes: QuestionType[] = []

  // Level 1+: Basic identifiers
  levelTypes.push('flag_match', 'capital_mcq')

  // Level 3+: Geography & Positioning
  if (args.level >= 3) levelTypes.push('map_tap', 'neighbor_mcq', 'population_pair', 'area_pair')

  // Level 5+: Detail & Characteristics  
  if (args.level >= 5) levelTypes.push('city_mcq', 'currency_mcq', 'landlocked_mcq', 'region_mcq')

  // Level 7+: Cultural & Hydrography
  if (args.level >= 7) levelTypes.push('river_mcq', 'language_mcq')

  // Level 9+: Advanced physical geography
  if (args.level >= 9) levelTypes.push('peak_mcq', 'range_mcq')

  const types = levelTypes.length > 0 ? levelTypes : allTypes

  for (let attempt = 0; attempt < types.length; attempt += 1) {
    const type = types[args.typeIndexRef.current % types.length]
    args.typeIndexRef.current += 1
    const question = buildQuestionForType(type, args)
    if (question) return question
  }

  return {
    id: 'no-data',
    type: 'flag_match' as QuestionType,
    prompt: 'No country data available.',
    options: ['Retry'],
    correctIndex: 0,
  }
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
    }
    featureIndex: Map<string, FeatureRecord>
    queueRef: MutableRefObject<Record<QuestionType, string[]>>
    level: number
  },
) {
  const country = getNextCountryForType(type, args)
  if (!country || !country.cca3) return null

  if (type === 'map_tap') {
    const targetFeature = args.featureIndex.get(country.cca3) ?? undefined
    return {
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${country.cca3}`,
      type,
      prompt: `Currency code for ${country.name}?`,
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
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${country.cca3}`,
      type,
      prompt: `Is ${country.name} landlocked or coastal?`,
      options: ['Landlocked', 'Coastal'],
      correctIndex: country.landlocked ? 0 : 1,
      targetCca3: country.cca3,
      displayCca3s: [country.cca3],
    }
  }

  if (type === 'peak_mcq') {
    const peakName = country.highestPeak?.name ?? ''
    if (!peakName) return null
    const slicedPool = getPoolForLevel(args.pools.peakPool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.highestPeak?.name ?? '',
      peakName,
    )
    return {
      id: `${type}-${country.cca3}`,
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
    const slicedPool = getPoolForLevel(args.pools.rangePool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.mountainRanges?.[0] ?? '',
      rangeName,
    )
    return {
      id: `${type}-${country.cca3}`,
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
    const slicedPool = getPoolForLevel(args.pools.regionPool, args.level)
    const { options, correctIndex } = buildOptionSet(
      slicedPool,
      country,
      (item) => item.physicalRegions?.[0] ?? '',
      regionName,
    )
    return {
      id: `${type}-${country.cca3}`,
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
      id: `${type}-${pair.a.cca3}-${pair.b.cca3}`,
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
      id: `${type}-${pair.a.cca3}-${pair.b.cca3}`,
      type,
      prompt: 'Which is larger by area?',
      options: [pair.a.name, pair.b.name],
      optionCca3s: [pair.a.cca3, pair.b.cca3],
      correctIndex: (pair.a.area ?? 0) > (pair.b.area ?? 0) ? 0 : 1,
      displayCca3s: [pair.a.cca3, pair.b.cca3].filter(Boolean) as string[],
    }
  }
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
    }
    queueRef: MutableRefObject<Record<QuestionType, string[]>>
    level: number
  },
) {
  const pool =
    type === 'map_tap'
      ? args.pools.mapPool
      : type === 'flag_match'
        ? args.pools.flagPool
        : type === 'capital_mcq'
          ? args.pools.capitalPool
          : type === 'neighbor_mcq'
            ? args.pools.neighborPool
            : type === 'currency_mcq'
              ? args.pools.currencyPool
              : type === 'city_mcq'
                ? args.pools.cityPool
                : type === 'river_mcq'
                  ? args.pools.riverPool
                  : type === 'language_mcq'
                    ? args.pools.languagePool
                    : type === 'population_pair'
                      ? args.pools.populationPool
                      : type === 'area_pair'
                        ? args.pools.areaPool
                        : type === 'landlocked_mcq'
                          ? args.pools.landlockedPool
                          : type === 'peak_mcq'
                            ? args.pools.peakPool
                            : type === 'range_mcq'
                              ? args.pools.rangePool
                              : args.pools.regionPool
  if (!pool.length) return null

  // Slice pool based on level
  const currentPool = getPoolForLevel(pool, args.level)

  const queue = args.queueRef.current[type]
  if (queue.length === 0) {
    args.queueRef.current[type] = shuffle(currentPool.map((country) => country.cca3).filter(Boolean) as string[])
  }

  const nextCca3 = args.queueRef.current[type].shift()
  return currentPool.find((country) => country.cca3 === nextCca3) ?? currentPool[0]
}

function getPoolForLevel<T>(pool: T[], level: number): T[] {
  if (level === 1) return pool.slice(0, 20)
  if (level === 2) return pool.slice(0, 40)
  if (level === 3) return pool.slice(0, 60)
  if (level === 4) return pool.slice(0, 80)
  if (level === 5) return pool.slice(0, 100)
  if (level === 6) return pool.slice(0, 130)
  if (level === 7) return pool.slice(0, 160)
  if (level === 8) return pool.slice(0, 200)
  return pool
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

  const shuffled = shuffle(pool)
  for (const country of shuffled) {
    const value = valueSelector(country)
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

  const shuffled = shuffle(pool)
  for (const country of shuffled) {
    const value = country.name
    if (!value || value === correctValue) continue
    options.add(value)
    if (options.size >= 4) break
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
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatScore(n: number) {
  return n.toLocaleString('en-US')
}

function getPointsForQuestion(type: QuestionType): number {
  switch (type) {
    case 'map_tap':
      return 1000
    case 'river_mcq':
      return 800
    case 'neighbor_mcq':
    case 'peak_mcq':
    case 'range_mcq':
      return 600
    case 'capital_mcq':
    case 'currency_mcq':
    case 'language_mcq':
    case 'city_mcq':
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
  return `${baseUrl}${path.slice(1)}`
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
