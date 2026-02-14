/**
 * =====================================================================================
 * Main Application Logic (app.js)
 * =====================================================================================
 * This file handles the core functionality of the family tree application.
 *
 * Key features:
 * 1. Data Pre-processing: Creates fast lookup maps for people and children.
 * 2. Lazy Loading: Implements `getFamilySet` to load only a small, relevant
 *    subset of the family for the currently focused person.
 * 3. Tree Rendering: Uses the FamilyTree.js library to draw and redraw the tree.
 * 4. Interaction: Allows users to click on any person to refocus the tree on them.
 * 5. Search: Provides a search bar to find and center on any person in the dataset.
 *
 * The code is written in vanilla JavaScript with a focus on readability and performance
 * for large datasets.
 * =====================================================================================
 */

// --- PWA: Global Event Listener (Must be outside DOMContentLoaded) ---
let deferredPrompt; // Global state to hold the prompt

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    console.log('beforeinstallprompt fired (global listener)');
    
    // If DOM is already ready, try to update UI immediately
    const installItem = document.getElementById('install-item');
    if (installItem) installItem.style.display = 'block';
    
    // Note: Toast logic is handled inside DOMContentLoaded to ensure elements exist
});

document.addEventListener('DOMContentLoaded', () => {

    // =================================================================================
    // SECTION 1: GLOBAL VARIABLES & INITIALIZATION
    // =================================================================================
    
    let tree = null; // Holds the FamilyTree.js instance
    const peopleMap = new Map(); // For fast person lookup by ID
    const childrenMap = new Map(); // For fast children lookup by parent ID
    let PEOPLE = []; // Will hold the family data fetched from JSON
    let suppressNextClick = false;
    let longPressTimer = null;
    let longPressCandidateId = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    const LONG_PRESS_MS = 550;
    const MOVE_CANCEL_PX = 8;
    
    const searchInput = document.getElementById('search-input');
    const searchSuggestions = document.getElementById('search-suggestions');
    const treeContainer = document.getElementById('tree');
    const personModalOverlay = document.getElementById('person-modal-overlay');
    const personModal = document.getElementById('person-modal');
    const personModalClose = document.getElementById('person-modal-close');
    const personModalAvatar = document.getElementById('person-modal-avatar');
    const personModalAvatarFallback = document.getElementById('person-modal-avatar-fallback');
    const personModalName = document.getElementById('person-modal-name');
    const personModalId = document.getElementById('person-modal-id');
    const personModalBody = document.getElementById('person-modal-body');
    const personHomeBtn = document.getElementById('person-home-btn');
    const personShareBtn = document.getElementById('person-share-btn');
    let activeModalPersonId = null;
    let activePersonId = null;  // Currently centered person in the tree (used by profile button)

    // --- PWA Install Logic ---
    const installItem = document.getElementById('install-item');
    const installBtn = document.getElementById('install-btn'); // Sidebar Link
    const installToast = document.getElementById('install-toast');
    const installToastBtn = document.getElementById('install-toast-btn');
    const installToastClose = document.getElementById('install-toast-close');
    const installPage = document.getElementById('install-page');
    const installPageContent = document.getElementById('install-page-content');
    const installPageClose = document.getElementById('install-page-close');

    // Detect iOS
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    // 1. Handle Android/Desktop (Check if event fired before DOM was ready)
    if (deferredPrompt) {
        if (installItem) installItem.style.display = 'block';
        if (!localStorage.getItem('installPromptDismissed') && installToast) {
            setTimeout(() => installToast.classList.add('show'), 2000); // Delay slightly
        }
    }

    // 2. Handle iOS (No event, just check UA)
    if (isIos && !isStandalone) {
        if (installItem) installItem.style.display = 'block';
        // Optional: Show toast for iOS too, prompting them to open instructions
        if (!localStorage.getItem('installPromptDismissed') && installToast) {
            setTimeout(() => installToast.classList.add('show'), 2000);
        }
    }

    // 3. Open Install Page (Instructions)
    function openInstallPage() {
        if (!installPage || !installPageContent) return;

        const logoHtml = `<img src="logo.png" alt="App Logo" style="width: 80px; height: 80px; border-radius: 16px; margin-bottom: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">`;
        let html = '';

        if (isIos) {
            // --- iOS: existing steps ---
            html = `
                <div style="text-align: center; padding: 10px 0 30px;">
                    ${logoHtml}
                    <h2 style="margin: 0 0 10px; color: #333;">Install on iOS</h2>
                    <p style="color: #666; font-size: 14px;">Follow these steps to add the app to your Home Screen.</p>
                </div>
                <div class="step">
                    <div class="step-num">1</div>
                    <div class="step-text">Tap the <strong>Share</strong> button <span class="share-icon"></span> in your browser bar.</div>
                </div>
                <div class="step">
                    <div class="step-num">2</div>
                    <div class="step-text">Scroll down and tap <strong>Add to Home Screen</strong>.</div>
                </div>
                <div class="step">
                    <div class="step-num">3</div>
                    <div class="step-text">Tap <strong>Add</strong> in the top right corner.</div>
                </div>
            `;
        } else {
            // --- Android / Desktop: title, logo, description, install button (or manual steps), why install, safety info ---
            html = `
                <div style="text-align: center; padding: 10px 0 20px;">
                    ${logoHtml}
                    <h2 style="margin: 0 0 10px; color: #333; font-size: 22px;">Install DFWA App</h2>
                    <p style="color: #666; font-size: 14px; line-height: 1.5;">Install the app for a better experience, offline access, and full-screen mode.</p>
                </div>
            `;

            if (deferredPrompt) {
                html += `<button id="install-page-action-btn" class="install-android-btn">Install for Android</button>`;
            } else {
                html += `
                    <div class="step">
                        <div class="step-num">1</div>
                        <div class="step-text">Tap the browser menu icon (usually <strong>⋮</strong> three dots) in the top right corner.</div>
                    </div>
                    <div class="step">
                        <div class="step-num">2</div>
                        <div class="step-text">Select <strong>Install App</strong> or <strong>Add to Home screen</strong> from the menu.</div>
                    </div>
                `;
            }

            html += `
                <div class="install-why-box">
                    <h3>⭐ Why install DFWA?</h3>
                    <ul>
                        <li>Opens instantly like a mobile app</li>
                        <li>Family tree in one tap</li>
                        <li>Works even in slow internet</li>
                        <li>No need to search the website again</li>
                    </ul>
                </div>
                <div class="install-safety-box">
                    <h3>🛡️ Safety Information</h3>
                    <p>This is NOT an APK or Play Store application. It only creates a shortcut to this website on your phone's home screen.</p>
                    <ul>
                        <li>No files are downloaded to your phone</li>
                        <li>No permissions are requested</li>
                        <li>No personal information is collected</li>
                        <li>No bank or payment data is accessed</li>
                        <li>You can remove it anytime by deleting the icon</li>
                    </ul>
                </div>
            `;
        }

        installPageContent.innerHTML = html;
        installPage.style.display = 'flex';

        const actionBtn = document.getElementById('install-page-action-btn');
        if (actionBtn && deferredPrompt) {
            actionBtn.addEventListener('click', async () => {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log(`User response to install prompt: ${outcome}`);
                deferredPrompt = null;
                installPage.style.display = 'none';
                if (installItem) installItem.style.display = 'none';
                if (installToast) installToast.classList.remove('show');
            });
        }
    }

    window.openInstallPageFromMenu = openInstallPage;

    // 4. Event Listeners
    if (installBtn) {
        installBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openInstallPage();
            if (window.closeSidebar) window.closeSidebar();
        });
    }

    if (installToastBtn) {
        installToastBtn.addEventListener('click', async () => {
            // For Toast: If Android, prompt directly. If iOS, show instructions page.
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredPrompt = null;
            if (installItem) installItem.style.display = 'none';
            if (installToast) installToast.classList.remove('show');
        } else if (isIos && !isStandalone) {
                openInstallPage();
            if (installToast) installToast.classList.remove('show');
        }
        });
    }

    if (installPageClose) {
        installPageClose.addEventListener('click', () => {
            installPage.style.display = 'none';
        });
    }

    const birthdaysPage = document.getElementById('birthdays-page');
    const birthdaysContent = document.getElementById('birthdays-content');
    const birthdaysPageClose = document.getElementById('birthdays-page-close');
    if (birthdaysPageClose && birthdaysPage) {
        birthdaysPageClose.addEventListener('click', () => {
            birthdaysPage.style.display = 'none';
        });
    }
    
    if (installToastClose) {
        installToastClose.addEventListener('click', () => {
            if (installToast) installToast.classList.remove('show');
            localStorage.setItem('installPromptDismissed', 'true');
        });
    }

    // 0. CRITICAL CHECK: Is the FamilyTree library loaded?
    if (typeof FamilyTree === 'undefined') {
        const msg = "Error: FamilyTree.js library is not loaded. Please check your internet connection or script tags.";
        console.error(msg);
        document.getElementById('tree').innerHTML = `<div style="color: red; text-align: center; padding: 20px;">${msg}</div>`;
        return;
    }

    // =================================================================================
    // SECTION 2: DATA PRE-PROCESSING
    // =================================================================================

    /**
     * Iterates through the PEOPLE array once to create efficient lookup maps.
     * - peopleMap: Allows finding a person by their ID in O(1) time.
     * - childrenMap: Allows finding all children of a parent in O(1) time.
     */
    function buildLookups() {
        // console.time('buildLookups');
        PEOPLE.forEach(person => {
            // Add person to the peopleMap
            peopleMap.set(person.id, person);

            // Helper to add a child to the childrenMap
            const addChild = (parentKey, childId) => {
                if (!childrenMap.has(parentKey)) {
                    childrenMap.set(parentKey, []);
                }
                childrenMap.get(parentKey).push(childId);
            };

            // Map children to their father (fid) and mother (mid)
            if (person.fid) addChild(person.fid, person.id);
            if (person.mid) addChild(person.mid, person.id);
        });
        // console.timeEnd('buildLookups');
    }

    // =================================================================================
    // SECTION 2.5: TEMPLATE DEFINITION
    // =================================================================================
    
    function isMobileViewport() {
        return window.matchMedia("(max-width: 768px)").matches;
    }

    function applyCircleTemplate() {
        if (typeof FamilyTree === "undefined") return;

        const mobile = isMobileViewport();
        // Scale visual node elements up for mobile readability (~75% larger).
        const cfg = mobile
            ? {
                width: 240, height: 180, cx: 120, cy: 64, radius: 61,
                initialsSize: 42, initialsY: 78, nameSize: 19, nameY: 160,
                nameWidth: 228, imgSize: 122, imgX: 59, imgY: 3
            }
            : {
                width: 180, height: 120, cx: 90, cy: 40, radius: 35,
                initialsSize: 24, initialsY: 48, nameSize: 11, nameY: 96,
                nameWidth: 170, imgSize: 70, imgX: 55, imgY: 5
            };

        FamilyTree.templates.circle = Object.assign({}, FamilyTree.templates.base);
        FamilyTree.templates.circle.size = [cfg.width, cfg.height];
        FamilyTree.templates.circle.node =
            `<circle cx="${cfg.cx}" cy="${cfg.cy}" r="${cfg.radius}" fill="#ffffff" stroke="#aeaeae" stroke-width="1"></circle>`;
        FamilyTree.templates.circle.field_0 =
            `<text style="font-size: ${cfg.initialsSize}px; font-weight: bold; fill: #000000; stroke: none;" fill="#000000" x="${cfg.cx}" y="${cfg.initialsY}" text-anchor="middle" pointer-events="none">{val}</text>`;
        FamilyTree.templates.circle.field_1 =
            `<text style="font-size: ${cfg.nameSize}px; font-weight: 600; fill: #000000; stroke: none;" fill="#000000" x="${cfg.cx}" y="${cfg.nameY}" text-anchor="middle" pointer-events="none" data-width="${cfg.nameWidth}">{val}</text>`;
        FamilyTree.templates.circle.img_0 =
            `<clipPath id="clip_id_{rand}"><circle cx="${cfg.cx}" cy="${cfg.cy}" r="${cfg.radius}"></circle></clipPath><image preserveAspectRatio="xMidYMid slice" clip-path="url(#clip_id_{rand})" xlink:href="{val}" x="${cfg.imgX}" y="${cfg.imgY}" width="${cfg.imgSize}" height="${cfg.imgSize}"></image><circle cx="${cfg.cx}" cy="${cfg.cy}" r="${cfg.radius}" fill="none" stroke="#4A90E2" stroke-width="2"></circle>`;
    }

    // =================================================================================
    // SECTION 3: CORE LAZY-LOADING LOGIC
    // =================================================================================

    /**
     * Gets a localized subset of the family around a central person.
     * This is the core of the lazy-loading mechanism.
     * @param {string} centerId - The ID of the person to be the focus.
     * @returns {Array} An array of person objects to be rendered in the tree.
     */
    function getFamilySet(centerId) {
        if (!peopleMap.has(centerId)) {
            console.error(`Person with ID ${centerId} not found.`);
            return [];
        }

        const familySet = new Map();
        const centerNode = peopleMap.get(centerId);
        
        // Helper to safely add a clone of the person
        // Cloning is CRITICAL: FamilyTree.js mutates data objects. 
        // If we reuse the same objects, the graph will break on subsequent renders.
        const addNode = (id) => {
            if (peopleMap.has(id) && !familySet.has(id)) {
                familySet.set(id, { ...peopleMap.get(id) });
            }
        };
        
        // Add the central person
        addNode(centerId);
        
        // Add parents
        if (centerNode.fid) addNode(centerNode.fid);
        if (centerNode.mid) addNode(centerNode.mid);
        
        // Add spouses
        if (centerNode.pids) {
            centerNode.pids.forEach(pid => addNode(pid));
        }
        
        // Add children
        if (childrenMap.has(centerId)) {
            childrenMap.get(centerId).forEach(childId => addNode(childId));
        }
        
        // --- CRITICAL FIX: Sanitize Relationships ---
        // FamilyTree.js will crash if a node refers to a 'pid', 'fid', or 'mid' 
        // that is not present in the current dataset. We must filter them out.
        const nodes = Array.from(familySet.values());
        const nodeIds = new Set(nodes.map(n => n.id));

        return nodes.map(node => {
            // We are modifying the clones created in addNode, so this is safe.
            
            // 1. Filter Spouses (pids)
            if (node.pids && Array.isArray(node.pids)) {
                node.pids = node.pids.filter(pid => nodeIds.has(pid));
            }

            // 2. Filter Parents (fid/mid)
            // If a parent ID exists but that parent node isn't in our subset, remove the link.
            if (node.fid && !nodeIds.has(node.fid)) node.fid = null;
            if (node.mid && !nodeIds.has(node.mid)) node.mid = null;

            // 3. Precompute display fields for stable nodeBinding rendering.
            const fullName = (node.name || "").trim();
            const parts = fullName ? fullName.split(/\s+/) : [];
            const hasImage = !!(node.image_url && node.image_url.trim() !== "");

            if (hasImage) {
                node._initials = "";
            } else if (parts.length === 0) {
                node._initials = "?";
            } else if (parts.length === 1) {
                node._initials = parts[0].charAt(0).toUpperCase();
            } else {
                node._initials = (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
            }

            // Keep multi-word first names intact and use only surname initial.
            // Example: "NARAYANA RAO DHARMAVARAM" -> "NARAYANA RAO.D"
            if (parts.length <= 1) {
                node._label = fullName;
            } else {
                const firstNameFull = parts.slice(0, -1).join(" ");
                const surnameInitial = parts[parts.length - 1].charAt(0).toUpperCase();
                node._label = `${firstNameFull}.${surnameInitial}`;
            }

            return node;
        });
    }

    // =================================================================================
    // SECTION 4: TREE RENDERING
    // =================================================================================
    
    /**
     * Helper to format date from dd-MMM-yy to dd-MMM-yyyy.
     * Handles 2-digit years (e.g., 80 -> 1980, 22 -> 2022).
     */
    function formatDate(dateStr) {
        if (!dateStr) return "";
        
        // Check for format like 10-May-80
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const day = parts[0];
            const month = parts[1];
            let year = parseInt(parts[2], 10);
            
            // Pivot logic: Assume 20th century if year > current year + 10
            if (year < 100) {
                const currentYear = new Date().getFullYear() % 100;
                const pivot = currentYear + 10;
                year = year > pivot ? 1900 + year : 2000 + year;
            }
            return `${day}-${month}-${year}`;
        }
        return dateStr;
    }

    /**
     * Parse birth date string (dd-MMM-yy or dd-MMM-yyyy) and return age in years, or null.
     */
    function getAgeFromBirth(birthStr) {
        if (!birthStr || !String(birthStr).trim()) return null;
        const parts = String(birthStr).trim().split('-');
        if (parts.length !== 3) return null;
        const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        const day = parseInt(parts[0], 10);
        const monthKey = parts[1].toUpperCase().slice(0, 3);
        const month = months[monthKey];
        if (month === undefined || isNaN(day)) return null;
        let year = parseInt(parts[2], 10);
        if (year < 100) {
            const currentYear = new Date().getFullYear() % 100;
            const pivot = currentYear + 10;
            year = year > pivot ? 1900 + year : 2000 + year;
        }
        const birth = new Date(year, month, day);
        if (isNaN(birth.getTime())) return null;
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age < 0 || age > 150 ? null : age;
    }

    /**
     * Parse birth date string to { month: 0-11, day: 1-31 } for matching month-day.
     */
    function getMonthDayFromBirth(birthStr) {
        if (!birthStr || !String(birthStr).trim()) return null;
        const parts = String(birthStr).trim().split('-');
        if (parts.length !== 3) return null;
        const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        const day = parseInt(parts[0], 10);
        const monthKey = parts[1].toUpperCase().slice(0, 3);
        const month = months[monthKey];
        if (month === undefined || isNaN(day) || day < 1 || day > 31) return null;
        return { month, day };
    }

    const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    /** Parse birth string and return 4-digit year, or null. */
    function getBirthYearFromBirth(birthStr) {
        if (!birthStr || !String(birthStr).trim()) return null;
        const parts = String(birthStr).trim().split('-');
        if (parts.length !== 3) return null;
        let year = parseInt(parts[2], 10);
        if (isNaN(year)) return null;
        if (year < 100) {
            const currentYear = new Date().getFullYear() % 100;
            const pivot = currentYear + 10;
            year = year > pivot ? 1900 + year : 2000 + year;
        }
        return year;
    }

    /**
     * Build WhatsApp chat URL for a phone number. Strips non-digits; opens chat only (no pre-filled text).
     */
    function getWhatsAppUrl(phone) {
        if (!phone || !String(phone).trim()) return '';
        const digits = String(phone).replace(/\D/g, '');
        return digits.length ? 'https://wa.me/' + digits : '';
    }

    /**
     * Get birthdays occurring in the next `daysAhead` days. Returns array of
     * { date, dateStr: "dd-MMM-yyyy", weekday, persons: [{ id, name, phone, ageAtDisplay }] }.
     */
    function getUpcomingBirthdays(daysAhead) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const byKey = {}; // key = "dd-MMM-yyyy" -> { dateStr, weekday, persons }

        for (let i = 0; i < daysAhead; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            const day = d.getDate();
            const month = d.getMonth();
            const year = d.getFullYear();
            const dateStr = String(day) + '-' + MONTH_ABBR[month] + '-' + year;
            const weekday = WEEKDAYS[d.getDay()];
            const key = dateStr;
            if (!byKey[key]) byKey[key] = { date: d, dateStr, weekday, persons: [] };

            PEOPLE.forEach(p => {
                const md = getMonthDayFromBirth(p.Birth || '');
                if (!md || md.month !== month || md.day !== day) return;
                const birthYear = getBirthYearFromBirth(p.Birth || '');
                const ageAtDisplay = birthYear != null ? year - birthYear : null;
                byKey[key].persons.push({
                    id: p.id,
                    name: (p.name || '').trim() || 'Unknown',
                    phone: (p.phone || '').trim(),
                    ageAtDisplay: ageAtDisplay != null && ageAtDisplay >= 0 && ageAtDisplay <= 150 ? ageAtDisplay : null
                });
            });
        }

        return Object.keys(byKey)
            .sort()
            .map(k => byKey[k])
            .filter(entry => entry.persons.length > 0);
    }

    function getInitials(name) {
        const parts = (name || "").trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return "?";
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function formatNameForNode(name) {
        const fullName = (name || "").trim();
        const parts = fullName ? fullName.split(/\s+/) : [];
        if (parts.length <= 1) return fullName;
        const firstNameFull = parts.slice(0, -1).join(" ");
        const surnameInitial = parts[parts.length - 1].charAt(0).toUpperCase();
        return `${firstNameFull}.${surnameInitial}`;
    }

    function personName(id) {
        const p = peopleMap.get(id);
        return p && p.name ? p.name : "";
    }

    function collectNames(ids) {
        if (!ids || ids.length === 0) return "-";
        return ids.map(id => {
            const name = personName(id);
            if (!name) return "";
            // Return a clickable div for the relative
            return `<div class="modal-link" data-id="${id}" style="color: #039BE5; cursor: pointer; margin-bottom: 4px; font-weight: 500;">${name}</div>`;
        }).join("");
    }

    function rowHtml(label, value) {
        const safeValue = value && String(value).trim() && String(value).trim() !== "-" ? String(value).trim() : "-";
        // Styled to match the screenshot: Gray label, Dark value, clean padding
        return `<tr style="border-bottom: 1px solid #f0f0f0;">
            <th style="text-align: left; color: #757575; font-weight: normal; padding: 12px 10px 12px 20px; vertical-align: top; width: 140px; font-size: 14px;">${label}</th>
            <td style="padding: 12px 20px 12px 0; color: #333; font-weight: 500; font-size: 14px; line-height: 1.4;">${safeValue}</td>
        </tr>`;
    }

    function openPersonModal(personId) {
        const p = peopleMap.get(personId);
        if (!p) return;
        activeModalPersonId = personId;

        const fullName = (p.name || "").trim() || "Unknown";
        personModalName.textContent = fullName;
        
        // ID and Optional Badge for Home Person
        let idHtml = `ID: ${p.id}`;
        const storedHomeId = localStorage.getItem('familyTreeHomeId');
        const isDefaultHome = !storedHomeId && p.name === "SRIKANTH DHARMAVARAM";
        const isSetHome = storedHomeId && p.id === storedHomeId;
        
        if (isDefaultHome || isSetHome) {
            idHtml += ` <span style="background-color: #4CAF50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-left: 8px; vertical-align: middle; font-weight: bold;">✓ Home Person</span>`;
        }
        personModalId.innerHTML = idHtml;

        const imageUrl = (p.image_url || "").trim();
        if (imageUrl) {
            personModalAvatar.src = imageUrl;
            personModalAvatar.style.display = "block";
            personModalAvatarFallback.style.display = "none";
        } else {
            personModalAvatar.removeAttribute("src");
            personModalAvatar.style.display = "none";
            personModalAvatarFallback.style.display = "flex";
            personModalAvatarFallback.textContent = getInitials(fullName);
        }

        const parents = [p.fid, p.mid].filter(Boolean);

        const siblingSet = new Set();
        if (p.fid && childrenMap.has(p.fid)) {
            childrenMap.get(p.fid).forEach(id => siblingSet.add(id));
        }
        if (p.mid && childrenMap.has(p.mid)) {
            childrenMap.get(p.mid).forEach(id => siblingSet.add(id));
        }
        siblingSet.delete(p.id);
        const siblings = Array.from(siblingSet);

        const spouses = Array.isArray(p.pids) ? p.pids : [];
        const children = childrenMap.get(p.id) || [];

        const birthFormatted = formatDate(p.Birth || "");
        const age = getAgeFromBirth(p.Birth || "");
        const birthWithAge = birthFormatted ? (birthFormatted + (age != null ? ` (${age})` : "")) : "";

        const rows = [
            rowHtml("Date of Birth", birthWithAge),
            rowHtml("Parents", collectNames(parents)),
            rowHtml("Spouse(s)", collectNames(spouses)),
            rowHtml("Children", collectNames(children)),
            rowHtml("Siblings", collectNames(siblings)),
            rowHtml("Address", p.Address || ""),
            rowHtml("Email", p.email ? `<a href="mailto:${p.email}" style="color: #039BE5; text-decoration: none;">${p.email}</a>` : ""),
            rowHtml("Phone", p.phone ? `<a href="tel:${p.phone}" style="color: #039BE5; text-decoration: none;">${p.phone}</a>` : "")
        ];
        personModalBody.innerHTML = rows.join("");

        personModalOverlay.classList.add("show");
        personModalOverlay.setAttribute("aria-hidden", "false");
    }

    // Handle clicks on relatives inside the modal
    personModalBody.addEventListener('click', (e) => {
        const target = e.target.closest('.modal-link');
        if (target && target.dataset.id) {
            const id = target.dataset.id;
            // Update the tree in the background
            drawTree(id);
            // Keep modal open and switch to the new person's details
            openPersonModal(id);
        }
    });

    function closePersonModal() {
        personModalOverlay.classList.remove("show");
        personModalOverlay.setAttribute("aria-hidden", "true");
        activeModalPersonId = null;
    }

    // --- Modal Actions ---
    
    // 1. Close Button
    personModalClose.addEventListener('click', closePersonModal);

    // 2. Set Home Person Button
    personHomeBtn.addEventListener('click', () => {
        if (activeModalPersonId) {
            localStorage.setItem('familyTreeHomeId', activeModalPersonId);
            // Re-render modal to show the new badge immediately
            openPersonModal(activeModalPersonId);
        }
    });

    // 3. Share Button
    personShareBtn.addEventListener('click', () => {
        if (!activeModalPersonId) return;
        const p = peopleMap.get(activeModalPersonId);
        const shareData = {
            title: 'Family Tree Profile',
            text: `Family Tree Profile: ${p.name} (ID: ${p.id})`,
            url: window.location.href
        };
        if (navigator.share) {
            navigator.share(shareData).catch(console.error);
        } else {
            alert(`Share functionality is not supported on this browser.\n\nName: ${p.name}\nID: ${p.id}`);
        }
    });

    function findNodeIdFromTarget(target) {
        let el = target;
        const attrs = ["data-n-id", "data-id", "node-id", "data-node-id"];

        while (el && el !== treeContainer) {
            if (el.getAttribute) {
                for (const attr of attrs) {
                    const val = el.getAttribute(attr);
                    if (val && peopleMap.has(val)) return val;
                }
                const idVal = el.getAttribute("id");
                if (idVal) {
                    const match = idVal.match(/I\d+/);
                    if (match && peopleMap.has(match[0])) return match[0];
                }
            }
            el = el.parentNode;
        }
        return null;
    }

    function clearLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        longPressCandidateId = null;
    }

    function setupLongPressHandlers() {
        treeContainer.addEventListener("pointerdown", (e) => {
            if (!e.isPrimary) return;
            const nodeId = findNodeIdFromTarget(e.target);
            if (!nodeId) return;

            clearLongPress();
            longPressCandidateId = nodeId;
            longPressStartX = e.clientX;
            longPressStartY = e.clientY;

            longPressTimer = setTimeout(() => {
                if (!longPressCandidateId) return;
                suppressNextClick = true;
                openPersonModal(longPressCandidateId);
                clearLongPress();
            }, LONG_PRESS_MS);
        });

        treeContainer.addEventListener("pointermove", (e) => {
            if (!longPressCandidateId) return;
            const dx = Math.abs(e.clientX - longPressStartX);
            const dy = Math.abs(e.clientY - longPressStartY);
            if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
                clearLongPress();
            }
        });

        ["pointerup", "pointercancel", "pointerleave"].forEach(evt => {
            treeContainer.addEventListener(evt, clearLongPress);
        });
    }

    /**
     * Initializes or updates the family tree view.
     * @param {string} centerId - The ID of the person to be at the center of the view.
     */
    function drawTree(centerId) {
        activePersonId = centerId;
        const familyData = getFamilySet(centerId);
        console.log(`Drawing tree for ${centerId}. Nodes count: ${familyData.length}`);
        const mobile = isMobileViewport();

        if (tree) {
            // If the tree instance exists, we can update it.
            // A full destroy and re-init is safer for this library's event handling.
            tree.destroy();
        }

        // --- FamilyTree.js Configuration ---
        applyCircleTemplate();
        if (FamilyTree.elements) FamilyTree.elements.myTree = null; // Clear previous static elements if any
        tree = new FamilyTree(document.getElementById('tree'), {
            nodes: familyData,
            nodeBinding: {
                // Bind to precomputed fields to avoid callback incompatibilities.
                field_0: "_initials",
                field_1: "_label",
                img_0: "image_url", // The person's photo
            },
            // The person to be initially displayed in the center
            nodeMouseClick: FamilyTree.action.none, // Disable default click action
            mouseScrool: FamilyTree.action.zoom,
            // Set the starting node for the view
            centric: centerId,
            // Ensure mobile-friendly layout
            mode: 'light', // Changed to light for white background
            layout: FamilyTree.layout.normal,
            scaleInitial: FamilyTree.match.boundary,
            padding: mobile ? 24 : 16,
            levelSeparation: mobile ? 48 : 80,
            siblingSeparation: mobile ? 18 : 35,
            subtreeSeparation: mobile ? 18 : 35,
            partnerNodeSeparation: mobile ? 12 : 20,
            minPartnerSeparation: mobile ? 12 : 20,
            // Other settings for better UX
            enableSearch: false, // We use our own custom search
            template: 'circle', // Use our new custom circle template
        });

        // Re-center after render so selected node and spouse stay in the viewport middle.
        setTimeout(() => {
            if (tree && typeof tree.center === "function") {
                tree.center(centerId);
            }
        }, 0);

        // --- Custom Click Event for Lazy Loading ---
        tree.on('click', (sender, args) => {
            // When a node is clicked, redraw the tree centered on that node.
            const clickedId = args.node.id;
            drawTree(clickedId);
        });
    }

    // =================================================================================
    // SECTION 5: SEARCH FUNCTIONALITY
    // =================================================================================

    /**
     * Handles the 'input' event on the search box.
     */
    function handleSearch() {
        const query = searchInput.value.toLowerCase().trim();
        if (query.length < 2) {
            clearSuggestions();
            return;
        }

        const matches = [];
        for (const person of PEOPLE) {
            if (person.name.toLowerCase().includes(query)) {
                matches.push(person);
                if (matches.length >= 20) break; // Limit to 20 suggestions
            }
        }
        displaySuggestions(matches);
    }

    /**
     * Renders the search suggestion list.
     * @param {Array} matches - An array of person objects that match the search query.
     */
    function displaySuggestions(matches) {
        clearSuggestions();
        matches.forEach(person => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `<strong>${person.name}</strong> <span style="font-size: 0.85em; color: #888; float: right;">${person.id}</span>`;
            item.dataset.id = person.id;
            item.addEventListener('click', () => {
                drawTree(person.id);
                clearSuggestions();
                searchInput.value = '';
            });
            searchSuggestions.appendChild(item);
        });
        searchSuggestions.style.display = matches.length > 0 ? 'block' : 'none';
    }

    /**
     * Clears the search suggestion list.
     */
    function clearSuggestions() {
        searchSuggestions.innerHTML = '';
        searchSuggestions.style.display = 'none';
    }

    // --- NEW: Home Button Logic ---
    
    /**
     * Retrieves the ID of the Home Person.
     * Checks localStorage first, then falls back to "SRIKANTH DHARMAVARAM", then the first person.
     */
    function getHomePersonId() {
        let homeId = localStorage.getItem('familyTreeHomeId');
        if (!homeId || !peopleMap.has(homeId)) {
            const homePerson = PEOPLE.find(p => p.name === "SRIKANTH DHARMAVARAM");
            homeId = homePerson ? homePerson.id : (PEOPLE[0] ? PEOPLE[0].id : null);
        }
        return homeId;
    }

    // Create and inject the Home button dynamically
    const mainHomeBtn = document.createElement('button');
    mainHomeBtn.innerHTML = '🏠'; // Home Icon
    mainHomeBtn.title = "Go to Home Person";
    // Style the button to look nice next to the search bar
    Object.assign(mainHomeBtn.style, {
        marginRight: '8px',
        padding: '6px 10px',
        fontSize: '20px',
        cursor: 'pointer',
        backgroundColor: '#fff',
        border: '1px solid #ccc',
        borderRadius: '4px',
        verticalAlign: 'middle'
    });

    // Profile button: show details of the active (centered) person
    const profileBtn = document.createElement('button');
    profileBtn.innerHTML = '👤';
    profileBtn.title = "View active person's details";
    Object.assign(profileBtn.style, {
        marginRight: '8px',
        padding: '6px 10px',
        fontSize: '18px',
        cursor: 'pointer',
        backgroundColor: '#fff',
        border: '1px solid #ccc',
        borderRadius: '4px',
        verticalAlign: 'middle'
    });

    // Insert Home then Profile before the search input field
    if (searchInput && searchInput.parentNode) {
        searchInput.parentNode.insertBefore(mainHomeBtn, searchInput);
        searchInput.parentNode.insertBefore(profileBtn, searchInput);
    }

    // Add click listener to reset tree to Home Person
    mainHomeBtn.addEventListener('click', () => {
        const homeId = getHomePersonId();
        if (homeId) {
            drawTree(homeId);
            searchInput.value = ''; // Clear search text
            clearSuggestions();
        }
    });

    profileBtn.addEventListener('click', () => {
        if (activePersonId && peopleMap.has(activePersonId)) {
            openPersonModal(activePersonId);
        } else {
            alert('No person selected. Tap a person on the tree first to center them, then tap the profile icon.');
        }
    });

    // Add event listeners for the search input
    searchInput.addEventListener('input', handleSearch);
    searchInput.addEventListener('focus', handleSearch); // Show suggestions when focused

    // Global click listener to hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target)) {
            clearSuggestions();
        }
    });

    // =================================================================================
    // SECTION 5.5: NEWS / WELCOME FEATURE
    // =================================================================================
    
    // Expose this function to the global scope so the HTML onclick can find it
    window.showNews = function() {
        const newsModal = document.getElementById('news-modal-overlay');
        const newsContent = document.getElementById('news-content');
        
        if (!newsModal || !newsContent) return;
        
        newsContent.innerHTML = '<p style="text-align:center; color:#666;">Loading updates...</p>';
        newsModal.style.display = 'flex';

        fetch('welcome.json')
            .then(res => res.json())
            .then(data => {
                // Sort by date (assuming dd-mm-yyyy, simplified logic here or just take array order)
                // We'll just map the array as is for now.
                const html = data.map(item => `
                    <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #eee;">
                        <div style="font-size: 12px; color: #4A90E2; font-weight: bold; margin-bottom: 4px;">📅 ${item.Date}</div>
                        <div style="font-size: 14px; color: #333; line-height: 1.5;">${item.Message}</div>
                    </div>
                `).join('');
                newsContent.innerHTML = html || '<p>No news available.</p>';
            })
            .catch(err => {
                console.error("Error loading news:", err);
                newsContent.innerHTML = '<p style="color: red; text-align: center;">Failed to load news.</p>';
            });
    };

    // =================================================================================
    // SECTION 5.6: BIRTHDAYS PAGE (next 20 days)
    // =================================================================================

    window.showBirthdays = function() {
        const page = document.getElementById('birthdays-page');
        const content = document.getElementById('birthdays-content');
        if (!page || !content) return;

        const list = getUpcomingBirthdays(20);
        if (list.length === 0) {
            content.innerHTML = '<p style="color:#666; text-align:center; padding: 20px;">No birthdays in the next 20 days.</p>';
        } else {
            content.innerHTML = list.map(entry => {
                const namesHtml = entry.persons.map(p => {
                    const ageStr = p.ageAtDisplay != null ? ` (${p.ageAtDisplay})` : '';
                    const phoneHtml = p.phone
                        ? `<div class="birthday-phone"><a href="${getWhatsAppUrl(p.phone)}" target="_blank" rel="noopener" class="birthday-whatsapp-link" title="Open WhatsApp">${p.phone}</a></div>`
                        : '';
                    return `<div class="birthday-person-block">
                        <div class="birthday-name"><a href="#" data-person-id="${p.id}">${p.name}${ageStr}</a></div>
                        ${phoneHtml}
                    </div>`;
                }).join('');
                return `<div class="birthday-date-block">
                    <div class="birthday-date-line">${entry.dateStr} ${entry.weekday}</div>
                    ${namesHtml}
                </div>`;
            }).join('');
        }

        content.querySelectorAll('.birthday-name a[data-person-id]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const id = link.getAttribute('data-person-id');
                if (id && peopleMap.has(id)) {
                    page.style.display = 'none';
                    drawTree(id);
                    openPersonModal(id);
                }
            });
        });

        page.style.display = 'flex';
    };

    // =================================================================================
    // SECTION 6: INITIAL APPLICATION START
    // =================================================================================
    
    // 1. Fetch Family Data, then Photos, then Draw Tree
    fetch('family_data.json')
        .then(response => response.json())
        .then(data => {
            PEOPLE = data;
            buildLookups();
            setupLongPressHandlers();
            return fetch('photos.json');
        })
        .then(response => response.json())
        .then(photoData => {
            // Update peopleMap with image URLs from the JSON file
            for (const [id, url] of Object.entries(photoData)) {
                if (peopleMap.has(id)) {
                    peopleMap.get(id).image_url = url;
                }
            }
        })
        .catch(err => console.warn('Error loading data:', err))
        .finally(() => {
            // Draw the tree whether photos loaded successfully or not
            try {
                const initialPersonId = getHomePersonId();
                console.log("Initializing tree with person ID:", initialPersonId);
                if (initialPersonId) drawTree(initialPersonId);
            } catch (err) {
                console.error("Error drawing tree:", err);
                document.getElementById('tree').innerHTML = `<div style="color: red; text-align: center;">Error drawing tree: ${err.message}</div>`;
            }
        });
});
