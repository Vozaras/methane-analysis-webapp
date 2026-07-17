/*
 * Methane Source Mapping — front-end logic.
 * Hand-ported from the Claude Design source "Methane Detection - H.dc.html"
 * to plain vanilla JS (no React, no design runtime). Mirrors that file's data
 * and behaviour; the interactive regions are rendered into stable containers
 * declared in index.html.
 *
 * MODEL BACKEND: only the MAP-CAPTURE flow calls the real model. runAnalysis()
 * POSTs the captured scene to `${API_BASE}/predict` as multipart/form-data and
 * renders the returned per-class confidences. In production API_BASE is "/api"
 * and a same-origin Caddy proxy forwards /api/* to the model backend — so there
 * is no CORS. The backend is unauthenticated. (Health-check polling is currently
 * removed — the Capture button always fires /predict.) The CHANNEL-SCENE flow does NOT hit
 * the backend: runDemoAnalysis() reveals the selected scene's real per-channel-set
 * scores from window.GALLERY (gallery-data.js) so the demo is smooth and always
 * works. See config.js, Caddyfile and BACKEND_API.md. The six classes are R&T,
 * CAFO, PROC, MINE, LNDFL, WWTP. RESULTS below is a fallback used only until the
 * first live response arrives.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ helpers
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var MONO = "'JetBrains Mono',monospace";

  function esri(cx, cy, sx, sy, w, h) {
    var bbox = (cx - sx) + ',' + (cy - sy) + ',' + (cx + sx) + ',' + (cy + sy);
    return 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=' +
      bbox + '&bboxSR=4326&size=' + w + ',' + h + '&format=jpg&f=image';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ----------------------------------------------------------- backend config
  // Read from config.js (window.METHANE_CONFIG), with safe fallbacks.
  var CFG = window.METHANE_CONFIG || {};
  var API_BASE = (CFG.API_BASE || '/api').replace(/\/+$/, '');   // strip trailing slash
  var PREDICT_TIMEOUT_MS = CFG.PREDICT_TIMEOUT_MS || 60000;
  var HEALTH_TIMEOUT_MS = CFG.HEALTH_TIMEOUT_MS || 30000;

  // fetch() with a hard timeout so a hung backend can't freeze the UI forever.
  // Same-origin (via the proxy) and unauthenticated, so no extra headers.
  function fetchWithTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    opts = opts || {}; opts.signal = ctrl.signal;
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  // Map the backend's per-class keys → the UI's fixed `abbr` codes. The /predict
  // response is a flat object { "<ClassName>": <conf 0..1>, ... }. Older builds
  // returned { results:[{abbr,conf}] }; normalizePredict() accepts either and
  // always yields the [{abbr, conf}] array the render path expects.
  var PREDICT_KEY_TO_ABBR = {
    RefineriesAndTerminals: 'R&T',
    CAFOs: 'CAFO',
    ProcessingPlants: 'PROC',
    Mines: 'MINE',
    Landfills: 'LNDFL',
    WWTreatment: 'WWTP',
  };
  function normalizePredict(data) {
    if (!data || typeof data !== 'object') return [];
    // Old contract: an explicit results array of { abbr, conf }.
    if (Array.isArray(data.results)) {
      return data.results
        .filter(function (r) { return r && r.abbr; })
        .map(function (r) { return { abbr: r.abbr, name: r.name, conf: +r.conf || 0 }; });
    }
    // Current contract: a flat map of ClassName → confidence.
    return Object.keys(PREDICT_KEY_TO_ABBR).reduce(function (out, key) {
      if (typeof data[key] === 'number') out.push({ abbr: PREDICT_KEY_TO_ABBR[key], conf: data[key] });
      return out;
    }, []);
  }

  // The backend names the live model by an internal id — /health returns
  // { model: "<id>" } and /predict may echo the same. Map those ids to the
  // friendly label shown in the UI so a raw id never leaks onto the screen.
  // The service currently always runs the same fine-tuned EfficientNetV2B0.
  var MODEL_LABELS = {
    best_naip_rgb_effnet_finetuned: 'EfficientNetV2B0 (fine-tuned)',
  };
  function friendlyModel(id) {
    if (!id) return '';
    return MODEL_LABELS[id] || String(id);
  }
  // Friendly label of the model /health reports as live; used as the default
  // MODEL shown in the analysis panel. Overwritten by checkHealth() on load.
  var liveModel = 'EfficientNetV2B0 (fine-tuned)';

  // --------------------------------------------------------------------- data
  var FACILITIES = [
    { abbr: 'R&T', name: 'Refineries & Terminals', c: [-93.935, 29.868] },
    { abbr: 'CAFO', name: 'Feeding Operations', c: [-102.320, 34.900] },
    { abbr: 'PROC', name: 'Gas Processing Plants', c: [-102.350, 31.900] },
    { abbr: 'MINE', name: 'Coal Mines', c: [-105.300, 43.720] },
    { abbr: 'LNDFL', name: 'Landfills', c: [-114.980, 36.360] },
    { abbr: 'WWTP', name: 'Wastewater Plants', c: [-87.770, 41.810] },
  ];

  // Demo scenes come from window.GALLERY (gallery-data.js): 15 curated scenes with
  // pre-baked RGB/IR thumbnails and real per-scene, per-channel-set model scores.
  // galleryScenes() degrades gracefully to [] if the data file failed to load.
  function galleryScenes() { return (window.GALLERY && window.GALLERY.length) ? window.GALLERY : []; }

  var CHANNELS = [
    { id: 'naip-rgb', name: 'NAIP RGB', desc: 'High-resolution aerial imagery in the visible spectrum — red, green and blue bands.', model: 'RGB branch', bands: '3-BAND', filter: 'none' },
    { id: 'naip-ir', name: 'NAIP NIR', desc: 'Color-infrared composite. The near-infrared band exposes vegetation strength and thermal moisture.', model: 'NIR branch', bands: '4-BAND', filter: 'sepia(1) hue-rotate(-35deg) saturate(2.6) contrast(1.05)' },
    { id: 'sentinel', name: 'Sentinel', desc: 'Frequently updated multispectral satellite data at 10–60 m resolution, including short-wave infrared bands.', model: 'S1 + S2 branches', bands: '13-BAND', filter: 'saturate(1.35) contrast(0.94) brightness(1.06) blur(0.3px)' },
  ];

  var MODEL_BRANCHES = [
    { id: 'rgb', name: 'NAIP aerial · RGB', shape: '720×720×3', res: '1 m', color: 'naip', stem: 'backbone' },
    { id: 'nir', name: 'NAIP aerial · NIR', shape: '720×720×1', res: '1 m', color: 'naip', stem: 'Conv ×3 · GAP' },
    { id: 's2a', name: 'Sentinel-2 · 10 m', shape: '72×72×4', res: '10 m', color: 's2', stem: 'Conv ×2 · GAP' },
    { id: 's2b', name: 'Sentinel-2 · 20 m', shape: '36×36×6', res: '20 m', color: 's2', stem: 'Conv ×2 · GAP' },
    { id: 's2c', name: 'Sentinel-2 · 60 m', shape: '12×12×3', res: '60 m', color: 's2', stem: 'Conv ×2 · GAP' },
    { id: 's1', name: 'Sentinel-1 · SAR', shape: '72×72×2', res: '10 m', color: 's1', stem: 'Conv ×2 · GAP' },
  ];
  var MODEL_CLASS_NAMES = ['CAFOs', 'Landfills', 'Mines', 'Proc. Plants', 'Refineries & Terminals', 'WW Treatment'];
  var MODEL_CLASS_ABBR = ['CAFO', 'LNDFL', 'MINE', 'PROC', 'R&T', 'WWTP'];
  var MODEL_PAPER = { macro: 0.558, perClass: [0.915, 0.259, 0.470, 0.350, 0.821, 0.534] };
  var MODEL_CONFIGS = [
    { id: 'bce-rgb', label: 'NAIP RGB', tag: 'Binary CE', branches: ['rgb'], backbone: 'DenseNet121', macro: 0.752, perClass: [0.916, 0.670, 0.779, 0.667, 0.870, 0.612] },
    { id: 'focal-rgb', label: 'NAIP RGB', tag: 'Focal CE', branches: ['rgb'], backbone: 'DenseNet121', macro: 0.753, perClass: [0.925, 0.685, 0.776, 0.650, 0.881, 0.603] },
    { id: 'naip-4ch', label: 'NAIP RGB + NIR', tag: 'Binary CE', branches: ['rgb', 'nir'], backbone: 'DenseNet121', macro: 0.758, perClass: [0.922, 0.704, 0.778, 0.687, 0.866, 0.589] },
    { id: 'all-dn-scaled', label: 'All sensors', tag: 'scaled S1/S2', branches: ['rgb', 'nir', 's2a', 's2b', 's2c', 's1'], backbone: 'DenseNet121', macro: 0.758, perClass: [0.952, 0.667, 0.756, 0.693, 0.898, 0.582] },
    { id: 'ft-rgb', label: 'NAIP RGB', tag: 'EffNet · fine-tuned', branches: ['rgb'], backbone: 'EfficientNetV2B0', macro: 0.839, perClass: [0.938, 0.803, 0.810, 0.760, 0.921, 0.802] },
    { id: 'ft-4ch', label: 'NAIP RGB + NIR', tag: 'EffNet · fine-tuned', branches: ['rgb', 'nir'], backbone: 'EfficientNetV2B0', macro: 0.841, perClass: [0.941, 0.805, 0.819, 0.764, 0.935, 0.782] },
    { id: 'ft-all', label: 'All sensors', tag: 'EffNet · fine-tuned', champion: true, branches: ['rgb', 'nir', 's2a', 's2b', 's2c', 's1'], backbone: 'EfficientNetV2B0', macro: 0.852, perClass: [0.950, 0.800, 0.832, 0.776, 0.943, 0.808] },
  ];
  var CM = [
    { name: 'CAFOs', tn: 904, fp: 22, fn: 5, tp: 87 },
    { name: 'Landfills', tn: 881, fp: 26, fn: 36, tp: 75 },
    { name: 'Mines', tn: 925, fp: 21, fn: 20, tp: 52 },
    { name: 'Proc. Plants', tn: 908, fp: 3, fn: 60, tp: 47 },
    { name: 'Refineries & Terminals', tn: 900, fp: 10, fn: 15, tp: 93 },
    { name: 'WW Treatment', tn: 838, fp: 51, fn: 29, tp: 100 },
  ];
  var DATASET = [
    { abbr: 'CAFO', name: 'Feeding Operations', total: 25096, train: '29.3%', test: '9.0%' },
    { abbr: 'LNDFL', name: 'Landfills', total: 4242, train: '4.8%', test: '10.9%' },
    { abbr: 'MINE', name: 'Coal Mines', total: 1888, train: '2.1%', test: '7.1%' },
    { abbr: 'PROC', name: 'Gas Processing Plants', total: 2045, train: '2.2%', test: '10.5%' },
    { abbr: 'R&T', name: 'Refineries & Terminals', total: 4179, train: '4.7%', test: '10.6%' },
    { abbr: 'WWTP', name: 'Wastewater Plants', total: 14694, train: '17.1%', test: '12.7%' },
    { abbr: 'NEG', name: 'Negatives', total: 34870, train: '40.2%', test: '41.8%', neg: true },
  ];
  // demo confidences shown on the results screen (fallback until first live result)
  var RESULTS = [
    { abbr: 'R&T', name: 'Refineries & Terminals', conf: 0.94 },
    { abbr: 'PROC', name: 'Gas Processing Plants', conf: 0.71 },
    { abbr: 'WWTP', name: 'Wastewater Plants', conf: 0.29 },
    { abbr: 'LNDFL', name: 'Landfills', conf: 0.11 },
    { abbr: 'CAFO', name: 'Feeding Operations', conf: 0.04 },
    { abbr: 'MINE', name: 'Coal Mines', conf: 0.02 },
  ];
  // Display order for the 6 facility classes — matches window.GALLERY score arrays
  // (each scene's scores.{rgb,all4,all} is [R&T, PROC, WWTP, LNDFL, CAFO, MINE]).
  var SCORE_ORDER = ['R&T', 'PROC', 'WWTP', 'LNDFL', 'CAFO', 'MINE'];

  // -------------------------------------------------------------------- state
  var state = {
    view: 'demo', phase: 'idle', threshold: 0.5,
    channels: ['naip-rgb'], scene: null,
    modelName: 'EfficientNetV2B0 (fine-tuned)', bandLabel: '3-BAND', resultFilter: 'none',
    modelSel: MODEL_CONFIGS.length - 1, cmSel: 0,
    fileName: 'demo_scene.png', logLines: [], capturedUrl: null,
    resultFallback: '',     // ESRI tile to swap the result image to if capturedUrl fails to load
    // backend wiring
    results: null,          // live per-class confidences from /predict (null → use RESULTS)
    errorMsg: '',           // message shown in the phase:'error' panel
    logTimer: null,         // interval id for the cosmetic log ticker
  };
  var leaflet = null;

  // ------------------------------------------------------- static list render
  function renderStatic() {
    // intro facility chips
    $('introChips').innerHTML = FACILITIES.map(function (f) {
      return '<span style="background:transparent; color:#f4f3e8; border:1px solid #ebfc72; font-family:' + MONO + '; font-size:13px; padding:5px 9px; border-radius:3.6px; letter-spacing:0;">' + esc(f.abbr) + ' — ' + esc(f.name) + '</span>';
    }).join('');

    // intro gallery (6, square)
    $('introGallery').innerHTML = FACILITIES.map(function (f) {
      var url = esri(f.c[0], f.c[1], 0.013, 0.010, 600, 600);
      return '<div style="position:relative; aspect-ratio:1/1; overflow:hidden; background:#13140e;">' +
        '<img src="' + url + '" alt="' + esc(f.name) + '" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">' +
        '<div style="position:absolute; inset:0; background:linear-gradient(to top, rgba(19,20,14,0.85), transparent 60%);"></div>' +
        '<div style="position:absolute; left:9px; bottom:9px; right:9px;"><div style="display:inline-block; background:#ebfc72; color:#13140e; font-family:' + MONO + '; font-size:11px; padding:2px 5px; border-radius:3.6px; letter-spacing:0;">' + esc(f.abbr) + '</div></div></div>';
    }).join('');

    // data facility gallery (6, square — same layout as the intro gallery)
    $('dataFacilityGallery').innerHTML = FACILITIES.map(function (f) {
      var url = esri(f.c[0], f.c[1], 0.013, 0.010, 600, 600);
      return '<div style="position:relative; aspect-ratio:1/1; overflow:hidden; background:#13140e;">' +
        '<img src="' + url + '" alt="' + esc(f.name) + '" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">' +
        '<div style="position:absolute; inset:0; background:linear-gradient(to top, rgba(19,20,14,0.85), transparent 60%);"></div>' +
        '<div style="position:absolute; left:9px; bottom:9px; right:9px;"><div style="display:inline-block; background:#ebfc72; color:#13140e; font-family:' + MONO + '; font-size:11px; padding:2px 5px; border-radius:3.6px; letter-spacing:0;">' + esc(f.abbr) + '</div></div></div>';
    }).join('');

    // dataset class-distribution bars
    var maxTotal = Math.max.apply(null, DATASET.map(function (d) { return d.total; }));
    $('dataClassBars').innerHTML = DATASET.map(function (d) {
      var fill = d.neg ? '#404040' : '#ebfc72';
      var labelColor = d.neg ? '#84837b' : '#f4f3e8';
      var width = (d.total / maxTotal * 100).toFixed(1) + '%';
      return '<div><div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">' +
        '<span style="font-family:' + MONO + '; font-size:13px; color:' + labelColor + '; letter-spacing:0;">' + esc(d.abbr) + ' — ' + esc(d.name) + '</span>' +
        '<span style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0;">n = ' + d.total.toLocaleString('en-US') + '</span></div>' +
        '<div style="height:8px; background:#1d1e16; border:1px solid #404040; border-radius:3.6px; overflow:hidden;"><div style="height:100%; width:' + width + '; background:' + fill + ';"></div></div>' +
        '<div style="font-family:' + MONO + '; font-size:10.5px; color:#6b6a62; letter-spacing:0; margin-top:5px;">train prev ' + d.train + ' · test prev ' + d.test + '</div></div>';
    }).join('');

    // scores: per-class champion vs paper
    var champ = MODEL_CONFIGS[MODEL_CONFIGS.length - 1];
    $('scoreBars').innerHTML = MODEL_CLASS_NAMES.map(function (n, k) {
      var champH = (champ.perClass[k] * 100).toFixed(1) + '%';
      var paperH = (MODEL_PAPER.perClass[k] * 100).toFixed(1) + '%';
      return '<div style="display:grid; grid-template-columns:200px 1fr 52px; gap:14px; align-items:center;">' +
        '<span style="font-family:' + MONO + '; font-size:13px; color:#f4f3e8; letter-spacing:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(n) + '</span>' +
        '<div style="position:relative; height:14px; background:#1d1e16; border:1px solid #404040; border-radius:3.6px;">' +
        '<div style="position:absolute; left:0; top:0; bottom:0; border-radius:3.6px; width:' + champH + '; background:#ebfc72;"></div>' +
        '<div style="position:absolute; top:-2px; bottom:-2px; left:' + paperH + '; width:2px; background:#f4f3e8; box-shadow:0 0 0 1px rgba(19,20,14,0.9);"></div></div>' +
        '<span style="font-family:' + MONO + '; font-size:14px; color:#ebfc72; text-align:right;">' + champ.perClass[k].toFixed(3) + '</span></div>';
    }).join('');

    // scores: macro AUPRC by configuration
    var macroRows = [
      { label: 'Paper · expert ensemble', val: 0.558, paper: true },
      { label: 'BCE · NAIP-RGB', val: 0.752 },
      { label: 'Focal · NAIP-RGB', val: 0.753 },
      { label: 'BCE · NAIP 4ch', val: 0.758 },
      { label: 'NAIP RGB · EffNet FT', val: 0.839 },
      { label: 'AllImg · DenseNet scaled', val: 0.758 },
      { label: 'NAIP 4ch · EffNet FT', val: 0.841 },
      { label: 'AllImg · EffNet FT', val: 0.852, champ: true },
    ];
    $('macroChart').innerHTML = macroRows.map(function (r) {
      var fill = r.paper ? '#404040' : '#ebfc72';
      var op = r.paper ? '1' : (r.champ ? '1' : '0.5');
      var valColor = r.champ ? '#ebfc72' : '#84837b';
      var labelColor = r.champ ? '#f4f3e8' : '#84837b';
      return '<div style="display:grid; grid-template-columns:200px 1fr 52px; gap:14px; align-items:center;">' +
        '<span style="font-family:' + MONO + '; font-size:13px; color:' + labelColor + '; letter-spacing:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(r.label) + '</span>' +
        '<div style="position:relative; height:14px; background:#1d1e16; border:1px solid #404040; border-radius:3.6px; overflow:hidden;">' +
        '<div style="position:absolute; left:0; top:0; bottom:0; border-radius:3.6px; width:' + (r.val * 100).toFixed(1) + '%; background:' + fill + '; opacity:' + op + ';"></div></div>' +
        '<span style="font-family:' + MONO + '; font-size:14px; color:' + valColor + '; text-align:right;">' + r.val.toFixed(3) + '</span></div>';
    }).join('');
  }

  // ---------------------------------------------------------- model (03) zone
  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function buildModelDiagram(cfg) {
    var P = { naip: '#ebfc72', s2: '#7cc7e8', s1: '#e6b45e', fusion: '#f4f3e8', gold: '#ebfc72', off: '#404040', text: '#f4f3e8', muted: '#84837b', faint: '#6b6a62' };
    var sans = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
    var W = 980, rowH = 78, top = 46, H = top + MODEL_BRANCHES.length * rowH + 26;
    var yOf = function (i) { return top + i * rowH + rowH / 2; };
    var concatX = 556, concatY = (yOf(0) + yOf(5)) / 2;
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Architecture diagram for ' + cfg.label + ' ' + cfg.tag });
    root.setAttribute('style', 'width:100%; height:auto; display:block;');
    [[133, 'SENSOR INPUTS'], [385, 'PER-SENSOR BRANCH'], [concatX + 48, 'FUSION'], [756, 'HEAD']].forEach(function (c) {
      root.appendChild(svg('text', { x: c[0], y: 26, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 11, 'letter-spacing': '2' }, c[1]));
    });
    root.appendChild(svg('text', { x: 908, y: 22, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 11, 'letter-spacing': '1' }, 'MULTI-LABEL'));
    root.appendChild(svg('text', { x: 908, y: 36, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 11, 'letter-spacing': '1' }, 'CLASSIFICATION'));
    MODEL_BRANCHES.forEach(function (b, i) {
      var on = cfg.branches.indexOf(b.id) >= 0;
      var y = yOf(i), col = on ? P[b.color] : P.off, isBk = b.stem === 'backbone';
      var unfrozen = cfg.backbone === 'EfficientNetV2B0';   // fine-tuned backbone is unfrozen
      var stemLabel = isBk ? cfg.backbone : b.stem, stemW = 170;
      var g = svg('g', { opacity: on ? 1 : 0.28 });
      g.appendChild(svg('rect', { x: 24, y: y - 26, width: 218, height: 52, rx: 8, fill: 'none', stroke: col, 'stroke-width': 1.4 }));
      g.appendChild(svg('text', { x: 38, y: y - 6, fill: P.text, 'font-family': sans, 'font-size': 14, 'font-weight': 600 }, b.name));
      g.appendChild(svg('text', { x: 38, y: y + 14, fill: P.muted, 'font-family': MONO, 'font-size': 12 }, b.shape + ' · ' + b.res + '/px'));
      g.appendChild(svg('line', { x1: 242, y1: y, x2: 300, y2: y, stroke: col, 'stroke-width': 1.4 }));
      g.appendChild(svg('rect', { x: 300, y: y - 22, width: stemW, height: 44, rx: 8, fill: (on && isBk) ? '#23241b' : 'none', stroke: col, 'stroke-width': isBk ? 2 : 1.4 }));
      g.appendChild(svg('text', { x: 310, y: y - 2, fill: P.text, 'font-family': MONO, 'font-size': 12.5, 'font-weight': isBk ? 700 : 400 }, stemLabel));
      g.appendChild(svg('text', { x: 310, y: y + 14, fill: (isBk && unfrozen) ? P.gold : P.faint, 'font-family': MONO, 'font-size': 10.5 }, isBk ? ('ImageNet · ' + (unfrozen ? 'unfrozen' : 'frozen') + ' · GAP') : 'trained from scratch'));
      g.appendChild(svg('path', { d: 'M ' + (300 + stemW) + ' ' + y + ' C ' + (concatX - 60) + ' ' + y + ', ' + (concatX - 60) + ' ' + concatY + ', ' + concatX + ' ' + concatY, fill: 'none', stroke: col, 'stroke-width': 1.4, opacity: 0.85 }));
      root.appendChild(g);
    });
    var gc = svg('g', {});
    gc.appendChild(svg('rect', { x: concatX, y: concatY - 34, width: 96, height: 68, rx: 10, fill: '#1d1e16', stroke: P.gold, 'stroke-width': 1.6 }));
    gc.appendChild(svg('text', { x: concatX + 48, y: concatY - 4, 'text-anchor': 'middle', fill: P.gold, 'font-family': MONO, 'font-size': 12.5, 'font-weight': 700 }, 'Concat'));
    gc.appendChild(svg('text', { x: concatX + 48, y: concatY + 14, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 10.5 }, cfg.branches.length + ' branch' + (cfg.branches.length > 1 ? 'es' : '')));
    root.appendChild(gc);
    root.appendChild(svg('line', { x1: concatX + 96, y1: concatY, x2: 708, y2: concatY, stroke: P.gold, 'stroke-width': 1.4 }));
    root.appendChild(svg('rect', { x: 708, y: concatY - 26, width: 96, height: 52, rx: 8, fill: 'none', stroke: P.gold, 'stroke-width': 1.6 }));
    root.appendChild(svg('text', { x: 756, y: concatY - 4, 'text-anchor': 'middle', fill: P.text, 'font-family': MONO, 'font-size': 12.5 }, 'Dense 200'));
    root.appendChild(svg('text', { x: 756, y: concatY + 14, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 10.5 }, 'ReLU'));
    root.appendChild(svg('line', { x1: 804, y1: concatY, x2: 860, y2: concatY, stroke: P.gold, 'stroke-width': 1.4 }));
    var go = svg('g', {});
    go.appendChild(svg('rect', { x: 860, y: concatY - 92, width: 96, height: 184, rx: 8, fill: 'none', stroke: P.gold, 'stroke-width': 1.8 }));
    go.appendChild(svg('text', { x: 908, y: concatY - 74, 'text-anchor': 'middle', fill: P.text, 'font-family': MONO, 'font-size': 11.5 }, 'σ × 6'));
    cfg.perClass.forEach(function (v, k) {
      var cy = concatY - 44 + k * 20;
      go.appendChild(svg('circle', { cx: 878, cy: cy, r: 4.5, fill: P.gold, opacity: 0.35 + 0.65 * v }));
      go.appendChild(svg('text', { x: 893, y: cy + 4, fill: P.text, 'font-family': MONO, 'font-size': 12 }, MODEL_CLASS_ABBR[k]));
    });
    go.appendChild(svg('text', { x: 908, y: concatY + 80, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 10.5 }, 'Sigmoid'));
    root.appendChild(go);
    return root;
  }
  function renderModels() {
    var sel = Math.min(state.modelSel, MODEL_CONFIGS.length - 1);
    var cfg = MODEL_CONFIGS[sel];
    // chips
    $('modelChips').innerHTML = MODEL_CONFIGS.map(function (c, i) {
      var on = i === sel;
      var idx = String(i + 1).padStart(2, '0');
      return '<button data-model="' + i + '" style="font-family:' + MONO + '; font-size:12px; padding:9px 12px; border-radius:3.6px; background:' + (on ? '#23241b' : 'transparent') + '; border:1px solid ' + (on ? '#ebfc72' : '#404040') + '; color:' + (on ? '#f4f3e8' : '#84837b') + '; cursor:pointer; letter-spacing:0;">' +
        '<span style="color:#6b6a62; margin-right:6px;">' + idx + '</span>' + esc(c.label) + ' <span style="color:#6b6a62;">· ' + esc(c.tag) + '</span><span style="color:#ebfc72; margin-left:6px;">' + (c.champion ? '★' : '') + '</span></button>';
    }).join('');
    // diagram
    var dia = $('modelDiagram'); dia.replaceChildren(buildModelDiagram(cfg));
    // metrics
    var md = cfg.macro - MODEL_PAPER.macro;
    var color = cfg.champion ? '#ebfc72' : '#f4f3e8';
    $('modelMacro').textContent = cfg.macro.toFixed(3); $('modelMacro').style.color = color;
    $('modelDelta').textContent = (md >= 0 ? '+' : '') + md.toFixed(3) + ' vs paper';
    var bar = $('modelMacroBar'); bar.style.background = color; bar.style.width = (cfg.macro * 100).toFixed(1) + '%';
  }

  // ------------------------------------------------------ confusion (04) zone
  function renderConfusion() {
    var sel = Math.min(state.cmSel, CM.length - 1);
    $('cmChips').innerHTML = CM.map(function (c, i) {
      var on = i === sel;
      return '<button data-cm="' + i + '" style="font-family:' + MONO + '; font-size:12px; padding:8px 12px; border-radius:3.6px; background:' + (on ? '#23241b' : 'transparent') + '; border:1px solid ' + (on ? '#ebfc72' : '#404040') + '; color:' + (on ? '#f4f3e8' : '#84837b') + '; cursor:pointer; letter-spacing:0;">' + esc(c.name) + '</button>';
    }).join('');
    var cm = CM[sel];
    var rowAbs = cm.tn + cm.fp, rowPres = cm.fn + cm.tp;
    function cell(v, total, correct) {
      var frac = total ? v / total : 0;
      var a = (0.1 + 0.9 * frac).toFixed(3);
      return { v: v, bg: (correct ? 'rgba(235,252,114,' : 'rgba(228,120,90,') + a + ')', fg: frac > 0.55 ? '#13140e' : '#f4f3e8' };
    }
    var tn = cell(cm.tn, rowAbs, true), fp = cell(cm.fp, rowAbs, false), fn = cell(cm.fn, rowPres, false), tp = cell(cm.tp, rowPres, true);
    var prec = (cm.tp / (cm.tp + cm.fp)).toFixed(3), rec = (cm.tp / (cm.tp + cm.fn)).toFixed(3);
    var present = cm.fn + cm.tp, absent = cm.tn + cm.fp;
    function box(o) { return '<div style="height:96px; display:flex; align-items:center; justify-content:center; border-radius:3.6px; background:' + o.bg + '; color:' + o.fg + '; font-family:' + MONO + '; font-size:24px;">' + o.v + '</div>'; }
    $('cmPanel').innerHTML =
      '<div><div style="font-family:' + MONO + '; font-size:11px; color:#6b6a62; letter-spacing:0.12em; text-align:center; margin-bottom:8px; padding-left:104px;">PREDICTED LABEL</div>' +
      '<div style="display:grid; grid-template-columns:104px 130px 130px; grid-auto-rows:auto; gap:6px; align-items:center;">' +
      '<div></div>' +
      '<div style="font-family:' + MONO + '; font-size:12px; color:#84837b; text-align:center;">Absent</div>' +
      '<div style="font-family:' + MONO + '; font-size:12px; color:#84837b; text-align:center;">Present</div>' +
      '<div style="font-family:' + MONO + '; font-size:12px; color:#84837b; text-align:right; padding-right:10px;">Absent</div>' + box(tn) + box(fp) +
      '<div style="font-family:' + MONO + '; font-size:12px; color:#84837b; text-align:right; padding-right:10px;">Present</div>' + box(fn) + box(tp) +
      '</div></div>' +
      '<div style="display:flex; flex-direction:column; gap:16px;">' +
      '<div style="font-size:20px; letter-spacing:-0.6px;">' + esc(cm.name) + '</div>' +
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:2px; background:#404040; border:1px solid #404040; max-width:280px;">' +
      '<div style="background:#13140e; padding:14px 16px;"><div style="font-family:' + MONO + '; font-size:11px; color:#84837b;">PRECISION</div><div style="font-family:' + MONO + '; font-size:24px; color:#ebfc72; margin-top:4px;">' + prec + '</div></div>' +
      '<div style="background:#13140e; padding:14px 16px;"><div style="font-family:' + MONO + '; font-size:11px; color:#84837b;">RECALL</div><div style="font-family:' + MONO + '; font-size:24px; color:#ebfc72; margin-top:4px;">' + rec + '</div></div></div>' +
      '<div style="font-family:' + MONO + '; font-size:12px; color:#84837b; letter-spacing:0; line-height:1.9;">TEST SUPPORT · ' + present + ' PRESENT · ' + absent + ' ABSENT<br>ROWS = TRUE LABEL · COLUMNS = PREDICTED · <span style="color:#ebfc72;">■</span> CORRECT · <span style="color:#e4785a;">■</span> ERROR</div></div>';
  }

  // -------------------------------------------------------- channels demo zone
  function routeModel(channels) {
    var byId = function (id) { return MODEL_CONFIGS.filter(function (c) { return c.id === id; })[0]; };
    if (channels.indexOf('sentinel') >= 0) return byId('ft-all');
    if (channels.indexOf('naip-ir') >= 0) return byId('ft-4ch');
    if (channels.indexOf('naip-rgb') >= 0) return byId('ft-rgb');
    return byId('ft-all');
  }
  function channelFilter() {
    // Priority order: NAIP NIR wins over Sentinel so its sepia/hue tint always shows
    // when NIR is selected, even alongside Sentinel.
    var order = ['naip-ir', 'sentinel', 'naip-rgb'];
    for (var i = 0; i < order.length; i++) {
      if (state.channels.indexOf(order[i]) >= 0) {
        var c = CHANNELS.filter(function (x) { return x.id === order[i]; })[0];
        if (c) return c.filter;
      }
    }
    return 'none';
  }
  function channelById(id) { return CHANNELS.filter(function (c) { return c.id === id; })[0] || {}; }
  // Channel selection is hierarchical: NAIP RGB is always required; NAIP NIR is a
  // prerequisite for Sentinel. Valid states are ['naip-rgb'], ['naip-rgb','naip-ir'],
  // ['naip-rgb','naip-ir','sentinel'].
  function toggleChannel(id) {
    if (id === 'naip-rgb') return;                      // always on, can't be toggled off
    var has = function (c) { return state.channels.indexOf(c) >= 0; };
    if (id === 'naip-ir') {
      // turning IR off also drops Sentinel (IR is its prerequisite)
      state.channels = has('naip-ir') ? ['naip-rgb'] : ['naip-rgb', 'naip-ir'];
    } else {                                            // sentinel
      state.channels = has('sentinel') ? ['naip-rgb', 'naip-ir'] : ['naip-rgb', 'naip-ir', 'sentinel'];
    }
  }
  function renderChannels() {
    $('channelCards').innerHTML = CHANNELS.map(function (ch) {
      var on = state.channels.indexOf(ch.id) >= 0;
      var lockTag = ch.id === 'naip-rgb' ? 'REQUIRED' : '';   // NAIP RGB is always on
      return '<div data-ch="' + ch.id + '" style="background:#1d1e16; border:1px solid ' + (on ? '#ebfc72' : '#404040') + '; border-radius:6px; padding:22px; cursor:pointer; box-shadow:' + (on ? '0 0 15px rgba(235,252,114,0.15)' : 'none') + '; display:flex; flex-direction:column; gap:14px; transition:border-color 0.2s, box-shadow 0.2s;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
        '<span style="display:flex; align-items:baseline; gap:9px;"><span style="font-size:22px; letter-spacing:-0.66px;">' + esc(ch.name) + '</span>' +
        '<span style="font-family:' + MONO + '; font-size:10px; color:#84837b; letter-spacing:0.08em;">' + lockTag + '</span></span>' +
        '<span style="width:20px; height:20px; border-radius:4px; border:2px solid ' + (on ? '#ebfc72' : '#404040') + '; background:' + (on ? '#ebfc72' : 'transparent') + '; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#13140e; font-size:13px; font-family:' + MONO + ';">' + (on ? '✓' : '') + '</span></div>' +
        '<p style="font-family:' + MONO + '; font-size:12px; line-height:1.65; color:#84837b; letter-spacing:0; margin:0; min-height:64px;">' + esc(ch.desc) + '</p>' +
        '<span style="font-family:' + MONO + '; font-size:11px; color:#ebfc72; letter-spacing:0; border:1px solid #404040; padding:3px 8px; border-radius:3.6px; align-self:flex-start;">MODEL · ' + esc(ch.model) + '</span></div>';
    }).join('');

    // Scene thumbnails are the single NAIP RGB image per scene (gallery PNG; rgb === ir in
    // the gallery data — there is no separate IR render). Apply the active channel's CSS
    // filter so the preview reflects the selection: the IR sepia/hue tint for NAIP NIR, the
    // Sentinel tint for Sentinel — the same filter channelFilter() applies to the result
    // panel. If the PNG is missing we fall back to a live ESRI tile with the same filter.
    var thumbFilter = channelFilter();
    $('scenePicker').innerHTML = galleryScenes().map(function (sc, i) {
      var on = state.scene === i;
      var fb = esri(sc.c[0], sc.c[1], 0.010, 0.010, 320, 320);
      return '<div data-scene="' + i + '" style="position:relative; aspect-ratio:1/1; overflow:hidden; border:1px solid ' + (on ? '#ebfc72' : '#404040') + '; box-shadow:' + (on ? '0 0 0 1px #ebfc72' : 'none') + '; border-radius:3.6px; cursor:pointer;">' +
        '<img data-sceneimg="1" src="' + sc.rgb + '" data-fb="' + fb + '" data-fbf="' + thumbFilter + '" loading="lazy" alt="scene ' + (i + 1) + '" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:' + thumbFilter + ';">' +
        '<div data-ov style="position:absolute; inset:0; background:rgba(19,20,14,' + (on ? '0' : '0.4') + '); transition:background 0.2s;"></div>' +
        '<span style="position:absolute; left:7px; top:7px; font-family:' + MONO + '; font-size:11px; color:#13140e; background:#ebfc72; padding:1px 5px; border-radius:2px; letter-spacing:0;">' + (i + 1) + '</span></div>';
    }).join('');
    wireSceneFallback();
    updateSelectionState();
    // Capture button (static, in the map section) always fires /predict — no
    // backend-readiness gating for now; it keeps its enabled styling from index.html.
  }
  // Update just the selected-channel label, routed model, and the analyze-button gating.
  // Split out of renderChannels so a scene click can refresh state without rebuilding the
  // scene thumbnails (rebuilding the <img>s makes the whole grid reload / flicker).
  function updateSelectionState() {
    var selected = CHANNELS.filter(function (c) { return state.channels.indexOf(c.id) >= 0; }).map(function (c) { return c.name; });
    $('selectedLabel').textContent = selected.join(' + ') || 'None selected';
    var routed = routeModel(state.channels);
    $('routedModel').textContent = 'ROUTES TO · ' + (state.channels.length ? routed.label + ' · ' + routed.backbone : '—');
    // Analyze-selection is a demo (no backend), so gate only on a valid selection.
    var can = selected.length > 0 && state.scene !== null;
    var btn = $('analyzeSelection');
    if (btn) {
      btn.style.background = can ? '#ebfc72' : '#23241b';
      btn.style.color = can ? '#13140e' : '#84837b';
      btn.style.cursor = can ? 'pointer' : 'not-allowed';
    }
  }
  // Move the selection highlight to the active scene tile in place — border, ring, and dim
  // overlay only. No innerHTML rewrite, so the thumbnails are never re-fetched.
  function highlightScene() {
    document.querySelectorAll('#scenePicker [data-scene]').forEach(function (tile) {
      var on = state.scene === parseInt(tile.getAttribute('data-scene'), 10);
      tile.style.border = '1px solid ' + (on ? '#ebfc72' : '#404040');
      tile.style.boxShadow = on ? '0 0 0 1px #ebfc72' : 'none';
      var ov = tile.querySelector('[data-ov]');
      if (ov) ov.style.background = 'rgba(19,20,14,' + (on ? '0' : '0.4') + ')';
    });
  }

  // ---------------------------------------------------------- upload demo zone
  function resultUrl() { return state.capturedUrl || esri(-93.935, 29.868, 0.033, 0.033, 720, 720); }
  // Confidence label. A value that rounds to 0.000 but is not actually zero
  // (e.g. 2.8e-4) renders as "<0.001", so a tiny-but-real score is
  // distinguishable from a hard zero.
  function fmtConf(conf) {
    var s = conf.toFixed(3);
    return (conf > 0 && s === '0.000') ? '<0.001' : s;
  }
  function computedResults() {
    // Use live model output when present; fall back to the demo RESULTS otherwise.
    var src = (state.results && state.results.length) ? state.results : RESULTS;
    return src.map(function (r) {
      var name = r.name || (FACILITIES.filter(function (f) { return f.abbr === r.abbr; })[0] || {}).name || r.abbr;
      var conf = typeof r.conf === 'number' ? r.conf : 0;
      var present = conf >= state.threshold;
      return {
        abbr: r.abbr, name: name, pct: fmtConf(conf), bar: (conf * 100).toFixed(0) + '%',
        color: present ? '#ebfc72' : '#84837b', fill: present ? '#ebfc72' : '#404040',
        tag: present ? 'PRESENT' : 'BELOW', tagColor: present ? '#ebfc72' : '#84837b',
      };
    });
  }
  function resultBarsHTML() {
    var threshPos = (state.threshold * 100).toFixed(0) + '%';
    return computedResults().map(function (r) {
      return '<div><div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">' +
        '<span style="font-family:' + MONO + '; font-size:14px; letter-spacing:0; color:' + r.color + ';">' + esc(r.abbr) + ' — ' + esc(r.name) + '</span>' +
        '<span style="display:flex; gap:10px; align-items:baseline;"><span style="font-family:' + MONO + '; font-size:11px; letter-spacing:0; color:' + r.tagColor + ';">' + r.tag + '</span>' +
        '<span style="font-family:' + MONO + '; font-size:14px; letter-spacing:0; color:' + r.color + ';">' + esc(r.pct) + '</span></span></div>' +
        '<div style="position:relative; height:8px; background:#1d1e16; border:1px solid #404040; border-radius:3.6px; overflow:hidden;">' +
        '<div style="height:100%; width:' + r.bar + '; background:' + r.fill + ';"></div>' +
        '<div style="position:absolute; top:0; bottom:0; left:' + threshPos + '; width:2px; background:#f4f3e8;"></div></div></div>';
    }).join('');
  }
  function foundLabelText(found) {
    return found === 0 ? 'NEGATIVE' : (found + ' / 6 CLASSES');
  }
  function renderUpload() {
    var panel = $('uploadPanel');
    if (state.phase === 'idle') {
      panel.innerHTML = '<div style="border:1px dashed #404040; border-radius:3.6px; padding:104px 40px; text-align:center;">' +
        '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0.04em; margin-bottom:24px;">NO SCENE ANALYZED YET</div>' +
        '<div style="display:flex; gap:14px; justify-content:center; flex-wrap:wrap;">' +
        '<button data-act="goMap" style="background:#ebfc72; color:#13140e; border:none; font-family:' + MONO + '; font-weight:400; font-size:14px; padding:14px 22px; border-radius:3.6px; letter-spacing:0.04em; text-transform:uppercase; cursor:pointer;">Capture from map</button>' +
        '<button data-act="goChannels" style="background:transparent; color:#f4f3e8; border:1px solid #f4f3e8; font-family:' + MONO + '; font-weight:400; font-size:14px; padding:13px 22px; border-radius:3.6px; letter-spacing:0.04em; text-transform:uppercase; cursor:pointer;">Choose a scene</button></div>' +
        '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0; margin-top:24px;">FRAME AN AREA ON THE MAP OR PICK A PRELOADED CHANNEL SCENE</div></div>';
      return;
    }
    if (state.phase === 'analyzing') {
      panel.innerHTML = '<div style="border:1px solid #404040; border-radius:3.6px; padding:40px; display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:center;">' +
        '<div style="position:relative; aspect-ratio:1/1; overflow:hidden; border:1px solid #404040;">' +
        '<img data-resultimg="1" src="' + resultUrl() + '" data-fb="' + esc(state.resultFallback || '') + '" data-fbf="' + state.resultFilter + '" alt="" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:' + state.resultFilter + ';">' +
        '<div style="position:absolute; left:0; right:0; top:0; height:40%; background:linear-gradient(to bottom, rgba(235,252,114,0.35), transparent); animation:scanline 1.6s linear infinite;"></div></div>' +
        '<div><div style="font-family:' + MONO + '; font-size:14px; color:#ebfc72; letter-spacing:0.04em; margin-bottom:18px;">ANALYZING · MODEL ' + esc(state.modelName) + '<span style="animation:blink 1s steps(1) infinite;">_</span></div>' +
        '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0; line-height:2;">' + state.logLines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div></div></div>';
      wireResultFallback();
      return;
    }
    if (state.phase === 'error') {
      panel.innerHTML = '<div style="border:1px solid #e4785a; border-radius:3.6px; padding:64px 40px; text-align:center;">' +
        '<div style="font-family:' + MONO + '; font-size:13px; color:#e4785a; letter-spacing:0.04em; margin-bottom:14px;">ANALYSIS FAILED</div>' +
        '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0; margin-bottom:24px; word-break:break-word;">' + esc(state.errorMsg || 'the model backend did not return a result') + '</div>' +
        '<button data-act="reset" style="background:#ebfc72; color:#13140e; border:none; font-family:' + MONO + '; font-weight:400; font-size:14px; padding:14px 22px; border-radius:3.6px; letter-spacing:0.04em; text-transform:uppercase; cursor:pointer;">Try again</button></div>';
      return;
    }
    // done
    var found = computedResults().filter(function (r) { return r.color === '#ebfc72'; }).length;
    panel.innerHTML = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:start;">' +
      '<div><div style="position:relative; aspect-ratio:1/1; overflow:hidden; border:1px solid #404040;">' +
      '<img data-resultimg="1" src="' + resultUrl() + '" data-fb="' + esc(state.resultFallback || '') + '" data-fbf="' + state.resultFilter + '" alt="" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:' + state.resultFilter + ';"></div>' +
      '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0; margin-top:14px;">INPUT · ' + esc(state.fileName) + ' · 720×720 · ' + esc(state.bandLabel) + ' · MODEL ' + esc(state.modelName) + '</div></div>' +
      '<div><div style="display:flex; justify-content:space-between; align-items:baseline; border-bottom:1px solid #404040; padding-bottom:14px; margin-bottom:21px;">' +
      '<div style="font-size:29px; letter-spacing:-0.87px;">Sources found</div>' +
      '<div id="foundLabel" style="font-family:' + MONO + '; font-size:20px; color:#ebfc72; letter-spacing:0;">' + foundLabelText(found) + '</div></div>' +
      '<div id="resultsList" style="display:flex; flex-direction:column; gap:18px;">' + resultBarsHTML() + '</div>' +
      '<div style="border:1px solid #404040; border-radius:3.6px; padding:11px 14px; margin-top:24px; display:flex; align-items:center; gap:16px;">' +
      '<span style="font-family:' + MONO + '; font-size:11px; color:#84837b; letter-spacing:0; white-space:nowrap;">PROB THRESHOLD</span>' +
      '<input id="threshInput" type="range" min="0" max="1" step="0.01" value="' + state.threshold + '" style="flex:1; accent-color:#ebfc72; cursor:pointer;">' +
      '<span id="threshLabel" style="font-family:' + MONO + '; font-size:14px; color:#ebfc72; letter-spacing:0; white-space:nowrap;">' + state.threshold.toFixed(2) + '</span></div>' +
      '<div style="display:flex; gap:14px; margin-top:29px; align-items:center; justify-content:space-between;">' +
      '<button data-act="reset" style="background:#ebfc72; color:#13140e; border:none; font-family:' + MONO + '; font-size:14px; padding:14px 18px; border-radius:3.6px; letter-spacing:0.04em; text-transform:uppercase; cursor:pointer;">Analyze another</button>' +
      '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0; text-align:right; line-height:1.6;">WHITE MARKER = THRESHOLD<br>CONFIDENCE = MODEL OUTPUT</div></div></div></div>';
    var slider = $('threshInput');
    if (slider) slider.addEventListener('input', function (e) {
      state.threshold = parseFloat(e.target.value);
      $('threshLabel').textContent = state.threshold.toFixed(2);
      $('resultsList').innerHTML = resultBarsHTML();
      $('foundLabel').textContent = foundLabelText(computedResults().filter(function (r) { return r.color === '#ebfc72'; }).length);
    });
    wireResultFallback();
    wireImgRetry();
  }

  // ---------------------------------------------------------- backend status
  // Ask the backend which model is live: POST /health → { model: "<id>" }. We
  // use its friendly label as the default MODEL shown in the analysis panel.
  // Best-effort only: there is no status pill and no readiness gating — if
  // /health is unreachable we keep the default label and Capture still fires
  // /predict. (Re-add a renderStatus()/#backendStatus pill here if a visible
  // up/down indicator is wanted later.)
  function checkHealth() {
    fetchWithTimeout(API_BASE + '/health', {
      method: 'POST',
      headers: { accept: 'application/json' },
    }, HEALTH_TIMEOUT_MS).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      var label = friendlyModel(data && data.model);
      if (label) { liveModel = label; state.modelName = label; }
    }).catch(function () { /* keep the default label; no UI change */ });
  }

  // ------------------------------------------------------------------ analysis
  // Cosmetic streaming log shown while a /predict call is in flight.
  var ANALYZE_LOG = [
    '> uploading scene composite',
    '> normalizing bands',
    '> forward pass · 6-class head',
    '> ranking probabilities',
    '> awaiting model response…',
  ];
  function startLogTicker() {
    stopLogTicker();
    var i = 0;
    state.logTimer = setInterval(function () {
      if (i >= ANALYZE_LOG.length) { stopLogTicker(); return; }
      state.logLines = state.logLines.concat([ANALYZE_LOG[i++]]);
      if (state.phase === 'analyzing') renderUpload();
    }, 480);
  }
  function stopLogTicker() {
    if (state.logTimer) { clearInterval(state.logTimer); state.logTimer = null; }
  }

  // LIVE path (map capture only). opts = { name, model, bands, url }
  //   url → the framed export URL we fetch into a blob and POST to the model.
  function runAnalysis(opts) {
    opts = opts || {};
    state.phase = 'analyzing';
    state.fileName = opts.name || 'scene.png';
    state.modelName = opts.model || liveModel;
    state.bandLabel = opts.bands || '3-BAND';
    state.results = null; state.errorMsg = ''; state.logLines = [];
    renderUpload();
    startLogTicker();

    // 1) Fetch the framed export into a Blob (the imagery hosts send
    //    Access-Control-Allow-Origin:*, so the browser may read the bytes).
    fetch(opts.url).then(function (r) {
      if (!r.ok) throw new Error('could not load scene image (HTTP ' + r.status + ')');
      return r.blob();
    }).then(function (blob) {
      // 2) POST multipart/form-data. Do NOT set Content-Type — the browser adds
      //    the multipart boundary automatically.
      var fd = new FormData();
      fd.append('image', blob, opts.name || 'scene.jpg');
      return fetchWithTimeout(API_BASE + '/predict', { method: 'POST', body: fd }, PREDICT_TIMEOUT_MS);
    }).then(function (res) {
      if (!res.ok) throw new Error('backend returned HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      // 3) Normalize the response (flat { ClassName: conf } map, or legacy
      //    { results:[{abbr,conf}] }) into [{abbr, conf}], sort by confidence,
      //    and render the done screen. An empty parse means the backend sent an
      //    unrecognized body — surface it instead of silently showing demo data.
      var results = normalizePredict(data);
      if (!results.length) throw new Error('backend returned no recognizable predictions');
      state.results = results.sort(function (a, b) { return b.conf - a.conf; });
      if (data.model) state.modelName = friendlyModel(data.model);
      stopLogTicker(); state.phase = 'done'; renderUpload();
    }).catch(function (err) {
      stopLogTicker(); state.phase = 'error';
      state.errorMsg = (err && err.name === 'AbortError')
        ? 'request timed out — the backend did not respond in time'
        : ((err && err.message) || String(err));
      renderUpload();
    });
  }

  // DEMO path (channel scenes). No backend call — run the same "analyzing"
  // animation, then reveal the hardcoded `results` so the demo is always smooth.
  function runDemoAnalysis(opts, results) {
    opts = opts || {};
    state.phase = 'analyzing';
    state.fileName = opts.name || 'scene.png';
    state.modelName = opts.model || liveModel;
    state.bandLabel = opts.bands || '3-BAND';
    state.results = null; state.errorMsg = ''; state.logLines = [];
    renderUpload();
    startLogTicker();
    setTimeout(function () {
      if (state.phase !== 'analyzing') return;   // user reset / navigated away
      stopLogTicker();
      state.results = results.slice().sort(function (a, b) { return b.conf - a.conf; });
      state.phase = 'done'; renderUpload();
    }, 2600);
  }

  // ------------------------------------------------------------------- actions
  function scrollToId(id) {
    setTimeout(function () {
      var el = $(id); if (!el) return;
      var anchor = el.firstElementChild || el;
      var top = anchor.getBoundingClientRect().top + window.scrollY - 40;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 90);
  }
  function captureMap() {
    if (!leaflet) return;

    // Get the geographic bounds specifically from our 720m square overlay.
    // If for some reason the box hasn't rendered yet, it safely falls back to the map bounds.
    var b = captureBoxOverlay ? captureBoxOverlay.getBounds() : leaflet.getBounds();

    // Construct the bounding box string for the API request
    var bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
    var url = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=' + bbox + '&bboxSR=4326&imageSR=4326&size=720,720&format=jpg&f=image';
    var c = leaflet.getCenter();

    state.capturedUrl = url;
    state.resultFallback = '';   // map capture is already a live tile; no demo fallback
    state.resultFilter = 'none';
    scrollToId('upload');

    // Pass to backend analyzer
    runAnalysis({ name: 'map_' + c.lat.toFixed(3) + '_' + c.lng.toFixed(3) + '.png', url: url });
  }
  function flyManual() {
    var lat = parseFloat($('latInput').value);
    var lng = parseFloat($('lngInput').value);

    if (isNaN(lat) || isNaN(lng)) {
      alert('Please enter valid numeric coordinates (e.g., 29.8680 and -93.9350).');
      return;
    }

    if (leaflet) {
      // Center the map on the new coordinates with a smooth animation
      leaflet.stop();
      leaflet.setView([lat, lng], 13, { animate: true });
    }
  }
  function analyzeSelection() {
    // Demo only — no backend needed, so this is NOT gated on backend readiness.
    var scenes = galleryScenes();
    if (!state.channels.length || state.scene === null || !scenes[state.scene]) return;
    var sc = scenes[state.scene];
    var routed = routeModel(state.channels);
    // Pick the score set for the selected channels: all sensors → 'all', RGB+NIR → 'all4',
    // RGB only → 'rgb'. Scores are in SCORE_ORDER; resolve names from FACILITIES downstream.
    var hasSent = state.channels.indexOf('sentinel') >= 0;
    var hasNir = state.channels.indexOf('naip-ir') >= 0;
    var setSel = hasSent ? 'all' : (hasNir ? 'all4' : 'rgb');
    var arr = (sc.scores && sc.scores[setSel]) || [0.94, 0.71, 0.29, 0.11, 0.04, 0.02];
    var results = SCORE_ORDER.map(function (abbr, i) { return { abbr: abbr, conf: arr[i] }; });
    // Result panel image = the exact NAIP scene the user picked (gallery PNG), tinted by
    // the active channel (NIR/Sentinel) via channelFilter(). The 720×720 NAIP matches the
    // result frame; if the PNG fails to load (e.g. stale cache) we fall back to a live ESRI
    // tile of the scene coords — see resultFallback / wireResultFallback.
    state.capturedUrl = sc.rgb;
    state.resultFallback = esri(sc.c[0], sc.c[1], 0.010, 0.010, 720, 720);
    state.resultFilter = channelFilter();
    scrollToId('upload');
    runDemoAnalysis(
      { name: 'scene_' + (state.scene + 1) + '.png', model: routed.backbone, bands: state.channels.length + '-CH' },
      results
    );
  }
  var actions = {
    showStudy: function () { state.view = 'study'; applyView(); },
    showDemo: function () { state.view = 'demo'; applyView(); },
    goStudy: function () { state.view = 'study'; applyView(); scrollToId('study'); },
    goMap: function () { state.view = 'demo'; applyView(); scrollToId('map'); },
    goChannels: function () { state.view = 'demo'; applyView(); scrollToId('channels'); },
    captureMap: captureMap,
    flyManual: flyManual,
    analyzeSelection: analyzeSelection,
    reset: function () { state.phase = 'idle'; state.logLines = []; state.capturedUrl = null; renderUpload(); },
  };

  // ---------------------------------------------------------------------- view
  function applyView() {
    var v = state.view;
    var study = $('study'); if (study) study.style.display = v === 'study' ? 'block' : 'none';
    ['intro', 'map', 'channels', 'upload'].forEach(function (id) {
      var el = $(id); if (el) el.style.display = v === 'demo' ? 'block' : 'none';
    });
    var ns = $('navStudy'), nd = $('navDemo');
    if (ns) { ns.style.background = v === 'study' ? '#ebfc72' : 'transparent'; ns.style.color = v === 'study' ? '#13140e' : '#f4f3e8'; }
    if (nd) { nd.style.background = v === 'demo' ? '#ebfc72' : 'transparent'; nd.style.color = v === 'demo' ? '#13140e' : '#f4f3e8'; }
    if (v === 'demo' && leaflet) setTimeout(function () { leaflet.invalidateSize(); }, 80);
  }

  // ------------------------------------------------------------------- wiring
  function wireDelegation() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]');
      if (a && actions[a.getAttribute('data-act')]) { actions[a.getAttribute('data-act')](); return; }

      var m = e.target.closest('[data-model]');
      if (m) { state.modelSel = parseInt(m.getAttribute('data-model'), 10); renderModels(); return; }

      var cm = e.target.closest('[data-cm]');
      if (cm) { state.cmSel = parseInt(cm.getAttribute('data-cm'), 10); renderConfusion(); return; }

      var ch = e.target.closest('[data-ch]');
      if (ch) {
        toggleChannel(ch.getAttribute('data-ch'));
        renderChannels(); return;
      }

      var sn = e.target.closest('[data-scene]');
      if (sn) { state.scene = parseInt(sn.getAttribute('data-scene'), 10); renderChannels(); return; }

      // NEW: Intercept bookmark clicks to "Fly Only"
      var bm = e.target.closest('[data-bookmark]');
      if (bm) {
        var coords = bm.getAttribute('data-bookmark').split(',');
        var lat = parseFloat(coords[0]);
        var lng = parseFloat(coords[1]);

        // Populate the manual input fields so the user sees the active coordinates
        var latIn = $('latInput');
        var lngIn = $('lngInput');
        if (latIn) latIn.value = lat;
        if (lngIn) lngIn.value = lng;

        // Smoothly pan the map to the bookmarked location (does NOT trigger analysis)
        if (leaflet) {
          leaflet.stop();
          leaflet.setView([lat, lng], 13, { animate: true });
        }
        return;
      }
    });
  }
  function wireScroll() {
    var wrap = $('scanWrap'), line = $('scanLine'), layer = $('revealLayer');
    if (!wrap || !line || !layer) return;
    var railFill = $('railFill'), railDot = $('railDot'), head = $('stageHead'),
      lineLabel = $('lineLabel'), rdCoord = $('rdCoord'), rdClass = $('rdClass');
    var ys = [0.30, 0.43];
    function onScroll() {
      var rect = wrap.getBoundingClientRect();
      var total = Math.max(1, wrap.offsetHeight - window.innerHeight);
      var prog = Math.max(0, Math.min(1, (-rect.top) / total));
      var pct = prog * 100;
      line.style.top = pct + '%';
      var clip = 'inset(0 0 ' + (100 - pct) + '% 0)';
      layer.style.clipPath = clip; layer.style.webkitClipPath = clip;
      if (railFill) railFill.style.height = pct + '%';
      if (railDot) { railDot.style.top = pct + '%'; railDot.textContent = String(Math.round(pct)).padStart(2, '0') + '%'; }
      if (lineLabel) lineLabel.textContent = 'SCAN ' + String(Math.round(pct)).padStart(2, '0') + '%';
      if (head) { head.style.opacity = String(Math.max(0, 1 - prog * 2.4)); head.style.transform = 'translateY(' + (prog * -30) + 'px)'; }
      var nt = $('navToggle');
      if (nt) { var show = prog >= 0.999; nt.style.opacity = show ? '1' : '0'; nt.style.pointerEvents = show ? 'auto' : 'none'; }
      var foundN = ys.filter(function (y) { return y <= prog + 0.001; }).length;
      if (rdCoord) rdCoord.textContent = '29.8680°N · 93.9350°W';
      if (rdClass) { rdClass.style.color = foundN > 0 ? '#ebfc72' : '#84837b'; rdClass.textContent = prog >= 0.999 ? 'SCAN COMPLETE' : (foundN > 0 ? 'DETECTING…' : 'SCANNING…'); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }
  // We will store the capture box reference here so other functions can update it
  var captureBoxOverlay = null;
  function initMap() {
    var el = $('leafletMap');
    if (!el || !window.L) { setTimeout(initMap, 250); return; }
    if (leaflet) return;

    // Initialize the map
    var m = window.L.map(el, { center: [29.868, -93.935], zoom: 13, minZoom: 4, maxZoom: 16, zoomControl: true, attributionControl: false });
    window.L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, maxNativeZoom: 16 }).addTo(m);
    leaflet = m;

    // Create the 720m x 720m capture box overlay using a dashed lime-green line
    captureBoxOverlay = window.L.rectangle([[0,0], [0,0]], {
      color: '#ebfc72',
      weight: 2,
      fill: false,
      dashArray: '5, 5',
      interactive: false
    }).addTo(m);

    function upd() {
      var c = m.getCenter(), out = $('mapCoord');
      if (out) out.textContent = c.lat.toFixed(4) + '°N · ' + Math.abs(c.lng).toFixed(4) + '°W · Z' + m.getZoom();

      // Calculate the exact geographic bounds for 720x720 meters
      // To get 1m/pixel for a 720px image, we need 360 meters in each direction from the center
      var halfSide = 360;

      // 1 degree of latitude is roughly 111,320 meters
      var deltaLat = halfSide / 111320;
      // Longitude shrinks as you move away from the equator (adjust via cosine of the latitude)
      var deltaLng = halfSide / (111320 * Math.cos(c.lat * (Math.PI / 180)));

      // Apply the newly calculated bounds to the rectangle
      captureBoxOverlay.setBounds([
        [c.lat - deltaLat, c.lng - deltaLng],
        [c.lat + deltaLat, c.lng + deltaLng]
      ]);
    }

    // Update the text and the box every time the user pans or zooms
    m.on('move zoom', upd);
    upd();

    // The map fills the grid row (whose height is set by the Manual Coordinates
    // box), so their bottom edges line up. Re-fit Leaflet after layout / resize.
    function refit() { setTimeout(function () { m.invalidateSize(); upd(); }, 60); }
    refit();
    window.addEventListener('resize', refit, { passive: true });
  }
  function wireAccordion() {
    document.querySelectorAll('[data-acc]').forEach(function (h) {
      var id = h.getAttribute('data-acc');
      var body = document.querySelector('[data-acc-body="' + id + '"]');
      var chev = h.querySelector('[data-chev]');
      if (!body) return;
      var set = function (o) { body.style.display = o ? 'block' : 'none'; if (chev) chev.textContent = o ? '–' : '+'; h.setAttribute('data-open', o ? '1' : '0'); };
      set(h.hasAttribute('data-acc-open'));
      h.addEventListener('click', function () { set(h.getAttribute('data-open') !== '1'); });
    });
  }
  function wireImgRetry() {
    document.querySelectorAll('img[src*="arcgis"]').forEach(function (img) {
      if (img._retryWired) return;
      img._retryWired = true;
      img.addEventListener('error', function () {
        if (img._retried) return;
        img._retried = true;
        var sep = img.src.indexOf('?') >= 0 ? '&' : '?';
        setTimeout(function () { img.src = img.src + sep + '_r=' + Date.now(); }, 500);
      });
    });
  }
  // Result panel image prefers the selected scene's NAIP PNG; if it fails to load (e.g. a
  // stale gallery-data.js cache pointing at an old path), swap once to the live ESRI tile in
  // data-fb. Mirrors wireSceneFallback but keyed on the result <img>.
  function wireResultFallback() {
    document.querySelectorAll('img[data-resultimg]').forEach(function (img) {
      if (img._rfbWired) return;
      img._rfbWired = true;
      img.addEventListener('error', function () {
        if (img._rfbDone) return;
        img._rfbDone = true;
        var fb = img.getAttribute('data-fb');
        if (!fb) return;
        img.style.filter = img.getAttribute('data-fbf') || 'none';
        img.src = fb;
        wireImgRetry();   // let the arcgis retry logic guard the fallback too
      });
    });
  }
  // Scene thumbnails prefer their pre-baked gallery PNG; if it 404s / fails to load,
  // swap once to the live ESRI tile (data-fb) with the matching CSS filter (data-fbf).
  function wireSceneFallback() {
    document.querySelectorAll('img[data-sceneimg]').forEach(function (img) {
      if (img._fbWired) return;
      img._fbWired = true;
      img.addEventListener('error', function () {
        if (img._fbDone) return;
        img._fbDone = true;
        var fb = img.getAttribute('data-fb');
        if (!fb) return;
        img.style.filter = img.getAttribute('data-fbf') || 'none';
        img.src = fb;
        wireImgRetry();   // let the arcgis retry logic guard the fallback too
      });
    });
  }

  // --------------------------------------------------------------------- init
  function init() {
    renderStatic();
    renderModels();
    renderConfusion();
    renderChannels();
    renderUpload();
    wireDelegation();
    wireScroll();
    wireAccordion();
    initMap();
    applyView();
    wireImgRetry();
    checkHealth();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
