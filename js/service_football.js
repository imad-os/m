/**
 * Football Service Client
 * A browser-compatible version of the Football API service.
 */

const FOOTBALL_CONFIG = {
    // API Keys provided from your original config.js
    APIS: [
        {"url":"https://v3.football.api-sports.io","host":"v3.football.api-sports.io", "key":"9e9fb80bd8d4c5c226e8a7f69375995a"},
        {"url":"https://v3.football.api-sports.io","host":"v3.football.api-sports.io", "key":"d79fe49364b4f281787947da46201ee3"},
        {"url":"https://api-football-v1.p.rapidapi.com/v3","host":"api-football-v1.p.rapidapi.com", "key":"b7e837cfb4msh0b84d927aa2291dp130d32jsn7b1570d863f8"},
        {"url":"https://api-football-v1.p.rapidapi.com/v3","host":"api-football-v1.p.rapidapi.com", "key":"b3a3d033ffmsh6e94bc1a2adfb2ap197138jsn33bbf80e8bb2"},
        {"url":"https://v3.football.api-sports.io","host":"v3.football.api-sports.io", "key":"cb397bed4ae3bce1f341cde74671ec94"},
    ],
    GLOBAL_LEAGUES: [1, 15, 1168],
    CONTINENT_LEAGUES: {
        EU: { CUP: [4], CL: [2], SECOND: [3, 848] },
        AF: { CUP: [6], CL: [12], SECOND: [20] },
        AS: { CUP: [15], CL: [17], SECOND: [18] },
        SA: { CUP: [9], CL: [13], SECOND: [11] },
        NA: { CUP: [22], CL: [16], SECOND: [] }
    },
    FRIENDLIES: [10, 666],
    FAVORITE_TEAMS: [85, 50, 541, 529, 23]
};

let currentApiIndex = 0;

const FootballClient = {
    /**
     * Core fetch function with API rotation
     */
    fetchData: async function(endpoint, params = {}, recursive = 0) {
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const api = FOOTBALL_CONFIG.APIS[currentApiIndex];
        
        // Build Query String
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = `${api.url}${cleanEndpoint}${queryString ? '?' + queryString : ''}`;

        try {
            const response = await fetch(fullUrl, {
                method: 'GET',
                headers: {
                    'x-rapidapi-host': api.host,
                    'x-rapidapi-key': api.key,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Handle API-side errors (like rate limits) by rotating keys
            if (recursive < 3 && data.errors && Object.keys(data.errors).length > 0) {
                console.warn("Football API Error detected, rotating key...", data.errors);
                currentApiIndex = (currentApiIndex + 1) % FOOTBALL_CONFIG.APIS.length;
                return this.fetchData(endpoint, params, recursive + 1);
            }

            return data;
        } catch (error) {
            console.error(`Football Client Error [${cleanEndpoint}]:`, error.message);
            throw error;
        }
    },

    /**
     * Get Recommended matches based on user context
     */
    getRecommendedMatches: async function(country, city, continentCode) {
        const today = new Date().toISOString().split('T')[0];
        const countryLower = country.toLowerCase();
        const cityLower = city.toLowerCase();

        const data = await this.fetchData('fixtures', { date: today });
        const allMatches = data.response || [];
        
        if (!allMatches.length) return [];

        const localContinentData = FOOTBALL_CONFIG.CONTINENT_LEAGUES[continentCode] || { CUP: [], CL: [], SECOND: [] };

        const scoredMatches = allMatches.map(match => {
            let score = 0;
            const leagueId = match.league.id;
            const leagueCountry = match.league.country.toLowerCase();
            const homeTeam = match.teams.home.name.toLowerCase();
            const awayTeam = match.teams.away.name.toLowerCase();
            const venueCity = (match.fixture.venue?.city || "").toLowerCase();
            const homeTeamId = match.teams.home.id;
            const awayTeamId = match.teams.away.id;

            if (FOOTBALL_CONFIG.GLOBAL_LEAGUES.includes(leagueId)) score = 1000;
            else if (localContinentData.CUP.includes(leagueId)) score = 900;
            else if (localContinentData.CL.includes(leagueId)) score = 800;
            else if (localContinentData.SECOND.includes(leagueId)) score = 700;
            else if (FOOTBALL_CONFIG.FAVORITE_TEAMS.includes(homeTeamId) || FOOTBALL_CONFIG.FAVORITE_TEAMS.includes(awayTeamId)) score = 750;
            else if (leagueCountry === countryLower && match.league.type === 'League') {
                score = 600;
                if (match.league.name.includes("Premier") || match.league.name.includes("1") || match.league.name.includes("Botola")) score += 50;
            }
            else if (leagueCountry === countryLower && match.league.type === 'Cup') score = 500;
            else if (FOOTBALL_CONFIG.FRIENDLIES.includes(leagueId)) {
                if (homeTeam.includes(countryLower) || awayTeam.includes(countryLower) || venueCity.includes(cityLower)) score = 400;
            }

            // Location bonus
            if (venueCity.includes(cityLower) || homeTeam.includes(cityLower) || awayTeam.includes(cityLower)) score = 700;
            if (homeTeam === countryLower || awayTeam === countryLower) score += 900;

            return { match, score };
        });

        return scoredMatches
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20)
            .map(item => ({
                fixture_id: item.match.fixture.id,
                date: item.match.fixture.date,
                status: item.match.fixture.status.short,
                league: item.match.league,
                home: { ...item.match.teams.home, goals: item.match.goals.home },
                away: { ...item.match.teams.away, goals: item.match.goals.away },
                priority_score: item.score
            }));
    },

    /**
     * Fetch news from Elbotola
     */
    fetchNews: async function(langue = 'en', country = 'MA', page = 1) {
        const baseUrl = "https://api.elbotola.com/newsfeed/v3/";
        const params = new URLSearchParams({
            exclude_ids: '',
            has_copyright: 'True',
            important_matches: 'True',
            lang: langue,
            page: page,
            country_code: country
        });

        try {
            const response = await fetch(`${baseUrl}?${params.toString()}`);
            return await response.json();
        } catch (error) {
            console.error("News Fetch Error:", error);
            throw error;
        }
    }
};