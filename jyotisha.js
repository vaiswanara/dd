/**
 * Jyotisha Logic (jyotisha.js)
 * Handles transit calculations for Guru and Shani.
 */

(function() {
    let transitData = null;
    let moonData = null;
    let isLoading = false;
    let dataUrl = 'json_data/transit.json'; // Default fallback
    let moonDataUrl = 'json_data/transit_moon.json'; // Default fallback

    // Rashi Mapping
    const RASHI_MAP = {
        "mesha": 1, "aries": 1,
        "vrishabha": 2, "taurus": 2,
        "mithuna": 3, "gemini": 3,
        "karka": 4, "cancer": 4, "karkataka": 4,
        "simha": 5, "leo": 5,
        "kanya": 6, "virgo": 6,
        "tula": 7, "libra": 7,
        "vrischika": 8, "scorpio": 8,
        "dhanu": 9, "sagittarius": 9, "dhanus": 9,
        "makara": 10, "capricorn": 10,
        "kumbha": 11, "aquarius": 11,
        "meena": 12, "pisces": 12
    };

    // Nakshatra Mapping (Name -> Index 1-27)
    // Includes abbreviations from CSV and full names
    const NAKSHATRA_MAP = {
        "aswini": 1, "aswi": 1, "ashwini": 1, "ashwin": 1,
        "bharani": 2, "bhar": 2,
        "krittika": 3, "krit": 3,
        "rohini": 4, "rohi": 4,
        "mrigasira": 5, "mrig": 5, "mrigashira": 5,
        "ardra": 6, "ardr": 6,
        "punarvasu": 7, "puna": 7,
        "pushyami": 8, "push": 8, "pushya": 8, "poosya": 8,
        "aslesha": 9, "asre": 9, "ashlesha": 9,
        "magha": 10, "magh": 10,
        "purva phalguni": 11, "ppha": 11, "pubba": 11,
        "uttara phalguni": 12, "upha": 12, "uttara": 12,
        "hasta": 13, "hast": 13,
        "chitra": 14, "chit": 14,
        "swati": 15, "swat": 15,
        "visakha": 16, "visa": 16, "vishakha": 16,
        "anuradha": 17, "anu": 17,
        "jyeshta": 18, "jye": 18, "jyeshtha": 18,
        "moola": 19, "mool": 19, "mula": 19,
        "purva ashadha": 20, "psha": 20, "purvashada": 20,
        "uttara ashadha": 21, "usha": 21, "uttarashada": 21,
        "sravana": 22, "srav": 22, "shravana": 22,
        "dhanishta": 23, "dhan": 23, "dhanishtha": 23, "dhanishtha": 23,
        "satabhisha": 24, "sata": 24, "shatabhisha": 24,
        "purva bhadra": 25, "pbha": 25, "purva bhadrapada": 25,
        "uttara bhadra": 26, "ubha": 26, "uttara bhadrapada": 26,
        "revati": 27, "reva": 27
    };

    const NAKSHATRA_NAMES = [
        "", "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu", "Pushya", "Ashlesha",
        "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
        "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada", "Revati"
    ];

    function normalizeRashi(rashiName) {
        if (!rashiName) return null;
        const key = String(rashiName).trim().toLowerCase().split(/\s+/)[0]; // Take first word
        return RASHI_MAP[key] || null;
    }

    function normalizeNakshatra(name) {
        if (!name) return null;
        const key = String(name).trim().toLowerCase();
        return NAKSHATRA_MAP[key] || null;
    }

    function loadTransitData(callback) {
        if (transitData) {
            if (callback) callback(transitData);
            return;
        }
        if (isLoading) {
            // Simple retry logic or just wait (not implemented for simplicity)
            setTimeout(() => loadTransitData(callback), 100);
            return;
        }
        isLoading = true;
        
        Promise.all([
            fetch(dataUrl).then(res => res.json()).catch(() => []),
            fetch(moonDataUrl).then(res => res.json()).catch(() => ({}))
        ])
            .then(([tData, mData]) => {
                transitData = tData;
                moonData = mData;
                isLoading = false;
                if (callback) callback();
            })
            .catch(err => {
                console.error("Failed to load jyotisha data:", err);
                isLoading = false;
                if (callback) callback();
            });
    }

    function getCurrentTransit(planet) {
        if (!transitData) return null;
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Find row where today is between start and end
        // Data format: { planet, start, end, rashi }
        // We can just string compare ISO dates
        
        for (const row of transitData) {
            if (row.planet.toLowerCase() === planet.toLowerCase()) {
                if (today >= row.start && today <= row.end) {
                    return row.rashi;
                }
            }
        }
        return null;
    }

    function getCurrentMoonNakshatra() {
        if (!moonData) return null;
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const abbr = moonData[today];
        return normalizeNakshatra(abbr);
    }

    function calculateGuruBhala(janmaRashiNum) {
        const currentGuru = getCurrentTransit('Guru');
        if (!currentGuru) return `<div style="color: gray;">Transit data unavailable</div>`;

        // Calculate position from Janma Rashi
        // If Janma is 1 (Mesha) and Guru is 2 (Vrishabha), pos is 2.
        // If Janma is 12 (Meena) and Guru is 1 (Mesha), pos is 2. (1 - 12 + 1 + 12) % 12 || 12?
        // Formula: (Transit - Janma + 12) % 12 + 1 ? No.
        // (Transit - Janma + 1) -> if <= 0 add 12.
        
        let pos = (currentGuru - janmaRashiNum + 1);
        if (pos <= 0) pos += 12;

        const isGood = [2, 5, 7, 9, 11].includes(pos);
        
        let html = `<div>Guru Posited <strong>${pos}${getOrdinal(pos)}</strong> from Janma Rashi</div>`;
        if (isGood) {
            html += `<div style="color: #2e7d32; font-weight: bold; margin-top: 4px;">Guru Bhala Exists</div>`;
        } else {
            html += `<div style="color: #c62828; font-weight: bold; margin-top: 4px;">Guru Bhala Does Not Exist</div>`;
        }
        return html;
    }

    function calculateShaniBhala(janmaRashiNum) {
        const currentShani = getCurrentTransit('Shani');
        if (!currentShani) return `<div style="color: gray;">Transit data unavailable</div>`;

        let pos = (currentShani - janmaRashiNum + 1);
        if (pos <= 0) pos += 12;

        let result = "";
        let color = "#333"; // Default black

        if (pos === 12) {
            result = "Sade-Sathi (Dwaadasha)";
            color = "#c62828"; // Red
        } else if (pos === 1) {
            result = "Sade-Sathi (Janma)";
            color = "#c62828";
        } else if (pos === 2) {
            result = "Sade-Sathi (Dwiteeya)";
            color = "#c62828";
        } else if (pos === 4) {
            result = "Ardhasthama-Shani (Chaturtha)";
            color = "#c62828";
        } else if (pos === 8) {
            result = "Ashtama-Shani (Ashtama)";
            color = "#c62828";
        } else if ([3, 6, 11].includes(pos)) {
            result = "Good";
            color = "#2e7d32"; // Green
        } else {
            result = "Average";
            color = "#f57f17"; // Orange/Yellow
        }

        return `<div>Shani Posited <strong>${pos}${getOrdinal(pos)}</strong> from Janma Rashi</div>
                <div style="color: ${color}; font-weight: bold; margin-top: 4px;">${result}</div>`;
    }
    
    function calculateTaraBhala(janmaNakshatraName) {
        const janmaIndex = normalizeNakshatra(janmaNakshatraName);
        const transitIndex = getCurrentMoonNakshatra();
        
        if (!janmaIndex) return "Janma Nakshatra not found";
        if (!transitIndex) return "Transit Moon data unavailable";

        // Formula: (Transit - Janma + 1 + 27) % 9
        // If result is 0, it corresponds to 9.
        let diff = (transitIndex - janmaIndex + 1);
        if (diff <= 0) diff += 27;
        
        let taraNum = diff % 9;
        if (taraNum === 0) taraNum = 9;

        const taras = {
            1: { name: "Janma", result: "Tara Bhala Does Not Exist", color: "#f57f17" },
            2: { name: "Sampat", result: "Tara Bhala Exist", color: "#2e7d32" },
            3: { name: "Vipat", result: "Tara Bhala Does Not Exist", color: "#c62828" },
            4: { name: "Kshema", result: "Tara Bhala Exist", color: "#2e7d32" },
            5: { name: "Pratyak", result: "Tara Bhala Does Not Exist", color: "#c62828" },
            6: { name: "Sadhana", result: "Tara Bhala Exist", color: "#2e7d32" },
            7: { name: "Naidhana", result: "Tara Bhala Does Not Exist", color: "#c62828" },
            8: { name: "Mitra", result: "Tara Bhala Exist", color: "#2e7d32" },
            9: { name: "Parama Mitra", result: "Tara Bhala Exist", color: "#2e7d32" }
        };

        const t = taras[taraNum];
        const transitName = NAKSHATRA_NAMES[transitIndex] || "Unknown";

        return `<div>Transit Nakshatra: <strong>${transitName}</strong></div>
                <div style="margin-top:4px;">Tara: <strong>${t.name}</strong> (${taraNum})</div>
                <div style="color: ${t.color}; font-weight: bold; margin-top: 4px;">${t.result}</div>`;
    }

    function calculateChandraBhala(janmaRashiNum) {
        const transitNakshatraIndex = getCurrentMoonNakshatra();
        if (!transitNakshatraIndex) return "Transit Moon data unavailable";

        // Approximate Moon Rashi from Nakshatra (12 Rashis / 27 Nakshatras)
        // 1 Nakshatra = 13.33 degrees. 1 Rashi = 30 degrees.
        // Rashi Index = Math.ceil(NakshatraIndex * 12 / 27)
        const transitRashiNum = Math.ceil(transitNakshatraIndex * 12 / 27);
        
        let pos = (transitRashiNum - janmaRashiNum + 1);
        if (pos <= 0) pos += 12;

        // Good: 1, 3, 6, 7, 10, 11
        const isGood = [1, 3, 6, 7, 10, 11].includes(pos);
        const color = isGood ? "#2e7d32" : "#c62828";
        const result = isGood ? "Chandra Bhala Exists" : "Chandra Bhala Does Not Exist";

        return `<div>Moon Posited <strong>${pos}${getOrdinal(pos)}</strong> from Janma Rashi</div>
                <div style="color: ${color}; font-weight: bold; margin-top: 4px;">${result}</div>`;
    }

    function getOrdinal(n) {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // Expose API
    window.Jyotisha = {
        init: function(url, moonUrl, callback) {
            if (url) dataUrl = url;
            if (moonUrl) moonDataUrl = moonUrl;
            loadTransitData(callback);
        },
        getDetails: function(rashiName, nakshatraName) {
            const rashiNum = normalizeRashi(rashiName);
            
            return {
                guru: rashiNum ? calculateGuruBhala(rashiNum) : "Rashi not available",
                shani: rashiNum ? calculateShaniBhala(rashiNum) : "Rashi not available",
                tara: nakshatraName ? calculateTaraBhala(nakshatraName) : "Nakshatra not available",
                chandra: rashiNum ? calculateChandraBhala(rashiNum) : "Rashi not available"
            };
        }
    };
})();