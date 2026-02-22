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

document.addEventListener('DOMContentLoaded', () => {

    // =================================================================================
    // SECTION 1: GLOBAL VARIABLES & INITIALIZATION
    // =================================================================================
    
    let tree = null; // Holds the FamilyTree.js instance
    // Expose maps globally for relationship.js
    window.peopleMap = new Map();
    window.childrenMap = new Map();
    window.genderMap = new Map();
    const peopleMap = window.peopleMap;
    const childrenMap = window.childrenMap;
    const genderMap = window.genderMap;

    let PEOPLE = []; // Will hold the family data fetched from JSON
    let suppressNextClick = false;
    let longPressTimer = null;
    let longPressCandidateId = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    const LONG_PRESS_MS = 550;
    const MOVE_CANCEL_PX = 8;
    const MALE_ICON_SVG = '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="#4A90E2"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
    const FEMALE_ICON_SVG = '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="#E91E63"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
    
    const searchInput = document.getElementById('search-input');
    const searchWrapper = document.querySelector('.search-wrapper');
    const dashboardHeaderTitle = document.getElementById('dashboard-header-title');
    const searchSuggestions = document.getElementById('search-suggestions');
    const treeContainer = document.getElementById('tree');
    const dashboardPage = document.getElementById('dashboard-page');
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
    const quickEditWrap = document.getElementById('person-modal-quick-edit');
    const quickCurrentParents = document.getElementById('quick-current-parents');
    const quickCurrentSpouses = document.getElementById('quick-current-spouses');
    const quickCurrentChildren = document.getElementById('quick-current-children');
    const quickFatherInput = document.getElementById('quick-father-id');
    const quickMotherInput = document.getElementById('quick-mother-id');
    const quickSpouseInput = document.getElementById('quick-spouse-id');
    const quickChildInput = document.getElementById('quick-child-id');
    const quickChildRole = document.getElementById('quick-child-role');
    const quickStatus = document.getElementById('quick-edit-status');
    const quickSaveDraftBtn = document.getElementById('quick-save-draft');
    const quickDiscardDraftBtn = document.getElementById('quick-discard-draft');
    const quickUnsavedTag = document.getElementById('quick-unsaved-tag');
    let activeModalPersonId = null;
    let quickRelDraft = null;
    let quickRelUndoStack = [];
    let activePersonId = null;  // Currently centered person in the tree (used by profile button)
    const brokenImageUrls = new Set();
    const checkedImageUrls = new Set();
    const attemptedAlternateImageKeys = new Set();
    let brokenImageRedrawTimer = null;
    const relationshipModalOverlay = document.getElementById('relationship-modal-overlay');
    const relationshipModalBody = document.getElementById('relationship-modal-body');
    const relationshipModalClose = document.getElementById('relationship-modal-close');
    let HOME_PERSON_ID = null;
    let APP_CONFIG = null;
    const IS_ADM_PAGE = /\/(?:adm|admin)(?:\/|$)/.test(window.location.pathname.replace(/\\/g, '/').toLowerCase());
    const APP_BASE_PREFIX = IS_ADM_PAGE ? '../' : '';

    function toAppPath(path) {
        const raw = String(path || '').trim();
        if (!raw) return raw;
        if (/^(?:[a-z]+:|\/\/|\/)/i.test(raw)) return raw;
        return APP_BASE_PREFIX + raw.replace(/^\.?\//, '');
    }

    function escapeHtml(text) {
        if (text == null) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function scheduleBrokenImageRedraw() {
        if (brokenImageRedrawTimer) return;
        brokenImageRedrawTimer = setTimeout(() => {
            brokenImageRedrawTimer = null;
            if (activePersonId) drawTree(activePersonId);
        }, 120);
    }

    function buildAlternateImageUrls(url) {
        const original = String(url || '').trim();
        if (!original) return [];
        const match = original.match(/^(.*)\.([a-z0-9]+)([?#].*)?$/i);
        if (!match) return [];
        const base = match[1];
        const currentExt = String(match[2] || '').toLowerCase();
        const suffix = match[3] || '';
        const preferred = ['jpg', 'jpeg', 'png'];
        const out = [];
        for (const ext of preferred) {
            if (ext === currentExt) continue;
            out.push(`${base}.${ext}${suffix}`);
        }
        return out;
    }

    function tryResolveAlternateImage(personId, failedUrl) {
        const pid = String(personId || '').trim();
        const failed = String(failedUrl || '').trim();
        if (!pid || !failed) return;
        const key = `${pid}|${failed}`;
        if (attemptedAlternateImageKeys.has(key)) return;
        attemptedAlternateImageKeys.add(key);

        const candidates = buildAlternateImageUrls(failed).filter(u => !brokenImageUrls.has(u));
        if (!candidates.length) return;

        const tryNext = (index) => {
            if (index >= candidates.length) return;
            const candidate = candidates[index];
            if (checkedImageUrls.has(candidate)) {
                if (peopleMap.has(pid)) {
                    peopleMap.get(pid).image_url = candidate;
                    scheduleBrokenImageRedraw();
                }
                return;
            }

            const img = new Image();
            img.onload = () => {
                checkedImageUrls.add(candidate);
                if (peopleMap.has(pid)) {
                    peopleMap.get(pid).image_url = candidate;
                    scheduleBrokenImageRedraw();
                }
            };
            img.onerror = () => {
                brokenImageUrls.add(candidate);
                tryNext(index + 1);
            };
            img.src = candidate;
        };

        tryNext(0);
    }

    function probeImageUrl(url, personId) {
        const u = String(url || '').trim();
        if (!u) return;
        if (checkedImageUrls.has(u) || brokenImageUrls.has(u)) return;
        checkedImageUrls.add(u);

        const img = new Image();
        img.onload = () => {};
        img.onerror = () => {
            brokenImageUrls.add(u);
            tryResolveAlternateImage(personId, u);
            console.warn('[Photos] Broken image detected:', u);
            scheduleBrokenImageRedraw();
        };
        img.src = u;
    }

    // --- Dashboard Elements ---
    const dashDateEl = document.getElementById('dash-date');
    const statTotalMembersEl = document.getElementById('stat-total-members');
    const statUpcomingBirthdaysEl = document.getElementById('stat-upcoming-birthdays');
    const dashDynamicMsgEl = document.getElementById('dash-dynamic-msg');
    const navDashboard = document.getElementById('nav-dashboard');
    const navTree = document.getElementById('nav-tree');
    const lineageBar = document.getElementById('lineage-bar');

    const birthdaysPage = document.getElementById('birthdays-page');
    const birthdaysContent = document.getElementById('birthdays-content');
    const birthdaysPageClose = document.getElementById('birthdays-page-close');
    if (birthdaysPageClose && birthdaysPage) {
        birthdaysPageClose.addEventListener('click', () => {
            birthdaysPage.style.display = 'none';
        });
    }

    // =================================================================================
    // SECTION 1.2: PWA INSTALL + SERVICE WORKER
    // =================================================================================

    // --- Service Worker Registration (required for PWA install/offline) ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register(toAppPath('sw.js'))
                .then(reg => console.log('[PWA] Service worker registered', reg.scope))
                .catch(err => console.warn('[PWA] Service worker registration failed', err));
        });
    }

    // --- Install UI Elements ---
    const installPage = document.getElementById('install-page');
    const installPageClose = document.getElementById('install-page-close');
    const installBtn = document.getElementById('install-app-btn');
    const installHowBtn = document.getElementById('install-how-btn');
    const installStatus = document.getElementById('install-status');
    const navInstall = document.getElementById('nav-install');

    let deferredInstallPrompt = null;

    function isAppInstalled() {
        // display-mode: standalone covers most modern browsers (Android Chrome, Edge, etc.)
        // navigator.standalone covers older iOS Safari (not relevant for Android, but harmless).
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function setSidebarActive(activeId) {
        // Keep existing behavior for dashboard/tree, extend to install.
        [navDashboard, navTree, navInstall].forEach(el => {
            if (!el) return;
            el.classList.toggle('active', el.id === activeId);
        });
    }

    function setInstallStatus(html) {
        if (installStatus) installStatus.innerHTML = html;
    }

    function refreshInstallUi() {
        if (!installBtn || !installStatus) return;

        if (isAppInstalled()) {
            installBtn.disabled = true;
            setInstallStatus('✅ App is already installed on this device.');
            return;
        }

        if (deferredInstallPrompt) {
            installBtn.disabled = false;
            setInstallStatus('Ready to install. Tap <code>Install on Android</code>.');
            return;
        }

        // If no prompt is available, show guidance (common on desktop/iOS or if not eligible yet).
        installBtn.disabled = true;
        setInstallStatus(
            'Install option is not available yet. ' +
            'On Android Chrome, use <code>⋮</code> menu → <code>Add to Home screen</code> / <code>Install app</code>. ' +
            'Also make sure you have opened this site at least once and you are online.'
        );
    }

    window.showInstallPage = function () {
        if (installPage) installPage.style.display = 'flex';
        setSidebarActive('nav-install');
        refreshInstallUi();
    };

    if (installPageClose && installPage) {
        installPageClose.addEventListener('click', () => {
            installPage.style.display = 'none';
        });
    }

    if (installHowBtn) {
        installHowBtn.addEventListener('click', () => {
            alert(
                'How to install on Android (Chrome):\n\n' +
                '1) Open this website in Chrome\n' +
                '2) Tap the (⋮) menu\n' +
                '3) Tap "Install app" or "Add to Home screen"\n\n' +
                'If you see the "Install on Android" button enabled here, you can use it directly.'
            );
        });
    }

    // Capture the install prompt when the browser decides the app is installable.
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // prevent mini-infobar; we will prompt from our button
        deferredInstallPrompt = e;
        refreshInstallUi();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        refreshInstallUi();
        if (window.showToast) window.showToast('App installed successfully.');
    });

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (isAppInstalled()) {
                if (window.showToast) window.showToast('App is already installed.');
                refreshInstallUi();
                return;
            }

            if (!deferredInstallPrompt) {
                refreshInstallUi();
                if (window.showToast) window.showToast('Install is not available right now. Use the browser menu to install.');
                return;
            }

            try {
                deferredInstallPrompt.prompt();
                const choiceResult = await deferredInstallPrompt.userChoice;
                console.log('[PWA] userChoice', choiceResult);
            } catch (err) {
                console.warn('[PWA] Install prompt failed', err);
            } finally {
                deferredInstallPrompt = null;
                refreshInstallUi();
            }
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

        // After populating, sort all children arrays.
        for (const children of childrenMap.values()) {
            // 1. Default sort by ID (stable baseline)
            children.sort();

            // 2. Sort by age (older first -> earlier date first)
            children.sort((a, b) => {
                const pA = peopleMap.get(a);
                const pB = peopleMap.get(b);
                
                const dateA = pA && pA.Birth && window.DateUtils ? window.DateUtils.parse(pA.Birth) : null;
                const dateB = pB && pB.Birth && window.DateUtils ? window.DateUtils.parse(pB.Birth) : null;

                if (dateA !== null && dateB !== null) return dateA - dateB;
                if (dateA !== null) return -1; // Has date -> comes first
                if (dateB !== null) return 1;  // Has date -> comes first
                return 0;
            });
        }

        // --- Infer Genders ---
        // Pass 1: from parenthood
        // This pass infers gender from parental roles but should NOT overwrite
        // explicit gender data already loaded from persons.json.
        PEOPLE.forEach(person => {
            if (person.fid && person.fid !== "" && !genderMap.has(person.fid)) {
                genderMap.set(person.fid, 'M');
            }
            if (person.mid && person.mid !== "" && !genderMap.has(person.mid)) {
                genderMap.set(person.mid, 'F');
            }
        });

        // Pass 2: from partnership (if one partner's gender is known)
        // Run a few times to propagate gender info
        for (let i = 0; i < 5; i++) {
            PEOPLE.forEach(person => {
                if (person.pids && person.pids.length > 0) {
                    const p1_id = person.id;
                    // Iterate over all partners
                    person.pids.forEach(p2_id => {
                        if (!peopleMap.has(p2_id)) return;

                        const p1_gender = genderMap.get(p1_id);
                        const p2_gender = genderMap.get(p2_id);

                        if (p1_gender && !p2_gender) genderMap.set(p2_id, p1_gender === 'M' ? 'F' : 'M');
                        if (!p1_gender && p2_gender) genderMap.set(p1_id, p2_gender === 'M' ? 'F' : 'M');
                    });
                }
            });
        }
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
                initialsSize: 42, initialsY: 78, nameSize: 19, nameY: 145,
                relSize: 14, relY: 165,
                nameWidth: 228, imgSize: 122, imgX: 59, imgY: 3
            }
            : {
                width: 180, height: 120, cx: 90, cy: 40, radius: 35,
                initialsSize: 24, initialsY: 48, nameSize: 11, nameY: 88,
                relSize: 9, relY: 102,
                nameWidth: 170, imgSize: 70, imgX: 55, imgY: 5
            };

        const iconSize = cfg.radius * 1.5;
        const iconX = cfg.cx - (iconSize / 2);
        const iconY = cfg.cy - (iconSize / 2);

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
        FamilyTree.templates.circle.field_2 =
            `<text style="font-size: ${cfg.relSize}px; fill: #E91E63; stroke: none;" fill="#E91E63" x="${cfg.cx}" y="${cfg.relY}" text-anchor="middle" pointer-events="none">{val}</text>`;
        // New field for gender icons
        FamilyTree.templates.circle.gender_icon = `<foreignObject x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}">{val}</foreignObject>`;
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
        const homeId = getHomePersonId();

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
            const nodeImageUrl = String(node.image_url || "").trim();
            if (nodeImageUrl) {
                if (brokenImageUrls.has(nodeImageUrl)) {
                    node.image_url = "";
                } else {
                    probeImageUrl(nodeImageUrl, node.id);
                }
            }
            const hasImage = !!(node.image_url && node.image_url.trim() !== "");
            const gender = getGender(node.id);

            node.gender_icon_svg = ''; // new property for binding
            node._initials = ''; // default to empty

            if (!hasImage) {
                if (gender === 'M') {
                    node.gender_icon_svg = MALE_ICON_SVG;
                } else if (gender === 'F') {
                    node.gender_icon_svg = FEMALE_ICON_SVG;
                } else { // 'U' or undefined
                    if (parts.length === 0) {
                        node._initials = "?";
                    } else if (parts.length === 1) {
                        node._initials = parts[0].charAt(0).toUpperCase();
                    } else {
                        node._initials = (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
                    }
                }
            }

            const isDeceased = node.deceased === true || String(node.deceased || '').toLowerCase() === 'true' || !!String(node.death_date || node.Death || '').trim();

            // Keep multi-word first names intact and use only surname initial.
            // Example: "NARAYANA RAO DHARMAVARAM" -> "NARAYANA RAO.D"
            if (parts.length <= 1) {
                node._label = fullName;
            } else {
                const firstNameFull = parts.slice(0, -1).join(" ");
                const surnameInitial = parts[parts.length - 1].charAt(0).toUpperCase();
                node._label = `${firstNameFull}.${surnameInitial}`;
            }
            if (isDeceased) {
                node._label = `● ${node._label}`;
            }

            node._relation = "";
            if (homeId && typeof findRelationship === 'function') {
                if (node.id === homeId) {
                    node._relation = "ME";
                } else {
                    const rel = findRelationship(homeId, node.id);
                    if (rel && rel !== "Unknown") {
                        node._relation = `(${rel})`;
                    }
                }
            }

            return node;
        });
    }

    // =================================================================================
    // SECTION 4: TREE RENDERING
    // =================================================================================
    
    const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

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
        const result = [];

        for (let i = 0; i < daysAhead; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            const day = d.getDate();
            const month = d.getMonth();
            const year = d.getFullYear(); // Current year for display
            const dateStr = window.DateUtils ? window.DateUtils.formatDisplay(d) : d.toDateString();
            const weekday = WEEKDAYS[d.getDay()];
            
            const dayEntry = { date: d, dateStr, weekday, persons: [] };

            PEOPLE.forEach(p => {
                if (p.deceased) return;
                if (p.birth_date_type !== 'exact') return;

                const md = window.DateUtils ? window.DateUtils.getMonthDay(p.Birth || '') : null;
                if (!md || md.month !== month || md.day !== day) return;
                const birthYear = window.DateUtils ? window.DateUtils.getYear(p.Birth || '') : null;
                const ageAtDisplay = birthYear != null ? year - birthYear : null;
                dayEntry.persons.push({
                    id: p.id,
                    name: (p.name || '').trim() || 'Unknown',
                    phone: (p.phone || '').trim(),
                    ageAtDisplay: ageAtDisplay != null && ageAtDisplay >= 0 && ageAtDisplay <= 150 ? ageAtDisplay : null,
                    jyotisha: p.jyotisha
                });
            });

            if (dayEntry.persons.length > 0) {
                result.push(dayEntry);
            }
        }

        return result;
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
            return `<div class="modal-link" data-id="${id}" style="color: #039BE5; cursor: pointer; margin-bottom: 4px; font-weight: 500;">${escapeHtml(name)}</div>`;
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

    function getCustomFieldsRows(custom) {
        if (!custom || typeof custom !== 'object' || Array.isArray(custom)) return [];
        const entries = Object.entries(custom)
            .map(([k, v]) => [escapeHtml(String(k || '').trim()), escapeHtml(String(v == null ? '' : v).trim())])
            .filter(([k, v]) => !!k && !!v)
            .sort((a, b) => a[0].localeCompare(b[0]));
        return entries.map(([key, value]) => rowHtml(key, value));
    }

    function cloneQuickRelDraft(draft) {
        if (!draft) return null;
        return {
            id: draft.id,
            parents: {
                fid: draft.parents && draft.parents.fid ? draft.parents.fid : '',
                mid: draft.parents && draft.parents.mid ? draft.parents.mid : ''
            },
            spouses: Array.isArray(draft.spouses) ? [...new Set(draft.spouses)] : [],
            children: Array.isArray(draft.children) ? [...new Set(draft.children)] : [],
            childRoles: { ...(draft.childRoles || {}) }
        };
    }

    function markQuickDraftDirty(flag) {
        if (quickUnsavedTag) quickUnsavedTag.style.display = flag ? 'inline-block' : 'none';
    }

    function setQuickStatus(message, isError) {
        if (!quickStatus) return;
        quickStatus.textContent = message || '';
        quickStatus.style.color = isError ? '#b91c1c' : '#4b5563';
    }

    function resolveQuickRef(raw, label) {
        if (!window.adminQuickRel || typeof window.adminQuickRel.resolveRef !== 'function') {
            return { ok: false, message: 'Quick editor API is not ready.' };
        }
        return window.adminQuickRel.resolveRef(raw, label);
    }

    function renderQuickDraftSummary() {
        if (!quickRelDraft || !window.adminQuickRel) return;
        const label = (id) => window.adminQuickRel.label(id);
        if (quickCurrentParents) {
            const parts = [];
            if (quickRelDraft.parents.fid) parts.push(`Father: ${label(quickRelDraft.parents.fid)}`);
            if (quickRelDraft.parents.mid) parts.push(`Mother: ${label(quickRelDraft.parents.mid)}`);
            quickCurrentParents.textContent = parts.length ? parts.join(' | ') : '-';
        }
        if (quickCurrentSpouses) {
            quickCurrentSpouses.textContent = quickRelDraft.spouses.length ? quickRelDraft.spouses.map(label).join(', ') : '-';
        }
        if (quickCurrentChildren) {
            quickCurrentChildren.textContent = quickRelDraft.children.length ? quickRelDraft.children.map(label).join(', ') : '-';
        }
    }

    function stageQuickDraftChange(mutator, successMessage) {
        if (!IS_ADM_PAGE || !window.adminQuickRel || !quickRelDraft) return;
        const before = cloneQuickRelDraft(quickRelDraft);
        const result = mutator();
        if (result && result.ok === false) {
            setQuickStatus(result.message || 'Update failed.', true);
            if (typeof window.showToast === 'function') window.showToast(result.message || 'Update failed.', 3200);
            return;
        }
        quickRelUndoStack.push(before);
        if (quickRelUndoStack.length > 80) quickRelUndoStack.shift();
        markQuickDraftDirty(true);
        renderQuickDraftSummary();
        setQuickStatus(successMessage || 'Staged.', false);
        if (typeof window.showToast === 'function') window.showToast(successMessage || 'Staged.', 2200);
    }

    function renderQuickEditPanel(personId) {
        if (!quickEditWrap) return;
        if (!IS_ADM_PAGE || !window.adminQuickRel || !personId) {
            quickEditWrap.style.display = 'none';
            quickRelDraft = null;
            quickRelUndoStack = [];
            return;
        }

        const snap = window.adminQuickRel.get(personId);
        if (!snap) {
            quickEditWrap.style.display = 'none';
            quickRelDraft = null;
            quickRelUndoStack = [];
            return;
        }

        quickRelDraft = cloneQuickRelDraft(snap);
        quickRelUndoStack = [];
        quickEditWrap.style.display = 'block';
        if (quickFatherInput) quickFatherInput.value = quickRelDraft.parents.fid || '';
        if (quickMotherInput) quickMotherInput.value = quickRelDraft.parents.mid || '';
        if (quickSpouseInput) quickSpouseInput.value = '';
        if (quickChildInput) quickChildInput.value = '';
        if (quickChildRole) quickChildRole.value = 'auto';
        markQuickDraftDirty(false);
        renderQuickDraftSummary();
        setQuickStatus('Stage edits, then click Save Changes.', false);
    }

    function openPersonModal(personId) {
        if (quickRelDraft && activeModalPersonId && personId !== activeModalPersonId && quickUnsavedTag && quickUnsavedTag.style.display !== 'none') {
            const ok = window.confirm('Discard unsaved quick relationship changes?');
            if (!ok) return;
        }
        const p = peopleMap.get(personId);
        if (!p) return;
        activeModalPersonId = personId;

        const fullName = (p.name || "").trim() || "Unknown";
        personModalName.textContent = fullName; // textContent is safe
        
        // ID and Optional Badge for Home Person
        let idHtml = `ID: ${p.id}`;
        const storedHomeId = localStorage.getItem('familyTreeHomeId');
        const isDefaultHome = !storedHomeId && p.name === "SRIKANTH DHARMAVARAM";
        const isSetHome = storedHomeId && p.id === storedHomeId;
        
        if (isDefaultHome || isSetHome) {
            idHtml += ` <span style="background-color: #4CAF50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-left: 8px; vertical-align: middle; font-weight: bold;">✓ Home Person</span>`;
        }
        const isDeceased = p.deceased === true || String(p.deceased || '').toLowerCase() === 'true' || !!String(p.death_date || p.Death || '').trim();
        if (isDeceased) {
            idHtml += ` <span style="background-color: #6b7280; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-left: 8px; vertical-align: middle; font-weight: bold;">✓ Deceased</span>`;
        }
        personModalId.innerHTML = idHtml;

        // Update "Set as Home" Button Visibility
        // If this person is already the home person, hide the button.
        if (personHomeBtn) {
            if (isSetHome || (isDefaultHome && !storedHomeId)) {
                personHomeBtn.style.display = 'none';
            } else {
                personHomeBtn.style.display = 'inline-block';
            }
        }

        const imageUrl = (p.image_url || "").trim();
        if (imageUrl) {
            personModalAvatar.onerror = () => {
                brokenImageUrls.add(imageUrl);
                personModalAvatar.removeAttribute("src");
                personModalAvatar.style.display = "none";
                personModalAvatarFallback.style.display = "flex";
                personModalAvatarFallback.textContent = getInitials(fullName);
                if (activePersonId) scheduleBrokenImageRedraw();
            };
            personModalAvatar.onload = () => {};
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

        const birthFormatted = window.DateUtils ? window.DateUtils.formatDisplay(p.Birth || "") : (p.Birth || "");
        const age = window.DateUtils ? window.DateUtils.getAge(p.Birth || "") : null;
        const birthWithAge = birthFormatted ? (birthFormatted + (age != null ? ` (${age})` : "")) : "";

        const deathFormatted = window.DateUtils ? window.DateUtils.formatDisplay(p.death_date || p.Death || "") : (p.death_date || p.Death || "");
        const rows = [
            rowHtml("Date of Birth", birthWithAge)
        ];
        if (isDeceased) {
            rows.push(rowHtml("Status", "Deceased"));
            if (deathFormatted) {
                rows.push(rowHtml("Date of Death", deathFormatted));
            }
        }

        if (p.jyotisha) {
            if (p.jyotisha.gothra) {
                rows.push(rowHtml("Gothra", p.jyotisha.gothra));
            }
            if (p.jyotisha.nakshatra || p.jyotisha.rashi) {
                const parts = [];
                if (p.jyotisha.nakshatra) parts.push(p.jyotisha.nakshatra);
                if (p.jyotisha.rashi) parts.push(p.jyotisha.rashi);
                if (parts.length > 0) {
                    rows.push(rowHtml("Jyotisha", parts.join(" - ")));
                }
            }
        }

        rows.push(rowHtml("Parents", collectNames(parents)));
        rows.push(rowHtml("Spouse(s)", collectNames(spouses)));

        if (p.divorces && Array.isArray(p.divorces) && p.divorces.length > 0) {
            const divIds = p.divorces.map(d => d.spouse_id).filter(id => id);
            if (divIds.length > 0) {
                rows.push(rowHtml("Divorced", collectNames(divIds)));
            }
        }

        rows.push(
            rowHtml("Children", collectNames(children)),
            rowHtml("Siblings", collectNames(siblings)),
            rowHtml("Birth Place", escapeHtml(p.Address || "")),
            rowHtml("Email", p.email ? `<a href=\"mailto:${escapeHtml(p.email)}\" style=\"color: #039BE5; text-decoration: none;\">${escapeHtml(p.email)}</a>` : ""),
            rowHtml("Phone", p.phone ? `<a href=\"tel:${escapeHtml(p.phone)}\" style=\"color: #039BE5; text-decoration: none;\">${escapeHtml(p.phone)}</a>` : ""),
            rowHtml("Note", escapeHtml(p.note || ""))
        );
        rows.push(...getCustomFieldsRows(p.custom));
        personModalBody.innerHTML = rows.join("");
        renderQuickEditPanel(personId);

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
        if (quickUnsavedTag && quickUnsavedTag.style.display !== 'none') {
            const ok = window.confirm('Discard unsaved quick relationship changes?');
            if (!ok) return;
        }
        personModalOverlay.classList.remove("show");
        personModalOverlay.setAttribute("aria-hidden", "true");
        activeModalPersonId = null;
        quickRelDraft = null;
        quickRelUndoStack = [];
        markQuickDraftDirty(false);
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
            updateDashboard(); // Update the dashboard text immediately
        }
    });

    // 3. Share Button
    personShareBtn.addEventListener('click', () => {
        if (!activeModalPersonId) return;
        const p = peopleMap.get(activeModalPersonId);
        if (!p) return;

        // Helper to get names as a clean, comma-separated string
        const collectNamesAsText = (ids) => {
            if (!ids || ids.length === 0) return "Not available";
            return ids.map(id => {
                const person = peopleMap.get(id);
                return person ? person.name : '';
            }).filter(Boolean).join(', ') || "Not available";
        };

        // --- Collect all details for sharing ---
        const fullName = (p.name || "").trim() || "Unknown";
        
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

        const birthFormatted = window.DateUtils ? window.DateUtils.formatDisplay(p.Birth || "") : (p.Birth || "");
        const age = window.DateUtils ? window.DateUtils.getAge(p.Birth || "") : null;
        const birthWithAge = birthFormatted ? (birthFormatted + (age != null ? ` (Age: ${age})` : "")) : "Not available";

        // --- Construct the text to share ---
        let shareText = `*Vamsha Vruksha Profile*\n\n`;
        shareText += `*Name:* ${fullName}\n`;
        shareText += `*ID:* ${p.id}\n`;
        shareText += `*Date of Birth:* ${birthWithAge}\n`;
        shareText += `*Parents:* ${collectNamesAsText(parents)}\n`;
        shareText += `*Spouse(s):* ${collectNamesAsText(spouses)}\n`;
        shareText += `*Children:* ${collectNamesAsText(children)}\n`;
        shareText += `*Siblings:* ${collectNamesAsText(siblings)}\n`;
        if (p.Address && p.Address.trim()) shareText += `*Address:* ${p.Address.trim()}\n`;
        if (p.email && p.email.trim()) shareText += `*Email:* ${p.email.trim()}\n`;
        if (p.phone && p.phone.trim()) shareText += `*Phone:* ${p.phone.trim()}\n`;
        if (p.note && p.note.trim()) shareText += `*Note:* ${p.note.trim()}\n`;
        
        shareText += `\nShared from the Vamsha Vruksha App.`;

        const shareData = {
            title: `Profile of ${fullName}`,
            text: shareText
        };

        if (navigator.share) {
            navigator.share(shareData).catch(console.error);
        } else {
            // Fallback for browsers that don't support navigator.share
            alert(`Share functionality is not supported on this browser. Details:\n\n${shareText}`);
        }
    });

    const quickSetParentsBtn = document.getElementById('quick-set-parents');
    const quickClearFatherBtn = document.getElementById('quick-clear-father');
    const quickClearMotherBtn = document.getElementById('quick-clear-mother');
    const quickAddSpouseBtn = document.getElementById('quick-add-spouse');
    const quickRemoveSpouseBtn = document.getElementById('quick-remove-spouse');
    const quickAddChildBtn = document.getElementById('quick-add-child');
    const quickRemoveChildBtn = document.getElementById('quick-remove-child');
    const quickUndoLastBtn = document.getElementById('quick-undo-last');
    quickSetParentsBtn?.addEventListener('click', () => {
        stageQuickDraftChange(() => {
            if (!quickRelDraft) return { ok: false, message: 'Open a person first.' };
            const fatherRes = resolveQuickRef(quickFatherInput ? quickFatherInput.value : '', 'Father');
            if (!fatherRes.ok) return fatherRes;
            const motherRes = resolveQuickRef(quickMotherInput ? quickMotherInput.value : '', 'Mother');
            if (!motherRes.ok) return motherRes;
            if (fatherRes.id && fatherRes.id === activeModalPersonId) return { ok: false, message: 'Father cannot be same as person.' };
            if (motherRes.id && motherRes.id === activeModalPersonId) return { ok: false, message: 'Mother cannot be same as person.' };
            quickRelDraft.parents.fid = fatherRes.id || '';
            quickRelDraft.parents.mid = motherRes.id || '';
            if (quickFatherInput) quickFatherInput.value = quickRelDraft.parents.fid;
            if (quickMotherInput) quickMotherInput.value = quickRelDraft.parents.mid;
            return { ok: true };
        }, 'Parents staged.');
    });

    quickClearFatherBtn?.addEventListener('click', () => {
        stageQuickDraftChange(() => {
            if (!quickRelDraft) return { ok: false, message: 'Open a person first.' };
            quickRelDraft.parents.fid = '';
            if (quickFatherInput) quickFatherInput.value = '';
            return { ok: true };
        }, 'Father cleared (staged).');
    });

    quickClearMotherBtn?.addEventListener('click', () => {
        stageQuickDraftChange(() => {
            if (!quickRelDraft) return { ok: false, message: 'Open a person first.' };
            quickRelDraft.parents.mid = '';
            if (quickMotherInput) quickMotherInput.value = '';
            return { ok: true };
        }, 'Mother cleared (staged).');
    });

    quickAddSpouseBtn?.addEventListener('click', () => {
        stageQuickDraftChange(() => {
            if (!quickRelDraft) return { ok: false, message: 'Open a person first.' };
            const res = resolveQuickRef(quickSpouseInput ? quickSpouseInput.value : '', 'Spouse');
            if (!res.ok) return res;
            const sid = res.id;
            if (!sid) return { ok: false, message: 'Enter spouse ID or name.' };
            if (sid === activeModalPersonId) return { ok: false, message: 'Person cannot be spouse of self.' };
            if (!quickRelDraft.spouses.includes(sid)) quickRelDraft.spouses.push(sid);
            if (quickSpouseInput) quickSpouseInput.value = '';
            return { ok: true };
        }, 'Spouse link staged.');
    });

    quickRemoveSpouseBtn?.addEventListener('click', () => {
        stageQuickDraftChange(() => {
            if (!quickRelDraft) return { ok: false, message: 'Open a person first.' };
            const res = resolveQuickRef(quickSpouseInput ? quickSpouseInput.value : '', 'Spouse');
            if (!res.ok) return res;
            const sid = res.id;
            if (!sid) return { ok: false, message: 'Enter spouse ID or name.' };
            if (!quickRelDraft.spouses.includes(sid)) return { ok: false, message: 'Spouse is not linked in staged draft.' };
            quickRelDraft.spouses = quickRelDraft.spouses.filter(id => id !== sid);
            if (quickSpouseInput) quickSpouseInput.value = '';
            return { ok: true };
        }, 'Spouse removal staged.');
    });

    quickAddChildBtn?.addEventListener('click', () => {
        stageQuickDraftChange(() => {
            if (!quickRelDraft) return { ok: false, message: 'Open a person first.' };
            const res = resolveQuickRef(quickChildInput ? quickChildInput.value : '', 'Child');
            if (!res.ok) return res;
            const cid = res.id;
            if (!cid) return { ok: false, message: 'Enter child ID or name.' };
            if (cid === activeModalPersonId) return { ok: false, message: 'Person cannot be own child.' };
            if (!quickRelDraft.children.includes(cid)) quickRelDraft.children.push(cid);
            const role = quickChildRole ? quickChildRole.value : 'auto';
            if (role === 'father' || role === 'mother') quickRelDraft.childRoles[cid] = role;
            else delete quickRelDraft.childRoles[cid];
            if (quickChildInput) quickChildInput.value = '';
            return { ok: true };
        }, 'Child link staged.');
    });

    quickRemoveChildBtn?.addEventListener('click', () => {
        stageQuickDraftChange(() => {
            if (!quickRelDraft) return { ok: false, message: 'Open a person first.' };
            const res = resolveQuickRef(quickChildInput ? quickChildInput.value : '', 'Child');
            if (!res.ok) return res;
            const cid = res.id;
            if (!cid) return { ok: false, message: 'Enter child ID or name.' };
            if (!quickRelDraft.children.includes(cid)) return { ok: false, message: 'Child is not linked in staged draft.' };
            quickRelDraft.children = quickRelDraft.children.filter(id => id !== cid);
            delete quickRelDraft.childRoles[cid];
            if (quickChildInput) quickChildInput.value = '';
            return { ok: true };
        }, 'Child removal staged.');
    });

    quickUndoLastBtn?.addEventListener('click', () => {
        if (!quickRelUndoStack.length) {
            setQuickStatus('No staged step to undo.', true);
            if (typeof window.showToast === 'function') window.showToast('No staged step to undo.', 2600);
            return;
        }
        quickRelDraft = quickRelUndoStack.pop();
        markQuickDraftDirty(true);
        renderQuickDraftSummary();
        setQuickStatus('Last staged step undone.', false);
        if (typeof window.showToast === 'function') window.showToast('Last staged step undone.', 2200);
    });

    quickSaveDraftBtn?.addEventListener('click', () => {
        if (!quickRelDraft || !activeModalPersonId || !window.adminQuickRel) return;
        const result = window.adminQuickRel.saveDraft(activeModalPersonId, quickRelDraft);
        const msg = result && result.message ? result.message : (result && result.ok ? 'Quick relationship changes saved.' : 'Save failed.');
        setQuickStatus(msg, !(result && result.ok));
        if (typeof window.showToast === 'function') window.showToast(msg, result && result.ok ? 2300 : 3200);
        if (result && result.ok) {
            quickRelUndoStack = [];
            markQuickDraftDirty(false);
            openPersonModal(activeModalPersonId);
        }
    });

    quickDiscardDraftBtn?.addEventListener('click', () => {
        if (!quickRelDraft) return;
        const ok = !quickUnsavedTag || quickUnsavedTag.style.display === 'none' || window.confirm('Discard staged quick relationship changes?');
        if (!ok) return;
        renderQuickEditPanel(activeModalPersonId);
        setQuickStatus('Staged changes discarded.', false);
        if (typeof window.showToast === 'function') window.showToast('Staged changes discarded.', 2200);
    });

    const relationBtn = document.getElementById('relation-btn');
    if(relationBtn){
        relationBtn.addEventListener('click', () => {
            const homeId = getHomePersonId();
            if(!activeModalPersonId || !homeId) {
                alert("Could not determine relationship. A home person must be set and the details box must show a person.");
                return;
            }

            const homePerson = peopleMap.get(homeId);
            const modalPerson = peopleMap.get(activeModalPersonId);
            if (!homePerson || !modalPerson) {
                alert("Person data not found.");
                return;
            }

            let relationshipHtml = '';
            if (homeId === activeModalPersonId) {
                relationshipHtml = `
                    <p style="margin-bottom: 10px;">This is the currently set Home Person:</p>
                    <strong style="font-size: 1.2em; color: var(--primary-color);">${escapeHtml(homePerson.name)}</strong>
                `;
            } else {
                const relation = findRelationship(homeId, activeModalPersonId);
                relationshipHtml = `
                    <p style="margin:0 0 5px;">Relationship between:</p>
                    <strong style="font-size: 1.1em; display: block; margin-bottom: 15px;">${escapeHtml(homePerson.name)} (Home)</strong>
                    <span style="font-size: 1.5em; color: #888;">&</span>
                    <strong style="font-size: 1.1em; display: block; margin-top: 15px;">${escapeHtml(modalPerson.name)} (Profile)</strong>
                    <hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;">
                    <p style="font-size: 1.4em; color: var(--primary-color); font-weight: bold; margin:0;">${relation}</p>
                `;
            }

            relationshipModalBody.innerHTML = relationshipHtml;
            relationshipModalOverlay.style.display = 'flex';
        });
    }

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
        HOME_PERSON_ID = centerId;
        window.HOME_PERSON_ID = centerId;
        const familyData = getFamilySet(centerId);
        updateLineageBar(centerId); // Update lineage bar whenever tree is drawn
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
                field_2: "_relation",
                img_0: "image_url",
                gender_icon: "gender_icon_svg"
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
            item.innerHTML = `<strong>${escapeHtml(person.name)}</strong> <span style="font-size: 0.85em; color: #888; float: right;">${person.id}</span>`;
            item.dataset.id = person.id;
            item.addEventListener('click', () => {
                drawTree(person.id);
                clearSuggestions();
                searchInput.value = '';
                window.showTreePage(); // Ensure we switch to tree view
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

    // Relationship button: find relationship between active person and home person
    const headerRelationshipBtn = document.createElement('button');
    headerRelationshipBtn.innerHTML = '↔️';
    headerRelationshipBtn.title = "Find relationship to Home Person";
    Object.assign(headerRelationshipBtn.style, {
        marginRight: '8px',
        padding: '6px 10px',
        fontSize: '18px',
        cursor: 'pointer',
        backgroundColor: '#fff',
        border: '1px solid #ccc',
        borderRadius: '4px',
        verticalAlign: 'middle'
    });

    // Insert Home, Profile, and Relationship buttons before the search input field
    if (searchInput && searchInput.parentNode) {
        searchInput.parentNode.insertBefore(mainHomeBtn, searchInput);
        searchInput.parentNode.insertBefore(profileBtn, searchInput);
        searchInput.parentNode.insertBefore(headerRelationshipBtn, searchInput);
    }

    // Add click listener to reset tree to Home Person
    mainHomeBtn.addEventListener('click', () => {
        const homeId = getHomePersonId();
        if (homeId) {
            drawTree(homeId);
            window.showTreePage(); // Ensure we switch to tree view
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

    // Add click listener for the new header relationship button
    headerRelationshipBtn.addEventListener('click', () => {
        const homeId = getHomePersonId();
        const centeredId = activePersonId;

        if (!homeId || !centeredId) {
            alert("Could not determine relationship. A home person and an active person must be selected.");
            return;
        }

        const homePerson = peopleMap.get(homeId);
        const centeredPerson = peopleMap.get(centeredId);

        if (!homePerson || !centeredPerson) {
            alert("Person data not found.");
            return;
        }

        let relationshipHtml = '';
        if (homeId === centeredId) {
            relationshipHtml = `
                <p style="margin-bottom: 10px;">This is the currently set Home Person:</p>
                <strong style="font-size: 1.2em; color: var(--primary-color);">${homePerson.name}</strong>
            `;
        } else {
            const relation = findRelationship(homeId, centeredId);
            relationshipHtml = `
                <p style="margin:0 0 5px;">Relationship between:</p>
                <strong style="font-size: 1.1em; display: block; margin-bottom: 15px;">${homePerson.name} (Home)</strong>
                <span style="font-size: 1.5em; color: #888;">&</span>
                <strong style="font-size: 1.1em; display: block; margin-top: 15px;">${centeredPerson.name} (Selected)</strong>
                <hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;">
                <p style="font-size: 1.4em; color: var(--primary-color); font-weight: bold; margin:0;">${relation}</p>
            `;
        }

        relationshipModalBody.innerHTML = relationshipHtml;
        relationshipModalOverlay.style.display = 'flex';
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

    // --- Relationship Modal Close Logic ---
    if (relationshipModalClose) {
        relationshipModalClose.addEventListener('click', () => {
            relationshipModalOverlay.style.display = 'none';
        });
    }
    if (relationshipModalOverlay) {
        relationshipModalOverlay.addEventListener('click', (e) => {
            if (e.target === relationshipModalOverlay) {
                relationshipModalOverlay.style.display = 'none';
            }
        });
    }

    // =================================================================================
    // SECTION 5.5: NEWS / WELCOME FEATURE
    // =================================================================================
    
    window.showUpdatesPage = function() {
        const page = document.getElementById('updates-page');
        const content = document.getElementById('updates-content');
        if (!page || !content) return;

        // Show page immediately with loading state
        page.style.display = 'flex';
        content.innerHTML = '<p style="text-align:center; color:#666; margin-top: 20px;">Loading updates...</p>';

        // Get URL from config
        const updatesUrl = (APP_CONFIG && APP_CONFIG.updates_url) ? APP_CONFIG.updates_url : null;

        if (!updatesUrl) {
            content.innerHTML = '<p style="text-align:center; color:red; margin-top: 20px;">Updates URL not configured.</p>';
            return;
        }
        
        const fetchUrl = `${updatesUrl}&t=${Date.now()}`; // Bypass cache

        fetch(fetchUrl)
            .then(res => res.text())
            .then(csvText => {
                const rows = csvText.split(/\r?\n/);
                const validUpdates = [];
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                // Skip header row (index 0)
                for (let i = 1; i < rows.length; i++) {
                    // Split CSV line handling quoted commas
                    const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').trim());
                    
                    // Expected columns: Date, Message, Expiry
                    if (cols.length < 2) continue;

                    const dateStr = cols[0];
                    const message = cols[1];
                    const expiryStr = cols[2];

                    const itemDate = window.DateUtils ? window.DateUtils.parse(dateStr) : null;
                    const expiryDate = window.DateUtils ? window.DateUtils.parse(expiryStr) : null;

                    // Check expiry
                    if (expiryDate && today > expiryDate) {
                        continue; // Skip expired messages
                    }

                    if (itemDate && message) {
                        validUpdates.push({ dateObj: itemDate, dateStr: dateStr, message: message });
                    }
                }

                // Sort by date descending (newest first)
                validUpdates.sort((a, b) => b.dateObj - a.dateObj);

                if (validUpdates.length === 0) {
                    content.innerHTML = '<p style="text-align:center; padding: 20px; color: #666;">No active updates.</p>';
                } else {
                    content.innerHTML = validUpdates.map((item, index) => `
                        <div class="update-item">
                            <div class="update-number">${index + 1})</div>
                            <div class="update-details">
                                <div class="update-date">📅 ${item.dateStr}</div>
                                <div class="update-text">${escapeHtml(item.message)}</div>
                            </div>
                        </div>
                    `).join('');
                }
            })
            .catch(err => {
                console.error("Error loading news:", err);
                content.innerHTML = '<p style="color: red; text-align: center; margin-top: 20px;">Failed to load updates.</p>';
            });
    };

    const updatesPageClose = document.getElementById('updates-page-close');
    if (updatesPageClose) {
        updatesPageClose.addEventListener('click', () => {
            document.getElementById('updates-page').style.display = 'none';
        });
    }

    // =================================================================================
    // SECTION 5.6: BIRTHDAYS PAGE (next 20 days)
    // =================================================================================

    window.showBirthdays = function() {
        const page = document.getElementById('birthdays-page');
        const content = document.getElementById('birthdays-content');
        if (!page || !content) return;

        const homeId = getHomePersonId();
        const list = getUpcomingBirthdays(30);
        if (list.length === 0) {
            content.innerHTML = '<p style="color:#666; text-align:center; padding: 20px;">No upcoming birthdays found.</p>';
        } else {
            content.innerHTML = list.map(entry => {
                const namesHtml = entry.persons.map(p => {
                    const ageStr = p.ageAtDisplay != null ? ` (${p.ageAtDisplay})` : '';
                    
                    let jyotishaHtml = '';
                    if (p.jyotisha) {
                        const parts = [];
                        if (p.jyotisha.gothra) parts.push(p.jyotisha.gothra);
                        if (p.jyotisha.nakshatra) parts.push(p.jyotisha.nakshatra);
                        if (p.jyotisha.rashi) parts.push(p.jyotisha.rashi);
                        if (parts.length > 0) {
                            jyotishaHtml = `<div style="font-size: 12px; color: #666; margin-top: 2px;">${parts.join(' - ')}</div>`;
                        }
                    }

                    let relationHtml = '';
                    if (homeId && typeof findRelationship === 'function') {
                        if (p.id === homeId) {
                            relationHtml = `<div style="font-size: 13px; color: #E91E63; margin-top: 2px;">You (Home)</div>`;
                        } else {
                            const rel = findRelationship(homeId, p.id);
                            if (rel && rel !== "Unknown") {
                                relationHtml = `<div style="font-size: 13px; color: #E91E63; margin-top: 2px;">${rel}</div>`;
                            }
                        }
                    }

                    const phoneHtml = p.phone
                        ? `<div class="birthday-phone"><a href="${getWhatsAppUrl(p.phone)}" target="_blank" rel="noopener" class="birthday-whatsapp-link" title="Open WhatsApp">${escapeHtml(p.phone)}</a></div>`
                        : '';
                    return `<div class="birthday-person-block">
                        <div class="birthday-name"><a href="#" data-person-id="${p.id}">${escapeHtml(p.name)}${ageStr}</a></div>
                        ${jyotishaHtml}
                        ${relationHtml}
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
    // SECTION 5.8: HELP PAGE
    // =================================================================================

    window.showHelp = function() {
        console.log("Opening Help Page...");
        const helpPage = document.getElementById('help-page');
        if (helpPage) {
            helpPage.style.display = 'flex';
        }
    };

    const helpPageClose = document.getElementById('help-page-close');
    if (helpPageClose) {
        helpPageClose.addEventListener('click', () => {
            document.getElementById('help-page').style.display = 'none';
        });
    }

    // =================================================================================
    // SECTION 5.6.5: FORM PAGE
    // =================================================================================

    window.showFormPage = function() {
        const formPage = document.getElementById('form-page');
        if (formPage) formPage.style.display = 'flex';
    };

    const formPageClose = document.getElementById('form-page-close');
    if (formPageClose) {
        formPageClose.addEventListener('click', () => {
            document.getElementById('form-page').style.display = 'none';
        });
    }

    // =================================================================================
    // SECTION 5.8.5: ABOUT PAGE
    // =================================================================================

    window.showAboutPage = function() {
        const aboutPage = document.getElementById('about-page');
        if (aboutPage) {
            aboutPage.style.display = 'flex';
        }
    };

    const aboutPageClose = document.getElementById('about-page-close');
    if (aboutPageClose) {
        aboutPageClose.addEventListener('click', () => {
            document.getElementById('about-page').style.display = 'none';
        });
    }

    // =================================================================================
    // SECTION 5.8.6: FEEDBACK PAGE
    // =================================================================================

    window.showFeedbackPage = function() {
        const feedbackPage = document.getElementById('feedback-page');
        if (feedbackPage) {
            feedbackPage.style.display = 'flex';
        }
    };

    const feedbackPageClose = document.getElementById('feedback-page-close');
    if (feedbackPageClose) {
        feedbackPageClose.addEventListener('click', () => {
            document.getElementById('feedback-page').style.display = 'none';
        });
    }

    // =================================================================================
    // SECTION 5.11: REPORTS PAGE & GENERATION
    // =================================================================================

    // State for the reports page
    let reportSelectedPersonId = null;
    let reportSecondPersonId = null; // For Relationship Diagram

    window.showReportsPage = function() {
        const page = document.getElementById('reports-page');
        if (page) {
            page.style.display = 'flex';
            // Reset selection on open if desired, or keep it. 
            // Let's keep it but ensure UI is synced.
            updateReportUI();
            setTimeout(() => {
                const input = document.getElementById('report-search-input');
                if(input) input.focus();
            }, 100);
        }
    };

    const reportsPageClose = document.getElementById('reports-page-close');
    if (reportsPageClose) {
        reportsPageClose.addEventListener('click', () => {
            document.getElementById('reports-page').style.display = 'none';
        });
    }

    // Report Search Logic
    const reportSearchInput = document.getElementById('report-search-input');
    const reportSuggestions = document.getElementById('report-search-suggestions');

    if (reportSearchInput && reportSuggestions) {
        reportSearchInput.addEventListener('input', () => {
            const query = reportSearchInput.value.toLowerCase().trim();
            if (query.length < 2) {
                reportSuggestions.style.display = 'none';
                return;
            }
            const matches = [];
            for (const person of PEOPLE) {
                if (person.name.toLowerCase().includes(query)) {
                    matches.push(person);
                    if (matches.length >= 10) break;
                }
            }
            reportSuggestions.innerHTML = matches.map(p => `
                <div class="suggestion-item" data-id="${p.id}">
                    <strong>${escapeHtml(p.name)}</strong> <span style="font-size: 0.85em; color: #888; float: right;">${p.id}</span>
                </div>
            `).join('');
            reportSuggestions.style.display = matches.length > 0 ? 'block' : 'none';
        });

        reportSuggestions.addEventListener('click', (e) => {
            const item = e.target.closest('.suggestion-item');
            if (item) {
                reportSelectedPersonId = item.dataset.id;
                reportSearchInput.value = '';
                reportSuggestions.style.display = 'none';
                updateReportUI();
            }
        });
    }

    // --- Relationship Diagram Logic ---
    window.toggleRelDiagramInputs = function() {
        const div = document.getElementById('rel-diagram-inputs');
        if (div) {
            div.style.display = div.style.display === 'none' ? 'block' : 'none';
            if (div.style.display === 'block') {
                document.getElementById('rel-diagram-search-input').focus();
            }
        }
    };

    const relSearchInput = document.getElementById('rel-diagram-search-input');
    const relSuggestions = document.getElementById('rel-diagram-suggestions');

    if (relSearchInput && relSuggestions) {
        relSearchInput.addEventListener('input', () => {
            const query = relSearchInput.value.toLowerCase().trim();
            if (query.length < 2) {
                relSuggestions.style.display = 'none';
                return;
            }
            const matches = PEOPLE.filter(p => p.name.toLowerCase().includes(query)).slice(0, 10);
            relSuggestions.innerHTML = matches.map(p => `
                <div class="suggestion-item" data-id="${p.id}">
                    <strong>${escapeHtml(p.name)}</strong> <span style="font-size: 0.85em; color: #888; float: right;">${p.id}</span>
                </div>
            `).join('');
            relSuggestions.style.display = matches.length > 0 ? 'block' : 'none';
        });

        relSuggestions.addEventListener('click', (e) => {
            const item = e.target.closest('.suggestion-item');
            if (item) {
                reportSecondPersonId = item.dataset.id;
                const p = peopleMap.get(reportSecondPersonId);
                
                document.getElementById('rel-diagram-selected').style.display = 'block';
                document.getElementById('rel-diagram-selected-name').textContent = p.name;
                
                relSearchInput.value = '';
                relSuggestions.style.display = 'none';
            }
        });
    }

    window.generateRelDiagram = function() {
        if (!reportSelectedPersonId) {
            alert("Please select the First Person (top search box) first.");
            return;
        }
        if (!reportSecondPersonId) {
            alert("Please select the Second Person.");
            return;
        }
        
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        
        if (typeof generateDiagramHTML !== 'function') {
            alert("relationship.js is not updated yet.");
            return;
        }

        content.innerHTML = generateDiagramHTML(reportSelectedPersonId, reportSecondPersonId);
        page.style.display = 'flex';
    };

    window.clearReportSelection = function() {
        reportSelectedPersonId = null;
        reportSecondPersonId = null;
        document.getElementById('rel-diagram-selected').style.display = 'none';
        document.getElementById('rel-diagram-inputs').style.display = 'none';
        updateReportUI();
    };

    function updateReportUI() {
        const card = document.getElementById('report-selected-person');
        const nameSpan = document.getElementById('report-selected-name');
        const btn = document.getElementById('btn-close-family-report');

        if (reportSelectedPersonId && peopleMap.has(reportSelectedPersonId)) {
            const p = peopleMap.get(reportSelectedPersonId);
            card.style.display = 'flex';
            nameSpan.textContent = p.name;
            if(btn) btn.classList.remove('disabled');
        } else {
            card.style.display = 'none';
            nameSpan.textContent = 'None';
            if(btn) btn.classList.add('disabled');
        }
    }

    window.generateSelectedReport = function(reportType) {
        if (!reportSelectedPersonId) {
            alert("Please search and select a person first.");
            return;
        }

        if (reportType === 'close-family') {
            showRelationshipReport(reportSelectedPersonId);
        } else if (reportType === 'ancestors') {
            showAncestorsReport(reportSelectedPersonId);
        } else if (reportType === 'descendants') {
            showDescendantsReport(reportSelectedPersonId);
        } else if (reportType === 'full-descendants') {
            showFullDescendantsReport(reportSelectedPersonId);
        } else if (reportType === 'full-descendants-diagram') {
            showFullDescendantsDiagram(reportSelectedPersonId);
        } else if (reportType === 'full-descendants') {
            showFullDescendantsReport(reportSelectedPersonId);
        } else if (reportType === 'full-descendants-diagram') {
            showFullDescendantsDiagram(reportSelectedPersonId);
        }
    };

    // Modified to accept an ID
    window.showRelationshipReport = function(targetId) {
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        if (!page || !content) return;

        // Safety check: Ensure relationship.js is loaded
        if (typeof generateRelationshipReport !== 'function') {
            alert("Error: relationship.js is not loaded. Please check if the file exists in your folder.");
            return;
        }

        try {
            // Use targetId if provided, otherwise fallback to home (though new UI enforces selection)
            const idToUse = targetId || getHomePersonId();
            content.innerHTML = generateRelationshipReport(idToUse);
            page.style.display = 'flex';

            // Set document title for printing filename
            if (idToUse && peopleMap.has(idToUse)) {
                const p = peopleMap.get(idToUse);
                document.title = `${p.name.toUpperCase()} RELATIONSHIP REPORT`;
            }
        } catch (e) {
            console.error("Report Generation Error:", e);
            content.innerHTML = `<p style="color:red; padding:20px; text-align:center;">An error occurred while generating the report:<br>${e.message}</p>`;
            page.style.display = 'flex';
        }
    };

    window.showAncestorsReport = function(targetId) {
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        if (!page || !content) return;

        if (typeof generateAncestorsReport !== 'function') {
            alert("Error: relationship.js is not updated.");
            return;
        }

        try {
            content.innerHTML = generateAncestorsReport(targetId);
            page.style.display = 'flex';
            if (targetId && peopleMap.has(targetId)) {
                const p = peopleMap.get(targetId);
                document.title = `${p.name.toUpperCase()} ANCESTORS REPORT`;
            }
        } catch (e) {
            console.error("Report Generation Error:", e);
            alert("An error occurred while generating the report.");
        }
    };

    window.showDescendantsReport = function(targetId) {
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        if (!page || !content) return;

        if (typeof generateDescendantsReport !== 'function') {
            alert("Error: relationship.js is not updated.");
            return;
        }

        try {
            content.innerHTML = generateDescendantsReport(targetId);
            page.style.display = 'flex';
            if (targetId && peopleMap.has(targetId)) {
                const p = peopleMap.get(targetId);
                document.title = `${p.name.toUpperCase()} DESCENDANTS REPORT`;
            }
        } catch (e) {
            console.error("Report Generation Error:", e);
            alert("An error occurred while generating the report.");
        }
    };

    window.showFullDescendantsReport = function(targetId) {
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        if (!page || !content) return;

        if (typeof generateFullDescendantsReport !== 'function') {
            alert("Error: relationship.js is not updated.");
            return;
        }

        try {
            content.innerHTML = generateFullDescendantsReport(targetId);
            page.style.display = 'flex';
            if (targetId && peopleMap.has(targetId)) {
                const p = peopleMap.get(targetId);
                document.title = `${p.name.toUpperCase()} FULL DESCENDANTS REPORT`;
            }
        } catch (e) {
            console.error("Report Generation Error:", e);
            alert("An error occurred while generating the report.");
        }
    };

    window.showFullDescendantsDiagram = function(targetId) {
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        if (!page || !content) return;

        if (typeof generateFullDescendantsDiagram !== 'function') {
            alert("Error: relationship.js is not updated.");
            return;
        }

        try {
            content.innerHTML = generateFullDescendantsDiagram(targetId);
            page.style.display = 'flex';
            if (targetId && peopleMap.has(targetId)) {
                const p = peopleMap.get(targetId);
                document.title = `${p.name.toUpperCase()} DESCENDANTS DIAGRAM`;
            }
        } catch (e) {
            console.error("Report Generation Error:", e);
            alert("An error occurred while generating the report.");
        }
    };

    window.showFullDescendantsReport = function(targetId) {
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        if (!page || !content) return;

        if (typeof generateFullDescendantsReport !== 'function') {
            alert("Error: relationship.js is not updated.");
            return;
        }

        try {
            content.innerHTML = generateFullDescendantsReport(targetId);
            page.style.display = 'flex';
            if (targetId && peopleMap.has(targetId)) {
                const p = peopleMap.get(targetId);
                document.title = `${p.name.toUpperCase()} FULL DESCENDANTS REPORT`;
            }
        } catch (e) {
            console.error("Report Generation Error:", e);
            alert("An error occurred while generating the report.");
        }
    };

    window.showFullDescendantsDiagram = function(targetId) {
        const page = document.getElementById('relationship-report-page');
        const content = document.getElementById('report-content');
        if (!page || !content) return;

        if (typeof generateFullDescendantsDiagram !== 'function') {
            alert("Error: relationship.js is not updated.");
            return;
        }

        try {
            content.innerHTML = generateFullDescendantsDiagram(targetId);
            page.style.display = 'flex';
            if (targetId && peopleMap.has(targetId)) {
                const p = peopleMap.get(targetId);
                document.title = `${p.name.toUpperCase()} DESCENDANTS DIAGRAM`;
            }
        } catch (e) {
            console.error("Report Generation Error:", e);
            alert("An error occurred while generating the report.");
        }
    };

    const reportPageClose = document.getElementById('report-page-close');
    if (reportPageClose) {
        reportPageClose.addEventListener('click', () => {
            document.getElementById('relationship-report-page').style.display = 'none';
            document.title = "VAMSHA VRUKSHA"; // Restore default title
        });
    }

    // =================================================================================
    // SECTION 5.12: JYOTISHA PAGE
    // =================================================================================

    window.showJyotishaPage = function() {
        const page = document.getElementById('jyotisha-page');
        if (page) {
            page.style.display = 'flex';
            
            // Default to Home Person
            const homeId = getHomePersonId();

            if (window.Jyotisha && typeof window.Jyotisha.init === 'function') {
                const transitUrl = (APP_CONFIG && APP_CONFIG.data_files && APP_CONFIG.data_files.transit) 
                                   ? toAppPath(APP_CONFIG.data_files.transit) 
                                   : 'json_data/transit.json';
                const moonUrl = (APP_CONFIG && APP_CONFIG.data_files && APP_CONFIG.data_files.transit_moon) 
                                   ? toAppPath(APP_CONFIG.data_files.transit_moon) 
                                   : 'json_data/transit_moon.json';
                
                window.Jyotisha.init(transitUrl, moonUrl, () => {
                    // Data loaded: refresh the current view if we are still on this page
                    if (currentJyotishaId && document.getElementById('jyotisha-page').style.display !== 'none') {
                        loadJyotishaDetails(currentJyotishaId);
                    }
                });
            }

            if (homeId) {
                loadJyotishaDetails(homeId);
            }
            
            setTimeout(() => {
                const input = document.getElementById('jyotisha-search-input');
                if(input) input.focus();
            }, 100);
        }
    };

    const jyotishaPageClose = document.getElementById('jyotisha-page-close');
    if (jyotishaPageClose) {
        jyotishaPageClose.addEventListener('click', () => {
            document.getElementById('jyotisha-page').style.display = 'none';
        });
    }

    let currentJyotishaId = null;

    function loadJyotishaDetails(personId) {
        currentJyotishaId = personId;
        const p = peopleMap.get(personId);
        const card = document.getElementById('jyotisha-details-card');
        const emptyMsg = document.getElementById('jyotisha-empty-msg');
        const nameEl = document.getElementById('jyotisha-name');
        const nakshatraEl = document.getElementById('jyotisha-nakshatra');
        const rashiEl = document.getElementById('jyotisha-rashi');
        const guruEl = document.getElementById('jyotisha-guru-result');
        const shaniEl = document.getElementById('jyotisha-shani-result');
        const taraEl = document.getElementById('jyotisha-tara-result');
        const chandraEl = document.getElementById('jyotisha-chandra-result');
        const searchInput = document.getElementById('jyotisha-search-input');

        if (!p) {
            if(card) card.style.display = 'none';
            if(emptyMsg) emptyMsg.style.display = 'block';
            return;
        }

        if(card) card.style.display = 'block';
        if(emptyMsg) emptyMsg.style.display = 'none';
        
        if(nameEl) nameEl.textContent = p.name;
        if(searchInput) searchInput.value = p.name;

        const j = p.jyotisha || {};
        if(nakshatraEl) nakshatraEl.textContent = j.nakshatra || '-';
        if(rashiEl) rashiEl.textContent = j.rashi || '-';

        if (p.deceased) {
            const msg = '<span style="color: #666;">Person not alive</span>';
            if(guruEl) guruEl.innerHTML = msg;
            if(shaniEl) shaniEl.innerHTML = msg;
            if(taraEl) taraEl.innerHTML = msg;
            if(chandraEl) chandraEl.innerHTML = msg;
        } else if (window.Jyotisha) {
            const details = window.Jyotisha.getDetails(j.rashi, j.nakshatra);
            if (details) {
                if(guruEl) guruEl.innerHTML = details.guru;
                if(shaniEl) shaniEl.innerHTML = details.shani;
                if(taraEl) taraEl.innerHTML = details.tara;
                if(chandraEl) chandraEl.innerHTML = details.chandra;
            } else {
                if(guruEl) guruEl.textContent = "Data unavailable";
                if(shaniEl) shaniEl.textContent = "Data unavailable";
            }
        } else {
            if(guruEl) guruEl.textContent = "Jyotisha module not loaded";
            if(shaniEl) shaniEl.textContent = "Jyotisha module not loaded";
            if(taraEl) taraEl.textContent = "Jyotisha module not loaded";
            if(chandraEl) chandraEl.textContent = "Jyotisha module not loaded";
        }
    }

    const jyotishaInput = document.getElementById('jyotisha-search-input');
    const jyotishaSuggestions = document.getElementById('jyotisha-search-suggestions');

    if (jyotishaInput && jyotishaSuggestions) {
        jyotishaInput.addEventListener('input', () => {
            const query = jyotishaInput.value.toLowerCase().trim();
            if (query.length < 1) {
                jyotishaSuggestions.style.display = 'none';
                return;
            }
            const matches = [];
            for (const person of PEOPLE) {
                if (person.name.toLowerCase().includes(query)) {
                    matches.push(person);
                    if (matches.length >= 10) break;
                }
            }
            jyotishaSuggestions.innerHTML = matches.map(p => `
                <div class="suggestion-item" data-id="${p.id}">
                    <strong>${escapeHtml(p.name)}</strong> <span style="font-size: 0.85em; color: #888; float: right;">${p.id}</span>
                </div>
            `).join('');
            jyotishaSuggestions.style.display = matches.length > 0 ? 'block' : 'none';
        });

        jyotishaSuggestions.addEventListener('click', (e) => {
            const item = e.target.closest('.suggestion-item');
            if (item) {
                const id = item.dataset.id;
                loadJyotishaDetails(id);
                jyotishaSuggestions.style.display = 'none';
            }
        });
        
        document.addEventListener('click', (e) => {
            if (!jyotishaInput.contains(e.target) && !jyotishaSuggestions.contains(e.target)) {
                jyotishaSuggestions.style.display = 'none';
            }
        });
    }

    // =================================================================================
    // SECTION 5.9: DASHBOARD LOGIC
    // =================================================================================

    window.showDashboard = function() {
        if (dashboardPage) dashboardPage.style.display = 'block';
        if (treeContainer) treeContainer.style.display = 'none';
        if (lineageBar) lineageBar.style.display = 'none';
        if (searchWrapper) searchWrapper.style.display = 'none';
        if (dashboardHeaderTitle) dashboardHeaderTitle.style.display = 'block';
        
        // Update Sidebar Active State
        if (navDashboard) navDashboard.classList.add('active');
        if (navTree) navTree.classList.remove('active');
    };

    window.showTreePage = function() {
        if (dashboardPage) dashboardPage.style.display = 'none';
        if (treeContainer) treeContainer.style.display = 'block';
        if (lineageBar) lineageBar.style.display = 'flex';
        if (searchWrapper) searchWrapper.style.display = 'flex';
        if (dashboardHeaderTitle) dashboardHeaderTitle.style.display = 'none';

        // Update Sidebar Active State
        if (navDashboard) navDashboard.classList.remove('active');
        if (navTree) navTree.classList.add('active');

        // If tree hasn't been drawn yet (edge case), draw it
        if (!tree && PEOPLE.length > 0) {
            const homeId = getHomePersonId();
            if (homeId) drawTree(homeId);
        }
    };

    window.focusSearch = function() {
        window.showTreePage();
        setTimeout(() => {
            if (searchInput) searchInput.focus();
        }, 100);
    };

    // Generic Toast Notification
    window.showToast = function(message, duration = 4000) {
        const toast = document.getElementById('app-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        // Clear any existing timeout to prevent early dismissal if called rapidly
        if (toast.timeoutId) clearTimeout(toast.timeoutId);
        toast.timeoutId = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    };

    const dashSearchContainer = document.getElementById('dash-search-container');
    const dashSearchInput = document.getElementById('dash-search-input');
    const dashSearchSuggestions = document.getElementById('dash-search-suggestions');

    window.changeHomePerson = function() {
        if (dashSearchContainer) {
            const isHidden = dashSearchContainer.style.display === 'none';
            dashSearchContainer.style.display = isHidden ? 'block' : 'none';
            if (isHidden && dashSearchInput) {
                dashSearchInput.value = '';
                if (dashSearchSuggestions) dashSearchSuggestions.style.display = 'none';
                setTimeout(() => dashSearchInput.focus(), 100);
            }
        }
    };

    if (dashSearchInput && dashSearchSuggestions) {
        dashSearchInput.addEventListener('input', () => {
            const query = dashSearchInput.value.toLowerCase().trim();
            if (query.length < 3) {
                dashSearchSuggestions.style.display = 'none';
                return;
            }
            const matches = [];
            for (const person of PEOPLE) {
                if (person.name.toLowerCase().includes(query)) {
                    matches.push(person);
                    if (matches.length >= 10) break;
                }
            }
            dashSearchSuggestions.innerHTML = matches.map(p => `
                <div class="suggestion-item" data-id="${p.id}">
                    <strong>${escapeHtml(p.name)}</strong> <span style="font-size: 0.85em; color: #888; float: right;">${p.id}</span>
                </div>
            `).join('');
            dashSearchSuggestions.style.display = matches.length > 0 ? 'block' : 'none';
        });
        dashSearchSuggestions.addEventListener('click', (e) => {
            const item = e.target.closest('.suggestion-item');
            if (item) {
                openPersonModal(item.dataset.id);
                dashSearchContainer.style.display = 'none';
            }
        });
    }

    function updateDashboard() {
        // 1. Set Date
        // if (dashDateEl) {
        //     const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        //     dashDateEl.textContent = new Date().toLocaleDateString('en-US', options);
        // }

        // 2. Total Members
        if (statTotalMembersEl) {
            statTotalMembersEl.textContent = PEOPLE.length;
        }

        // 3. Upcoming Birthdays (Next 30 days)
        if (statUpcomingBirthdaysEl) {
            const upcoming = getUpcomingBirthdays(30);
            // Count total people, not just dates
            let count = 0;
            upcoming.forEach(day => {
                count += day.persons.length;
            });
            statUpcomingBirthdaysEl.textContent = count;
        }

        // 4. Home Person Name
        const homeId = getHomePersonId();
        const homeNameEl = document.getElementById('dash-home-name');
        const userRowEl = document.getElementById('dash-user-row');
        const dashTitleEl = document.getElementById('dashboard-main-title');
        
        if (homeId && peopleMap.has(homeId)) {
            const p = peopleMap.get(homeId);
            if (homeNameEl) homeNameEl.textContent = p.name;
            if (userRowEl) userRowEl.style.display = 'block';

            if (dashTitleEl) {
                const surname = p.surname || '';
                const cardEl = document.getElementById('dashboard-family-card');
                
                if (surname) {
                    if (cardEl) cardEl.style.display = 'block';
                    const titleText = surname.toUpperCase() + " FAMILY";
                    dashTitleEl.textContent = titleText;

                    // Dynamic resizing to fit single line
                    dashTitleEl.style.whiteSpace = 'nowrap';
                    dashTitleEl.style.overflow = 'hidden';
                    dashTitleEl.style.textOverflow = 'ellipsis';
                    dashTitleEl.style.maxWidth = '100%';
                    dashTitleEl.style.display = 'block';

                    // Heuristic: Base 24px fits ~15 chars comfortably on mobile
                    const len = titleText.length;
                    const newSize = len > 15 ? Math.max(10, Math.floor(24 * (15 / len))) : 24;
                    dashTitleEl.style.fontSize = newSize + 'px';
                    dashTitleEl.style.letterSpacing = len > 15 ? '0px' : '1px';
                } else {
                    if (cardEl) cardEl.style.display = 'none';
                    dashTitleEl.style.display = 'none';
                }
            }
        }
        
        // Update Lineage Bar for Home Person (default view)
        if (homeId) updateLineageBar(homeId);

        // 5. Fetch Dynamic Welcome Message from Google Sheet
        fetchDashboardMessage();
    }

    function fetchDashboardMessage() {
        const sheetUrl = (APP_CONFIG && APP_CONFIG.welcome_msg_url) ? APP_CONFIG.welcome_msg_url : null;
        if (!sheetUrl) return;

        // Append timestamp to bypass cache and ensure fresh data
        const url = `${sheetUrl}&t=${Date.now()}`;

        fetch(url)
            .then(response => response.text())
            .then(csvText => {
                const rows = csvText.split(/\r?\n/);
                console.log(`[Dashboard] Fetched ${rows.length} rows from sheet.`);
                if (rows.length < 2) return;

                // Headers: start_date, Message, expiry
                // We assume column order: 0=start_date, 1=Message, 2=expiry
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const validMessages = [];

                for (let i = 1; i < rows.length; i++) {
                    // Handle CSV splitting (regex handles quoted commas if any)
                    const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').trim());
                    
                    if (cols.length < 3) continue;

                    const startDate = window.DateUtils ? window.DateUtils.parse(cols[0]) : null;
                    const message = cols[1];
                    const expiryDate = window.DateUtils ? window.DateUtils.parse(cols[2]) : null;

                    if (startDate && expiryDate && message) {
                        if (today >= startDate && today <= expiryDate) {
                            validMessages.push({ start: startDate, msg: message });
                        } else {
                            // console.log("Skipping expired or future message:", message, startDate, expiryDate);
                        }
                    }
                }

                // Sort by start date descending (latest first)
                validMessages.sort((a, b) => b.start - a.start);

                if (validMessages.length > 0 && dashDynamicMsgEl) {
                    console.log("[Dashboard] Showing message:", validMessages[0].msg);
                    dashDynamicMsgEl.textContent = validMessages[0].msg;
                    dashDynamicMsgEl.style.display = 'block';
                } else if (dashDynamicMsgEl) {
                    dashDynamicMsgEl.style.display = 'none';
                }
            })
            .catch(err => console.error("Error fetching welcome message:", err));
    }

    function applyFeatureVisibility() {
        if (!APP_CONFIG || !APP_CONFIG.features) {
            console.log("Config features not found, showing all defaults.");
            return;
        }
        const f = APP_CONFIG.features;
        const setVisible = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? '' : 'none';
        };

        // Sidebar Items
        setVisible('nav-dashboard', f.dashboard !== false);
        setVisible('nav-tree', f.tree !== false);
        setVisible('nav-birthdays', f.birthdays !== false);
        setVisible('nav-updates', f.updates !== false);
        setVisible('nav-reports', f.reports !== false);
        setVisible('nav-jyotisha', f.jyotisha !== false);
        setVisible('nav-install', f.install !== false);
        setVisible('nav-help', f.help !== false);
        setVisible('nav-about', f.about !== false);
        setVisible('nav-feedback', f.feedback !== false);
        setVisible('nav-update-data', f.update_data !== false);

        // Dashboard Items (Cards/Buttons)
        setVisible('dash-card-birthdays', f.birthdays !== false);
        setVisible('dash-card-updates', f.updates !== false);
        setVisible('dash-card-reports', f.reports !== false);
        setVisible('dash-card-tree', f.tree !== false);
        setVisible('dash-card-update-data', f.update_data !== false);
    }

    // =================================================================================
    // SECTION 5.10: LINEAGE BAR LOGIC
    // =================================================================================

    function updateLineageBar(centerId) {
        const bar = document.getElementById('lineage-bar');
        if (!bar) return;
        
        if (!centerId || !peopleMap.has(centerId)) {
            bar.innerHTML = '';
            return;
        }

        // 1. Find Ancestors (Father chain, max 3)
        const ancestors = [];
        let curr = peopleMap.get(centerId);
        for (let i = 0; i < 3; i++) {
            if (curr && curr.fid && peopleMap.has(curr.fid)) {
                curr = peopleMap.get(curr.fid);
                ancestors.unshift(curr); // Add to beginning
            } else {
                break;
            }
        }

        // 3. Build HTML
        const createItem = (p, isCurrent) => {
            // Use ONLY first name
            const firstName = (p.name || '').trim().split(' ')[0];
            const className = isCurrent ? 'lineage-item current' : 'lineage-item';
            return `<div class="${className}" onclick="window.lineageClick('${p.id}')">${escapeHtml(firstName)}</div>`;
        };

        const arrow = `<div class="lineage-arrow">→</div>`;
        
        let html = '';
        
        // Ancestors
        ancestors.forEach(p => {
            html += createItem(p, false);
            html += arrow;
        });

        // Current
        const currentPerson = peopleMap.get(centerId);
        html += createItem(currentPerson, true);

        bar.innerHTML = html;
        
        // Scroll current item into view if needed
        setTimeout(() => {
            const currentEl = bar.querySelector('.current');
            if (currentEl) {
                currentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }, 100);
    }

    window.lineageClick = function(id) {
        drawTree(id);
        window.showTreePage(); 
    };

    /**
     * =================================================================================
     * SECTION 5.7: NEW DATABASE ADAPTER
     * =================================================================================
     * This function loads data from the new three-file format (persons, families, places)
     * and transforms it into the single `PEOPLE` array format that the rest of the
     * application expects.
     */
    async function loadNewDatabase() {
        console.log("Loading configuration...");
        APP_CONFIG = await (await fetch(toAppPath('config.json'))).json();
        applyFeatureVisibility();

        console.log("Loading data from new database format...");
        const [personsRes, familiesRes, placesRes, contactsRes, dictRes] = await Promise.all([
            fetch(toAppPath(APP_CONFIG.data_files.persons)),
            fetch(toAppPath(APP_CONFIG.data_files.families)),
            fetch(toAppPath(APP_CONFIG.data_files.places)),
            fetch(toAppPath(APP_CONFIG.data_files.contacts)),
            fetch(toAppPath(APP_CONFIG.data_files.relationshipDictionary)).catch(err => console.warn("Dict load fail", err))
        ]);

        const persons = await personsRes.json();
        const families = await familiesRes.json();
        const places = await placesRes.json();
        const contacts = await contactsRes.json();

        if (dictRes && dictRes.ok) {
            window.relationshipDictionary = await dictRes.json();
        } else {
            window.relationshipDictionary = {};
        }

        // Create a map for easy lookup of contact info
        const contactsMap = new Map();
        for (const contact of contacts) {
            contactsMap.set(contact.person_id, contact);
        }

        const newPeopleMap = new Map();

        const isArchivedPerson = (p) => {
            if (!p) return false;
            if (p.archived === true) return true;
            const t = String(p.archived || '').trim().toLowerCase();
            return t === 'true' || t === '1' || t === 'yes' || t === 'y';
        };

        // 1. Create initial person objects from persons.json
        for (const p of persons) {
            if (isArchivedPerson(p)) continue;
            const givenName = (p.given_name || '').trim();
            const surname = (p.surname || '').trim();
            let fullName = (givenName + ' ' + surname).trim();
            if (!fullName) {
                fullName = p.person_id;
            }

            // Populate genderMap with explicit 'sex' data from the new database.
            if (p.sex && (p.sex === 'M' || p.sex === 'F')) {
                genderMap.set(p.person_id, p.sex);
            }

            const contactInfo = contactsMap.get(p.person_id) || {};

            const birthPlace = p.birth_place_id && places[p.birth_place_id] ? places[p.birth_place_id].place : '';

            const isDeceased = p.deceased === true || String(p.deceased || '').toLowerCase() === 'true' || !!String(p.death_date || '').trim();
            const custom = (p.custom && typeof p.custom === 'object' && !Array.isArray(p.custom)) ? p.custom : {};

            newPeopleMap.set(p.person_id, {
                id: p.person_id,
                name: fullName,
                surname: surname,
                fid: "",
                mid: "",
                pids: [],
                Birth: p.birth_date || "",
                birth_date_type: p.birth_date_type || "",
                Death: p.death_date || "",
                deceased: isDeceased,
                death_date: p.death_date || "",
                Address: birthPlace,
                email: contactInfo.email || "",
                phone: contactInfo.phone || "",
                note: contactInfo.note || "",
                custom,
                image_url: "", // Populated later by photos.json
                jyotisha: p.jyotisha || {},
                divorces: p.divorces || []
            });
        }

        // 2. Process families.json to build relationships (spouses, parents, children)
        for (const family of families) {
            const husbandId = family.husband_id;
            const wifeId = family.wife_id;

            // Link spouses
            if (husbandId && wifeId && newPeopleMap.has(husbandId) && newPeopleMap.has(wifeId)) {
                const husband = newPeopleMap.get(husbandId);
                const wife = newPeopleMap.get(wifeId);
                if (!husband.pids.includes(wifeId)) husband.pids.push(wifeId);
                if (!wife.pids.includes(husbandId)) wife.pids.push(husbandId);
            }

            // Link children to parents
            if (family.children && Array.isArray(family.children)) {
                for (const childId of family.children) {
                    if (newPeopleMap.has(childId)) {
                        const child = newPeopleMap.get(childId);
                        if (husbandId) child.fid = husbandId;
                        if (wifeId) child.mid = wifeId;
                    }
                }
            }
        }

        console.log("Data transformation complete.");
        return Array.from(newPeopleMap.values());
    }

    // =================================================================================
    // SECTION 5.13: LANGUAGE SWITCHER
    // =================================================================================

    window.toggleLanguage = function() {
        const toast = document.getElementById('language-selection-toast');
        if (toast) {
            toast.classList.add('show');
        }
    };

    window.setLanguage = function(lang) {
        localStorage.setItem('relation_language', lang);
        if (typeof window.RELATION_LANGUAGE !== 'undefined') {
            window.RELATION_LANGUAGE = lang;
        }
        
        const display = document.getElementById('lang-display');
        if (display) display.textContent = lang.toUpperCase();

        const toast = document.getElementById('language-selection-toast');
        if (toast) {
            toast.classList.remove('show');
        }

        if (activePersonId) {
            drawTree(activePersonId);
        }
        
        if (window.showToast) window.showToast(`Language set to ${lang.toUpperCase()}`);
    };

    // Initialize language display
    const initLang = localStorage.getItem('relation_language') || 'kn';
    const initLangDisplay = document.getElementById('lang-display');
    if (initLangDisplay) initLangDisplay.textContent = initLang.toUpperCase();

    // =================================================================================
    // SECTION 5.14: REFRESH DATA (Clear Cache & Reload)
    // =================================================================================

    window.refreshFamilyData = async function(skipConfirm = false) {
        if (!skipConfirm) {
            const confirmed = confirm("Refresh Family Data?\n\nThis will clear offline storage and fetch the latest data from the server.");
            if (!confirmed) return;
        }

        if (window.showToast) window.showToast("Clearing cache and reloading...", 5000);

        try {
            // 1. Unregister Service Workers
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    await registration.unregister();
                }
            }

            // 2. Clear Cache Storage
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
            }

            // 3. Force Reload
            window.location.reload(true);
        } catch (error) {
            console.error("Data refresh failed:", error);
            window.location.reload();
        }
    };

    // =================================================================================
    // SECTION 5.15: AUTO UPDATE CHECK
    // =================================================================================

    function initAutoUpdateCheck() {
        if (!APP_CONFIG || !APP_CONFIG.updates_url) return;

        const check = async () => {
            try {
                // Fetch updates CSV to find the latest timestamp
                const res = await fetch(APP_CONFIG.updates_url + '&t=' + Date.now());
                if (!res.ok) return;
                const text = await res.text();
                
                const rows = text.split(/\r?\n/);
                let latestDate = 0;
                
                // Parse CSV (skip header)
                for (let i = 1; i < rows.length; i++) {
                    const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                    if (cols.length > 0) {
                        const dateStr = cols[0].replace(/^"|"$/g, '').trim();
                        const d = window.DateUtils ? window.DateUtils.parse(dateStr) : null;
                        if (d && d.getTime() > latestDate) {
                            latestDate = d.getTime();
                        }
                    }
                }

                if (latestDate > 0) {
                    const lastKnown = localStorage.getItem('last_data_update');
                    if (lastKnown) {
                        if (latestDate > parseInt(lastKnown, 10)) {
                            showUpdateNotification(latestDate);
                        }
                    } else {
                        // First run or missing local data: assume current is latest
                        localStorage.setItem('last_data_update', latestDate);
                    }
                }
            } catch (e) {
                console.warn('[AutoUpdate] Check failed:', e);
            }
        };

        // Initial check after 5 seconds
        setTimeout(check, 5000);
        // Poll every 10 minutes
        setInterval(check, 600000);
    }

    function showUpdateNotification(newTimestamp) {
        const bar = document.getElementById('update-notification');
        if (!bar) return;
        // Don't show if dismissed in this session
        if (sessionStorage.getItem('update_dismissed') === String(newTimestamp)) return;

        bar.style.display = 'flex';
        
        const btn = document.getElementById('update-now-btn');
        btn.onclick = () => {
            // Update local version before reloading so we don't notify again immediately
            localStorage.setItem('last_data_update', newTimestamp);
            window.refreshFamilyData(true); // true = skip confirm
        };

        const dismiss = document.getElementById('update-dismiss-btn');
        dismiss.onclick = () => {
            bar.style.display = 'none';
            sessionStorage.setItem('update_dismissed', String(newTimestamp));
        };
    }

    // =================================================================================
    // SECTION 6: INITIAL APPLICATION START
    // =================================================================================
    
    // 1. Fetch Family Data, then Photos, then Draw Tree
    // 1. Fetch and adapt all data, then draw the tree
    loadNewDatabase()
        .then(data => {
            PEOPLE = data;
            buildLookups();
            setupLongPressHandlers();
            const photosPath = (APP_CONFIG && APP_CONFIG.data_files) ? APP_CONFIG.data_files.photos : 'json_data/photos.json';
            return fetch(toAppPath(photosPath));
        })
        .then(response => response.json())
        .then(photoData => {
            // Update peopleMap with image URLs from the JSON file
            for (const [id, url] of Object.entries(photoData)) {
                if (peopleMap.has(id)) {
                    peopleMap.get(id).image_url = toAppPath(url);
                }
            }
        })
        .catch(err => console.warn('Error loading data:', err))
        .finally(() => {
            // Draw the tree whether photos loaded successfully or not
            try {
                // Populate Dashboard Data
                updateDashboard();
                
                // Show Dashboard by default unless disabled in config
                if (APP_CONFIG && APP_CONFIG.features && APP_CONFIG.features.dashboard === false) {
                    window.showTreePage();
                } else {
                    window.showDashboard();
                }
            } catch (e) {
                console.error("Error during initial draw:", e);
            }

            // Start background update checker
            initAutoUpdateCheck();
        });
});
