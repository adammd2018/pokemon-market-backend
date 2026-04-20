import express from 'express'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

const app = express()
const port = process.env.PORT || 8787
const pokemonApiBase = 'https://api.pokemontcg.io/v2'
const setCache = { value: null, expiresAt: 0 }
const searchCache = new Map()

function getHeaders() {
  const headers = { Accept: 'application/json' }
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY
  return headers
}

async function safeJson(url) {
  const response = await fetch(url, { headers: getHeaders() })
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json()
}

function parseDate(value) {
  if (!value) return 0
  return new Date(String(value).replace(/\//g, '-')).getTime()
}

function formatDate(value) {
  if (!value) return null
  const date = new Date(String(value).replace(/\//g, '-'))
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function daysSinceRelease(value) {
  const then = parseDate(value)
  if (!then) return 9999
  return Math.max(0, Math.round((Date.now() - then) / 86400000))
}

function getPrimaryPrice(card) {
  const prices = card?.tcgplayer?.prices || {}
  const preferredKeys = ['holofoil', 'normal', 'reverseHolofoil', '1stEditionHolofoil', 'unlimitedHolofoil', 'reverse']
  for (const key of preferredKeys) {
    const p = prices[key]
    if (p && (p.market || p.mid || p.low || p.high)) return { variant: key, ...p }
  }
  for (const [key, value] of Object.entries(prices)) {
    if (value && (value.market || value.mid || value.low || value.high)) return { variant: key, ...value }
  }
  return null
}

function deriveTrendFlags(pricing = {}) {
  const market = Number(pricing.market || 0)
  const low = Number(pricing.low || 0)
  const mid = Number(pricing.mid || 0)
  const high = Number(pricing.high || 0)
  if (!market) return { momentum: 'unknown', spreadPct: null, premiumVsMidPct: null }
  const spreadPct = low ? Number((((market - low) / market) * 100).toFixed(1)) : null
  const premiumVsMidPct = mid ? Number((((market - mid) / mid) * 100).toFixed(1)) : null
  let momentum = 'flat'
  if (premiumVsMidPct !== null) {
    if (premiumVsMidPct >= 8) momentum = 'breaking out'
    else if (premiumVsMidPct >= 2) momentum = 'firm'
    else if (premiumVsMidPct <= -8) momentum = 'soft'
    else if (premiumVsMidPct <= -2) momentum = 'slipping'
  }
  return { momentum, spreadPct, premiumVsMidPct, upsideToHighPct: high ? Number((((high - market) / market) * 100).toFixed(1)) : null }
}

function scoreCard(card) {
  const pricing = getPrimaryPrice(card)
  const rarity = String(card.rarity || '').toLowerCase()
  const market = Number(pricing?.market || 0)
  const mid = Number(pricing?.mid || pricing?.market || pricing?.low || 0)
  const low = Number(pricing?.low || 0)
  const high = Number(pricing?.high || mid)
  const directLow = Number(pricing?.directLow || pricing?.directLowPrice || 0)
  const days = daysSinceRelease(card?.set?.releaseDate)

  let score = 40
  const reasons = []
  const risks = []

  if (market >= 150) {
    score += 18
    reasons.push('Strong dollar value usually signals real collector demand.')
  } else if (market >= 50) {
    score += 10
    reasons.push('Healthy market price gives the card enough room to matter.')
  } else if (market >= 15) {
    score += 4
  } else {
    risks.push('Low market price usually means thinner upside unless demand accelerates.')
  }

  if (/illustration rare|special illustration rare|alternate art|alt art|secret/.test(rarity)) {
    score += 15
    reasons.push('Premium rarity helps long-term collector appeal.')
  } else if (/ultra rare|hyper rare|rare holo vstar|rare holo vmax|ace spec/.test(rarity)) {
    score += 8
    reasons.push('Above-base rarity supports demand better than standard holos.')
  }

  if (days >= 30 && days <= 240) {
    score += 12
    reasons.push('Past launch chaos but still early in the market cycle.')
  } else if (days < 30) {
    score -= 6
    risks.push('Very new releases can be distorted by early hype and tight supply.')
  } else if (days > 800) {
    score += 5
    reasons.push('Older supply can tighten when the card stays relevant.')
  }

  if (mid > 0 && market > 0) {
    const marketVsMid = market / mid
    if (marketVsMid >= 0.9 && marketVsMid <= 1.1) {
      score += 7
      reasons.push('Market price lines up with broader ask levels instead of looking broken.')
    }
  }

  if (low > 0 && market > 0) {
    const spread = (market - low) / market
    if (spread <= 0.18) {
      score += 6
      reasons.push('Tighter low-to-market spread suggests healthier pricing.')
    } else if (spread >= 0.35) {
      score -= 8
      risks.push('Wide low-to-market spread can mean fragile pricing or undercut pressure.')
    }
  }

  if (high > 0 && market > 0 && (high - market) / market >= 0.5) {
    score -= 5
    risks.push('Large gap between high and market can signal hype listings above the real market.')
  }

  if (directLow > 0 && directLow >= market * 0.96) {
    score += 4
    reasons.push('Direct low support suggests better quality supply near the market price.')
  }

  if (/charizard|pikachu|umbreon|rayquaza|eevee|gengar|mew|mewtwo|lugia/.test(String(card.name).toLowerCase())) {
    score += 8
    reasons.push('Iconic character demand can keep a card liquid longer than average.')
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let verdict = 'Watch'
  if (score >= 80) verdict = 'Buy'
  else if (score >= 67) verdict = 'Hold'
  else if (score >= 48) verdict = 'Watch'
  else verdict = 'Sell'

  return {
    score,
    verdict,
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 3),
    pricing,
    trend: deriveTrendFlags(pricing || {}),
    daysSinceRelease: days,
  }
}

function slimSet(set) {
  return {
    id: set.id,
    name: set.name,
    series: set.series,
    printedTotal: set.printedTotal,
    total: set.total,
    releaseDate: set.releaseDate,
    updatedAt: set.updatedAt,
    symbol: set.images?.symbol || null,
    logo: set.images?.logo || null,
  }
}

function slimCard(card) {
  const primary = getPrimaryPrice(card)
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    rarity: card.rarity || null,
    artist: card.artist || null,
    hp: card.hp || null,
    supertype: card.supertype || null,
    subtypes: card.subtypes || [],
    types: card.types || [],
    images: card.images || {},
    set: card.set ? {
      id: card.set.id,
      name: card.set.name,
      series: card.set.series,
      releaseDate: card.set.releaseDate,
      total: card.set.total,
      printedTotal: card.set.printedTotal,
      symbol: card.set.images?.symbol || null,
      logo: card.set.images?.logo || null,
    } : null,
    tcgplayer: card.tcgplayer || null,
    primaryPrice: primary,
    ai: scoreCard(card),
  }
}

async function fetchAllSets() {
  if (setCache.value && Date.now() < setCache.expiresAt) return setCache.value
  const pageSize = 250
  let page = 1
  let totalCount = Infinity
  const sets = []

  while (sets.length < totalCount && page <= 6) {
    const data = await safeJson(`${pokemonApiBase}/sets?page=${page}&pageSize=${pageSize}&orderBy=-releaseDate`)
    totalCount = Number(data.totalCount || data.data?.length || 0)
    sets.push(...(data.data || []))
    if (!data.data?.length) break
    page += 1
  }

  const deduped = Array.from(new Map(sets.map((set) => [set.id, set])).values())
  const sorted = deduped.sort((a, b) => parseDate(b.releaseDate) - parseDate(a.releaseDate))
  setCache.value = sorted
  setCache.expiresAt = Date.now() + 1000 * 60 * 60
  return sorted
}

async function fetchCardsPage(query, page = 1, pageSize = 250, orderBy = '-set.releaseDate,name,number') {
  const select = encodeURIComponent('id,name,number,rarity,artist,hp,supertype,subtypes,types,set,images,tcgplayer')
  const url = `${pokemonApiBase}/cards?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&orderBy=${encodeURIComponent(orderBy)}&select=${select}`
  return safeJson(url)
}

async function fetchCardsMultiPage(query, { pageSize = 250, maxPages = 6, orderBy = '-set.releaseDate,name,number' } = {}) {
  const cacheKey = JSON.stringify({ query, pageSize, maxPages, orderBy })
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let page = 1
  let totalCount = Infinity
  const cards = []

  while (cards.length < totalCount && page <= maxPages) {
    const data = await fetchCardsPage(query, page, pageSize, orderBy)
    totalCount = Number(data.totalCount || data.data?.length || 0)
    cards.push(...(data.data || []))
    if (!data.data?.length) break
    page += 1
  }

  const deduped = Array.from(new Map(cards.map((card) => [card.id, card])).values())
  const value = deduped
  searchCache.set(cacheKey, { value, expiresAt: Date.now() + 1000 * 60 * 15 })
  return value
}

function buildSearchQuery(term) {
  const normalized = term.trim().replace(/"/g, '')
  const escaped = normalized.replace(/'/g, "\\'")
  const exact = `name:"${escaped}"`
  const prefix = `name:${escaped}*`
  const setMatch = `set.name:"${escaped}"`
  const numberMatch = /^\d+[a-zA-Z-]*$/.test(normalized) ? `number:${escaped}` : null
  return [exact, prefix, setMatch, numberMatch].filter(Boolean).join(' OR ')
}

function sortByAiAndPrice(cards) {
  return [...cards].sort((a, b) => {
    const scoreDelta = (b.ai?.score || 0) - (a.ai?.score || 0)
    if (scoreDelta) return scoreDelta
    return (b.primaryPrice?.market || 0) - (a.primaryPrice?.market || 0)
  })
}

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/sets', async (req, res) => {
  try {
    const allSets = await fetchAllSets()
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 250)))
    res.json({
      generatedAt: new Date().toISOString(),
      total: allSets.length,
      sets: allSets.slice(0, limit).map(slimSet),
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sets.', details: error.message })
  }
})

app.get('/api/sets/:setId/cards', async (req, res) => {
  try {
    const { setId } = req.params
    const limit = Math.min(250, Math.max(1, Number(req.query.limit || 60)))
    const cards = await fetchCardsMultiPage(`set.id:${setId}`, { pageSize: 250, maxPages: 8, orderBy: 'number,name' })
    const enriched = sortByAiAndPrice(cards.filter((card) => getPrimaryPrice(card)).map(slimCard))
    res.json({ setId, total: enriched.length, cards: enriched.slice(0, limit) })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load set cards.', details: error.message })
  }
})

app.get('/api/home', async (_req, res) => {
  try {
    const sets = (await fetchAllSets()).slice(0, 36).map(slimSet)
    const newestSetIds = sets.slice(0, 8).map((set) => set.id)
    const cardsBySet = await Promise.all(newestSetIds.map((setId) => fetchCardsMultiPage(`set.id:${setId}`, { pageSize: 100, maxPages: 3 })))
    const movers = sortByAiAndPrice(cardsBySet.flat().filter((card) => getPrimaryPrice(card)).map(slimCard)).slice(0, 18)
    res.json({ generatedAt: new Date().toISOString(), sets, movers })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load home data.', details: error.message })
  }
})

app.get('/api/search', async (req, res) => {
  const term = String(req.query.q || '').trim()
  if (!term) return res.status(400).json({ error: 'Missing q query parameter.' })
  try {
    const cards = await fetchCardsMultiPage(buildSearchQuery(term), { pageSize: 250, maxPages: 8 })
    const results = sortByAiAndPrice(cards.filter((card) => getPrimaryPrice(card)).map(slimCard)).slice(0, 500)
    res.json({ query: term, total: results.length, results })
  } catch (error) {
    res.status(500).json({ error: 'Search failed.', details: error.message })
  }
})

app.get('/api/analyze', async (req, res) => {
  const term = String(req.query.q || '').trim()
  if (!term) return res.status(400).json({ error: 'Missing q query parameter.' })
  try {
    const cards = await fetchCardsMultiPage(buildSearchQuery(term), { pageSize: 250, maxPages: 6 })
    const results = sortByAiAndPrice(cards.filter((card) => getPrimaryPrice(card)).map(slimCard)).slice(0, 50)
    res.json({
      query: term,
      total: results.length,
      best: results[0] || null,
      results,
    })
  } catch (error) {
    res.status(500).json({ error: 'AI analysis failed.', details: error.message })
  }
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`Pokemon Market server running on http://localhost:${port}`)
})
