import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'

dotenv.config()

const app = express()
const port = process.env.PORT || 8787
const pokemonApiBase = 'https://api.pokemontcg.io/v2'
const pokeApiBase = 'https://pokeapi.co/api/v2'

app.use(cors({
  origin: [
    'https://pokeinvest.tritownrevival.org',
    'https://www.pokeinvest.tritownrevival.org',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.options('*', cors())
app.use(express.json())

const fallbackSets = []

const fallbackCards = [
  {
    id: 'sv3pt5-199',
    name: 'Charizard ex',
    number: '199',
    rarity: 'Special Illustration Rare',
    set: { id: 'sv3pt5', name: 'Scarlet & Violet 151', releaseDate: '2023/09/22' },
    tcgplayer: {
      updatedAt: '2026/04/19',
      prices: { holofoil: { low: 495, mid: 585, high: 775, market: 550, directLow: 560 } },
    },
    images: { small: 'https://images.pokemontcg.io/sv3pt5/199.png' },
  },
  {
    id: 'swsh7-215',
    name: 'Umbreon VMAX',
    number: '215',
    rarity: 'Rare Secret',
    set: { id: 'swsh7', name: 'Evolving Skies', releaseDate: '2021/08/27' },
    tcgplayer: {
      updatedAt: '2026/04/19',
      prices: { holofoil: { low: 1160, mid: 1375, high: 1800, market: 1299, directLow: 1305 } },
    },
    images: { small: 'https://images.pokemontcg.io/swsh7/215.png' },
  },
  {
    id: 'pgo-10',
    name: 'Mewtwo VSTAR',
    number: '31',
    rarity: 'Rare Holo VSTAR',
    set: { id: 'pgo', name: 'Pokémon GO', releaseDate: '2022/07/01' },
    tcgplayer: {
      updatedAt: '2026/04/19',
      prices: { holofoil: { low: 42, mid: 49, high: 75, market: 46, directLow: 45 } },
    },
    images: { small: 'https://images.pokemontcg.io/pgo/31.png' },
  },
]

const pokemonAliasMap = {
  'farfetchd': 'farfetchd',
  "farfetch'd": 'farfetchd',
  'sirfetchd': 'sirfetchd',
  "sirfetch'd": 'sirfetchd',
  'mrmime': 'mr-mime',
  'mr mime': 'mr-mime',
  'mimejr': 'mime-jr',
  'mime jr': 'mime-jr',
  'typenull': 'type-null',
  'type null': 'type-null',
  'nidoranf': 'nidoran-f',
  'nidoran f': 'nidoran-f',
  'nidoranm': 'nidoran-m',
  'nidoran m': 'nidoran-m',
  'hooh': 'ho-oh',
  'porygonz': 'porygon-z',
  'jangmoo': 'jangmo-o',
  'hakamoo': 'hakamo-o',
  'kommoo': 'kommo-o',
  'greattusk': 'great-tusk',
  'slitherwing': 'slither-wing',
  'sandyshocks': 'sandy-shocks',
  'ironhands': 'iron-hands',
  'ironbundle': 'iron-bundle',
  'ironthorns': 'iron-thorns',
  'roaringmoon': 'roaring-moon',
  'walkingwake': 'walking-wake',
  'ragingbolt': 'raging-bolt',
  'ironcrown': 'iron-crown',
  'ironboulder': 'iron-boulder',
  'ironleaves': 'iron-leaves',
  'wochien': 'wo-chien',
  'chienpao': 'chien-pao',
  'tinglu': 'ting-lu',
  'chiyu': 'chi-yu',

  'wo-chien': 'wo-chien',
  'chien-pao': 'chien-pao',
  'ting-lu': 'ting-lu',
  'chi-yu': 'chi-yu',
}
function getHeaders() {
  const headers = { Accept: 'application/json' }
  if (process.env.POKEMONTCG_API_KEY) {
    headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY
  }
  return headers
}

async function safeJson(url, headers = {}) {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json()
}

function parseDate(value) {
  if (!value) return 0
  return new Date(String(value).replace(/\//g, '-')).getTime()
}

function daysSinceRelease(value) {
  const then = parseDate(value)
  if (!then) return 9999
  const diffMs = Date.now() - then
  return Math.max(0, Math.round(diffMs / 86400000))
}

function getPrimaryPrice(card) {
  const prices = card?.tcgplayer?.prices || {}
  const preferredKeys = [
    'holofoil',
    'normal',
    'reverseHolofoil',
    '1stEditionHolofoil',
    'unlimitedHolofoil',
    'reverse',
  ]

  for (const key of preferredKeys) {
    if (prices[key]?.market) return { variant: key, ...prices[key] }
  }

  for (const [key, value] of Object.entries(prices)) {
    if (value?.market || value?.mid || value?.low) return { variant: key, ...value }
  }

  return null
}

function scoreCard(card) {
  const pricing = getPrimaryPrice(card)
  const rarity = String(card.rarity || '').toLowerCase()
  const market = pricing?.market || 0
  const mid = pricing?.mid || pricing?.market || pricing?.low || 0
  const low = pricing?.low || 0
  const high = pricing?.high || mid
  const directLow = pricing?.directLow || pricing?.directLowPrice || 0
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
    risks.push('Low market price usually means thin upside unless demand accelerates.')
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
    reasons.push('The card is past launch chaos but still early in its market life.')
  } else if (days < 30) {
    score -= 6
    risks.push('Very new releases can be distorted by pre-release hype and low supply.')
  } else if (days > 800) {
    score += 5
    reasons.push('Older supply can tighten if the card stays relevant.')
  }

  if (mid > 0 && market > 0) {
    const marketVsMid = market / mid
    if (marketVsMid >= 0.9 && marketVsMid <= 1.1) {
      score += 7
      reasons.push('Market price is lining up with the broader ask range instead of looking broken.')
    }
  }

  if (low > 0 && market > 0) {
    const spread = (market - low) / market
    if (spread <= 0.18) {
      score += 6
      reasons.push('Low-to-market spread is fairly tight, which can mean healthier pricing.')
    } else if (spread >= 0.35) {
      score -= 8
      risks.push('Wide low-to-market spread can mean fragile pricing or undercut pressure.')
    }
  }

  if (high > 0 && market > 0) {
    const hypeGap = (high - market) / market
    if (hypeGap >= 0.5) {
      score -= 5
      risks.push('Large gap between high and market can signal hype listings above the real market.')
    }
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
  if (score >= 78) verdict = 'Strong hold candidate'
  else if (score >= 62) verdict = 'Possible hold'
  else if (score <= 42) verdict = 'Probably not a hold'

  return {
    score,
    verdict,
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 3),
    pricing,
    daysSinceRelease: days,
  }
}

function sortSetsNewestFirst(sets) {
  return [...sets].sort((a, b) => parseDate(b.releaseDate) - parseDate(a.releaseDate))
}

async function fetchRecentSets(limit = 8) {
  try {
    const data = await safeJson(`${pokemonApiBase}/sets?pageSize=50&orderBy=-releaseDate`, getHeaders())
    return sortSetsNewestFirst(data.data || []).slice(0, limit)
  } catch {
    return fallbackSets
  }
}

function classifySetStatus(releaseDate) {
  const time = parseDate(releaseDate)
  if (!time) return 'unknown'
  return time > Date.now() ? 'upcoming' : 'released'
}

async function fetchCardsForSet(setId, pageSize = 40) {
  try {
    const query = encodeURIComponent(`set.id:${setId}`)
    const select = encodeURIComponent('id,name,number,rarity,set,images,tcgplayer')
    const data = await safeJson(`${pokemonApiBase}/cards?q=${query}&pageSize=${pageSize}&orderBy=-set.releaseDate&select=${select}`, getHeaders())
    return data.data || []
  } catch {
    return fallbackCards.filter((card) => card.set.id === setId)
  }
}

function pickTopCandidates(cards, max = 6) {
  return cards
    .map((card) => ({ ...card, model: scoreCard(card) }))
    .sort((a, b) => {
      const aHasPricing = a.model.pricing ? 1 : 0
      const bHasPricing = b.model.pricing ? 1 : 0
      if (bHasPricing !== aHasPricing) return bHasPricing - aHasPricing
      return b.model.score - a.model.score || ((b.model.pricing?.market || 0) - (a.model.pricing?.market || 0))
    })
    .slice(0, max)
}

function normalizePokemonName(input) {
  const cleaned = String(input || '')
    .replace(/\b(ex|gx|vmax|vstar|v-union|v|tag team|radiant|shiny|delta|break|lv\.?x|star)\b/gi, ' ')
    .replace(/[♀]/g, ' f')
    .replace(/[♂]/g, ' m')
    .replace(/[^a-zA-Z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!cleaned) return ''

  const key = cleaned.replace(/['\-.\s]/g, '')
  if (pokemonAliasMap[key]) return pokemonAliasMap[key]
  if (pokemonAliasMap[cleaned]) return pokemonAliasMap[cleaned]

  const words = cleaned.split(' ')
  if (words.length > 1) {
    const first = words[0]
    const firstKey = first.replace(/['\-.\s]/g, '')
    if (pokemonAliasMap[firstKey]) return pokemonAliasMap[firstKey]
    return first
  }

  return cleaned
}

function titleCase(value) {
  return String(value || '')
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function extractEvolutionChain(chainNode, bucket = []) {
  if (!chainNode?.species?.name) return bucket
  bucket.push(titleCase(chainNode.species.name))
  for (const child of chainNode.evolves_to || []) extractEvolutionChain(child, bucket)
  return bucket
}

async function fetchPokemonEnrichment(term) {
  const pokemonName = normalizePokemonName(term)
  if (!pokemonName) return null

  try {
    const pokemon = await safeJson(`${pokeApiBase}/pokemon/${encodeURIComponent(pokemonName)}`)
    const species = await safeJson(pokemon.species.url)
    const evolution = species.evolution_chain?.url ? await safeJson(species.evolution_chain.url) : null

    return {
      lookup: pokemonName,
      profile: {
        id: pokemon.id,
        name: titleCase(pokemon.name),
        sprite: pokemon.sprites?.other?.['official-artwork']?.front_default || pokemon.sprites?.front_default || null,
        heightMeters: pokemon.height ? pokemon.height / 10 : null,
        weightKg: pokemon.weight ? pokemon.weight / 10 : null,
        baseExperience: pokemon.base_experience || null,
        types: (pokemon.types || []).map((entry) => titleCase(entry.type.name)),
        abilities: (pokemon.abilities || []).map((entry) => ({
          name: titleCase(entry.ability.name.replace(/-/g, ' ')),
          hidden: !!entry.is_hidden,
        })),
        stats: (pokemon.stats || []).map((entry) => ({
          name: titleCase(entry.stat.name.replace(/special-/g, 'sp. ')),
          base: entry.base_stat,
        })),
        generation: species.generation?.name ? titleCase(species.generation.name.replace('generation-', 'Gen ')) : null,
        habitat: species.habitat?.name ? titleCase(species.habitat.name) : null,
        captureRate: species.capture_rate ?? null,
        color: species.color?.name ? titleCase(species.color.name) : null,
        evolves: evolution?.chain ? extractEvolutionChain(evolution.chain, []) : [],
      },
    }
  } catch {
    return null
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/release-radar', async (_req, res) => {
  const sets = await fetchRecentSets(8)
  const cardsBySet = await Promise.all(
    sets.map(async (set) => {
      const cards = await fetchCardsForSet(set.id, 40)
      return {
        set: { ...set, status: classifySetStatus(set.releaseDate) },
        candidates: pickTopCandidates(cards, 5),
      }
    }),
  )

  const usedFallback = sets.length === 0
  res.json({
    source: usedFallback ? 'fallback cards only' : 'pokemontcg.io live data',
    generatedAt: new Date().toISOString(),
    fallback: usedFallback,
    sets: cardsBySet,
  })
})

app.get('/api/card-search', async (req, res) => {
  const term = String(req.query.q || '').trim()
  if (!term) return res.status(400).json({ error: 'Missing q query parameter.' })

  try {
    const query = encodeURIComponent(`name:"${term}" OR name:${term}`)
    const select = encodeURIComponent('id,name,number,rarity,set,images,tcgplayer')
    const data = await safeJson(`${pokemonApiBase}/cards?q=${query}&pageSize=24&orderBy=-set.releaseDate&select=${select}`, getHeaders())
    const results = (data.data || [])
      .map((card) => ({ ...card, model: scoreCard(card) }))
      .sort((a, b) => {
        const aHasPricing = a.model.pricing ? 1 : 0
        const bHasPricing = b.model.pricing ? 1 : 0
        if (bHasPricing !== aHasPricing) return bHasPricing - aHasPricing
        return b.model.score - a.model.score
      })

    res.json({ results, pokemonLookup: normalizePokemonName(term) || null })
  } catch {
    const results = fallbackCards
      .filter((card) => card.name.toLowerCase().includes(term.toLowerCase()))
      .map((card) => ({ ...card, model: scoreCard(card) }))
    res.json({ results, fallback: true, pokemonLookup: normalizePokemonName(term) || null })
  }
})

app.get('/api/pokemon-enrich', async (req, res) => {
  const term = String(req.query.q || '').trim()
  if (!term) return res.status(400).json({ error: 'Missing q query parameter.' })

  const enrichment = await fetchPokemonEnrichment(term)
  if (!enrichment) return res.status(404).json({ error: 'No PokéAPI species matched that search.' })
  res.json({ source: 'pokeapi.co', generatedAt: new Date().toISOString(), ...enrichment })
})

app.get('/api/predict', async (req, res) => {
  const term = String(req.query.q || '').trim()
  let card = null

  if (term) {
    try {
      const query = encodeURIComponent(`name:"${term}" OR name:${term}`)
      const select = encodeURIComponent('id,name,number,rarity,set,images,tcgplayer')
      const data = await safeJson(`${pokemonApiBase}/cards?q=${query}&pageSize=10&orderBy=-set.releaseDate&select=${select}`, getHeaders())
      card = (data.data || [])[0] || null
    } catch {
      card = fallbackCards.find((entry) => entry.name.toLowerCase().includes(term.toLowerCase())) || null
    }
  }

  if (!card) return res.status(404).json({ error: 'No card matched that search.' })

  const enrichment = await fetchPokemonEnrichment(card.name)
  res.json({
    card,
    pokemon: enrichment?.profile || null,
    model: scoreCard(card),
    generatedAt: new Date().toISOString(),
  })
})

app.listen(port, () => {
  console.log(`Pokemon Market AI server running on http://localhost:${port}`)
})
