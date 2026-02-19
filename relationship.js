/**
 * =====================================================================================
 * Relationship Logic & Report Engine (relationship.js)
 * =====================================================================================
 */
console.log("relationship.js loaded");

// --- Language Configuration ---
window.RELATION_LANGUAGE = localStorage.getItem('relation_language') || 'te';

function getTerm(entryValue) {
    if (!entryValue) return "";
    if (typeof entryValue === 'string') return entryValue; // Backward compatibility
    return entryValue[window.RELATION_LANGUAGE] || entryValue['te'] || "";
}

function getHomeId() { return window.HOME_PERSON_ID; }

// --- Helper Accessors ---
function getPerson(id) { return (window.peopleMap && window.peopleMap.has(id)) ? window.peopleMap.get(id) : null; }
function getChildrenIds(id) { return (window.childrenMap && window.childrenMap.has(id)) ? window.childrenMap.get(id) : []; }
function getGender(id) { return (window.genderMap && window.genderMap.has(id)) ? window.genderMap.get(id) : 'U'; }

// Safe name accessor to prevent crashes
function safeName(id) {
    const p = getPerson(id);
    return p ? p.name : "Unknown";
}

function getSiblings(id) {
    const person = getPerson(id);
    if (!person) return [];
    const siblings = new Set();
    if (person.fid && window.childrenMap && window.childrenMap.has(person.fid)) {
        window.childrenMap.get(person.fid).forEach(c => siblings.add(c));
    }
    if (person.mid && window.childrenMap && window.childrenMap.has(person.mid)) {
        window.childrenMap.get(person.mid).forEach(c => siblings.add(c));
    }
    siblings.delete(id);
    return Array.from(siblings);
}

function getParents(id) {
    const p = getPerson(id);
    if (!p) return [];
    const parents = [];
    if (p.fid) parents.push({ id: p.fid, role: 'Father' });
    if (p.mid) parents.push({ id: p.mid, role: 'Mother' });
    return parents;
}

function getGrandParents(id) {
    const p = getPerson(id);
    if (!p) return [];
    const gps = [];
    
    if (p.fid) {
        const father = getPerson(p.fid);
        if (father) {
            if (father.fid) gps.push({ id: father.fid, role: 'Paternal Grandfather' });
            if (father.mid) gps.push({ id: father.mid, role: 'Paternal Grandmother' });
        }
    }
    if (p.mid) {
        const mother = getPerson(p.mid);
        if (mother) {
            if (mother.fid) gps.push({ id: mother.fid, role: 'Maternal Grandfather' });
            if (mother.mid) gps.push({ id: mother.mid, role: 'Maternal Grandmother' });
        }
    }
    return gps;
}

// --- NEW: Relationship Calculation Engine ---

/**
 * Calculates the shortest relationship path and returns a code.
 * Codes: F (Father), M (Mother), S (Son), D (Daughter), B (Brother), Z (Sister), H (Husband), W (Wife)
 */
function getRelationshipCode(homeId, targetId) {
    if (!homeId || !targetId) return null;
    if (homeId === targetId) return { code: "SELF", path: [homeId] };

    // BFS Queue: { id, code, path }
    let queue = [{ id: homeId, code: "", path: [homeId] }];
    let visited = new Set([homeId]);

    // Limit depth to prevent performance issues on large graphs
    const MAX_DEPTH = 100; 

    while (queue.length > 0) {
        let curr = queue.shift();

        if (curr.id === targetId) {
            return { 
                code: normalizeCode(curr.code), 
                path: curr.path 
            };
        }
        
        if (curr.path.length > MAX_DEPTH) continue;

        const p = getPerson(curr.id);
        if (!p) continue;

        // Helper to add neighbor to queue
        const add = (nextId, relChar) => {
            if (!visited.has(nextId)) {
                visited.add(nextId);
                queue.push({
                    id: nextId,
                    code: curr.code + relChar,
                    path: [...curr.path, nextId]
                });
            }
        };

        // 1. Parents (F/M)
        if (p.fid) add(p.fid, 'F');
        if (p.mid) add(p.mid, 'M');

        // 2. Children (S/D)
        const children = getChildrenIds(curr.id);
        children.forEach(childId => {
            const g = getGender(childId);
            add(childId, g === 'M' ? 'S' : (g === 'F' ? 'D' : 'C'));
        });

        // 3. Spouses (H/W)
        if (p.pids) {
            p.pids.forEach(pid => {
                const g = getGender(pid);
                add(pid, g === 'M' ? 'H' : (g === 'F' ? 'W' : 'P'));
            });
        }

        // 4. Siblings (B/Z) - Treated as 1 step for cleaner codes
        const sibs = getSiblings(curr.id);
        sibs.forEach(sibId => {
            const g = getGender(sibId);
            add(sibId, g === 'M' ? 'B' : (g === 'F' ? 'Z' : 'Sib'));
        });
    }

    return null;
}

function normalizeCode(raw) {
    if (!raw) return "";
    let code = raw;
    let prev;
    
    // Iteratively reduce Parent + Child -> Sibling
    do {
        prev = code;
        code = code.replace(/FS/g, 'B');
        code = code.replace(/FD/g, 'Z');
        code = code.replace(/MS/g, 'B');
        code = code.replace(/MD/g, 'Z');

        // Parallel Cousins (Father's Brother's children / Mother's Sister's children) => Siblings
        // This handles deep nesting like FFBSS -> F(FBS)S -> F(B)S -> FBS -> B
        code = code.replace(/FBS/g, 'B');
        code = code.replace(/FBD/g, 'Z');
        code = code.replace(/MZS/g, 'B');
        code = code.replace(/MZD/g, 'Z');

        // Grandparent Parallel Siblings -> Grandparents
        // This handles deep ancestry like FFBSS -> FFSS -> FBS -> B
        code = code.replace(/FFB/g, 'FF');
        code = code.replace(/MMZ/g, 'MM');
        code = code.replace(/MFB/g, 'MF');
        code = code.replace(/FMZ/g, 'FM');
    } while (code !== prev);

    return code;
}

/**
 * Helper to expand abbreviation codes into readable strings.
 * e.g., SSWB -> Son's-Son's-Wife's-Brother
 */
function expandCode(code) {
    if (!code) return "";
    if (code === 'SELF') return "Self";

    const map = {
        'F': "Father", 'M': "Mother",
        'S': "Son", 'D': "Daughter",
        'B': "Brother", 'Z': "Sister",
        'H': "Husband", 'W': "Wife"
    };
    
    let parts = [];
    for (const char of code) {
        parts.push(map[char] || char);
    }
    
    if (parts.length === 0) return code;
    if (parts.length === 1) return parts[0];
    
    return parts.map((p, i) => i < parts.length - 1 ? p + "'s" : p).join("-");
}

/**
 * Resolves a relationship code to a display string using the dictionary.
 */
function resolveRelationName(result, homePerson, targetPerson) {
    if (!result) return "Unknown";
    const { code, path } = result;

    const dict = window.relationshipDictionary || {};
    const entry = dict[code];

    // If no exact match in dictionary, return the code itself
    if (!entry) return expandCode(code);

    // 1. Direct Name
    if (entry.name) return getTerm(entry.name);

    // 2. Gender-based Name
    if (entry.male || entry.female) {
        const g = getGender(targetPerson.id);
        if (g === 'M' && entry.male) return getTerm(entry.male);
        if (g === 'F' && entry.female) return getTerm(entry.female);
    }

    // 3. Age-based Rules
    if (entry.ageRule) {
        // Rule: pedda_chinna (e.g., for FB - Father's Brother)
        // Logic: Compare Target vs Home's Parent (who is Target's Sibling)
        if (entry.ageRule === 'pedda_chinna' && path.length >= 3) {
            const parentId = path[path.length - 2]; // The node before target
            const parent = getPerson(parentId);
            const comparison = compareAge(targetPerson, parent);
            
            if (comparison === 'older') return getTerm(entry.pedda || entry.elder);
            if (comparison === 'younger') return getTerm(entry.chinna || entry.younger);
            
            // Fallback if ages unknown
            return getTerm(entry.pedda || entry.elder) + "/" + getTerm(entry.chinna || entry.younger);
        }

        // Rule: sibling_child (e.g., for BS - Brother's Son)
        // Logic: Compare Home vs Sibling (who is Target's Parent)
        if (entry.ageRule === 'sibling_child' && path.length >= 3) {
            const siblingId = path[path.length - 2]; // The node before target
            const sibling = getPerson(siblingId);
            const comparison = compareAge(sibling, homePerson);
            
            if (comparison === 'older') return getTerm(entry.elder);
            if (comparison === 'younger') return getTerm(entry.younger);
            return getTerm(entry.elder) + "/" + getTerm(entry.younger);
        }

        // Rule: vadina_maradalu (e.g., for BW - Brother's Wife)
        // Logic: Compare Home vs Sibling (who is Target's Spouse)
        if (entry.ageRule === 'vadina_maradalu' && path.length >= 3) {
            const siblingId = path[path.length - 2]; // The node before target
            const sibling = getPerson(siblingId);
            const comparison = compareAge(sibling, homePerson); // Is sibling older than me?
            
            if (comparison === 'older') return getTerm(entry.elder); // Older brother's wife -> Vadina
            if (comparison === 'younger') return getTerm(entry.younger); // Younger brother's wife -> Maradalu
            
            return getTerm(entry.elder) + "/" + getTerm(entry.younger);
        }

        // Rule: direct_age (e.g., for B, Z, WB, WZ)
        // Logic: Compare Target vs Home Person directly
        if (entry.ageRule === 'direct_age') {
            const comparison = compareAge(targetPerson, homePerson);
            if (comparison === 'older') return getTerm(entry.elder);
            if (comparison === 'younger') return getTerm(entry.younger);
            return getTerm(entry.default) || (getTerm(entry.elder) + "/" + getTerm(entry.younger));
        }

        // Rule: parent_age_compare (e.g., for WZS - Wife's Sister's Son)
        // Logic: Compare Target's Parent (e.g., WZ) vs Home Person
        if (entry.ageRule === 'parent_age_compare' && path.length >= 2) {
            const parentId = path[path.length - 2]; // The node before target
            const parent = getPerson(parentId);
            const comparison = compareAge(parent, homePerson);
            if (comparison === 'older') return getTerm(entry.elder);
            if (comparison === 'younger') return getTerm(entry.younger);
            return getTerm(entry.default) || (getTerm(entry.elder) + "/" + getTerm(entry.younger));
        }
    }

    return code;
}

/**
 * Helper to compare ages.
 * Returns 'older', 'younger', or null.
 */
function compareAge(p1, p2) {
    if (!p1 || !p2 || !p1.Birth || !p2.Birth) return null;
    
    const d1 = parseDate(p1.Birth);
    const d2 = parseDate(p2.Birth);
    
    if (!d1 || !d2) return null;
    
    // Earlier birth date = Older person
    if (d1 < d2) return 'older';
    if (d1 > d2) return 'younger';
    return 'same';
}

// --- Main Entry Point ---

function findRelationship(id1, id2) {
    const p1 = getPerson(id1);
    const p2 = getPerson(id2);
    
    if (!p1 || !p2) return "Unknown";

    // 1. Calculate Code
    const result = getRelationshipCode(id1, id2);
    
    // 2. Resolve Name
    return resolveRelationName(result, p1, p2);
}

// =================================================================================
// REPORT GENERATION LOGIC
// =================================================================================

function generateRelationshipReport(customHomeId) {
    const id = customHomeId || getHomeId();
    const p = getPerson(id);
    if (!p) return "<p style='text-align:center; padding:20px; color:red;'>Home person not found or data not loaded yet.</p>";

    let html = `<div style="padding: 20px; max-width: 800px; margin: 0 auto; font-family: 'Segoe UI', sans-serif;">`;
    
    html += `<div style="text-align: center; margin-bottom: 10px;"><img src="logo.png" style="width: 80px; height: auto; border: none;"></div>`;
    html += `<h2 style="color: #4A90E2; border-bottom: 2px solid #eee; padding-bottom: 10px; text-align: center;">Relationship Report</h2>`;
    html += `<p style="color: #666; text-align: center;">Centered on: <strong>${p.name}</strong> (${p.id})</p>`;

    // 1. SELF
    html += renderSection("SELF", [{ id: p.id, name: p.name }], id);

    // 2. PARENTS
    const parents = getParents(id).map(x => ({ ...x, name: safeName(x.id) }));
    html += renderSection("PARENTS", parents, id);

    // 3. GRANDPARENTS
    const gps = getGrandParents(id).map(x => ({ ...x, name: safeName(x.id) }));
    html += renderSection("GRANDPARENTS", gps, id);

    // 4. SIBLINGS
    const siblings = getSiblings(id).map(sid => ({ id: sid, name: safeName(sid) }));
    html += renderSection("SIBLINGS", siblings, id);

    // 5. SIBLINGS CHILDREN
    if (siblings.length > 0) {
        let sibChildrenList = [];
        siblings.forEach(sib => {
            const kids = getChildrenIds(sib.id);
            if (kids.length > 0) {
                sibChildrenList.push({ 
                    header: `Children of ${sib.name}`, 
                    items: kids.map(k => ({ id: k, name: safeName(k) })) 
                });
            }
        });
        html += renderComplexSection("SIBLINGS' CHILDREN", sibChildrenList, id);
    }

    // 6. CHILDREN
    const children = getChildrenIds(id).map(cid => ({ id: cid, name: safeName(cid) }));
    html += renderSection("CHILDREN", children, id);

    // 7. GRANDCHILDREN
    if (children.length > 0) {
        let grandChildrenList = [];
        children.forEach(child => {
            const kids = getChildrenIds(child.id);
            if (kids.length > 0) {
                grandChildrenList.push({ 
                    header: `Children of ${child.name}`, 
                    items: kids.map(k => ({ id: k, name: safeName(k) })) 
                });
            }
        });
        html += renderComplexSection("GRANDCHILDREN", grandChildrenList, id);
    }

    // 8. SPOUSE SIDE
    if (p.pids && p.pids.length > 0) {
        let spouseSideHtml = `<h3 style="background: #f0f7ff; padding: 10px; border-left: 4px solid #E91E63; margin-top: 30px; color: #333;">SPOUSE SIDE</h3>`;
        
        p.pids.forEach(pid => {
            const spouse = getPerson(pid);
            if (!spouse) return;
            
            const spouseRel = findRelationship(id, pid);
            spouseSideHtml += `<div style="margin-left: 15px; margin-bottom: 25px; border-bottom: 1px dashed #ccc; padding-bottom: 15px;">`;
            spouseSideHtml += `<h4 style="color: #E91E63; margin-bottom: 10px;">Spouse: ${spouse.name} — ${spouseRel}</h4>`;

            // Spouse Parents
            const sParents = getParents(pid).map(x => ({ ...x, name: safeName(x.id) }));
            spouseSideHtml += renderSubList("Parents", sParents, id);

            // Spouse Grandparents
            const sGps = getGrandParents(pid).map(x => ({ ...x, name: safeName(x.id) }));
            spouseSideHtml += renderSubList("Grandparents", sGps, id);

            // Spouse Siblings
            const sSibs = getSiblings(pid).map(sid => ({ id: sid, name: safeName(sid) }));
            spouseSideHtml += renderSubList("Siblings", sSibs, id);

            // Spouse Siblings Children
            if (sSibs.length > 0) {
                let sSibKidsHtml = "";
                sSibs.forEach(sib => {
                    const kids = getChildrenIds(sib.id);
                    if (kids.length > 0) {
                        sSibKidsHtml += `<div style="margin-left: 20px; font-size: 14px; color: #555;"><em>Children of ${sib.name}:</em></div>`;
                        sSibKidsHtml += `<ul style="margin-top: 5px; margin-bottom: 10px;">`;
                        kids.forEach(k => {
                            let relation = findRelationship(id, k);
                            sSibKidsHtml += `<li style="margin-bottom: 4px;">
                                <strong>${safeName(k)}</strong> 
                                <span style="color:#E91E63; font-size:13px;"> — ${relation}</span>
                            </li>`;
                        });
                        sSibKidsHtml += `</ul>`;
                    }
                });
                if (sSibKidsHtml) {
                    spouseSideHtml += `<div style="font-weight: bold; margin-top: 10px; color: #444;">Siblings' Children:</div>`;
                    spouseSideHtml += sSibKidsHtml;
                }
            }
            
            spouseSideHtml += `</div>`;
        });
        html += spouseSideHtml;
    }

    html += `</div>`;
    return html;
}

function renderSection(title, items, homeId) {
    if (!items || items.length === 0) return "";
    const hId = homeId || getHomeId();
    let h = `<h3 style="background: #f9f9f9; padding: 8px; border-left: 4px solid #4A90E2; margin-top: 20px; font-size: 16px; color: #333;">${title}</h3>`;
    h += `<ul style="list-style-type: disc; padding-left: 25px; margin-top: 5px;">`;
    items.forEach(item => {
        let relation = findRelationship(hId, item.id);
        h += `<li style="margin-bottom: 4px;">
        <strong>${item.name}</strong> 
        <span style="color:#E91E63; font-size:13px;"> — ${relation}</span>
        </li>`;
    });
    h += `</ul>`;
    return h;
}

function generateAncestorsReport(id) {
    const p = getPerson(id);
    if (!p) return "<p style='text-align:center; padding:20px; color:red;'>Person not found.</p>";

    let html = `<div style="padding: 20px; max-width: 800px; margin: 0 auto; font-family: 'Segoe UI', sans-serif;">`;
    
    html += `<div style="text-align: center; margin-bottom: 10px;"><img src="logo.png" style="width: 80px; height: auto; border: none;"></div>`;
    html += `<h2 style="color: #4A90E2; border-bottom: 2px solid #eee; padding-bottom: 10px; text-align: center;">Ancestors Report</h2>`;
    html += `<p style="color: #666; text-align: center;">Ancestors of: <strong>${p.name}</strong> (${p.id})</p>`;

    let currentGenIds = [];
    if (p.fid) currentGenIds.push(p.fid);
    if (p.mid) currentGenIds.push(p.mid);

    let genIndex = 1;

    while (currentGenIds.length > 0) {
        let genTitle = "";
        if (genIndex === 1) genTitle = "Parents";
        else if (genIndex === 2) genTitle = "Grandparents";
        else if (genIndex === 3) genTitle = "Great-Grandparents";
        else genTitle = `${"Great-".repeat(genIndex - 2)}Grandparents`;

        html += `<h3 style="background: #f9f9f9; padding: 8px; border-left: 4px solid #4A90E2; margin-top: 20px; font-size: 16px; color: #333;">${genTitle}</h3>`;
        html += `<ul style="list-style-type: disc; padding-left: 25px; margin-top: 5px;">`;

        let nextGenIds = [];
        
        currentGenIds.forEach(ancId => {
            const anc = getPerson(ancId);
            if (anc) {
                const g = getGender(ancId);
                let role = "";
                if (genIndex === 1) role = (g === 'M' ? "Father" : "Mother");
                else if (genIndex === 2) role = (g === 'M' ? "Grandfather" : "Grandmother");
                else {
                    const greats = "Great-".repeat(genIndex - 2);
                    role = greats + (g === 'M' ? "Grandfather" : "Grandmother");
                }

                let displayRole = role;
                const relObj = getRelationshipCode(id, ancId);
                if (relObj) {
                    const dict = window.relationshipDictionary || {};
                    let extra = "";
                    if (dict[relObj.code]) {
                        extra = resolveRelationName(relObj, getPerson(id), anc);
                    } else {
                        extra = relObj.code;
                    }
                    if (extra) displayRole += ` (${extra})`;
                }

                html += `<li style="margin-bottom: 4px;">
                    <strong>${anc.name}</strong> 
                    <span style="color:#E91E63; font-size:13px;"> — ${displayRole}</span>
                </li>`;

                if (anc.fid) nextGenIds.push(anc.fid);
                if (anc.mid) nextGenIds.push(anc.mid);
            }
        });

        html += `</ul>`;
        currentGenIds = nextGenIds;
        genIndex++;
        
        if (genIndex > 20) break; // Safety break
    }

    if (genIndex === 1) {
        html += `<p style="text-align:center; margin-top:20px; color:#666;">No ancestors recorded for this person.</p>`;
    }

    html += `</div>`;
    return html;
}

function generateDescendantsReport(id) {
    const p = getPerson(id);
    if (!p) return "<p style='text-align:center; padding:20px; color:red;'>Person not found.</p>";

    let html = `<div style="padding: 20px; max-width: 800px; margin: 0 auto; font-family: 'Segoe UI', sans-serif;">`;
    
    html += `<div style="text-align: center; margin-bottom: 10px;"><img src="logo.png" style="width: 80px; height: auto; border: none;"></div>`;
    html += `<h2 style="color: #4A90E2; border-bottom: 2px solid #eee; padding-bottom: 10px; text-align: center;">Descendants Report</h2>`;
    html += `<p style="color: #666; text-align: center;">Descendants of: <strong>${p.name}</strong> (${p.id})</p>`;

    let currentGenIds = getChildrenIds(id);
    let genIndex = 1;

    while (currentGenIds.length > 0) {
        let genTitle = "";
        if (genIndex === 1) genTitle = "Children";
        else if (genIndex === 2) genTitle = "Grandchildren";
        else if (genIndex === 3) genTitle = "Great-Grandchildren";
        else genTitle = `${"Great-".repeat(genIndex - 2)}Grandchildren`;

        html += `<h3 style="background: #f9f9f9; padding: 8px; border-left: 4px solid #4A90E2; margin-top: 20px; font-size: 16px; color: #333;">${genTitle}</h3>`;
        html += `<ul style="list-style-type: disc; padding-left: 25px; margin-top: 5px;">`;

        let nextGenIds = [];
        
        currentGenIds.forEach(descId => {
            const desc = getPerson(descId);
            if (desc) {
                const g = getGender(descId);
                let role = "";
                if (genIndex === 1) role = (g === 'M' ? "Son" : (g === 'F' ? "Daughter" : "Child"));
                else if (genIndex === 2) role = (g === 'M' ? "Grandson" : (g === 'F' ? "Granddaughter" : "Grandchild"));
                else {
                    const greats = "Great-".repeat(genIndex - 2);
                    role = greats + (g === 'M' ? "Grandson" : (g === 'F' ? "Granddaughter" : "Grandchild"));
                }

                let displayRole = role;
                const relObj = getRelationshipCode(id, descId);
                if (relObj) {
                    const dict = window.relationshipDictionary || {};
                    let extra = "";
                    if (dict[relObj.code]) {
                        extra = resolveRelationName(relObj, getPerson(id), desc);
                    } else {
                        extra = relObj.code;
                    }
                    if (extra) displayRole += ` (${extra})`;
                }

                html += `<li style="margin-bottom: 4px;">
                    <strong>${desc.name}</strong> 
                    <span style="color:#E91E63; font-size:13px;"> — ${displayRole}</span>
                </li>`;

                const kids = getChildrenIds(descId);
                if (kids) nextGenIds.push(...kids);
            }
        });

        html += `</ul>`;
        currentGenIds = nextGenIds;
        genIndex++;
        
        if (genIndex > 20) break; // Safety break
    }

    if (genIndex === 1) {
        html += `<p style="text-align:center; margin-top:20px; color:#666;">No descendants recorded for this person.</p>`;
    }

    html += `</div>`;
    return html;
}

// =================================================================================
// DIAGRAM GENERATION
// =================================================================================

function generateDiagramHTML(id1, id2) {
    const p1 = getPerson(id1);
    const p2 = getPerson(id2);
    
    if (!p1 || !p2) return "<p>Person not found.</p>";

    // 1. Get Path
    const result = getRelationshipCode(id1, id2);
    if (!result || !result.path || result.path.length === 0) {
        return `<div style="text-align:center; padding:20px;">
            <h3>No direct relationship path found.</h3>
            <p>Try connecting them through a common ancestor manually.</p>
        </div>`;
    }

    const path = result.path; // Array of IDs [Start, ..., End]
    
    // --- 0. Check for Sibling Bridge (Sibling Pivot) ---
    // If the path steps sideways via a sibling relationship (e.g. Grandfather <-> Great Uncle),
    // we use a specific layout for that.
    let siblingIndex = -1;
    for (let i = 0; i < path.length - 1; i++) {
        const u = path[i];
        const v = path[i+1];
        const sibs = getSiblings(u);
        if (sibs.includes(v)) {
            siblingIndex = i;
            break;
        }
    }

    // Helper to determine label (Name or Code) for the diagram node
    const getDiagramLabel = (targetId) => {
        const r = getRelationshipCode(id1, targetId);
        if (!r) return "";
        if (r.code === 'SELF') return "Self";
        
        const dict = window.relationshipDictionary || {};
        // If in dictionary (e.g. Uncle) or simple 1-char code (F, M), use full name
        if (dict[r.code] || r.code.length <= 1) {
            return resolveRelationName(r, p1, getPerson(targetId));
        }
        
        // Otherwise use the Code (e.g. FFZDSW) to save space in the box
        return r.code;
    };

    // Helper to render a single node card
    const renderNode = (id, roleLabel) => {
        const p = getPerson(id);
        
        // Format Name: SRIKANTH DHARMAVARAM -> SRIKANTH.D
        let displayName = p.name || "";
        const parts = displayName.trim().split(/\s+/);
        if (parts.length > 1) {
            const firstName = parts.slice(0, -1).join(" ");
            const lastInitial = parts[parts.length - 1].charAt(0);
            displayName = `${firstName}.${lastInitial}`;
        }

        let mediaHtml = '';
        if (p.image_url) {
            mediaHtml = `<img src="${p.image_url}">`;
        } else {
            const g = getGender(id);
            const MALE_ICON = '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="#4A90E2"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
            const FEMALE_ICON = '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="#E91E63"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
            const svg = (g === 'F') ? FEMALE_ICON : MALE_ICON;
            mediaHtml = `<div style="width:50px; height:50px; margin-bottom:5px; border-radius:50%; border:1px solid #ddd; background:#fff; overflow:hidden;">${svg}</div>`;
        }

        // Change SELF to ME
        let displayRole = roleLabel;
        if (id === id1) displayRole = "ME";

        return `
            <div class="ca-node-wrapper">
                <div class="ca-node">
                    ${displayRole ? `<div class="ca-node-role">${displayRole}</div>` : ''}
                    ${mediaHtml}
                    <div class="ca-node-name">${displayName}</div>
                    <div class="ca-node-id">${p.id}</div>
                </div>
            </div>`;
    };

    let html = `<div style="padding: 20px; max-width: 800px; margin: 0 auto; font-family: 'Segoe UI', sans-serif;">`;
    html += `<div style="text-align: center; margin-bottom: 20px;">
                <img src="logo.png" alt="Logo" style="width: 80px; height: auto; border: none; margin-bottom: 10px; display: inline-block;">
                <h2 style="color: #4A90E2; margin:0;">Relationship Diagram</h2>
                <p style="color: #666;">${p1.name} ➡ ${p2.name}</p>
             </div>`;
    html += `<div class="ca-diagram">`;

    if (siblingIndex !== -1) {
        // --- SIBLING BRIDGE LAYOUT ---
        const sib1Id = path[siblingIndex];
        const sib2Id = path[siblingIndex + 1];
        
        // Left Branch: From Sibling 1 down to Start
        const leftNodes = path.slice(0, siblingIndex).reverse();
        // Right Branch: From Sibling 2 down to End
        const rightNodes = path.slice(siblingIndex + 2);

        html += `<div class="ca-sibling-container">`;

        // Left Side (Sibling 1 + Descendants)
        html += `<div class="ca-sibling-side">`;
        html += renderNode(sib1Id, getDiagramLabel(sib1Id)); // Label relative to Start
        if (leftNodes.length > 0) {
            html += `<div class="ca-single-col">`;
            let parentId = sib1Id;
            leftNodes.forEach(nodeId => {
                html += renderNode(nodeId, getDiagramLabel(nodeId));
                parentId = nodeId;
            });
            html += `</div>`;
        }
        html += `</div>`; // End Left Side

        // Right Side (Sibling 2 + Descendants)
        html += `<div class="ca-sibling-side">`;
        html += renderNode(sib2Id, getDiagramLabel(sib2Id)); // Label relative to Start
        if (rightNodes.length > 0) {
            html += `<div class="ca-single-col">`;
            let parentId = sib2Id;
            rightNodes.forEach(nodeId => {
                html += renderNode(nodeId, getDiagramLabel(nodeId));
                parentId = nodeId;
            });
            html += `</div>`;
        }
        html += `</div>`; // End Right Side

        html += `</div>`; // End ca-sibling-container

    } else {
        // --- COMMON ANCESTOR LAYOUT (Existing Logic) ---
        
    // --- 1. Identify Pivot (Common Ancestor) ---
    // We calculate the relative generation level of each node.
    // Start = 0. Parent = +1. Child = -1. Sibling/Spouse = 0.
    let generations = [0];
    let currentGen = 0;
    
    for (let i = 0; i < path.length - 1; i++) {
        const curr = path[i];
        const next = path[i+1];
        const pNext = getPerson(next);
        
        if (pNext.fid === curr || pNext.mid === curr) {
            // Next is child of Current -> Going DOWN
            currentGen--;
        } else if (getPerson(curr).fid === next || getPerson(curr).mid === next) {
            // Next is parent of Current -> Going UP
            currentGen++;
        }
        // Else (Spouse/Sibling) -> Level stays same
        generations.push(currentGen);
    }

    // Find the index with the highest generation (The Pivot)
    let maxGen = -999;
    let pivotIndex = 0;
    generations.forEach((gen, idx) => {
        if (gen > maxGen) {
            maxGen = gen;
            pivotIndex = idx;
        }
    });

    const pivotId = path[pivotIndex];
    const pivotPerson = getPerson(pivotId);

    // --- 2. Split Path into Branches ---
    // Left Branch: From Pivot down to Start (path[0])
    // Right Branch: From Pivot down to End (path[length-1])
    
    // Slice excludes pivot from the list to avoid duplication in rendering
    const leftNodes = path.slice(0, pivotIndex).reverse(); 
    const rightNodes = path.slice(pivotIndex + 1);

    // Render Pivot
    html += `<div class="ca-pivot-wrapper">
                ${renderNode(pivotId, getDiagramLabel(pivotId))}
             </div>`;

    // Render Branches Container
    html += `<div class="ca-branches">`;

    // Left Column
    if (leftNodes.length > 0) {
        // If right is empty (linear descendant case), treat as single column
        const branchClass = rightNodes.length === 0 ? "ca-single-col left-stack" : "ca-branch left";
        html += `<div class="${branchClass}">`;
        // Iterate: Pivot -> Child -> ... -> Start
        // We need to label the relationship relative to the node ABOVE it.
        // For leftNodes[0], parent is Pivot.
        let parentId = pivotId;
        leftNodes.forEach(nodeId => {
            html += renderNode(nodeId, getDiagramLabel(nodeId));
            parentId = nodeId;
        });
        html += `</div>`;
    }

    // Right Column
    if (rightNodes.length > 0) {
        // If left is empty (linear ancestor case), we treat this as a single column centered
        const branchClass = leftNodes.length === 0 ? "ca-single-col" : "ca-branch right";
        html += `<div class="${branchClass}">`;
        
        let parentId = pivotId;
        rightNodes.forEach(nodeId => {
            html += renderNode(nodeId, getDiagramLabel(nodeId));
            parentId = nodeId;
        });
        html += `</div>`;
    }

    } // End else (Common Ancestor)

    html += `</div>`; // End ca-branches
    html += `</div>`; // End ca-diagram

    // Final Summary Sentence
    const finalRel = findRelationship(id1, id2);
    html += `<div style="text-align:center; margin-top:30px; font-size:18px; color:#333; padding: 15px; background: #f9f9f9; border-radius: 8px;">
                <strong>${p2.name}</strong> is your <strong>${finalRel}</strong>
                <div style="margin-top: 8px; font-size: 12px; color: #999; font-family: monospace;">Code: ${result.code}</div>
             </div>`;

    // Legend for Abbreviations
    html += `<div style="margin-top: 20px; padding: 15px; border-top: 1px solid #eee; font-size: 13px; color: #666; text-align: center; background: #fff;">
                <strong>Relationship Codes:</strong><br>
                <span style="display:inline-block; margin: 2px 5px;">M = Mother</span>
                <span style="display:inline-block; margin: 2px 5px;">F = Father</span>
                <span style="display:inline-block; margin: 2px 5px;">B = Brother</span>
                <span style="display:inline-block; margin: 2px 5px;">Z = Sister</span><br>
                <span style="display:inline-block; margin: 2px 5px;">S = Son</span>
                <span style="display:inline-block; margin: 2px 5px;">D = Daughter</span>
                <span style="display:inline-block; margin: 2px 5px;">W = Wife</span>
                <span style="display:inline-block; margin: 2px 5px;">H = Husband</span>
             </div>`;

    html += `</div>`;
    return html;
}

function getStepLabel(fromId, toId) {
    const fromP = getPerson(fromId);
    const toP = getPerson(toId);
    
    if (fromP.fid === toId) return "Father";
    if (fromP.mid === toId) return "Mother";
    
    if (toP.fid === fromId || toP.mid === fromId) {
        const g = getGender(toId);
        return g === 'M' ? "Son" : (g === 'F' ? "Daughter" : "Child");
    }
    
    if (fromP.pids && fromP.pids.includes(toId)) return "Spouse";
    
    // Sibling check
    const sibs = getSiblings(fromId);
    if (sibs.includes(toId)) {
        const g = getGender(toId);
        return g === 'M' ? "Brother" : (g === 'F' ? "Sister" : "Sibling");
    }
    
    return "Related";
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    const day = parseInt(parts[0], 10);
    const monthKey = parts[1].toUpperCase().slice(0, 3);
    const month = months[monthKey];
    let year = parseInt(parts[2], 10);
    if (year < 100) {
        const currentYear = new Date().getFullYear() % 100;
        year = year > (currentYear + 10) ? 1900 + year : 2000 + year;
    }
    if (month === undefined || isNaN(day) || isNaN(year)) return null;
    return new Date(year, month, day);
}

function getSiblingTerm(homeId, siblingId) {
    const home = getPerson(homeId);
    const sib = getPerson(siblingId);
    const sibGender = getGender(siblingId);
    
    let isElder = false;
    let unknownAge = true;
    
    if (home && sib && home.Birth && sib.Birth) {
        const hDate = parseDate(home.Birth);
        const sDate = parseDate(sib.Birth);
        if (hDate && sDate) {
            isElder = sDate < hDate;
            unknownAge = false;
        }
    }
    
    if (unknownAge) {
        return sibGender === 'M' 
            ? getTerm({ te: "అన్న/తమ్ముడు", kn: "ಅಣ್ಣ/ತಮ್ಮ", en: "Anna/Tamma" }) 
            : getTerm({ te: "అక్క/చెల్లి", kn: "ಅಕ್ಕ/ತಂಗಿ", en: "Akka/Tangi" });
    }
    
    if (sibGender === 'M') return isElder 
        ? getTerm({ te: "అన్న", kn: "ಅಣ್ಣ", en: "Anna" }) 
        : getTerm({ te: "తమ్ముడు", kn: "ತಮ್ಮ", en: "Tamma" });
        
    return isElder 
        ? getTerm({ te: "అక్క", kn: "ಅಕ್ಕ", en: "Akka" }) 
        : getTerm({ te: "చెల్లి", kn: "ತಂಗಿ", en: "Tangi" });
}

function renderComplexSection(title, groups, homeId) {
    if (!groups || groups.length === 0) return "";
    const hId = homeId || getHomeId();
    let h = `<h3 style="background: #f9f9f9; padding: 8px; border-left: 4px solid #4A90E2; margin-top: 20px; font-size: 16px; color: #333;">${title}</h3>`;
    groups.forEach(g => {
        h += `<div style="margin-top: 10px; font-weight: 600; color: #555; margin-left: 10px;">${g.header}</div>`;
        h += `<ul style="list-style-type: circle; padding-left: 40px; margin-top: 5px;">`;
        g.items.forEach(item => {
            let relation = findRelationship(hId, item.id);
            h += `<li style="margin-bottom: 4px;">
            ${item.name} 
            <span style="color:#E91E63; font-size:13px;"> — ${relation}</span>
            </li>`;
        });
        h += `</ul>`;
    });
    return h;
}

function renderSubList(label, items, homeId) {
    if (!items || items.length === 0) return "";
    const hId = homeId || getHomeId();
    let h = `<div style="font-weight: bold; margin-top: 10px; color: #444;">${label}:</div>`;
    h += `<ul style="margin-top: 5px; margin-bottom: 10px;">`;
    items.forEach(item => {
        let relation = findRelationship(hId, item.id);
        h += `<li style="margin-bottom: 4px;">
        <strong>${item.name}</strong> 
        <span style="color:#E91E63; font-size:13px;"> — ${relation}</span>
        </li>`;
    });
    h += `</ul>`;
    return h;
}
