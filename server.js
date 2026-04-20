require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const pokemonApiBase = "https://api.pokemontcg.io/v2";
const pokeApiBase = "https://pokeapi.co/api/v2";

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

function toPrice(card) {
  return (
    card?.tcgplayer?.prices?.holofoil?.market ??
    card?.tcgplayer?.prices?.reverseHolofoil?.market ??
    card?.tcgplayer?.prices?.normal?.market ??
    card?.cardmarket?.prices?.avg30 ??
    null
  );
}

function toRecentSale(card) {
  return (
    card?.tcgplayer?.prices?.holofoil?.mid ??
    card?.tcgplayer?.prices?.reverseHolofoil?.mid ??
    card?.tcgplayer?.prices?.normal?.mid ??
    card?.cardmarket?.prices?.avg7 ??
    null
  );
}

function toRarity(card) {
  return card?.rarity || "Unknown";
}

function toImage(card) {
  return card?.images?.small || card?.images?.large || null;
}

function normalizeCard(card) {
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

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "pokemon-market-backend",
    data_sources: [pokemonApiBase, pokeApiBase],
    routes: ["/api/search", "/api/radar", "/api/analytics", "/api/education", "/api/education/:pokemon"]
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

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Pokemon Market backend listening on port ${PORT}`);
});
