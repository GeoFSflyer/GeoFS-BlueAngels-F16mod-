// ==UserScript==
// @name         GeoFS Flight Recorder Debug Tools
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      0.1.0
// @description  External debug panel for GeoFS Flight Recorder playback node inspection.
// @match        https://www.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const FR_PANEL_ID = 'flight-recorder-panel';
  const ROOT_ID = 'fr-debug-tools-root';
  const STYLE_ID = 'fr-debug-tools-style';
  const CATEGORY_ORDER = ['gear', 'wheels', 'doors', 'hideNodes', 'other'];
  const CATEGORY_LABELS = {
    gear: 'Gear',
    wheels: 'Wheels',
    doors: 'Doors',
    hideNodes: 'Always hidden',
    other: 'Niet geclassificeerd'
  };
  const MODE_CYCLE = ['default', 'ignore', 'gear', 'hide'];

  let autoRefresh = true;
  let renderQueued = false;
  let firstAutoRenderDone = false;
  const overrideDraftByAircraftId = Object.create(null);

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getApi() {
    return window.FlightRecorder?.debugApi || null;
  }

  function nodeKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function getOverrideDraft(aircraftId) {
    const id = String(aircraftId || '').trim();
    if (!id) return null;
    if (!overrideDraftByAircraftId[id]) {
      overrideDraftByAircraftId[id] = { ignore: new Set(), gear: new Set(), hide: new Set() };
    }
    return overrideDraftByAircraftId[id];
  }

  function syncDraftFromMainConfig(track) {
    const id = String(track?.aircraftId || '').trim();
    if (!id) return;
    const draft = getOverrideDraft(id);
    if (!draft) return;

    const cfg = track?.overrideConfig || {};
    const ignore = Array.isArray(cfg.ignoreNodes) ? cfg.ignoreNodes : [];
    const gear = Array.isArray(cfg.gearNodes) ? cfg.gearNodes : [];
    const hide = Array.isArray(cfg.hideNodes) ? cfg.hideNodes : [];

    for (const n of ignore) {
      const k = nodeKey(n);
      if (k) draft.ignore.add(k);
      if (k) draft.gear.delete(k);
      if (k) draft.hide.delete(k);
    }
    for (const n of gear) {
      const k = nodeKey(n);
      if (k) draft.gear.add(k);
      if (k) draft.ignore.delete(k);
      if (k) draft.hide.delete(k);
    }
    for (const n of hide) {
      const k = nodeKey(n);
      if (k) draft.hide.add(k);
      if (k) draft.ignore.delete(k);
      if (k) draft.gear.delete(k);
    }
  }

  function getNodeMode(aircraftId, nodeName, fallbackMode = 'default') {
    const draft = getOverrideDraft(aircraftId);
    const k = nodeKey(nodeName);
    if (!draft || !k) return fallbackMode;
    if (draft.ignore.has(k)) return 'ignore';
    if (draft.hide.has(k)) return 'hide';
    if (draft.gear.has(k)) return 'gear';
    return 'default';
  }

  function setNodeMode(aircraftId, nodeName, mode) {
    const draft = getOverrideDraft(aircraftId);
    const k = nodeKey(nodeName);
    if (!draft || !k) return;
    draft.ignore.delete(k);
    draft.gear.delete(k);
    draft.hide.delete(k);
    if (mode === 'ignore') draft.ignore.add(k);
    if (mode === 'gear') draft.gear.add(k);
    if (mode === 'hide') draft.hide.add(k);
  }

  function cycleMode(currentMode) {
    const idx = MODE_CYCLE.indexOf(String(currentMode || 'default'));
    const next = MODE_CYCLE[(idx + 1 + MODE_CYCLE.length) % MODE_CYCLE.length];
    return next;
  }

  function modeLabel(mode) {
    if (mode === 'ignore') return 'Ignore';
    if (mode === 'gear') return 'Gear';
    if (mode === 'hide') return 'Always hide';
    return 'Default';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} .frd-track { border:1px solid #ccc; border-radius:6px; padding:8px; margin-bottom:8px; background:#f5f5f5; }
      #${ROOT_ID} .frd-row { display:flex; gap:6px; align-items:center; justify-content:space-between; margin:3px 0; }
      #${ROOT_ID} .frd-name { font-family: Consolas, monospace; font-size:12px; overflow-wrap:anywhere; }
      #${ROOT_ID} .frd-muted { color:#666; font-size:12px; }
      #${ROOT_ID} .frd-cat { border:1px dashed #bbb; border-radius:6px; padding:6px; margin-top:6px; background:#fff; }
      #${ROOT_ID} button { cursor:pointer; }
      #${ROOT_ID} .frd-actions { display:flex; gap:6px; flex-wrap:wrap; }
      #${ROOT_ID} .frd-mode-default { background:#f4f4f4; }
      #${ROOT_ID} .frd-mode-ignore { background:#ffd6d6; }
      #${ROOT_ID} .frd-mode-gear { background:#d7f7d7; }
      #${ROOT_ID} .frd-mode-hide { background:#d9e7ff; }
      #${ROOT_ID} .frd-output { width:100%; min-height:90px; font-family:Consolas, monospace; font-size:12px; }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    const panel = document.getElementById(FR_PANEL_ID);
    if (!panel) return null;

    const host = panel.firstElementChild || panel;
    let root = document.getElementById(ROOT_ID);
    if (root && root.parentElement !== host) {
      root.remove();
      root = null;
    }

    if (!root) {
      root = document.createElement('fieldset');
      root.id = ROOT_ID;
      root.style.marginTop = '10px';
      root.innerHTML = `
        <legend>Debug Tools</legend>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
          <button id="frd-refresh-btn">Refresh</button>
          <label style="font-size:12px; color:#555;">
            <input id="frd-auto-refresh" type="checkbox" checked> Auto refresh
          </label>
          <span id="frd-state" class="frd-muted"></span>
        </div>
        <div id="frd-content" class="frd-muted">Wachten op data...</div>
      `;
      host.appendChild(root);

      const refreshBtn = root.querySelector('#frd-refresh-btn');
      const autoCb = root.querySelector('#frd-auto-refresh');
      if (refreshBtn) refreshBtn.onclick = () => render();
      if (autoCb) {
        autoCb.checked = !!autoRefresh;
        autoCb.onchange = (e) => { autoRefresh = !!e.target.checked; };
      }

      root.addEventListener('click', onRootClick);
    }

    return root;
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      render();
    }, 0);
  }

  function onRootClick(e) {
    const btn = e.target?.closest?.('button[data-act]');
    if (!btn) return;

    const api = getApi();
    if (!api) return;

    const act = String(btn.dataset.act || '');
    const trackId = String(btn.dataset.trackId || '');
    const aircraftId = String(btn.dataset.aircraftId || '');
    const nodeName = String(btn.dataset.nodeName || '');
    const category = String(btn.dataset.category || '');

    let needsRerender = false;

    if (act === 'hide-node') { api.setTrackNodeVisibility(trackId, nodeName, false); needsRerender = true; }
    if (act === 'show-node') { api.setTrackNodeVisibility(trackId, nodeName, true); needsRerender = true; }
    if (act === 'hide-cat') { api.setTrackCategoryVisibility(trackId, category, false); needsRerender = true; }
    if (act === 'show-cat') { api.setTrackCategoryVisibility(trackId, category, true); needsRerender = true; }
    if (act === 'hide-nodes-now') {
      if (typeof api.hideTrackHideNodes === 'function') api.hideTrackHideNodes(trackId);
      else api.hideTrackLadder?.(trackId);
      needsRerender = true;
    }
    if (act === 'cycle-override') {
      const current = getNodeMode(aircraftId, nodeName, 'default');
      setNodeMode(aircraftId, nodeName, cycleMode(current));
      needsRerender = true;
    }
    if (act === 'copy-snippet') {
      const track = btn.closest('.frd-track');
      const ta = track?.querySelector('textarea.frd-output');
      if (ta) copyText(ta.value);
    }

    if (needsRerender) queueRender();
  }

  function copyText(text) {
    const value = String(text || '');
    if (!value) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {
        fallbackCopyText(value);
      });
      return;
    }
    fallbackCopyText(value);
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = String(text || '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch { }
    ta.remove();
  }

  function getAircraftSnippet(track) {
    const aircraftId = String(track?.aircraftId || '').trim();
    if (!aircraftId) return '// Geen aircraftId beschikbaar voor deze track.';

    const draft = getOverrideDraft(aircraftId);
    const allItems = [];
    for (const cat of CATEGORY_ORDER) {
      for (const item of (track?.groups?.[cat] || [])) allItems.push(item);
    }

    const keyToName = new Map();
    for (const item of allItems) {
      const k = nodeKey(item?.name);
      if (k && !keyToName.has(k)) keyToName.set(k, String(item?.name || ''));
    }

    const ignoreNodes = [];
    const gearNodes = [];
    const hideNodes = [];
    if (draft) {
      for (const k of draft.ignore) {
        const name = keyToName.get(k);
        if (name) ignoreNodes.push(name);
      }
      for (const k of draft.gear) {
        const name = keyToName.get(k);
        if (name) gearNodes.push(name);
      }
      for (const k of draft.hide) {
        const name = keyToName.get(k);
        if (name) hideNodes.push(name);
      }
    }

    ignoreNodes.sort((a, b) => a.localeCompare(b));
    gearNodes.sort((a, b) => a.localeCompare(b));
    hideNodes.sort((a, b) => a.localeCompare(b));

    const idLit = JSON.stringify(aircraftId);
    const ignoreLit = `[${ignoreNodes.map((n) => JSON.stringify(n)).join(', ')}]`;
    const gearLit = `[${gearNodes.map((n) => JSON.stringify(n)).join(', ')}]`;
    const hideLit = `[${hideNodes.map((n) => JSON.stringify(n)).join(', ')}]`;

    return [
      '{',
      `  aircraftId: ${idLit},`,
      `  ignoreNodes: ${ignoreLit},`,
      `  gearNodes: ${gearLit},`,
      `  hideNodes: ${hideLit}`,
      '}'
    ].join('\n');
  }

  function getAllAircraftArraySnippet(tracks) {
    const items = [];
    const seen = new Set();
    for (const track of tracks || []) {
      const aircraftId = String(track?.aircraftId || '').trim();
      if (!aircraftId || seen.has(aircraftId)) continue;
      seen.add(aircraftId);
      items.push(getAircraftSnippet(track));
    }
    return `const AIRCRAFT_NODE_OVERRIDES = [\n${items.map((x) => `  ${x.replace(/\n/g, '\n  ')}`).join(',\n')}\n];`;
  }

  function renderCategory(track, category, items) {
    const safeTrackId = escapeHtml(track.id);
    const safeCategory = escapeHtml(category);
    const safeAircraftId = escapeHtml(track.aircraftId || '');
    const rows = items.map((item) => {
      const safeName = escapeHtml(item.name);
      const vis = item.visible ? 'zichtbaar' : 'verborgen';
      const mode = getNodeMode(track.aircraftId, item.name, item.overrideMode || 'default');
      const modeClass = `frd-mode-${mode}`;
      return `
        <div class="frd-row">
          <div class="frd-name">${safeName}</div>
          <div class="frd-actions">
            <span class="frd-muted">${vis}</span>
            <button class="${modeClass}" data-act="cycle-override" data-aircraft-id="${safeAircraftId}" data-node-name="${safeName}">${modeLabel(mode)}</button>
            <button data-act="hide-node" data-track-id="${safeTrackId}" data-node-name="${safeName}">Hide</button>
            <button data-act="show-node" data-track-id="${safeTrackId}" data-node-name="${safeName}">Show</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="frd-cat">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; margin-bottom:4px;">
          <b>${escapeHtml(CATEGORY_LABELS[category] || category)} (${items.length})</b>
          <div class="frd-actions">
            <button data-act="hide-cat" data-track-id="${safeTrackId}" data-category="${safeCategory}">Hide group</button>
            <button data-act="show-cat" data-track-id="${safeTrackId}" data-category="${safeCategory}">Show group</button>
          </div>
        </div>
        ${rows || '<div class="frd-muted">Geen nodes</div>'}
      </div>
    `;
  }

  function render() {
    ensureStyle();
    const root = ensureRoot();
    if (!root) return;

    const stateEl = root.querySelector('#frd-state');
    const content = root.querySelector('#frd-content');
    if (!content) return;

    const api = getApi();
    if (!api) {
      if (stateEl) stateEl.textContent = 'Main plugin API niet gevonden';
      content.innerHTML = '<div class="frd-muted">Laad eerst de main Flight Recorder plugin.</div>';
      return;
    }

    const tracks = api.getPlaybackDebugData?.() || [];
    if (stateEl) stateEl.textContent = `Actieve playback tracks: ${tracks.length}`;

    if (!tracks.length) {
      content.innerHTML = '<div class="frd-muted">Geen playback tracks actief.</div>';
      return;
    }

    const cardsHtml = tracks.map((track) => {
      syncDraftFromMainConfig(track);

      const title = `${track.name || track.id} (${track.id})`;
      const callsign = track.callsign ? ` • callsign=${track.callsign}` : '';
      const modelState = track.modelReady ? 'model ready' : 'model not ready';
      const aircraftId = String(track.aircraftId || '').trim() || '-';

      const cats = CATEGORY_ORDER.map((cat) => renderCategory(track, cat, track.groups?.[cat] || [])).join('');
      const snippet = getAircraftSnippet(track);
      return `
        <div class="frd-track">
          <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
            <b>${escapeHtml(title)}</b>
            <span class="frd-muted">${escapeHtml(modelState)} • parts=${Number(track.totalParts) || 0}${escapeHtml(callsign)}</span>
          </div>
          <div class="frd-muted" style="margin-top:4px;">aircraftId=${escapeHtml(aircraftId)}</div>
          <div style="margin-top:6px;">
            <button data-act="hide-nodes-now" data-track-id="${escapeHtml(track.id)}">Apply always-hidden now</button>
            <button data-act="copy-snippet">Copy snippet</button>
          </div>
          ${cats}
          <div style="margin-top:8px;">
            <div class="frd-muted" style="margin-bottom:4px;">Plak dit object in AIRCRAFT_NODE_OVERRIDES in de main plugin:</div>
            <textarea class="frd-output" readonly>${escapeHtml(snippet)}</textarea>
          </div>
        </div>
      `;
    }).join('');

    const allSnippet = getAllAircraftArraySnippet(tracks);
    content.innerHTML = `${cardsHtml}
      <div class="frd-track">
        <b>Gecombineerde snippet (onderaan plakken in main plugin)</b>
        <div style="margin-top:6px;" class="frd-muted">Vervang hiermee de waarde van AIRCRAFT_NODE_OVERRIDES.</div>
        <div style="margin-top:6px;"><button data-act="copy-snippet">Copy combined snippet</button></div>
        <textarea class="frd-output" readonly style="margin-top:6px; min-height:180px;">${escapeHtml(allSnippet)}</textarea>
      </div>
    `;
  }

  window.addEventListener('fr:ui-updated', () => {
    if (autoRefresh) queueRender();
  });

  setInterval(() => {
    ensureRoot();
    if (autoRefresh && !firstAutoRenderDone) {
      firstAutoRenderDone = true;
      render();
    }
  }, 1200);

  render();
})();
