import { fetchFeatures, createFeature, updateFeature, fetchMe, assignUserRole, createFeaturesBulk } from './api.js';
import { initLeafletMap, renderMap, flyToFeature, enableMapPicker, toggleLayer, fetchAmenities, map, switchBasemap, toggleOverlay, startLineDrawing } from './map.js';
import { updateInfoCard, renderLegend, initThemeToggle, openModal, closeModal, openHelpModal, closeHelpModal, switchTab } from './ui.js';
import { downloadGeoJSON, getCategoryMeta } from './utils.js';

// DOM Elements
const infoCard = document.getElementById('infoCard');
const legendStack = document.getElementById('legendStack');
const searchInput = document.getElementById('searchInput');
const helpBtn = document.getElementById('helpBtn');
const quickReportBtn = document.getElementById('quickReportBtn');
const adminActions = document.getElementById('adminActions');
const exportGeoJsonBtn = document.getElementById('exportGeoJsonBtn');
const importMarcBtn = document.getElementById('importMarcBtn');
const addPointBtn = document.getElementById('addPointBtn');
const addLineBtn = document.getElementById('addLineBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const closeHelpBtn = document.getElementById('closeHelpBtn');
const featureForm = document.getElementById('featureForm');
const pickOnMapBtn = document.getElementById('pickOnMapBtn');

// Admin Panel Elements
const adminAuthRequired = document.getElementById('admin-auth-required');
const roleManagementSection = document.getElementById('roleManagementSection');
const targetUserEmail = document.getElementById('targetUserEmail');
const targetUserRole = document.getElementById('targetUserRole');
const assignRoleBtn = document.getElementById('assignRoleBtn');
const featureActions = document.getElementById('featureActions');

// Tabs
const tabExplore = document.getElementById('tab-explore');
const tabSearch = document.getElementById('tab-search');
const tabAdmin = document.getElementById('tab-admin');

// User Auth Elements
const sendMagicLinkBtn = document.getElementById('sendMagicLinkBtn');
const loginEmailInput = document.getElementById('loginEmailInput');
const userLoggedOutView = document.getElementById('user-logged-out');
const userLoggedInView = document.getElementById('user-logged-in');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const userLogoutBtn = document.getElementById('userLogoutBtn');

let allFeatures = [];
let currentUser = null;
let userPermissions = [];

function hasPermission(p) {
  return userPermissions.includes(p);
}

function isUserStaff() {
  return hasPermission('feature.any.hide') || hasPermission('feature.any.update_public_fields') || hasPermission('user.role.assign');
}

function updateAdminUI() {
  const isAdmin = hasPermission('user.role.assign');
  const isStaff = isUserStaff();

  if (currentUser) {
    if (adminAuthRequired) adminAuthRequired.style.display = 'none';
    if (adminActions) adminActions.style.display = isStaff ? 'block' : 'none';
    
    // Feature Actions (Moderators + Admins)
    if (featureActions) featureActions.style.display = (isStaff || isAdmin) ? 'block' : 'none';
    
    // Admin only tools
    if (importMarcBtn) importMarcBtn.style.display = hasPermission('feature.import_official') ? 'block' : 'none';
    if (roleManagementSection) roleManagementSection.style.display = isAdmin ? 'block' : 'none';
  } else {
    if (adminAuthRequired) adminAuthRequired.style.display = 'block';
    if (adminActions) adminActions.style.display = 'none';
  }
  
  if (allFeatures.length) {
    renderMap(allFeatures, allFeatures.length, (f) => updateInfoCard(f, infoCard, isStaff || isAdmin), handleMarkerDrag, isStaff || isAdmin);
    renderLegend(allFeatures, legendStack, (f) => flyToFeature(f, (feature) => updateInfoCard(feature, infoCard, isStaff || isAdmin)));
  }
}

async function refreshData() {
  try {
    allFeatures = await fetchFeatures();
    const isStaff = isUserStaff();
    renderMap(allFeatures, allFeatures.length, (f) => updateInfoCard(f, infoCard, isStaff), handleMarkerDrag, isStaff);
    renderLegend(allFeatures, legendStack, (f) => flyToFeature(f, (feature) => updateInfoCard(feature, infoCard, isStaff)));
  } catch (err) {
    console.error('Failed to fetch features:', err);
  }
}

async function handleMarkerDrag(feature, newCoords) {
  if (!hasPermission('feature.any.update_geometry')) return;
  try {
    const updated = { ...feature, geometry: { type: 'Point', coordinates: newCoords } };
    await updateFeature(feature.id, updated);
  } catch (err) {
    alert('Failed to update marker position: ' + err.message);
  }
}

function initCryptAnimations() {
  const scanline = document.querySelector('.crypt-scan');
  const grid = document.querySelector('.crypt-grid');
  
  if (scanline) {
    gsap.fromTo(scanline, 
      { y: "-100%" }, 
      { y: "100vh", duration: 8, ease: "none", repeat: -1 }
    );
  }
  
  if (grid) {
    gsap.to(grid, {
      opacity: 0.1,
      duration: 4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });
  }
}

async function init() {
  initThemeToggle();
  initLeafletMap('map', [39.03, -94.535], 12);
  
  if (map) {
    map.on('click', (e) => {
      if (e.originalEvent.target.id === 'map' || e.originalEvent.target.classList.contains('leaflet-container')) {
        if (infoCard) infoCard.style.display = 'none';
      }
    });
  }
  
  await refreshData();
  initCryptAnimations();

  const searchResultsList = document.getElementById('searchResultsList');

  let searchTimeout;
  let nominatimController = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const isStaff = isUserStaff();

      if (!q) {
        if (searchResultsList) searchResultsList.innerHTML = '';
        renderMap(allFeatures, allFeatures.length, (f) => updateInfoCard(f, infoCard, isStaff), handleMarkerDrag, isStaff);
        return;
      }

      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        const filtered = allFeatures.filter(f =>
          f.name.toLowerCase().includes(q) ||
          (f.public_description && f.public_description.toLowerCase().includes(q)) ||
          f.category.toLowerCase().includes(q)
        );

        if (searchResultsList) {
          searchResultsList.innerHTML = '';
          filtered.forEach(f => {
            const tile = document.createElement('div');
            tile.className = 'tile-btn';
            tile.style.borderLeft = `4px solid ${getCategoryMeta(f.category).swatch}`;
            tile.innerHTML = `<div><strong>${f.name}</strong><br><small style="font-size:9px; opacity:0.7;">${f.category}</small></div>`;
            tile.onclick = () => flyToFeature(f, (feature) => updateInfoCard(feature, infoCard, isStaff));
            searchResultsList.appendChild(tile);
          });

          try {
            if (nominatimController) {
              nominatimController.abort();
            }
            nominatimController = new AbortController();
            const nomResp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&viewbox=-95.1,39.3,-94.1,38.7&bounded=1`, { signal: nominatimController.signal });
            const nomData = await nomResp.json();
            nominatimController = null;
            
            if (nomData.length > 0) {
              const divider = document.createElement('div');
              divider.style.cssText = 'font-size:9px; text-transform:uppercase; font-weight:700; margin: 12px 0 4px; opacity:0.5;';
              divider.textContent = 'Global Locations';
              searchResultsList.appendChild(divider);

              nomData.forEach(place => {
                const tile = document.createElement('div');
                tile.className = 'tile-btn';
                tile.style.borderLeft = '4px solid #94a3b8ff';
                tile.innerHTML = `<div><strong>${place.display_name.split(',')[0]}</strong><br><small style="font-size:9px; opacity:0.7;">${place.display_name.split(',').slice(1, 3).join(',')}</small></div>`;
                tile.onclick = () => {
                  map.flyTo([place.lat, place.lon], 15);
                };
                searchResultsList.appendChild(tile);
              });
            }
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.warn('Nominatim search failed:', err);
            }
          }
        }

        renderMap(filtered, allFeatures.length, (f) => updateInfoCard(f, infoCard, isStaff), handleMarkerDrag, isStaff);
      }, 400);
    });
  }

  const doLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Server logout failed, clearing locally');
    }
    document.cookie = "session=; Max-Age=0; path=/; SameSite=Strict;";
    location.reload();
  };

  if (userLogoutBtn) userLogoutBtn.addEventListener('click', doLogout);

  if (assignRoleBtn) {
    assignRoleBtn.addEventListener('click', async () => {
      const email = targetUserEmail.value;
      const role = targetUserRole.value;
      if (!email) return alert('Enter a user email');
      try {
        assignRoleBtn.disabled = true;
        await assignUserRole(email, role);
        alert(`Role '${role}' assigned to ${email}`);
        targetUserEmail.value = '';
      } catch (err) {
        alert('Failed: ' + err.message);
      } finally {
        assignRoleBtn.disabled = false;
      }
    });
  }

  // Basemap Selector
  const basemapSelect = document.getElementById('basemapSelect');
  const saveDefaultBasemapBtn = document.getElementById('saveDefaultBasemapBtn');

  await checkUserAuth();

  async function checkUserAuth() {
    try {
      const data = await fetchMe();
      if (data.authenticated) {
        currentUser = data.user;
        userPermissions = data.user.permissions || [];
        
        if (userLoggedOutView) userLoggedOutView.style.display = 'none';
        if (userLoggedInView) userLoggedInView.style.display = 'block';
        if (userEmailDisplay) userEmailDisplay.textContent = data.user.email;
        
        const usernameDisplay = document.getElementById('userUsernameDisplay');
        const avatarDisplay = document.getElementById('userAvatarDisplay');
        if (usernameDisplay) {
          usernameDisplay.textContent = data.user.username || data.user.email.split('@')[0];
        }
        if (avatarDisplay && data.user.avatar_url) {
          avatarDisplay.src = data.user.avatar_url;
          avatarDisplay.style.display = 'block';
        }
        
        // Apply gamification data
        const levelEl = document.getElementById('contributor-level');
        const xpEl = document.getElementById('contributor-xp');
        const barEl = document.getElementById('xp-progress-bar');
        const badgeGrid = document.getElementById('user-badges-grid');

        if (data.user.reputation_score !== undefined) {
          const score = data.user.reputation_score;
          const level = Math.floor(score / 50) + 1;
          const xpInLevel = score % 50;
          const progress = (xpInLevel / 50) * 100;
          const levelNames = ['SCOUT', 'PATHFINDER', 'EXPLORER', 'CHART-MASTER', 'KNOWLEDGE-NODE', 'TRAIL-WIZARD', 'TERRAIN-GURU', 'MAP-VANGUARD', 'DATA-ELITE', 'LOCAL LEGEND'];
          const levelName = levelNames[Math.min(level - 1, 9)];

          if (levelEl) levelEl.textContent = `LEVEL ${level} ${levelName}`;
          if (xpEl) xpEl.textContent = `${score} XP`;
          if (barEl) barEl.style.width = `${progress}%`;

          if (badgeGrid && data.badges) {
            badgeGrid.innerHTML = '';
            data.badges.forEach(b => {
              const badge = document.createElement('div');
              badge.style.cssText = 'padding: 2px 6px; border-radius: 4px; background: var(--color-primary-soft); color: var(--color-primary); font-size: 8px; font-weight: 700; text-transform: uppercase; border: 1px solid var(--color-primary);';
              badge.textContent = b.name;
              badge.title = b.description;
              badgeGrid.appendChild(badge);
            });
          }
        }

        if (data.preferences) {
          if (data.preferences.basemap) {
            switchBasemap(data.preferences.basemap);
            if (basemapSelect) basemapSelect.value = data.preferences.basemap;
          }
          if (data.preferences.theme) {
            document.documentElement.setAttribute('data-theme', data.preferences.theme);
            localStorage.setItem('theme', data.preferences.theme);
          }
        }
        if (saveDefaultBasemapBtn) saveDefaultBasemapBtn.style.display = 'block';
        updateAdminUI();
      }
    } catch (err) {
      console.warn('Auth check failed:', err);
    }
  };

  if (sendMagicLinkBtn) {
    sendMagicLinkBtn.addEventListener('click', async () => {
      const email = loginEmailInput.value;
      if (!email) return alert('Email required');
      try {
        sendMagicLinkBtn.disabled = true;
        sendMagicLinkBtn.textContent = 'Sending...';
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        if (res.ok) {
            alert('Verification link sent! Check your inbox.');
        } else {
            throw new Error(`Server returned ${res.status}`);
        }
      } catch (err) {
        alert('Failed to send link: ' + err.message);
      } finally {
        sendMagicLinkBtn.disabled = false;
        sendMagicLinkBtn.textContent = 'Send Link';
      }
    });
  }

  if (exportGeoJsonBtn) {
    exportGeoJsonBtn.addEventListener('click', () => {
      downloadGeoJSON(allFeatures);
    });
  }

  const importGeoJsonBtn = document.getElementById('importGeoJsonBtn');
  const geoJsonFileInput = document.getElementById('geoJsonFileInput');

  if (importGeoJsonBtn && geoJsonFileInput) {
    importGeoJsonBtn.addEventListener('click', () => { if (!hasPermission('feature.import_official')) return alert('Unauthorized'); geoJsonFileInput.click(); });
    geoJsonFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const geojson = JSON.parse(event.target.result);
          if (!geojson.features || !Array.isArray(geojson.features)) throw new Error("Invalid GeoJSON.");
          
          let count = 0;
          importGeoJsonBtn.disabled = true;
          importGeoJsonBtn.textContent = 'Importing...';
          
          const featuresToImport = [];
          for (const feat of geojson.features) {
            const geom = feat.geometry;
            const props = feat.properties || {};
            if (!geom) continue;
            
            const data = {
              name: props.name || 'Imported Feature',
              feature_type: geom.type === 'Point' ? 'point' : 'line',
              category: props.category || 'Trail spines',
              status: props.status || 'active',
              officiality: props.officiality || 'official',
              visibility: props.visibility || 'public',
              public_description: props.public_description || '',
              geometry: geom
            };
            featuresToImport.push(data);
          }
          try {
            const res = await createFeaturesBulk(featuresToImport);
            alert(`Imported ${res.count} features.`);
            await refreshData();
          } catch (err) {
             alert("Error: " + err.message);
          }
        } catch (err) {
          alert("Error: " + err.message);
        } finally {
          importGeoJsonBtn.disabled = false;
          importGeoJsonBtn.textContent = 'Import GeoJSON';
          geoJsonFileInput.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  if (importMarcBtn) {
    importMarcBtn.addEventListener('click', async () => {
      if (!confirm('Fetch and import latest MARC data?')) return;
      try {
        importMarcBtn.disabled = true;
        importMarcBtn.textContent = 'Importing...';
        const resp = await fetch('/admin/import-marc', {
            method: 'POST'
        });
        const result = await resp.text();
        alert(result);
        await refreshData();
      } catch (err) {
        alert('Import failed: ' + err.message);
      } finally {
        importMarcBtn.disabled = false;
        importMarcBtn.textContent = 'Run MARC Import';
      }
    });
  }

  if (tabExplore) tabExplore.addEventListener('click', () => switchTab('explore'));
  if (tabSearch) tabSearch.addEventListener('click', () => switchTab('search'));
  if (tabAdmin) tabAdmin.addEventListener('click', () => switchTab('admin'));

  if (quickReportBtn) {
    quickReportBtn.addEventListener('click', () => {
      alert('Click on the map to report an issue.');
      enableMapPicker((coords) => {
        openModal({
          name: 'New Report',
          category: 'Field Reports',
          status: 'caution',
          public_geometry: { type: 'Point', coordinates: coords },
          geometry: { type: 'Point', coordinates: coords }
        });
      });
    });
  }

  if (helpBtn) helpBtn.addEventListener('click', openHelpModal);
  if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeHelpModal);

  if (addPointBtn) addPointBtn.addEventListener('click', () => openModal(null, 'point'));
  if (addLineBtn) addLineBtn.addEventListener('click', () => openModal(null, 'line'));
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  const closeInfoCardBtn = document.getElementById('closeInfoCard');
  if (closeInfoCardBtn && infoCard) {
    closeInfoCardBtn.addEventListener('click', () => {
      infoCard.style.display = 'none';
    });
  }

  // Layer Toggles
  const knowledgeToggle = document.getElementById('layer-knowledge');
  const officialToggle = document.getElementById('layer-official');
  const reportsToggle = document.getElementById('layer-reports');
  const amenitiesToggle = document.getElementById('layer-amenities');

  if (knowledgeToggle) knowledgeToggle.addEventListener('change', (e) => toggleLayer('knowledge', e.target.checked));
  if (officialToggle) officialToggle.addEventListener('change', (e) => toggleLayer('official', e.target.checked));
  if (reportsToggle) reportsToggle.addEventListener('change', (e) => toggleLayer('reports', e.target.checked));

  // Overlay Toggles
  ['railway', 'cycling_routes', 'hiking_trails'].forEach(id => {
    const el = document.getElementById(`overlay-${id}`);
    if (el) el.addEventListener('change', (e) => toggleOverlay(id, e.target.checked));
  });

  if (basemapSelect) {
    basemapSelect.addEventListener('change', (e) => {
      switchBasemap(e.target.value);
    });
  }

  if (saveDefaultBasemapBtn) {
    saveDefaultBasemapBtn.addEventListener('click', async () => {
      const basemapId = basemapSelect ? basemapSelect.value : 'pioneer';
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      try {
        saveDefaultBasemapBtn.disabled = true;
        saveDefaultBasemapBtn.textContent = 'SAVING...';
        await fetch('/api/me/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ basemap: basemapId, theme: currentTheme })
        });
        saveDefaultBasemapBtn.textContent = 'SAVED!';
        setTimeout(() => {
          saveDefaultBasemapBtn.textContent = 'SET DEFAULT';
          saveDefaultBasemapBtn.disabled = false;
        }, 2000);
      } catch (err) {
        saveDefaultBasemapBtn.textContent = 'ERROR';
        setTimeout(() => {
          saveDefaultBasemapBtn.textContent = 'SET DEFAULT';
          saveDefaultBasemapBtn.disabled = false;
        }, 2000);
      }
    });
  }

  if (amenitiesToggle) {
    amenitiesToggle.addEventListener('change', (e) => {
      toggleLayer('amenities', e.target.checked);
      if (e.target.checked) fetchAmenities();
    });
  }

  if (map) {
    map.on('moveend', () => {
      if (amenitiesToggle && amenitiesToggle.checked) fetchAmenities();
    });
  }

  if (pickOnMapBtn) {
    const drawingControls = document.getElementById('drawing-controls');
    const finishDrawingBtn = document.getElementById('finishDrawingBtn');
    let stopDrawingFn = null;

    pickOnMapBtn.addEventListener('click', () => {
      const type = document.getElementById('f_type').value;
      const geomField = document.getElementById('f_geometry');
      if (type === 'point') {
        const originalText = pickOnMapBtn.textContent;
        pickOnMapBtn.textContent = 'Click on Map...';
        enableMapPicker((coords) => {
          geomField.value = JSON.stringify({ type: 'Point', coordinates: coords });
          pickOnMapBtn.textContent = originalText;
        });
      } else {
        closeModal();
        if (drawingControls) drawingControls.style.display = 'flex';
        stopDrawingFn = startLineDrawing(
          (points) => {},
          (finalPoints) => {
            openModal(null, 'line', true);
            document.getElementById('f_geometry').value = JSON.stringify({ type: 'LineString', coordinates: finalPoints });
            if (drawingControls) drawingControls.style.display = 'none';
          }
        );
      }
    });

    if (finishDrawingBtn) {
      finishDrawingBtn.addEventListener('click', () => {
        if (stopDrawingFn) {
          stopDrawingFn();
          stopDrawingFn = null;
        }
      });
    }
  }

  if (featureForm) {
    featureForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('f_id').value;
      try {
        const geomValue = document.getElementById('f_geometry').value;
        if (!geomValue) throw new Error('Pick a location first.');

        const data = {
          name: document.getElementById('f_name').value,
          feature_type: document.getElementById('f_type').value,
          category: document.getElementById('f_category').value,
          status: document.getElementById('f_status').value,
          officiality: document.getElementById('f_officiality').value,
          visibility: document.getElementById('f_visibility').value,
          public_description: document.getElementById('f_description').value,
          surface_note: document.getElementById('f_surface_note').value,
          risk_note: document.getElementById('f_risk_note').value,
          weather_sensitivity: document.getElementById('f_weather').value,
          source_confidence: document.getElementById('f_confidence').value,
          longevity: document.getElementById('f_longevity').value,
          poster_email: document.getElementById('f_poster_email').value,
          geometry: JSON.parse(geomValue),
          sources: Array.from(document.querySelectorAll('.source-link-row')).map(row => ({
            url: row.querySelector('.source-url').value,
            note: row.querySelector('.source-note').value
          })).filter(s => s.url)
        };

        if (id) {
          await updateFeature(id, data);
        } else {
          const result = await createFeature(data);
          if (result.success && data.poster_email && !currentUser) {
            alert(`Success! Delete token: ${result.delete_token}`);
          }
        }
        closeModal();
        await refreshData();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  const editProfileBtn = document.getElementById('editProfileBtn');
  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', () => {
      import('./ui.js').then(ui => ui.openProfileEditModal(currentUser));
    });
  }

  const profileEditForm = document.getElementById('profileEditForm');
  if (profileEditForm) {
    profileEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('saveProfileBtn');
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        
        const username = document.getElementById('f_profile_username').value;
        const bio = document.getElementById('f_profile_bio').value;
        const social_links = Array.from(document.querySelectorAll('.profile-social-row')).map(row => 
          row.querySelector('.social-url').value
        ).filter(url => url);

        import('./api.js').then(async (api) => {
          await api.updateProfile({ username, bio, social_links });
          
          const avatarInput = document.getElementById('f_avatar_upload');
          if (avatarInput.files && avatarInput.files[0]) {
            await api.uploadAvatar(avatarInput.files[0]);
          }

          document.getElementById('profileEditModal').style.display = 'none';
          alert('Profile updated successfully!');
          location.reload();
        }).catch(err => {
          alert('Error: ' + err.message);
        }).finally(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Profile';
        });
      } catch (err) {
        alert('Error: ' + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Profile';
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
