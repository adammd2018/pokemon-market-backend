require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const pokemonApiBase = "https://api.pokemontcg.io/v2";
const pokeApiBase = "https://pokeapi.co/api/v2";

const ANALYZER_SCAN_PAGES = Math.max(Number(process.env.ANALYZER_SCAN_PAGES || 5), 1);
const ANALYZER_PAGE_SIZE = Math.min(Math.max(Number(process.env.ANALYZER_PAGE_SIZE || 50), 1), 250);

function jsonHeaders(extra = {}) {
  const headers = { Accept: "application/json", ...extra };
  if (process.env.POKEMONTCG_API_KEY && process.env.POKEMONTCG_API_KEY.trim()) {
    headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY.trim();
  }
  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const error = new Error("Upstream did not return valid JSON");
    error.status = 502;
    error.body = text;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Upstream request failed: ${response.status}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return data;
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPriceBlock(card) {
  return card?.tcgplayer?.prices?.holofoil
    || card?.tcgplayer?.prices?.reverseHolofoil
    || card?.tcgplayer?.prices?.normal
    || null;
}

function toPrice(card) {
  return (
    numberOrNull(card?.tcgplayer?.prices?.holofoil?.market) ??
    numberOrNull(card?.tcgplayer?.prices?.reverseHolofoil?.market) ??
    numberOrNull(card?.tcgplayer?.prices?.normal?.market) ??
    numberOrNull(card?.cardmarket?.prices?.avg30) ??
    null
  );
}

function toRecentSale(card) {
  return (
    numberOrNull(card?.tcgplayer?.prices?.holofoil?.mid) ??
    numberOrNull(card?.tcgplayer?.prices?.reverseHolofoil?.mid) ??
    numberOrNull(card?.tcgplayer?.prices?.normal?.mid) ??
    numberOrNull(card?.cardmarket?.prices?.avg7) ??
    null
  );
}

function toRarity(card) {
  return card?.rarity || "Unknown";
}

function toImage(card) {
  return card?.images?.small || card?.images?.large || null;
}

function pctChange(current, previous) {
  const c = numberOrNull(current);
  const p = numberOrNull(previous);
  if (c === null || p === null || p === 0) return null;
  return Number((((c - p) / p) * 100).toFixed(2));
}

function estimateChanges(card) {
  const market = toPrice(card);
  const recent = toRecentSale(card);
  const avg1 = numberOrNull(card?.cardmarket?.prices?.avg1);
  const avg7 = numberOrNull(card?.cardmarket?.prices?.avg7);
  const avg30 = numberOrNull(card?.cardmarket?.prices?.avg30);

  // Prefer actual windows when present, otherwise fall back to best nearby reference.
  const dailyChange = pctChange(
    market ?? recent,
    avg1 ?? recent ?? market
  );

  const weeklyChange = pctChange(
    market ?? recent,
    avg7 ?? recent ?? market
  );

  const monthlyChange = pctChange(
    market ?? recent,
    avg30 ?? avg7 ?? recent ?? market
  );

  return {
    dailyChange,
    weeklyChange,
    monthlyChange
  };
}

function normalizeCard(card) {
  const changes = estimateChanges(card);
  return {
    id: card.id,
    name: card.name,
    supertype: card.supertype || null,
    subtypes: card.subtypes || [],
    set: card.set?.name || null,
    setId: card.set?.id || null,
    setSeries: card.set?.series || null,
    releaseDate: card.set?.releaseDate || null,
    number: card.number || null,
    rarity: toRarity(card),
    artist: card.artist || null,
    hp: card.hp || null,
    types: card.types || [],
    image: toImage(card),
    marketPrice: toPrice(card),
    recentSale: toRecentSale(card),
    dailyChange: changes.dailyChange,
    weeklyChange: changes.weeklyChange,
    monthlyChange: changes.monthlyChange,
    tcgplayerUrl: card?.tcgplayer?.url || null,
    cardmarketUrl: card?.cardmarket?.url || null
  };
}

function average(nums) {
  const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function sum(nums) {
  return nums.filter((n) => typeof n === "number" && !Number.isNaN(n)).reduce((a, b) => a + b, 0);
}

async function getCards(params = {}) {
  const url = new URL(`${pokemonApiBase}/cards`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const data = await fetchJson(url.toString(), { headers: jsonHeaders() });
  return data.data || [];
}

async function getSets(params = {}) {
  const url = new URL(`${pokemonApiBase}/sets`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const data = await fetchJson(url.toString(), { headers: jsonHeaders() });
  return data.data || [];
}

async function scanCardsAcrossPages(baseParams = {}, pages = ANALYZER_SCAN_PAGES, pageSize = ANALYZER_PAGE_SIZE) {
  const requests = [];
  for (let page = 1; page <= pages; page += 1) {
    requests.push(
      getCards({
        ...baseParams,
        page,
        pageSize
      }).catch(() => [])
    );
  }
  const chunks = await Promise.all(requests);
  return chunks.flat();
}

function scoreCard(card) {
  const market = typeof card.marketPrice === "number" ? card.marketPrice : 0;
  const recent = typeof card.recentSale === "number" ? card.recentSale : 0;
  const daily = typeof card.dailyChange === "number" ? card.dailyChange : 0;
  const weekly = typeof card.weeklyChange === "number" ? card.weeklyChange : 0;
  const monthly = typeof card.monthlyChange === "number" ? card.monthlyChange : 0;

  let score = 50;

  if (market >= 100) score += 18;
  else if (market >= 50) score += 12;
  else if (market >= 20) score += 8;
  else if (market > 0) score += 3;

  if (recent >= 100) score += 10;
  else if (recent >= 50) score += 6;
  else if (recent >= 20) score += 3;

  if (weekly > 12) score += 10;
  else if (weekly > 5) score += 6;
  else if (weekly < -10) score -= 8;

  if (monthly > 20) score += 10;
  else if (monthly > 8) score += 6;
  else if (monthly < -15) score -= 10;

  if (daily > 10) score -= 3; // possible spike/chase risk

  if (card.rarity && /secret|ultra|illustration|hyper|alternate|special/i.test(card.rarity)) score += 12;
  if (card.setSeries && /scarlet|sword|sun|xy|black|diamond|platinum|neo|base/i.test(card.setSeries)) score += 4;
  if (card.supertype && /pokemon/i.test(card.supertype)) score += 3;

  return Math.max(1, Math.min(100, Math.round(score)));
}

function buildRecommendation(score, daily, weekly, monthly) {
  if (score >= 82 && (weekly >= 0 || monthly >= 0)) return "Strong Buy";
  if (score >= 70) return "Watch / Buy on Strength";
  if (score >= 58) return "Hold / Watch";
  if ((daily < -8 && weekly < -8) || monthly < -15) return "Sell / Avoid Weakness";
  return "Speculative Watch";
}

function buildRiskLevel(card, score, daily, weekly, monthly) {
  let risk = "Medium";
  if (card.marketPrice && card.marketPrice >= 80 && Math.abs(weekly || 0) < 8 && Math.abs(monthly || 0) < 15) risk = "Low";
  if (Math.abs(daily || 0) > 10 || Math.abs(weekly || 0) > 18 || Math.abs(monthly || 0) > 30) risk = "High";
  if (!card.marketPrice) risk = "High";
  if (score >= 80 && risk === "Medium") risk = "Medium";
  return risk;
}

function buildLiquidityNote(card) {
  if (typeof card.marketPrice === "number" && typeof card.recentSale === "number") {
    if (Math.abs(card.marketPrice - card.recentSale) <= Math.max(2, card.marketPrice * 0.08)) {
      return "Market price and recent sale are close, which suggests cleaner pricing and potentially better liquidity.";
    }
    return "Market price and recent sale are diverging, which can mean thinner or less stable liquidity.";
  }
  return "Liquidity confidence is limited because there is not enough recent pricing depth.";
}

function buildTrendNote(daily, weekly, monthly) {
  const d = typeof daily === "number" ? daily : null;
  const w = typeof weekly === "number" ? weekly : null;
  const m = typeof monthly === "number" ? monthly : null;

  if (w !== null && m !== null && w > 0 && m > 0) {
    return "The card is showing positive momentum across both the weekly and monthly windows.";
  }
  if (d !== null && d > 8 && w !== null && w <= 0) {
    return "The card may be experiencing a short-term spike without broader weekly confirmation.";
  }
  if (w !== null && w < 0 && m !== null && m < 0) {
    return "The trend is weak across both the weekly and monthly windows.";
  }
  return "The trend is mixed and needs more confirmation before conviction increases.";
}

function buildGradingOutlook(card, score) {
  if (card.marketPrice && card.marketPrice >= 100 && /secret|ultra|illustration|alternate|special/i.test(card.rarity || "")) {
    return "Interesting grading candidate if condition is strong, because the value profile supports closer inspection.";
  }
  if (score >= 75 && typeof card.marketPrice === "number" && card.marketPrice >= 40) {
    return "Worth checking for grading only if centering, edges, and surface quality are strong.";
  }
  return "Grading outlook is limited unless the raw condition is exceptional or the graded spread is unusually wide.";
}

function buildReasoning(card, score, recommendation) {
  const parts = [];

  if (typeof card.marketPrice === "number") {
    parts.push(`Current market price is ${card.marketPrice.toFixed(2)}.`);
  } else {
    parts.push("Current market price is limited or unavailable.");
  }

  if (typeof card.weeklyChange === "number") {
    parts.push(`Weekly change is ${card.weeklyChange.toFixed(2)}%.`);
  }
  if (typeof card.monthlyChange === "number") {
    parts.push(`Monthly change is ${card.monthlyChange.toFixed(2)}%.`);
  }

  if (/secret|ultra|illustration|hyper|alternate|special/i.test(card.rarity || "")) {
    parts.push("Rarity profile is stronger than average, which supports attention.");
  }

  parts.push(`Overall recommendation is ${recommendation}.`);
  return parts.join(" ");
}

function buildAnalyzedCard(card) {
  const score = scoreCard(card);
  const daily = card.dailyChange;
  const weekly = card.weeklyChange;
  const monthly = card.monthlyChange;
  const recommendation = buildRecommendation(score, daily, weekly, monthly);
  const riskLevel = buildRiskLevel(card, score, daily, weekly, monthly);

  return {
    ...card,
    aiScore: score,
    aiLabel:
      score >= 80 ? "Strong" :
      score >= 60 ? "Moderate" :
      "Speculative",
    recommendation,
    reasoning: buildReasoning(card, score, recommendation),
    riskLevel,
    gradingOutlook: buildGradingOutlook(card, score),
    liquidityNote: buildLiquidityNote(card),
    trendNote: buildTrendNote(daily, weekly, monthly)
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "pokemon-market-backend",
    data_sources: [pokemonApiBase, pokeApiBase],
    analyzer_scan_pages: ANALYZER_SCAN_PAGES,
    analyzer_page_size: ANALYZER_PAGE_SIZE,
    routes: [
      "/api/search",
      "/api/radar",
      "/api/analytics",
      "/api/education",
      "/api/education/:pokemon",
      "/api/analyzer"
    ]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 12), 50);

  try {
    let query = "";
    if (q) {
      const escaped = q.replace(/"/g, '\\"');
      query = `name:"*${escaped}*"`;
    }

    const cards = await getCards({
      q: query || undefined,
      page,
      pageSize: limit,
      orderBy: "-set.releaseDate"
    });

    res.json({
      results: cards.map(normalizeCard),
      count: cards.length,
      query: q
    });
  } catch (error) {
    res.status(error.status || 502).json({
      error: "search request failed",
      details: error.body || error.message
    });
  }
});

app.get("/api/radar", async (req, res) => {
  try {
    const latestSets = await getSets({
      orderBy: "-releaseDate",
      page: 1,
      pageSize: 4
    });

    const cardsBySet = await Promise.all(
      latestSets.map((set) =>
        getCards({
          q: `set.id:${set.id}`,
          page: 1,
          pageSize: 18,
          orderBy: "-tcgplayer.prices.holofoil.market"
        }).catch(() => [])
      )
    );

    const flattened = cardsBySet.flat().map(normalizeCard).filter((c) => typeof c.marketPrice === "number");
    const sortedByPrice = [...flattened].sort((a, b) => (b.marketPrice || 0) - (a.marketPrice || 0));

    res.json({
      latestSets: latestSets.map((set) => ({
        id: set.id,
        name: set.name,
        series: set.series,
        releaseDate: set.releaseDate,
        images: set.images
      })),
      gainers: sortedByPrice.slice(0, 8),
      mostValuableRecent: sortedByPrice.slice(0, 12),
      totalRecentCardsScanned: flattened.length
    });
  } catch (error) {
    res.status(error.status || 502).json({
      error: "radar request failed",
      details: error.body || error.message
    });
  }
});

app.get("/api/analytics", async (req, res) => {
  try {
    const latestSets = await getSets({
      orderBy: "-releaseDate",
      page: 1,
      pageSize: 6
    });

    const cardsBySet = await Promise.all(
      latestSets.map((set) =>
        getCards({
          q: `set.id:${set.id}`,
          page: 1,
          pageSize: 25,
          orderBy: "-tcgplayer.prices.holofoil.market"
        }).catch(() => [])
      )
    );

    const setAnalytics = latestSets.map((set, idx) => {
      const cards = cardsBySet[idx].map(normalizeCard);
      const prices = cards.map((c) => c.marketPrice);
      return {
        setId: set.id,
        setName: set.name,
        releaseDate: set.releaseDate,
        cardCountScanned: cards.length,
        averageMarketPrice: average(prices),
        totalMarketValue: sum(prices),
        highestCard: [...cards]
          .filter((c) => typeof c.marketPrice === "number")
          .sort((a, b) => (b.marketPrice || 0) - (a.marketPrice || 0))[0] || null
      };
    });

    const allCards = cardsBySet.flat().map(normalizeCard);
    const rarityBreakdown = {};
    allCards.forEach((card) => {
      const key = card.rarity || "Unknown";
      rarityBreakdown[key] = (rarityBreakdown[key] || 0) + 1;
    });

    res.json({
      sets: setAnalytics,
      rarityBreakdown,
      cardsScanned: allCards.length
    });
  } catch (error) {
    res.status(error.status || 502).json({
      error: "analytics request failed",
      details: error.body || error.message
    });
  }
});

app.get("/api/education", async (req, res) => {
  try {
    const [typesData, generationsData] = await Promise.all([
      fetchJson(`${pokeApiBase}/type`, { headers: jsonHeaders() }),
      fetchJson(`${pokeApiBase}/generation`, { headers: jsonHeaders() })
    ]);

    const sets = await getSets({
      orderBy: "-releaseDate",
      page: 1,
      pageSize: 8
    });

    res.json({
      pokemonTypes: (typesData.results || []).map((t) => t.name),
      generations: (generationsData.results || []).map((g) => g.name),
      recentSets: sets.map((set) => ({
        id: set.id,
        name: set.name,
        series: set.series,
        releaseDate: set.releaseDate,
        images: set.images
      }))
    });
  } catch (error) {
    res.status(error.status || 502).json({
      error: "education request failed",
      details: error.body || error.message
    });
  }
});

app.get("/api/education/:pokemon", async (req, res) => {
  const pokemon = String(req.params.pokemon || "").toLowerCase().trim();
  try {
    const species = await fetchJson(`${pokeApiBase}/pokemon-species/${pokemon}`, {
      headers: jsonHeaders()
    });
    const pokemonData = await fetchJson(`${pokeApiBase}/pokemon/${pokemon}`, {
      headers: jsonHeaders()
    });

    const englishFlavor = (species.flavor_text_entries || []).find(
      (entry) => entry.language?.name === "en"
    );

    const cardMatches = await getCards({
      q: `name:"*${pokemonData.name}*"`,
      page: 1,
      pageSize: 12,
      orderBy: "-set.releaseDate"
    });

    res.json({
      pokemon: {
        id: pokemonData.id,
        name: pokemonData.name,
        height: pokemonData.height,
        weight: pokemonData.weight,
        types: (pokemonData.types || []).map((t) => t.type.name),
        abilities: (pokemonData.abilities || []).map((a) => a.ability.name),
        sprite: pokemonData.sprites?.front_default || null
      },
      species: {
        generation: species.generation?.name || null,
        habitat: species.habitat?.name || null,
        isLegendary: species.is_legendary,
        isMythical: species.is_mythical,
        flavorText: englishFlavor ? englishFlavor.flavor_text.replace(/\f/g, " ") : null
      },
      cards: cardMatches.map(normalizeCard)
    });
  } catch (error) {
    res.status(error.status || 502).json({
      error: "education pokemon request failed",
      details: error.body || error.message
    });
  }
});

app.get("/api/analyzer", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const setId = String(req.query.setId || "").trim();
  const rarity = String(req.query.rarity || "").trim();

  try {
    let query = "";
    if (q) {
      const escaped = q.replace(/"/g, '\\"');
      query += `name:"*${escaped}*"`;
    }
    if (setId) query += `${query ? " " : ""}set.id:${setId}`;
    if (rarity) query += `${query ? " " : ""}rarity:"${rarity.replace(/"/g, '\\"')}"`;

    const cards = await scanCardsAcrossPages(
      {
        q: query || undefined,
        orderBy: "-set.releaseDate"
      },
      ANALYZER_SCAN_PAGES,
      ANALYZER_PAGE_SIZE
    );

    const normalized = cards.map(normalizeCard);
    const analyzed = normalized.map(buildAnalyzedCard).sort((a, b) => b.aiScore - a.aiScore);

    res.json({
      results: analyzed,
      scannedCards: normalized.length,
      scanPages: ANALYZER_SCAN_PAGES,
      pageSize: ANALYZER_PAGE_SIZE,
      query: {
        q,
        setId,
        rarity
      }
    });
  } catch (error) {
    res.status(error.status || 502).json({
      error: "analyzer request failed",
      details: error.body || error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Pokemon Market backend listening on port ${PORT}`);
});
