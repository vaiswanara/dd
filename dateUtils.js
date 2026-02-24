/**
 * Global Date Utilities (dateUtils.js)
 * Standardizes date parsing and formatting across the application.
 * Supported Input Formats: dd-MMM-yyyy, dd-MMM-yy, YYYY-MM-DD
 * Standard Display Format: dd-MMM-yyyy
 */
(function() {
    const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    window.DateUtils = {
        /**
         * Parses a date string into a Date object.
         * Handles:
         * - dd-MMM-yyyy (01-JAN-1980)
         * - dd-MMM-yy (01-JAN-80) -> Uses 10-year pivot
         * - YYYY-MM-DD (1980-01-01)
         */
        parse: function(dateStr) {
            if (!dateStr) return null;
            const s = String(dateStr).trim().toUpperCase();
            if (!s) return null;

            // 1. ISO Format: YYYY-MM-DD (Flexible: allows 1980-1-1 or 1980-01-01)
            const isoMatch = s.match(/^(\d{4})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})$/);
            if (isoMatch) {
                const [_, y, m, d] = isoMatch.map(Number);
                return new Date(y, m - 1, d);
            }

            // 2. Standard/Legacy: dd-MMM-yyyy or dd-MMM-yy
            // Allow separators: - / . space
            const parts = s.split(/[\-\/\.\s]+/);
            if (parts.length === 3) {
                const day = parseInt(parts[0], 10);
                const monthStr = parts[1];
                let year = parseInt(parts[2], 10);

                // Resolve Month
                let month = MONTHS[monthStr];
                if (month === undefined) {
                    // Try numeric month
                    const mVal = parseInt(monthStr, 10);
                    if (!isNaN(mVal) && mVal >= 1 && mVal <= 12) month = mVal - 1;
                }

                if (month !== undefined && !isNaN(day) && !isNaN(year)) {
                    // Handle 2-digit year
                    if (year < 100) {
                        const currentYear = new Date().getFullYear() % 100;
                        const pivot = currentYear + 10; // Future tolerance
                        year = year > pivot ? 1900 + year : 2000 + year;
                    }
                    return new Date(year, month, day);
                }
            }
            
            // 3. Year only
            if (/^\d{4}$/.test(s)) {
                return new Date(parseInt(s, 10), 0, 1);
            }

            return null;
        },

        /**
         * Formats a Date object or date string to "dd-MMM-yyyy".
         * Returns original string if parsing fails.
         */
        formatDisplay: function(dateOrStr) {
            if (!dateOrStr) return "";
            const date = (dateOrStr instanceof Date) ? dateOrStr : this.parse(dateOrStr);
            if (!date || isNaN(date.getTime())) return String(dateOrStr).trim();
            
            const d = String(date.getDate()).padStart(2, '0');
            const m = MONTH_NAMES[date.getMonth()];
            const y = date.getFullYear();
            return `${d}-${m}-${y}`;
        },

        /**
         * Calculates age from a birth date string.
         */
        getAge: function(birthStr) {
            const birth = this.parse(birthStr);
            if (!birth) return null;
            
            const today = new Date();
            let age = today.getFullYear() - birth.getFullYear();
            const m = today.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
                age--;
            }
            return (age >= 0 && age <= 150) ? age : null;
        },

        /**
         * Returns { month: 0-11, day: 1-31 } from date string.
         */
        getMonthDay: function(dateStr) {
            const date = this.parse(dateStr);
            if (!date) return null;
            return { month: date.getMonth(), day: date.getDate() };
        },

        /**
         * Returns 4-digit year from date string.
         */
        getYear: function(dateStr) {
            const date = this.parse(dateStr);
            return date ? date.getFullYear() : null;
        }
    };
})();