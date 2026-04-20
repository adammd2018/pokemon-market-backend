# Pokemon Market Backend v3

Uses the real APIs:
- https://api.pokemontcg.io/v2
- https://pokeapi.co/api/v2

## Routes
- /api/search?q=charizard
- /api/radar
- /api/analytics
- /api/education
- /api/education/pikachu
- /api/analyzer?q=charizard

## AI analyzer restore
The analyzer now returns:
- aiScore
- aiLabel
- recommendation
- reasoning
- riskLevel
- gradingOutlook
- liquidityNote
- trendNote
- dailyChange
- weeklyChange
- monthlyChange

## Analyzer depth
Default:
- 5 pages
- 50 cards per page

That means the analyzer scans up to 250 cards by default.
