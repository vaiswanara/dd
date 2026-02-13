if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => console.log('Service Worker Registered'));
}

const HOME_MEMBER_NAME = 'SRIKANTH DHARMAVARAM';

let allData = [];
let rootNodes = [];
let dataMap = {};
let photoMap = {};
let activeFocusId = null;
const spouseParentsExpanded = new Set();
let deferredPrompt; // For PWA install prompt

async function loadPhotoMap() {
    try {
        const response = await fetch('photo.json');
        if (!response.ok) throw new Error(`photo.json ${response.status}`);
        const map = await response.json();
        photoMap = map && typeof map === 'object' ? map : {};
    } catch (error) {
        console.log('photo.json load failed. Using initials only.', error);
        photoMap = {};
    }
}

window.addEventListener('DOMContentLoaded', () => {
    Promise.all([
        fetch('family_data.json').then(r => r.json()),
        loadPhotoMap(),
        fetchWelcomeMessage()
    ])
        .then(([jsonData]) => {
            allData = jsonData;
            rootNodes = buildHierarchy(allData);
            renderTree(rootNodes);

            // Check if user has set a custom Home Person
            const storedHomeId = localStorage.getItem('familyTree_homeId');
            if (storedHomeId && dataMap[storedHomeId]) {
                locateNode(storedHomeId);
            } else {
                const homeNode = Object.values(dataMap).find(n => n.name === HOME_MEMBER_NAME);
                if (homeNode) locateNode(homeNode.id);
            }
        })
        .catch(e => console.log('Auto-load failed. Use manual upload.', e));
});

async function fetchWelcomeMessage() {
    try {
        const response = await fetch('welcome.json');
        if (!response.ok) return;
        const messages = await response.json();
        if (messages && messages.length > 0) {
            // Show the last message in the list
            const latest = messages[messages.length - 1];
            document.getElementById('welcomeBanner').textContent = latest.Message;
        }
    } catch (e) {
        console.log('Welcome message load failed', e);
        document.getElementById('welcomeBanner').style.display = 'none';
    }
}

// Listen for PWA install event
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installAppBtn').style.display = 'flex';
});

document.getElementById('csvFileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        allData = parseCSV(text);
        rootNodes = buildHierarchy(allData);
        activeFocusId = null;
        renderTree(rootNodes);
    };
    reader.readAsText(file);
});

document.getElementById('searchInput').addEventListener('keyup', function(e) {
    if (e.key === 'Enter') searchNode(this.value);
});

const searchInput = document.getElementById('searchInput');
const searchDropdown = document.getElementById('searchDropdown');

searchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase();
    searchDropdown.innerHTML = '';
    if (query.length < 1) {
        searchDropdown.style.display = 'none';
        return;
    }

    const matches = Object.values(dataMap)
        .filter(p => p.name && p.name.toLowerCase().includes(query))
        .slice(0, 10);

    if (matches.length > 0) {
        matches.forEach(p => {
            const div = document.createElement('div');
            div.textContent = p.name;
            div.onclick = () => {
                searchInput.value = p.name;
                searchDropdown.style.display = 'none';
                locateNode(p.id);
            };
            searchDropdown.appendChild(div);
        });
        searchDropdown.style.display = 'block';
    } else {
        searchDropdown.style.display = 'none';
    }
});

document.addEventListener('click', function(e) {
    if (!document.querySelector('.search-box').contains(e.target) && !e.target.closest('.search-toggle-btn')) {
        searchDropdown.style.display = 'none';
    }
});

function parseCSV(text) {
    const lines = text.trim().split('\n');
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = [];
        let current = '';
        let inQuote = false;

        for (const char of line) {
            if (char === '"') { inQuote = !inQuote; continue; }
            if (char === ',' && !inQuote) {
                parts.push(current.trim());
                current = '';
                continue;
            }
            current += char;
        }
        parts.push(current.trim());

        if (parts.length < 2) continue;

        result.push({
            id: parts[0],
            name: parts[1],
            fid: parts[2] || null,
            mid: parts[3] || null,
            pids: parts[4]
                ? [...new Set(parts[4].split(',').map(s => s.trim()).filter(Boolean))]
                : []
        });
    }
    return result;
}

function buildHierarchy(flatData) {
    dataMap = {};
    flatData.forEach(node => {
        dataMap[node.id] = {
            ...node,
            children: [],
            linkedChildren: [],
            collapsed: true,
            parent: null,
            parents: []
        };
    });

    const roots = [];
    flatData.forEach(node => {
        const parentIds = [...new Set([node.fid, node.mid].filter(pid => pid && dataMap[pid]))];
        const displayParentId = parentIds[0] || null;

        if (parentIds.length > 0) {
            dataMap[node.id].parents = parentIds.map(pid => dataMap[pid]);
        }

        if (displayParentId && dataMap[displayParentId]) {
            dataMap[displayParentId].children.push(dataMap[node.id]);
            dataMap[node.id].parent = dataMap[displayParentId];
        } else {
            roots.push(dataMap[node.id]);
        }
    });

    // Keep display tree stable (one primary parent), but also attach each child to the other parent
    // so spouse-side descendants are reachable from both husband and wife branches.
    flatData.forEach(node => {
        const childNode = dataMap[node.id];
        if (!childNode) return;

        const hasFather = !!(node.fid && dataMap[node.fid]);
        const hasMother = !!(node.mid && dataMap[node.mid]);
        if (!hasFather || !hasMother) return;

        const displayParentId = childNode.parent ? childNode.parent.id : null;
        const fatherNode = dataMap[node.fid];
        const motherNode = dataMap[node.mid];

        if (displayParentId === fatherNode.id) {
            motherNode.linkedChildren.push(childNode);
        } else if (displayParentId === motherNode.id) {
            fatherNode.linkedChildren.push(childNode);
        } else {
            fatherNode.linkedChildren.push(childNode);
            motherNode.linkedChildren.push(childNode);
        }
    });

    return roots;
}

function getRenderableChildren(node) {
    if (!node) return [];
    const direct = Array.isArray(node.children) ? node.children : [];
    const linked = Array.isArray(node.linkedChildren) ? node.linkedChildren : [];
    const unique = new Map();

    direct.forEach(child => {
        if (child && child.id) unique.set(child.id, child);
    });
    linked.forEach(child => {
        if (child && child.id) unique.set(child.id, child);
    });

    return [...unique.values()];
}

function toggleNode(id) {
    if (dataMap[id]) {
        dataMap[id].collapsed = !dataMap[id].collapsed;
        renderTree(rootNodes);
    }
}

function centerNodeFamily(id) {
    const wrapper = document.getElementById('mainWrapper');
    const nodeEl = document.getElementById(`node-${id}`);
    if (!wrapper || !nodeEl) return;

    // Target the specific content container (Person + Spouse), ignoring the children list (<ul>)
    const contentEl = nodeEl.querySelector('.node-container');
    if (!contentEl) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const contentRect = contentEl.getBoundingClientRect();

    // Calculate center based only on the person/couple block
    const targetCenterX = contentRect.left + contentRect.width / 2;
    const targetCenterY = contentRect.top + contentRect.height / 2;

    const nextLeft = wrapper.scrollLeft + (targetCenterX - wrapperRect.left) - (wrapper.clientWidth / 2);
    const nextTop = wrapper.scrollTop + (targetCenterY - wrapperRect.top) - (wrapper.clientHeight / 2);

    wrapper.scrollTo({
        left: Math.max(0, nextLeft),
        top: Math.max(0, nextTop),
        behavior: 'smooth'
    });
}

function formatName(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1) {
        const firstPart = parts.slice(0, -1).join(' ');
        const lastPart = parts[parts.length - 1];
        return `${firstPart}.${lastPart.charAt(0)}`;
    }
    return name;
}

function getInitial(name) {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase();
}

function toggleSpouseParents(id) {
    if (!id) return;
    if (spouseParentsExpanded.has(id)) {
        spouseParentsExpanded.delete(id);
    } else {
        spouseParentsExpanded.add(id);
    }
    renderTree(rootNodes);
}

function getCircleContent(id, name) {
    const initial = name ? name.charAt(0).toUpperCase() : '?';
    const photoSrc = photoMap[id];
    const safeTitle = name || '';

    if (!photoSrc) {
        return `<span class="member-initial">${initial}</span>`;
    }

    return `<span class="member-initial">${initial}</span><img class="member-photo" src="${photoSrc}" alt="${safeTitle}" loading="lazy" onerror="this.remove()">`;
}

function createTreeHTML(node) {
    const renderableChildren = getRenderableChildren(node);
    const hasChildren = renderableChildren.length > 0;
    const collapsedClass = node.collapsed ? 'collapsed' : 'expanded';
    const childrenClass = hasChildren ? 'has-children' : '';

    let leftPartnerHtml = '';
    let rightPartnerHtml = '';
    if (node.pids && node.pids.length > 0) {
        const spouseItems = node.pids.map(pid => {
            const spouseNode = dataMap[pid];
            if (!spouseNode) return null;
            return {
                id: spouseNode.id,
                fullName: spouseNode.name || '',
                fid: spouseNode.fid || null,
                mid: spouseNode.mid || null
            };
        }).filter(Boolean);

        if (spouseItems.length > 0) {
            const renderPartner = (s, ownerId) => {
                const parentNodes = [dataMap[s.fid], dataMap[s.mid]].filter(Boolean);
                const hasParents = parentNodes.length > 0;
                const isExpanded = spouseParentsExpanded.has(s.id);

                const parentRow = isExpanded && hasParents
                    ? `<div class="mini-row">
                        ${parentNodes.map(p => `
                            <div class="mini-parent"
                                 onclick="event.stopPropagation(); locateNode('${p.id}')"
                                 onmousedown="event.stopPropagation()">
                                <div class="mini-circle">${getInitial(p.name)}</div>
                                <div class="mini-name">${formatName(p.name)}</div>
                            </div>
                        `).join('')}
                      </div>`
                    : '';

                const parentsToggle = hasParents
                    ? `<button class="mini-toggle"
                               onclick="event.stopPropagation(); toggleSpouseParents('${s.id}')"
                               onmousedown="event.stopPropagation()">
                           ${isExpanded ? 'Hide Parents' : 'Show Parents'}
                       </button>`
                    : '';

                return `
                    <div class="person-block">
                        <div class="member-circle person-circle spouse-circle"
                             onclick="event.stopPropagation(); focusFamily('${s.id}'); return false;"
                             data-node-id="${s.id}"
                             title="${s.fullName}">
                            ${getCircleContent(s.id, s.fullName)}
                        </div>
                        <div class="member-name">${formatName(s.fullName)}</div>
                        ${parentsToggle}
                        ${parentRow}
                    </div>
                `;
            };

            if (spouseItems.length === 2) {
                leftPartnerHtml = renderPartner(spouseItems[0], node.id);
                rightPartnerHtml = renderPartner(spouseItems[1], node.id);
            } else if (spouseItems.length === 1) {
                rightPartnerHtml = renderPartner(spouseItems[0], node.id);
            } else {
                leftPartnerHtml = renderPartner(spouseItems[0], node.id);
                rightPartnerHtml = spouseItems.slice(1).map(s => renderPartner(s, node.id)).join('');
            }
        }
    }

    let html = `<li class="${collapsedClass} ${childrenClass}" id="node-${node.id}">
        <div class="node-container">
            <div class="couple-row ${(leftPartnerHtml || rightPartnerHtml) ? 'has-partner' : ''}">
                ${leftPartnerHtml}
                <div class="person-block">
                    <div class="circle-wrapper">
                        <div class="member-circle person-circle primary-person"
                             onclick="focusFamily('${node.id}')"
                             data-node-id="${node.id}"
                             title="${node.name || ''}">
                            ${getCircleContent(node.id, node.name)}
                        </div>
                        <div class="toggle-btn" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); toggleNode('${node.id}'); centerNodeFamily('${node.id}')"></div>
                    </div>
                    <div class="member-name">${formatName(node.name)}</div>
                </div>
                ${rightPartnerHtml}
            </div>
        </div>`;

    if (hasChildren) {
        html += '<ul>';
        renderableChildren.forEach(child => {
            html += createTreeHTML(child);
        });
        html += '</ul>';
    }

    html += '</li>';
    return html;
}

function renderTree(roots) {
    const container = document.getElementById('treeContainer');
    if (roots.length === 0) {
        container.innerHTML = '';
        return;
    }

    let htmlContent = '<ul>';
    roots.forEach(root => htmlContent += createTreeHTML(root));
    htmlContent += '</ul>';
    container.innerHTML = htmlContent;
    applyLineageFocus(activeFocusId);
}

let searchResults = [];
let searchIndex = 0;
let lastQuery = '';

function expandAncestors(node) {
    if (!node) return;
    const visited = new Set();
    const stack = [node];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || visited.has(current.id)) continue;
        visited.add(current.id);

        const parents = current.parents && current.parents.length > 0
            ? current.parents
            : (current.parent ? [current.parent] : []);

        parents.forEach(parentNode => {
            parentNode.collapsed = false;
            stack.push(parentNode);
        });
    }
}

function getLineageIds(node) {
    if (!node) return new Set();
    const lineage = new Set();
    const stack = [node];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || lineage.has(current.id)) continue;
        lineage.add(current.id);

        const parents = current.parents && current.parents.length > 0
            ? current.parents
            : (current.parent ? [current.parent] : []);

        parents.forEach(parentNode => stack.push(parentNode));
    }

    return lineage;
}

function getFocusPath(node) {
    const path = [];
    let current = node;
    while (current) {
        path.push(current);
        current = current.parent || null;
    }
    return path.reverse();
}

function getDisplayNames(ids) {
    if (!ids || ids.length === 0) return 'N/A';
    const names = ids.map(id => dataMap[id]?.name).filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'N/A';
}

function getParentNames(node) {
    const parentIds = [node.fid, node.mid].filter(Boolean);
    return getDisplayNames(parentIds);
}

function applyLineageFocus(focusId) {
    const container = document.getElementById('treeContainer');
    container.querySelectorAll('li.lineage').forEach(el => el.classList.remove('lineage'));
    container.querySelectorAll('li.selected').forEach(el => el.classList.remove('selected'));

    if (!focusId || !dataMap[focusId]) return;
    const lineageIds = getLineageIds(dataMap[focusId]);

    lineageIds.forEach(id => {
        const el = document.getElementById(`node-${id}`);
        if (el) el.classList.add('lineage');
    });

    const selected = document.getElementById(`node-${focusId}`);
    if (selected) selected.classList.add('selected');
}

function focusNode(foundId) {
    activeFocusId = foundId;
    expandAncestors(dataMap[foundId]);
    renderTree(rootNodes);

    // Use requestAnimationFrame to ensure DOM update is processed
    requestAnimationFrame(() => {
        setTimeout(() => {
            const element = document.getElementById(`node-${foundId}`);
            if (element) {
                document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
                element.classList.add('highlight');
                centerNodeFamily(foundId);
            }
        }, 200);
    });
}

function searchNode(name) {
    if (!name) return;
    const lowerName = name.toLowerCase();

    if (lowerName !== lastQuery) {
        searchResults = Object.keys(dataMap).filter(id =>
            dataMap[id].name && dataMap[id].name.toLowerCase().includes(lowerName)
        );
        searchIndex = 0;
        lastQuery = lowerName;
    } else {
        searchIndex++;
        if (searchIndex >= searchResults.length) searchIndex = 0;
    }

    if (searchResults.length > 0) {
        const foundId = searchResults[searchIndex];
        focusNode(foundId);
        document.getElementById('searchInput').title = `Result ${searchIndex + 1} of ${searchResults.length}`;
    } else {
        alert('Name not found');
    }
}

function locateNode(id) {
    if (!dataMap[id]) return;
    // If the target is not currently rendered (fully collapsed elsewhere),
    // open its own node as well to avoid centering into empty space.
    dataMap[id].collapsed = false;
    focusNode(id);
}

const slider = document.getElementById('mainWrapper');
let isDragging = false;
let dragPointerId = null;
let startX = 0;
let startY = 0;
let scrollLeft = 0;
let scrollTop = 0;
let suppressToggleOnce = false;
let hasMoved = false;
let longPressTimer = null;
let longPressActive = false;
const LONG_PRESS_MS = 550;

slider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.toggle-btn') || e.target.closest('.search-box') || e.target.closest('.mini-toggle') || e.target.closest('.mini-parent')) return;

    isDragging = true;
    dragPointerId = e.pointerId;
    slider.setPointerCapture(e.pointerId);
    slider.style.cursor = 'grabbing';
    slider.style.userSelect = 'none';
    startX = e.clientX;
    startY = e.clientY;
    hasMoved = false;
    scrollLeft = slider.scrollLeft;
    scrollTop = slider.scrollTop;
});

slider.addEventListener('pointermove', (e) => {
    if (!isDragging || dragPointerId !== e.pointerId) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    const walkX = e.clientX - startX;
    const walkY = e.clientY - startY;
    if (Math.abs(walkX) > 5 || Math.abs(walkY) > 5) hasMoved = true;
    slider.scrollLeft = scrollLeft - walkX;
    slider.scrollTop = scrollTop - walkY;
});

function endDrag(e) {
    if (!isDragging || dragPointerId !== e.pointerId) return;
    isDragging = false;
    dragPointerId = null;
    slider.style.cursor = 'grab';
    slider.style.userSelect = '';
    if (slider.hasPointerCapture(e.pointerId)) {
        slider.releasePointerCapture(e.pointerId);
    }
}

slider.addEventListener('pointerup', endDrag);
slider.addEventListener('pointercancel', endDrag);

function startLongPress(target, clientX, clientY) {
    clearTimeout(longPressTimer);
    longPressActive = false;
    longPressTimer = setTimeout(() => {
        const nodeId = target.dataset.nodeId;
        if (!nodeId) return;
        longPressActive = true;
        suppressToggleOnce = true;
        if (navigator.vibrate) navigator.vibrate(50); // Haptic feedback
        renderProfileModal(nodeId);
    }, LONG_PRESS_MS);
}

function cancelLongPress() {
    clearTimeout(longPressTimer);
}

document.addEventListener('touchstart', (e) => {
    const circle = e.target.closest('.person-circle');
    if (!circle) return;
    if (!e.touches || e.touches.length !== 1) return;
    startLongPress(circle, e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

document.addEventListener('touchmove', cancelLongPress, { passive: true });
document.addEventListener('touchend', cancelLongPress);
document.addEventListener('touchcancel', cancelLongPress);

document.addEventListener('mousedown', (e) => {
    const circle = e.target.closest('.person-circle');
    if (!circle || e.button !== 0) return;
    startLongPress(circle, e.clientX, e.clientY);
});

document.addEventListener('mouseup', cancelLongPress);
document.addEventListener('mouseleave', cancelLongPress);

document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.person-circle')) {
        e.preventDefault();
    }
});

function openCurrentProfile() {
    toggleSidebar(); // Close sidebar first
    
    let targetId = activeFocusId;
    
    // If no node is selected, try to find the stored home person, then the hardcoded home member
    if (!targetId) {
        const storedHomeId = localStorage.getItem('familyTree_homeId');
        if (storedHomeId && dataMap[storedHomeId]) {
            targetId = storedHomeId;
        } else {
            const homeNode = Object.values(dataMap).find(n => n.name === HOME_MEMBER_NAME);
            if (homeNode) targetId = homeNode.id;
        }
    }

    if (targetId) {
        renderProfileModal(targetId);
    } else {
        showToast("Please select a family member first.");
    }
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
}

function setHomePerson(id) {
    if (!dataMap[id]) return;
    localStorage.setItem('familyTree_homeId', id);
    showToast(`Success! ${dataMap[id].name} is now set as your Home Person.`);
    renderProfileModal(id); // Refresh modal to update button state
}

function shareProfile(id) {
    const node = dataMap[id];
    if (!node) return;

    const spouseNames = getDisplayNames(node.pids || []);
    const parentNames = getParentNames(node);
    
    const text = `Family Member Profile:\nName: ${node.name}\nID: ${node.id}\nSpouse: ${spouseNames}\nParents: ${parentNames}\n\n- Dharmavaram Dynasty Family Tree`;

    if (navigator.share) {
        navigator.share({
            title: node.name,
            text: text,
            url: window.location.href
        }).catch(console.error);
    } else {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Profile details copied to clipboard!');
        });
    }
}

function shareApp() {
    if (navigator.share) {
        navigator.share({
            title: document.title,
            text: 'Check out our Family Tree!',
            url: window.location.href
        }).catch(console.error);
    } else {
        navigator.clipboard.writeText(window.location.href).then(() => showToast('App link copied!'));
    }
    toggleSidebar();
}

async function installPWA() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        deferredPrompt = null;
        document.getElementById('installAppBtn').style.display = 'none';
    }
    toggleSidebar();
}

function renderProfileModal(id) {
    const node = dataMap[id];
    if (!node) return;

    const photoSrc = photoMap[id] || '';
    const initial = getInitial(node.name);
    const imgHtml = photoSrc 
        ? `<img src="${photoSrc}" class="profile-img-large" alt="${node.name}">`
        : `<div class="profile-img-large" style="display:flex;align-items:center;justify-content:center;background:#f0f2f5;font-size:48px;color:#3498db;margin:0 auto 10px;">${initial}</div>`;

    // Check if this person is the current Home Person
    const currentHomeId = localStorage.getItem('familyTree_homeId');
    const isHome = currentHomeId === id;
    const homeBtn = isHome 
        ? `<button class="profile-action-btn" disabled style="background:#27ae60; cursor:default;">&#10003; Default Home Person</button>`
        : `<button class="profile-action-btn" onclick="setHomePerson('${id}')">Set as Home Person</button>`;

    const shareBtn = `<button class="profile-action-btn" style="background:#f39c12; margin-left:5px;" onclick="shareProfile('${id}')">Share</button>`;

    // Parents
    const parentLinks = (node.parents || []).map(p => 
        `<span class="profile-link" onclick="renderProfileModal('${p.id}')">${p.name}</span>`
    ).join('') || 'N/A';

    // Spouses
    const spouseLinks = (node.pids || []).map(pid => {
        const s = dataMap[pid];
        return s ? `<span class="profile-link" onclick="renderProfileModal('${s.id}')">${s.name}</span>` : '';
    }).join('') || 'N/A';

    // Children
    const children = getRenderableChildren(node);
    const childrenLinks = children.map(c => 
        `<span class="profile-link" onclick="renderProfileModal('${c.id}')">${c.name}</span>`
    ).join('') || 'N/A';

    // Details Table
    let detailsHtml = `<table class="profile-details-table">`;
    
    if (node.Birth) detailsHtml += `<tr><td class="profile-label">Date of Birth</td><td class="profile-value">${node.Birth}</td></tr>`;
    if (node.Death) detailsHtml += `<tr><td class="profile-label">Date of Death</td><td class="profile-value">${node.Death}</td></tr>`;
    
    detailsHtml += `<tr><td class="profile-label">Parents</td><td class="profile-value">${parentLinks}</td></tr>`;
    detailsHtml += `<tr><td class="profile-label">Spouse(s)</td><td class="profile-value">${spouseLinks}</td></tr>`;
    detailsHtml += `<tr><td class="profile-label">Children</td><td class="profile-value">${childrenLinks}</td></tr>`;

    if (node.Address) detailsHtml += `<tr><td class="profile-label">Address</td><td class="profile-value">${node.Address}</td></tr>`;
    if (node.email) detailsHtml += `<tr><td class="profile-label">Email</td><td class="profile-value"><a href="mailto:${node.email}">${node.email}</a></td></tr>`;
    if (node.phone) detailsHtml += `<tr><td class="profile-label">Phone</td><td class="profile-value"><a href="tel:${node.phone}">${node.phone}</a></td></tr>`;
    
    detailsHtml += `</table>`;

    const content = `
        <div class="profile-header">
            ${imgHtml}
            <h2>${node.name}</h2>
            <p style="color:#777;">ID: ${node.id}</p>
            <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
                ${homeBtn}
                ${shareBtn}
            </div>
        </div>
        ${detailsHtml}
    `;

    document.getElementById('profileContent').innerHTML = content;
    document.getElementById('profileModal').classList.add('active');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show';
    setTimeout(() => {
        toast.className = toast.className.replace('show', '');
    }, 3000);
}

const originalToggleNode = toggleNode;
toggleNode = function(id) {
    if (suppressToggleOnce) {
        suppressToggleOnce = false;
        if (longPressActive) {
            longPressActive = false;
            return;
        }
    }
    if (hasMoved) {
        hasMoved = false;
        return;
    }
    activeFocusId = id; // Update active focus so Profile menu works for this person
    originalToggleNode(id);
};

function focusFamily(id) {
    if (suppressToggleOnce) {
        suppressToggleOnce = false;
        if (longPressActive) {
            longPressActive = false;
            return;
        }
    }
    if (hasMoved) {
        hasMoved = false;
        return;
    }
    if (!dataMap[id]) return;

    Object.values(dataMap).forEach(n => n.collapsed = true);
    expandAncestors(dataMap[id]);
    dataMap[id].collapsed = false;
    
    activeFocusId = id;
    renderTree(rootNodes);
    setTimeout(() => centerNodeFamily(id), 100);
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('active');
}

function toggleSearch() {
    const container = document.getElementById('searchContainer');
    container.classList.toggle('active');
    if (container.classList.contains('active')) {
        document.getElementById('searchInput').focus();
    }
}
