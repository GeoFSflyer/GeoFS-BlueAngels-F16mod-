// ==UserScript==
// @name         Sky Dolly 2.7.7 (GeoFS, Sync start + Rename + Clear UI)
// @namespace    https://arjan-copilot.dev
// @version      2.7.7
// @description  Smooth formation playback + perfectly synced new recording start; rename flights; clear UI; fixed gear mapping; model test panel.
// @match        https://www.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  /* ---------- Utils ---------- */
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,f)=>a+(b-a)*f;
  const lerpAngleDeg=(a,b,f)=>{let d=((b-a+540)%360)-180;return a+d*f;};
  const smoothstep=(f)=>f*f*(3-2*f);
  const now=()=>performance.now();

  /* ---------- Config ---------- */
  let defaultSampleMs = 33;        // 30 Hz
  let easingOn = true;
  let planeSplineOn = true;        // Catmull-Rom in lokaal XY
  let motionSmoothOn = true;       // extra RC-low-pass op gespline-de XY
  let motionTauMs = 120;           // tijdconstante RC-filter
  const MAX_DT_CAP = 120;          // ms
  const MAX_STEPS = 10;            // catch-up limiter

  /* ---------- State ---------- */
  // Track:
  // { id,name,modelUrl,sampleMs,data:[{lla,htr,state:{gear,flaps,spoilers},xy}],
  //   base:{lat0,lon0,mLat,mLon}, ghost, play:{playing,paused,acc,index,lastT},
  //   pool:{lla,htr}, nodeCache:{ ready, all:[], gear:[], wheels:[], struts:[], doors:[], ladder:[] },
  //   lastGearUp:null, smooth:{xy:[x,y,z]} }
  let tracks = [];
  let current = null;

  /* ---------- Node helpers ---------- */
  function buildNodeCacheDetailed(tr){
    if (!tr.ghost || !tr.ghost._model || !tr.ghost._model.ready) return false;
    if (tr.nodeCache && tr.nodeCache.ready) return true;

    const mdl = tr.ghost._model;
    const parts = geofs?.aircraft?.instance?.definition?.parts || [];

    const all=[], gear=[], wheels=[], struts=[], doors=[], ladder=[];
    for (const p of parts){
      const name = p?.name; if (!name) continue;
      const n = mdl.getNode(name) || mdl.getNode(name.toLowerCase()) || mdl.getNode(name.toUpperCase());
      if (!n) continue;

      const low = String(name).toLowerCase();
      all.push(n);

      if (low.includes('ladder') || low.includes('boarding') || low.includes('stairs')) ladder.push(n);
      if (low.includes('door') || low.includes('hatch') || low.includes('bay'))        doors.push(n);
      if (low.includes('wheel') || low.includes('tire') || low.includes('bogie') || low.includes('truck')) wheels.push(n);
      if (low.includes('strut') || low.includes('oleo') || low.includes('shock'))      struts.push(n);
      if (low.includes('gear'))                                                         gear.push(n);
    }
    tr.nodeCache = { ready:true, all, gear, wheels, struts, doors, ladder };
    return true;
  }

  function setCategoryVisible(tr, cat, visible){
    if (!buildNodeCacheDetailed(tr)) return;
    const bag = tr.nodeCache[cat] || [];
    for (const n of bag){ try{ n.show = visible; }catch{} }
  }
  function setAllVisible(tr, visible){
    if (!buildNodeCacheDetailed(tr)) return;
    for (const n of tr.nodeCache.all){ try{ n.show = visible; }catch{} }
  }

  // Eén functie om alle gear-gerelateerde onderdelen in eind-stand te zetten
  function applyGearState(tr, isUp) {
    // Ladder altijd verborgen
    setCategoryVisible(tr, 'ladder', false);

    if (isUp) {
      // Gear UP
      setCategoryVisible(tr, 'doors',  false);
      setCategoryVisible(tr, 'wheels', false);
      setCategoryVisible(tr, 'gear',   false);
      setCategoryVisible(tr, 'struts', false);
    } else {
      // Gear DOWN
      setCategoryVisible(tr, 'doors',  true);
      setCategoryVisible(tr, 'gear',   true);
      setCategoryVisible(tr, 'wheels', true);
      setCategoryVisible(tr, 'struts', true);
      setCategoryVisible(tr, 'ladder', false);
    }
  }

  /* ---------- Sampling ---------- */
  function metersPerDeg(latDeg){
    const mLat = 111132;
    const mLon = 111320 * Math.cos(latDeg * Math.PI/180);
    return { mLat, mLon };
  }
  function readSampleAndXY(tr){
    const ac = geofs?.aircraft?.instance; if(!ac) return null;
    const lla = [ac.llaLocation[0], ac.llaLocation[1], ac.llaLocation[2]];
    const htr = [ac.htr[0], ac.htr[1], ac.htr[2]];
    const av  = ac.animationValues || geofs?.animation?.values || {};
    const key = (obj,keys)=>{for(const k of keys){if(obj && obj[k]!=null) return Number(obj[k]);} return null;};
    const gear     = key(av, ['gear','landingGear','gearPosition','landing_gear']); // 0=DOWN, 1=UP
    const flaps    = key(av, ['flaps','flapsPosition','flaps_value']);
    const spoilers = key(av, ['spoilers','spoiler','spoilersPosition']);

    let xy = null;
    if (tr.base){
      const dx = (lla[1] - tr.base.lon0) * tr.base.mLon;
      const dy = (lla[0] - tr.base.lat0) * tr.base.mLat;
      xy = [dx, dy, lla[2]];
    }
    return { lla, htr, state:{gear,flaps,spoilers}, xy };
  }

  /* ---------- Recording ---------- */
  function startRecording(){
    const ac = geofs?.aircraft?.instance; if(!ac){ alert('No aircraft'); return; }
    const url= ac?.object3d?.model?._model?._resource?.url; if(!url){ alert('No model URL'); return; }
    const id='T'+Date.now().toString(36);
    const lat0 = ac.llaLocation[0], lon0 = ac.llaLocation[1];
    const { mLat, mLon } = metersPerDeg(lat0);

    current = {
      id,
      name:(ac.aircraftRecord?.name||'Unknown')+' '+id.slice(-4),
      modelUrl:url, sampleMs: defaultSampleMs,
      data:[],
      base:{ lat0, lon0, mLat, mLon },
      ghost:null,
      nodeCache:{ ready:false, all:[], gear:[], wheels:[], struts:[], doors:[], ladder:[] },
      lastGearUp:null,
      smooth:{ xy: null },
      play:{ playing:false, paused:true, acc:0, index:0, lastT:now() },
      pool:{ lla:[0,0,0], htr:[0,0,0] }
    };
    tracks.push(current);
    guiRefresh(); guiSetRec(true);
    return current;
  }
  // Variant met expliciete tijdstempel (voor perfecte sync)
  function startRecordingAt(t0){
    const tr = startRecording();
    if (tr){
      tr.play.lastT = t0;
      tr.play.acc   = 0;
      tr.play.index = 0;
    }
    return tr;
  }

  function stopRecording(){
    if(!current) return;
    current=null; saveAll(); guiSetRec(false); guiRefresh();
  }

  function recordStep(tr, dtRaw){
    const dt = Math.min(dtRaw, MAX_DT_CAP);
    tr.play.acc += dt;
    let steps=0;
    while (tr.play.acc >= tr.sampleMs && steps < MAX_STEPS){
      const s = readSampleAndXY(tr);
      if (s){
        if (!tr.data.length){ s.xy = [0,0,s.lla[2]]; }
        tr.data.push(s);
      }
      tr.play.acc -= tr.sampleMs; steps++;
    }
  }

  /* ---------- Playback ---------- */
  function spawnGhost(tr){
    try {
      const g = new geofs.api.Model(null,{
        url:tr.modelUrl,
        location:tr.data[0].lla,
        rotation:tr.data[0].htr
      });
      tr.ghost = g;
      // Ladder meteen proberen te verbergen (als ready)
      setCategoryVisible(tr, 'ladder', false);
      return g;
    } catch(e){ console.warn('[SkyDolly] spawnGhost failed:', e); return null; }
  }
  function startPlayback(tr){
    if(!tr?.data?.length) return;
    if(!tr.ghost) tr.ghost = spawnGhost(tr);
    tr.play.playing=true; tr.play.paused=false;
    tr.play.index=0; tr.play.acc=0; tr.play.lastT=now();
    tr.lastGearUp = null;
    tr.smooth.xy = tr.data[0].xy ? [...tr.data[0].xy] : null;

    // Ladder bij start sowieso weg
    setCategoryVisible(tr, 'ladder', false);
  }
  // Variant met expliciete tijd (voor sync-start)
  function startPlaybackAt(tr, t0){
    startPlayback(tr);
    if (tr){
      tr.play.lastT = t0;
      tr.play.acc   = 0;
      tr.play.index = 0;
    }
  }

  function pausePlayback(tr,state){ if(!tr?.play?.playing) return; tr.play.paused=state; tr.play.lastT=now(); }

  function stopPlayback(tr){
    if(!tr) return;
    tr.play.playing=false; tr.play.paused=true;
    if(tr.ghost){ try{tr.ghost.destroy();}catch{} }
    tr.ghost=null;
  }

  function setGhostPose(tr, lla, htr){
    if (!tr.ghost || !tr.ghost.setPositionOrientationAndScale) return;
    const L=tr.pool.lla, H=tr.pool.htr;
    L[0]=lla[0]; L[1]=lla[1]; L[2]=lla[2];
    H[0]=htr[0]; H[1]=htr[1]; H[2]=htr[2];
    try { tr.ghost.setPositionOrientationAndScale(L,H,null); } catch {}
  }

  function interpLLA(a,b,f,out){
    out[0]=lerp(a[0],b[0],f);
    const lonA=a[1], lonB=b[1]; const dlon=((lonB-lonA+540)%360)-180;
    out[1]=lonA+dlon*f;
    out[2]=lerp(a[2],b[2],f);
    return out;
  }

  function catmullRom3(p0,p1,p2,p3,t,out){
    const t2=t*t, t3=t2*t;
    out[0]=0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3);
    out[1]=0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3);
    out[2]=0.5*((2*p1[2])+(-p0[2]+p2[2])*t+(2*p0[2]-5*p1[2]+4*p2[2]-p3[2])*t2+(-p0[2]+3*p1[2]-3*p2[2]+p3[2])*t3);
    return out;
  }

  function playStep(tr, dtRaw){
    if(!tr.play.playing || tr.play.paused || !tr.data.length) return;

    const dt=Math.min(dtRaw, MAX_DT_CAP);
    tr.play.acc += dt;
    let steps=0;
    while(tr.play.acc >= tr.sampleMs && steps < MAX_STEPS){
      tr.play.index++;
      tr.play.acc -= tr.sampleMs;
      steps++;
    }

    const d = tr.data;
    const i1 = clamp(tr.play.index, 0, d.length-1);
    const i2 = Math.min(i1+1, d.length-1);
    let f = tr.play.acc / tr.sampleMs; if(easingOn) f = smoothstep(f);

    // Pos: plane-spline + RC smoothing (indien aanwezig), anders LLA-linear
    let lat, lon, alt;
    if (planeSplineOn && d[i1].xy && d[i2].xy && tr.base){
      const get=(k)=>d[clamp(k,0,d.length-1)].xy;
      const p0=get(Math.max(0,i1-1)), p1=d[i1].xy, p2=d[i2].xy, p3=get(Math.min(d.length-1,i2+1));
      const C=[0,0,0]; catmullRom3(p0,p1,p2,p3,f,C);
      let X=C[0], Y=C[1], Z=C[2];
      if (motionSmoothOn){
        if (!tr.smooth.xy) tr.smooth.xy=[X,Y,Z];
        const alpha = 1 - Math.exp(-dt / Math.max(1, motionTauMs));
        tr.smooth.xy[0] += alpha * (X - tr.smooth.xy[0]);
        tr.smooth.xy[1] += alpha * (Y - tr.smooth.xy[1]);
        tr.smooth.xy[2] += alpha * (Z - tr.smooth.xy[2]);
        X=tr.smooth.xy[0]; Y=tr.smooth.xy[1]; Z=tr.smooth.xy[2];
      }
      lat = tr.base.lat0 + (Y / tr.base.mLat);
      lon = tr.base.lon0 + (X / tr.base.mLon);
      alt = Z;
    } else {
      const L = tr.pool.lla;
      interpLLA(d[i1].lla, d[i2].lla, f, L);
      lat=L[0]; lon=L[1]; alt=L[2];
    }

    // Oriëntatie
    const hdg=lerpAngleDeg(d[i1].htr[0], d[i2].htr[0], f);
    const pit=lerpAngleDeg(d[i1].htr[1], d[i2].htr[1], f);
    const rol=lerpAngleDeg(d[i1].htr[2], d[i2].htr[2], f);
    setGhostPose(tr, [lat,lon,alt], [hdg,pit,rol]);

    // Gear per frame: 0=DOWN, 1=UP
    const g2 = (d[i2].state && d[i2].state.gear != null) ? d[i2].state.gear
             : (d[i1].state ? d[i1].state.gear : null);
    const gearUpNow = (g2 != null) ? (g2 >= 0.5) : false;
    if (tr.lastGearUp !== gearUpNow) {
      applyGearState(tr, gearUpNow);
      tr.lastGearUp = gearUpNow;
    }

    if (i1 >= d.length-1){ tr.play.paused = true; }
  }

  /* ---------- Save/Load/Export/Import ---------- */
  // Save/Load = lokaal via localStorage (sessie/pc)
  // Export/Import JSON = bestand opslaan/laden (delen tussen pc's of bewaren als file)
  const LS_KEY='SkyDolly277';

  function saveAll(){
    try{
      const plain=tracks.map(t=>({
        id:t.id, name:t.name, modelUrl:t.modelUrl, sampleMs:t.sampleMs, base:t.base,
        data:t.data.map(s=>({ lla:s.lla, htr:s.htr, state:s.state, xy:s.xy||null }))
      }));
      localStorage.setItem(LS_KEY, JSON.stringify(plain));
    }catch(e){ console.warn('[SkyDolly] save failed:', e); }
  }
  function loadAll(){
    try{
      const s=localStorage.getItem(LS_KEY); if(!s) return;
      const arr=JSON.parse(s);
      tracks=(arr||[]).map(t=>({
        ...t,
        ghost:null,
        nodeCache:{ ready:false, all:[], gear:[], wheels:[], struts:[], doors:[], ladder:[] },
        lastGearUp:null,
        smooth:{ xy:null },
        play:{ playing:false, paused:true, acc:0, index:0, lastT:now() },
        pool:{ lla:[0,0,0], htr:[0,0,0] }
      }));
    }catch(e){ console.warn('[SkyDolly] load failed:', e); }
  }
  function exportJSON(){
    const plain=tracks.map(t=>({ id:t.id, name:t.name, modelUrl:t.modelUrl, sampleMs:t.sampleMs, base:t.base, data:t.data }));
    const blob=new Blob([JSON.stringify(plain)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='sky-dolly-formation.json'; a.click(); URL.revokeObjectURL(a.href);
  }
  function importJSON(file){
    const rd=new FileReader();
    rd.onload=()=>{ try{
      const arr=JSON.parse(rd.result);
      for(const t of arr){
        tracks.push({
          ...t,
          ghost:null,
          nodeCache:{ ready:false, all:[], gear:[], wheels:[], struts:[], doors:[], ladder:[] },
          lastGearUp:null,
          smooth:{ xy:null },
          play:{ playing:false, paused:true, acc:0, index:0, lastT:now() },
          pool:{ lla:[0,0,0], htr:[0,0,0] }
        });
      }
      saveAll(); guiRefresh();
    }catch(e){ alert('Import failed: '+e); } };
    rd.readAsText(file);
  }

  /* ---------- Sync Start: Formation + New Recording ---------- */
  function startFormationAndRecord() {
    // Lees selectie uit UI
    if (!guiWin || guiWin.closed) { openGui(); }
    const boxes=[...guiWin.document.querySelectorAll('input.track-select[type="checkbox"]')];
    if (!boxes.length) { alert('Selecteer eerst ten minste één track.'); return; }

    // Verzamel tracks
    const selected = [];
    for (const cb of boxes){
      if (cb.checked){
        const tr = tracks.find(t=>t.id===cb.dataset.id);
        if (tr && tr.data && tr.data.length) selected.push(tr);
      }
    }
    if (!selected.length){ alert('Geen geldige tracks geselecteerd.'); return; }

    // Eén t0 voor iedereen
    const t0 = now();

    // Start playback exact op t0
    for (const tr of selected){
      startPlaybackAt(tr, t0);
    }

    // Start nieuwe opname exact op t0
    const rec = startRecordingAt(t0);
    if (rec){
      // UI laat direct de nieuwe track zien
      guiRefresh();
    }
  }

  /* ---------- Model Test panel ---------- */
  let guiWin=null; const gui={};

  function renderModelTestPanel(container){
    // EERSTE track met actieve ghost
    const active = tracks.find(t => t.ghost && t.ghost._model);
    const disabled = !active ? 'disabled' : '';
    const counts = (active && active.nodeCache && active.nodeCache.ready)
      ? `All:${active.nodeCache.all.length} • Gear:${active.nodeCache.gear.length} • Wheels:${active.nodeCache.wheels.length} • Struts:${active.nodeCache.struts.length} • Doors:${active.nodeCache.doors.length} • Ladder:${active.nodeCache.ladder.length}`
      : '(klik “Build/Refresh Cache”)';

    container.innerHTML = `
      <fieldset style="margin-top:10px;">
        <legend>Model Test</legend>

        <div style="margin-bottom:6px;">
          <button id="mtBuild" ${disabled}>Build/Refresh Cache</button>
          <span id="mtCounts" style="margin-left:8px; color:#555;">${counts}</span>
        </div>

        <div style="margin:8px 0;">
          <button id="mtGearUp"  ${disabled}>Gear UP (test)</button>
          <button id="mtGearDown" ${disabled}>Gear DOWN (test)</button>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="mtAllShow" ${disabled}>Show ALL</button>
          <button id="mtAllHide" ${disabled}>Hide ALL</button>

          <button id="mtGearShow" ${disabled}>Show Gear</button>
          <button id="mtGearHide" ${disabled}>Hide Gear</button>

          <button id="mtWheelShow" ${disabled}>Show Wheels</button>
          <button id="mtWheelHide" ${disabled}>Hide Wheels</button>

          <button id="mtStrutShow" ${disabled}>Show Struts</button>
          <button id="mtStrutHide" ${disabled}>Hide Struts</button>

          <button id="mtDoorShow" ${disabled}>Show Doors</button>
          <button id="mtDoorHide" ${disabled}>Hide Doors</button>

          <button id="mtLadderShow" ${disabled}>Show Ladder</button>
          <button id="mtLadderHide" ${disabled}>Hide Ladder</button>
        </div>
      </fieldset>
    `;

    if (!active) return;

    const updateCounts = ()=>{
      const c = (active.nodeCache && active.nodeCache.ready)
        ? `All:${active.nodeCache.all.length} • Gear:${active.nodeCache.gear.length} • Wheels:${active.nodeCache.wheels.length} • Struts:${active.nodeCache.struts.length} • Doors:${active.nodeCache.doors.length} • Ladder:${active.nodeCache.ladder.length}`
        : '(cache not ready)';
      const el = guiWin.document.getElementById('mtCounts');
      if (el) el.textContent = c;
    };

    guiWin.document.getElementById('mtBuild').onclick = ()=>{
      buildNodeCacheDetailed(active);
      // Ladder direct weghalen in cache‑stand
      setCategoryVisible(active, 'ladder', false);
      updateCounts();
    };

    guiWin.document.getElementById('mtGearUp').onclick   = ()=> applyGearState(active, true);
    guiWin.document.getElementById('mtGearDown').onclick = ()=> applyGearState(active, false);

    guiWin.document.getElementById('mtAllShow').onclick   = ()=> setAllVisible(active,true);
    guiWin.document.getElementById('mtAllHide').onclick   = ()=> setAllVisible(active,false);

    guiWin.document.getElementById('mtGearShow').onclick  = ()=> setCategoryVisible(active,'gear',true);
    guiWin.document.getElementById('mtGearHide').onclick  = ()=> setCategoryVisible(active,'gear',false);

    guiWin.document.getElementById('mtWheelShow').onclick = ()=> setCategoryVisible(active,'wheels',true);
    guiWin.document.getElementById('mtWheelHide').onclick = ()=> setCategoryVisible(active,'wheels',false);

    guiWin.document.getElementById('mtStrutShow').onclick = ()=> setCategoryVisible(active,'struts',true);
    guiWin.document.getElementById('mtStrutHide').onclick = ()=> setCategoryVisible(active,'struts',false);

    guiWin.document.getElementById('mtDoorShow').onclick  = ()=> setCategoryVisible(active,'doors',true);
    guiWin.document.getElementById('mtDoorHide').onclick  = ()=> setCategoryVisible(active,'doors',false);

    guiWin.document.getElementById('mtLadderShow').onclick= ()=> setCategoryVisible(active,'ladder',true);
    guiWin.document.getElementById('mtLadderHide').onclick= ()=> setCategoryVisible(active,'ladder',false);
  }

  /* ---------- GUI ---------- */
  function openGui(){
    if (guiWin && !guiWin.closed){ guiWin.focus(); return; }
    guiWin=window.open('', '_blank', 'width=900,height=780');
    guiWin.document.title='Sky Dolly 2.7.7';

    guiWin.document.body.innerHTML=`
      <div style="font-family: Segoe UI, sans-serif; padding:14px;">
        <h2 style="margin:0 0 12px;">Sky Dolly 2.7.7</h2>

        <fieldset style="margin-bottom:10px;">
          <legend>Recording</legend>
          <button id="recBtn">Start Recording</button>
          <label style="margin-left:10px;">Sample:
            <select id="rateSel">
              <option value="100">10 Hz</option>
              <option value="50">20 Hz</option>
              <option value="33" selected>30 Hz</option>
              <option value="16">60 Hz</option>
            </select>
          </label>
          <div style="margin-top:6px;">
            <label><input type="checkbox" id="easeCb" checked> Smooth easing</label>
            <label style="margin-left:12px;"><input type="checkbox" id="splineCb" checked> Plane-spline</label>
            <label style="margin-left:12px;"><input type="checkbox" id="msCb" checked> Motion smoothing</label>
            <label style="margin-left:6px;">τ (ms)
              <input id="tauIn" type="number" value="120" min="20" max="1000" step="10" style="width:70px;">
            </label>
          </div>
        </fieldset>

        <fieldset style="margin-bottom:10px;">
          <legend>Playback</legend>
          <div style="margin-bottom:8px;">
            <button id="playSelBtn">Start Formation (selected)</button>
            <button id="startBothBtn" title="Start selected playback and new recording at same millisecond">Start Formation + New Recording</button>
            <button id="stopAllBtn">Stop All</button>
          </div>
          <div id="tracks"></div>
        </fieldset>

        <fieldset style="margin-bottom:10px;">
          <legend>Storage</legend>
          <div style="margin-bottom:6px;">
            <button id="saveBtn" title="Save: writes all tracks to your browser (localStorage) on this PC">Save (to Browser)</button>
            <button id="loadBtn" title="Load: loads tracks from your browser (localStorage)">Load (from Browser)</button>
          </div>
          <div style="margin-bottom:6px;">
            <button id="exportBtn" title="Export JSON file for backup/sharing">Export JSON</button>
            <label for="importFile" style="margin-left:6px; border:1px solid #888; padding:3px 6px; cursor:pointer;">Import JSON</label>
            <input type="file" id="importFile" accept="application/json" style="display:none;">
          </div>
          <small style="color:#555;">
            <b>Save/Load</b> = opslaan/laden op deze computer (browser).<br/>
            <b>Export/Import</b> = naar/van een JSON-bestand (delen/archiveren).
          </small>
        </fieldset>

        <div id="modelTest"></div>

        <div style="margin-top:10px;"><small id="info" style="color:#444;"></small></div>
      </div>
    `;

    // refs/binds
    gui.recBtn   = guiWin.document.getElementById('recBtn');
    gui.rateSel  = guiWin.document.getElementById('rateSel');
    gui.easeCb   = guiWin.document.getElementById('easeCb');
    gui.splineCb = guiWin.document.getElementById('splineCb');
    gui.msCb     = guiWin.document.getElementById('msCb');
    gui.tauIn    = guiWin.document.getElementById('tauIn');
    gui.saveBtn  = guiWin.document.getElementById('saveBtn');
    gui.loadBtn  = guiWin.document.getElementById('loadBtn');
    gui.exportBtn= guiWin.document.getElementById('exportBtn');
    gui.importFile=guiWin.document.getElementById('importFile');
    gui.tracksDiv= guiWin.document.getElementById('tracks');
    gui.modelTest= guiWin.document.getElementById('modelTest');
    gui.info     = guiWin.document.getElementById('info');

    gui.recBtn.onclick=()=>{ if(!current) startRecording(); else stopRecording(); };
    gui.rateSel.onchange=(e)=>{ defaultSampleMs=Number(e.target.value); };
    gui.easeCb.onchange =(e)=>{ easingOn=!!e.target.checked; };
    gui.splineCb.onchange=(e)=>{ planeSplineOn=!!e.target.checked; };
    gui.msCb.onchange   =(e)=>{ motionSmoothOn=!!e.target.checked; };
    gui.tauIn.onchange  =(e)=>{ motionTauMs=Math.max(20, Math.min(1000, Number(e.target.value)||120)); };
    gui.saveBtn.onclick =saveAll;
    gui.loadBtn.onclick =()=>{ loadAll(); guiRefresh(); renderModelTestPanel(gui.modelTest); };
    gui.exportBtn.onclick=exportJSON;
    gui.importFile.onchange=(e)=>{ const f=e.target.files?.[0]; if(f) importJSON(f); e.target.value=''; };

    guiWin.document.getElementById('playSelBtn').onclick=()=>{
      const boxes=[...guiWin.document.querySelectorAll('input.track-select[type="checkbox"]')];
      boxes.forEach(cb=>{ const id=cb.dataset.id; const tr=tracks.find(t=>t.id===id); if(cb.checked) startPlayback(tr); });
      renderModelTestPanel(gui.modelTest);
    };
    guiWin.document.getElementById('startBothBtn').onclick=()=>{
      startFormationAndRecord();
      renderModelTestPanel(gui.modelTest);
    };
    guiWin.document.getElementById('stopAllBtn').onclick=()=>{
      for (const t of tracks) stopPlayback(t);
      guiRefresh(); renderModelTestPanel(gui.modelTest);
    };

    guiRefresh();
    renderModelTestPanel(gui.modelTest);
  }

  // Naam wijzigen + kaarten renderen
  function guiRefresh(){
    if(!gui.tracksDiv){ return; }
    if(!tracks.length){ gui.tracksDiv.innerHTML=`<p><i>No tracks recorded/loaded yet.</i></p>`; return; }

    gui.tracksDiv.innerHTML = tracks.map(t=>{
      const secs = Math.round((t.data.length * (t.sampleMs||defaultSampleMs))/1000);
      return `
        <div style="border:1px solid #ccc; padding:8px; margin-bottom:8px; border-radius:6px;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <label><input type="checkbox" class="track-select" data-id="${t.id}"> Select</label>
            <input class="nameIn" data-id="${t.id}" value="${(t.name||'Unnamed').replace(/"/g,'&quot;')}" style="min-width:200px;">
            <button class="renameBtn" data-id="${t.id}" title="Rename this flight">Rename</button>
            <span style="color:#666;">• Duration: ${secs}s • Rate: ${(1000/(t.sampleMs||defaultSampleMs)).toFixed(1)} Hz</span>
          </div>
          <div style="margin-top:6px;">
            <small style="color:#666;">${t.modelUrl}</small>
          </div>
          <div style="margin-top:6px;">
            <button class="playBtn" data-id="${t.id}">${t.play.playing?(t.play.paused?'Resume':'Pause'):'Play'}</button>
            <button class="stopBtn" data-id="${t.id}">Stop</button>
            <button class="delBtn" data-id="${t.id}" style="margin-left:6px;">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    // bind acties
    [...guiWin.document.querySelectorAll('.playBtn')].forEach(btn=>{
      btn.onclick=()=>{ const t=tracks.find(x=>x.id===btn.dataset.id);
        if(!t.play.playing) startPlayback(t); else pausePlayback(t, !t.play.paused);
        guiRefresh(); renderModelTestPanel(gui.modelTest);
      };
    });
    [...guiWin.document.querySelectorAll('.stopBtn')].forEach(btn=>{
      btn.onclick=()=>{ const t=tracks.find(x=>x.id===btn.dataset.id);
        stopPlayback(t); guiRefresh(); renderModelTestPanel(gui.modelTest);
      };
    });
    [...guiWin.document.querySelectorAll('.delBtn')].forEach(btn=>{
      btn.onclick=()=>{ const id=btn.dataset.id; const ix=tracks.findIndex(x=>x.id===id);
        if(ix>=0){ stopPlayback(tracks[ix]); tracks.splice(ix,1); saveAll(); guiRefresh(); renderModelTestPanel(gui.modelTest); }
      };
    });
    [...guiWin.document.querySelectorAll('.renameBtn')].forEach(btn=>{
      btn.onclick=()=>{ const id=btn.dataset.id;
        const inp=guiWin.document.querySelector(`.nameIn[data-id="${id}"]`);
        const t=tracks.find(x=>x.id===id);
        if (t && inp){ t.name = inp.value.trim() || t.name; saveAll(); guiRefresh(); }
      };
    });
  }

  /* ---------- RAF ---------- */
  function mainRAF(){
    requestAnimationFrame(mainRAF);

    // Recording
    if (current){
      const t=now(); const dt=Math.min(t-current.play.lastT, MAX_DT_CAP); current.play.lastT=t;
      recordStep(current, dt);
      if (gui.info) gui.info.textContent=`REC • samples=${current.data.length} • rate=${(1000/current.sampleMs).toFixed(1)} Hz`;
    } else if (gui.info){
      const playing=tracks.filter(t=>t.play.playing && !t.play.paused).length;
      gui.info.textContent=`Tracks: ${tracks.length} • Playing: ${playing} • Smooth: ${planeSplineOn?'Plane-spline':''}${motionSmoothOn?' + RC':''}${(!planeSplineOn && !motionSmoothOn)?' (LLA-linear)':''}`;
    }

    // Playback
    for (const tr of tracks){
      if (!tr.play.playing) continue;
      const t=now(); const dt=Math.min(t-tr.play.lastT, MAX_DT_CAP); tr.play.lastT=t;
      if(!tr.play.paused) playStep(tr, dt);
    }
  }

  /* ---------- Boot ---------- */
  function addBtn(){
    const b=document.createElement('button');
    b.textContent='Sky Dolly 2.7.7';
    b.style.cssText='position:absolute;top:20px;right:20px;padding:6px 10px;z-index:999999;cursor:pointer;';
    b.onclick=openGui;
    document.body.appendChild(b);
  }

  // Start
  loadAll();
  addBtn();
  requestAnimationFrame(mainRAF);
})();