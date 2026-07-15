/*
 * Methane Source Mapping — front-end logic.
 * Hand-ported from the Claude Design source "Methane Detection - F.dc.html"
 * to plain vanilla JS (no React, no design runtime). Mirrors that file's data
 * and behaviour; the interactive regions are rendered into stable containers
 * declared in index.html.
 *
 * MODEL BACKEND SEAM: analysis is mocked in runAnalysis() below. To wire the
 * real model, replace its body with a call to your inference endpoint:
 *
 *   const body = new FormData(); body.append('image', file);
 *   const res  = await fetch('https://YOUR_API/predict', { method:'POST', body });
 *   const data = await res.json();  // { results:[{abbr,name,conf}], boxes:[{x,y,w,h,label}] }
 *
 * then have renderUpload() read `data.results` instead of the hardcoded RESULTS
 * array. The six classes are R&T, CAFO, PROC, MINE, LNDFL, WWTP.
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

  // --------------------------------------------------------------------- data
  var FACILITIES = [
    { abbr: 'R&T', name: 'Refineries & Terminals', c: [-93.935, 29.868] },
    { abbr: 'CAFO', name: 'Feeding Operations', c: [-102.320, 34.900] },
    { abbr: 'PROC', name: 'Gas Processing Plants', c: [-102.350, 31.900] },
    { abbr: 'MINE', name: 'Coal Mines', c: [-105.300, 43.720] },
    { abbr: 'LNDFL', name: 'Landfills', c: [-114.980, 36.360] },
    { abbr: 'WWTP', name: 'Wastewater Plants', c: [-87.770, 41.810] },
  ];

  var CHANNEL_COORDS = [
    { c: [-93.935, 29.868], label: 'R&T · Port Arthur' },
    { c: [-102.350, 31.900], label: 'PROC · Permian TX' },
    { c: [-87.770, 41.810], label: 'WWTP · Chicago IL' },
    { c: [-114.980, 36.360], label: 'LNDFL · Las Vegas NV' },
    { c: [-105.300, 43.720], label: 'MINE · Powder River WY' },
  ];
  var CHANNELS = [
    { id: 'naip-rgb', name: 'NAIP RGB', desc: 'High-resolution aerial orthoimagery in the visible spectrum — red, green and blue bands.', model: 'RGB branch', bands: '3-BAND', filter: 'none' },
    { id: 'naip-ir', name: 'NAIP IR', desc: 'Color-infrared composite. The near-infrared band exposes vegetation vigor and thermal moisture.', model: 'NIR branch', bands: '4-BAND', filter: 'sepia(1) hue-rotate(-35deg) saturate(2.6) contrast(1.05)' },
    { id: 'sentinel', name: 'Sentinel', desc: 'High-revisit multispectral satellite data at 10–60 m, including short-wave infrared bands.', model: 'S1 + S2 branches', bands: '13-BAND', filter: 'saturate(1.35) contrast(0.94) brightness(1.06) blur(0.3px)' },
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
  var MODEL_PAPER = { macro: 0.558, perClass: [0.915, 0.259, 0.470, 0.350, 0.821, 0.534] };
  var MODEL_CONFIGS = [
    { id: 'bce-rgb', label: 'NAIP RGB', tag: 'Binary CE', branches: ['rgb'], backbone: 'DenseNet121', macro: 0.752, perClass: [0.916, 0.670, 0.779, 0.667, 0.870, 0.612], note: 'Baseline. A single frozen-backbone model already clears the paper’s six-model ensemble by +0.19 macro AUPRC.' },
    { id: 'focal-rgb', label: 'NAIP RGB', tag: 'Focal CE', branches: ['rgb'], backbone: 'DenseNet121', macro: 0.753, perClass: [0.925, 0.685, 0.776, 0.650, 0.881, 0.603], note: 'Loss ablation. Focal loss shifts probability calibration but not ranking — class imbalance is not the bottleneck.' },
    { id: 'naip-4ch', label: 'NAIP RGB + NIR', tag: 'Binary CE', branches: ['rgb', 'nir'], backbone: 'DenseNet121', macro: 0.758, perClass: [0.922, 0.704, 0.778, 0.687, 0.866, 0.589], note: 'NIR ablation. Small gain concentrated in landfills and processing plants — vegetation vs bare-earth contrast.' },
    { id: 'all-dn', label: 'All sensors', tag: 'DenseNet121', branches: ['rgb', 'nir', 's2a', 's2b', 's2c', 's1'], backbone: 'DenseNet121', macro: 0.774, perClass: [0.920, 0.717, 0.803, 0.702, 0.894, 0.607], note: 'Branch fusion at native resolutions makes Sentinel data additive — reversing the paper’s finding that fusion hurt.' },
    { id: 'all-dn-scaled', label: 'All sensors', tag: 'scaled S1/S2', branches: ['rgb', 'nir', 's2a', 's2b', 's2c', 's1'], backbone: 'DenseNet121', macro: 0.758, perClass: [0.952, 0.667, 0.756, 0.693, 0.898, 0.582], note: 'Scaling ablation. No benefit — each branch’s BatchNorm already absorbs input scale. Calibrates run-to-run noise (±0.015).' },
    { id: 'all-eff', label: 'All sensors', tag: 'EfficientNetV2B0', champion: true, branches: ['rgb', 'nir', 's2a', 's2b', 's2c', 's1'], backbone: 'EfficientNetV2B0', macro: 0.801, perClass: [0.915, 0.769, 0.819, 0.715, 0.907, 0.681], note: 'Champion. Biggest gains on the hardest classes: Landfills +0.510, Proc. Plants +0.365 over the paper’s per-class expert model.' },
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
  // demo confidences shown on the results screen (mock model output)
  var RESULTS = [
    { abbr: 'R&T', name: 'Refineries & Terminals', conf: 0.94 },
    { abbr: 'PROC', name: 'Gas Processing Plants', conf: 0.71 },
    { abbr: 'WWTP', name: 'Wastewater Plants', conf: 0.29 },
    { abbr: 'LNDFL', name: 'Landfills', conf: 0.11 },
    { abbr: 'CAFO', name: 'Feeding Operations', conf: 0.04 },
    { abbr: 'MINE', name: 'Coal Mines', conf: 0.02 },
  ];

  // -------------------------------------------------------------------- state
  var state = {
    view: 'demo', phase: 'idle', threshold: 0.5,
    channels: ['naip-rgb'], scene: null,
    modelName: 'EfficientNetV2B0', bandLabel: '3-BAND', resultFilter: 'none',
    modelSel: MODEL_CONFIGS.length - 1, cmSel: 0,
    fileName: 'demo_scene.png', logLines: [], capturedUrl: null,
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

    // data facility gallery (6, 3:2)
    $('dataFacilityGallery').innerHTML = FACILITIES.map(function (f) {
      var url = esri(f.c[0], f.c[1], 0.013, 0.010, 600, 600);
      return '<div style="position:relative; aspect-ratio:3/2; overflow:hidden; background:#13140e;">' +
        '<img src="' + url + '" alt="' + esc(f.name) + '" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">' +
        '<div style="position:absolute; inset:0; background:linear-gradient(to top, rgba(19,20,14,0.85), transparent 55%);"></div>' +
        '<div style="position:absolute; left:14px; bottom:14px; right:14px;"><div style="display:inline-block; background:#ebfc72; color:#13140e; font-family:' + MONO + '; font-size:12px; padding:3px 6px; border-radius:3.6px; letter-spacing:0;">' + esc(f.abbr) + '</div>' +
        '<div style="font-size:16px; letter-spacing:-0.48px; margin-top:7px;">' + esc(f.name) + '</div></div></div>';
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
        '<div style="position:relative; height:14px; background:#1d1e16; border:1px solid #404040; border-radius:3.6px; overflow:hidden;">' +
        '<div style="position:absolute; left:0; top:0; bottom:0; width:' + champH + '; background:#ebfc72;"></div>' +
        '<div style="position:absolute; top:-3px; bottom:-3px; left:' + paperH + '; width:2px; background:#f4f3e8; box-shadow:0 0 0 1px rgba(19,20,14,0.9);"></div></div>' +
        '<span style="font-family:' + MONO + '; font-size:14px; color:#ebfc72; text-align:right;">' + champ.perClass[k].toFixed(3) + '</span></div>';
    }).join('');

    // scores: macro AUPRC by configuration
    var macroRows = [
      { label: 'Paper · expert ensemble', val: 0.558, paper: true },
      { label: 'BCE · NAIP-RGB', val: 0.752 },
      { label: 'Focal · NAIP-RGB', val: 0.753 },
      { label: 'BCE · NAIP 4ch', val: 0.758 },
      { label: 'AllImg · DenseNet', val: 0.774 },
      { label: 'AllImg · DenseNet scaled', val: 0.758 },
      { label: 'AllImg · EfficientNetV2B0', val: 0.801, champ: true },
    ];
    $('macroChart').innerHTML = macroRows.map(function (r) {
      var fill = r.paper ? '#404040' : '#ebfc72';
      var op = r.paper ? '1' : (r.champ ? '1' : '0.5');
      var valColor = r.champ ? '#ebfc72' : '#84837b';
      var labelColor = r.champ ? '#f4f3e8' : '#84837b';
      return '<div style="display:grid; grid-template-columns:200px 1fr 52px; gap:14px; align-items:center;">' +
        '<span style="font-family:' + MONO + '; font-size:13px; color:' + labelColor + '; letter-spacing:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(r.label) + '</span>' +
        '<div style="position:relative; height:14px; background:#1d1e16; border:1px solid #404040; border-radius:3.6px; overflow:hidden;">' +
        '<div style="position:absolute; left:0; top:0; bottom:0; width:' + (r.val * 100).toFixed(1) + '%; background:' + fill + '; opacity:' + op + ';"></div></div>' +
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
    var concatX = 596, concatY = (yOf(0) + yOf(5)) / 2;
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Architecture diagram for ' + cfg.label + ' ' + cfg.tag });
    root.setAttribute('style', 'width:100%; height:auto; display:block;');
    [[133, 'SENSOR INPUTS'], [385, 'PER-SENSOR BRANCH'], [concatX + 48, 'FUSION'], [796, 'HEAD']].forEach(function (c) {
      root.appendChild(svg('text', { x: c[0], y: 26, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 11, 'letter-spacing': '2' }, c[1]));
    });
    MODEL_BRANCHES.forEach(function (b, i) {
      var on = cfg.branches.indexOf(b.id) >= 0;
      var y = yOf(i), col = on ? P[b.color] : P.off, isBk = b.stem === 'backbone';
      var stemLabel = isBk ? cfg.backbone : b.stem, stemW = 170;
      var g = svg('g', { opacity: on ? 1 : 0.28 });
      g.appendChild(svg('rect', { x: 24, y: y - 26, width: 218, height: 52, rx: 8, fill: 'none', stroke: col, 'stroke-width': 1.4 }));
      g.appendChild(svg('text', { x: 38, y: y - 6, fill: P.text, 'font-family': sans, 'font-size': 14, 'font-weight': 600 }, b.name));
      g.appendChild(svg('text', { x: 38, y: y + 14, fill: P.muted, 'font-family': MONO, 'font-size': 12 }, b.shape + ' · ' + b.res + '/px'));
      g.appendChild(svg('line', { x1: 242, y1: y, x2: 300, y2: y, stroke: col, 'stroke-width': 1.4 }));
      g.appendChild(svg('rect', { x: 300, y: y - 22, width: stemW, height: 44, rx: 8, fill: (on && isBk) ? '#23241b' : 'none', stroke: col, 'stroke-width': isBk ? 2 : 1.4 }));
      g.appendChild(svg('text', { x: 310, y: y - 2, fill: P.text, 'font-family': MONO, 'font-size': 12.5, 'font-weight': isBk ? 700 : 400 }, stemLabel));
      g.appendChild(svg('text', { x: 310, y: y + 14, fill: P.faint, 'font-family': MONO, 'font-size': 10.5 }, isBk ? 'ImageNet · frozen · GAP' : 'trained from scratch'));
      g.appendChild(svg('path', { d: 'M ' + (300 + stemW) + ' ' + y + ' C ' + (concatX - 60) + ' ' + y + ', ' + (concatX - 60) + ' ' + concatY + ', ' + concatX + ' ' + concatY, fill: 'none', stroke: col, 'stroke-width': 1.4, opacity: 0.85 }));
      root.appendChild(g);
    });
    var gc = svg('g', {});
    gc.appendChild(svg('rect', { x: concatX, y: concatY - 34, width: 96, height: 68, rx: 10, fill: '#1d1e16', stroke: P.fusion, 'stroke-width': 1.6 }));
    gc.appendChild(svg('text', { x: concatX + 48, y: concatY - 4, 'text-anchor': 'middle', fill: P.fusion, 'font-family': MONO, 'font-size': 12.5, 'font-weight': 700 }, 'Concat'));
    gc.appendChild(svg('text', { x: concatX + 48, y: concatY + 14, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 10.5 }, cfg.branches.length + ' branch' + (cfg.branches.length > 1 ? 'es' : '')));
    root.appendChild(gc);
    root.appendChild(svg('line', { x1: concatX + 96, y1: concatY, x2: 742, y2: concatY, stroke: P.fusion, 'stroke-width': 1.4 }));
    root.appendChild(svg('rect', { x: 742, y: concatY - 26, width: 108, height: 52, rx: 8, fill: 'none', stroke: P.text, 'stroke-width': 1.2 }));
    root.appendChild(svg('text', { x: 796, y: concatY - 4, 'text-anchor': 'middle', fill: P.text, 'font-family': MONO, 'font-size': 12.5 }, 'Dense 200'));
    root.appendChild(svg('text', { x: 796, y: concatY + 14, 'text-anchor': 'middle', fill: P.faint, 'font-family': MONO, 'font-size': 10.5 }, 'ReLU'));
    root.appendChild(svg('line', { x1: 850, y1: concatY, x2: 886, y2: concatY, stroke: P.text, 'stroke-width': 1.2 }));
    var go = svg('g', {});
    go.appendChild(svg('rect', { x: 886, y: concatY - 78, width: 80, height: 156, rx: 8, fill: 'none', stroke: cfg.champion ? P.gold : P.text, 'stroke-width': cfg.champion ? 1.8 : 1.2 }));
    go.appendChild(svg('text', { x: 926, y: concatY - 58, 'text-anchor': 'middle', fill: P.text, 'font-family': MONO, 'font-size': 11.5 }, 'σ × 6'));
    cfg.perClass.forEach(function (v, k) {
      go.appendChild(svg('circle', { cx: 926, cy: concatY - 38 + k * 20, r: 4.5, fill: cfg.champion ? P.gold : P.fusion, opacity: 0.35 + 0.65 * v }));
    });
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
    $('modelNote').textContent = cfg.note;
    $('modelClasses').innerHTML = MODEL_CLASS_NAMES.map(function (n, k) {
      var barColor = cfg.champion ? '#ebfc72' : '#f4f3e8';
      return '<div style="display:grid; grid-template-columns:150px 1fr 48px; gap:8px; align-items:center; margin-bottom:7px;">' +
        '<span style="font-family:' + MONO + '; font-size:12.5px; color:#84837b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(n) + '</span>' +
        '<div style="position:relative; height:7px; background:#404040; border-radius:4px;">' +
        '<div style="position:absolute; left:0; top:0; bottom:0; border-radius:4px; width:' + (cfg.perClass[k] * 100).toFixed(1) + '%; background:' + barColor + '; opacity:0.9;"></div>' +
        '<div style="position:absolute; left:' + (MODEL_PAPER.perClass[k] * 100).toFixed(1) + '%; top:-3px; bottom:-3px; width:2px; background:#f4f3e8; box-shadow:0 0 0 1px rgba(19,20,14,0.9);"></div></div>' +
        '<span style="font-family:' + MONO + '; font-size:12px; color:#f4f3e8; text-align:right;">' + cfg.perClass[k].toFixed(3) + '</span></div>';
    }).join('');
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
    if (channels.indexOf('sentinel') >= 0) return byId('all-eff');
    if (channels.indexOf('naip-ir') >= 0) return byId('naip-4ch');
    if (channels.indexOf('naip-rgb') >= 0) return byId('bce-rgb');
    return byId('all-eff');
  }
  function channelFilter() {
    var order = ['sentinel', 'naip-ir', 'naip-rgb'];
    for (var i = 0; i < order.length; i++) {
      if (state.channels.indexOf(order[i]) >= 0) {
        var c = CHANNELS.filter(function (x) { return x.id === order[i]; })[0];
        if (c) return c.filter;
      }
    }
    return 'none';
  }
  function renderChannels() {
    $('channelCards').innerHTML = CHANNELS.map(function (ch) {
      var on = state.channels.indexOf(ch.id) >= 0;
      return '<div data-ch="' + ch.id + '" style="background:#1d1e16; border:1px solid ' + (on ? '#ebfc72' : '#404040') + '; border-radius:6px; padding:22px; cursor:pointer; box-shadow:' + (on ? '0 0 15px rgba(235,252,114,0.15)' : 'none') + '; display:flex; flex-direction:column; gap:14px; transition:border-color 0.2s, box-shadow 0.2s;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;"><span style="font-size:22px; letter-spacing:-0.66px;">' + esc(ch.name) + '</span>' +
        '<span style="width:20px; height:20px; border-radius:4px; border:2px solid ' + (on ? '#ebfc72' : '#404040') + '; background:' + (on ? '#ebfc72' : 'transparent') + '; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#13140e; font-size:13px; font-family:' + MONO + ';">' + (on ? '✓' : '') + '</span></div>' +
        '<p style="font-family:' + MONO + '; font-size:12px; line-height:1.65; color:#84837b; letter-spacing:0; margin:0; min-height:64px;">' + esc(ch.desc) + '</p>' +
        '<span style="font-family:' + MONO + '; font-size:11px; color:#ebfc72; letter-spacing:0; border:1px solid #404040; padding:3px 8px; border-radius:3.6px; align-self:flex-start;">MODEL · ' + esc(ch.model) + '</span></div>';
    }).join('');

    $('scenePicker').innerHTML = CHANNEL_COORDS.map(function (sc, i) {
      var on = state.scene === i;
      var url = esri(sc.c[0], sc.c[1], 0.010, 0.010, 320, 320);
      return '<div data-scene="' + i + '" style="position:relative; aspect-ratio:1/1; overflow:hidden; border:1px solid ' + (on ? '#ebfc72' : '#404040') + '; box-shadow:' + (on ? '0 0 0 1px #ebfc72' : 'none') + '; border-radius:3.6px; cursor:pointer;">' +
        '<img src="' + url + '" alt="scene ' + (i + 1) + '" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:none;">' +
        '<div style="position:absolute; inset:0; background:rgba(19,20,14,' + (on ? '0' : '0.4') + '); transition:background 0.2s;"></div>' +
        '<span style="position:absolute; left:7px; top:7px; font-family:' + MONO + '; font-size:11px; color:#13140e; background:#ebfc72; padding:1px 5px; border-radius:2px; letter-spacing:0;">' + (i + 1) + '</span></div>';
    }).join('');

    var selected = CHANNELS.filter(function (c) { return state.channels.indexOf(c.id) >= 0; }).map(function (c) { return c.name; });
    $('selectedLabel').textContent = selected.join(' + ') || 'None selected';
    var routed = routeModel(state.channels);
    $('routedModel').textContent = 'ROUTES TO · ' + (state.channels.length ? routed.label + ' · ' + routed.backbone : '—');
    var can = selected.length > 0 && state.scene !== null;
    var btn = $('analyzeSelection');
    btn.style.background = can ? '#ebfc72' : '#23241b';
    btn.style.color = can ? '#13140e' : '#84837b';
    btn.style.cursor = can ? 'pointer' : 'not-allowed';
  }

  // ---------------------------------------------------------- upload demo zone
  function resultUrl() { return state.capturedUrl || esri(-93.935, 29.868, 0.033, 0.033, 720, 720); }
  function computedResults() {
    return RESULTS.map(function (r) {
      var present = r.conf >= state.threshold;
      return {
        abbr: r.abbr, name: r.name, pct: r.conf.toFixed(2), bar: (r.conf * 100).toFixed(0) + '%',
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
        '<span style="font-family:' + MONO + '; font-size:14px; letter-spacing:0; color:' + r.color + ';">' + r.pct + '</span></span></div>' +
        '<div style="position:relative; height:8px; background:#1d1e16; border:1px solid #404040; border-radius:3.6px; overflow:hidden;">' +
        '<div style="height:100%; width:' + r.bar + '; background:' + r.fill + ';"></div>' +
        '<div style="position:absolute; top:0; bottom:0; left:' + threshPos + '; width:2px; background:#f4f3e8;"></div></div></div>';
    }).join('');
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
        '<img src="' + resultUrl() + '" alt="" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:' + state.resultFilter + ';">' +
        '<div style="position:absolute; left:0; right:0; top:0; height:40%; background:linear-gradient(to bottom, rgba(235,252,114,0.35), transparent); animation:scanline 1.6s linear infinite;"></div></div>' +
        '<div><div style="font-family:' + MONO + '; font-size:14px; color:#ebfc72; letter-spacing:0.04em; margin-bottom:18px;">ANALYZING · MODEL ' + esc(state.modelName) + '<span style="animation:blink 1s steps(1) infinite;">_</span></div>' +
        '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0; line-height:2;">' + state.logLines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div></div></div>';
      return;
    }
    // done
    var found = computedResults().filter(function (r) { return r.color === '#ebfc72'; }).length;
    panel.innerHTML = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:start;">' +
      '<div><div style="position:relative; aspect-ratio:1/1; overflow:hidden; border:1px solid #404040;">' +
      '<img src="' + resultUrl() + '" alt="" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:' + state.resultFilter + ';"></div>' +
      '<div style="font-family:' + MONO + '; font-size:13px; color:#84837b; letter-spacing:0; margin-top:14px;">INPUT · ' + esc(state.fileName) + ' · 720×720 · ' + esc(state.bandLabel) + ' · MODEL ' + esc(state.modelName) + '</div></div>' +
      '<div><div style="display:flex; justify-content:space-between; align-items:baseline; border-bottom:1px solid #404040; padding-bottom:14px; margin-bottom:21px;">' +
      '<div style="font-size:29px; letter-spacing:-0.87px;">Methane Sources found</div>' +
      '<div style="font-family:' + MONO + '; font-size:20px; color:#ebfc72; letter-spacing:0;"><span id="foundCount">' + found + '</span> / 6 CLASSES</div></div>' +
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
      $('foundCount').textContent = computedResults().filter(function (r) { return r.color === '#ebfc72'; }).length;
    });
    wireImgRetry();
  }

  // ------------------------------------------------------------------ analysis
  function runAnalysis(name, model, bands) {
    var lines = [
      '> loading weights — meter-ml.ckpt',
      '> normalizing 3-band composite',
      '> forward pass · 6-class head',
      '> non-max suppression · boxes',
      '> ranking confidences',
    ];
    state.phase = 'analyzing'; state.fileName = name; state.logLines = [];
    state.modelName = model || 'EfficientNetV2B0'; state.bandLabel = bands || '3-BAND';
    renderUpload();
    lines.forEach(function (ln, i) {
      setTimeout(function () {
        state.logLines = state.logLines.concat([ln]);
        renderUpload();
        if (i === lines.length - 1) setTimeout(function () { state.phase = 'done'; renderUpload(); }, 700);
      }, 480 * (i + 1));
    });
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

    // CHANGE: Get the geographic bounds specifically from our 720m square overlay.
    // If for some reason the box hasn't rendered yet, it safely falls back to the map bounds.
    var b = captureBoxOverlay ? captureBoxOverlay.getBounds() : leaflet.getBounds();

    // Construct the bounding box string for the API request
    var bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');

    // Send the request to the USGS server for a 720x720 image
    var url = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=' + bbox + '&bboxSR=4326&imageSR=4326&size=720,720&format=jpg&f=image';
    var c = leaflet.getCenter();

    state.capturedUrl = url;
    state.resultFilter = 'none';
    scrollToId('upload');
    runAnalysis('map_' + c.lat.toFixed(3) + '_' + c.lng.toFixed(3) + '.png', 'EfficientNetV2B0', '3-BAND');
  }
  function analyzeSelection() {
    if (!state.channels.length || state.scene === null) return;
    var sc = CHANNEL_COORDS[state.scene];
    var routed = routeModel(state.channels);
    state.capturedUrl = esri(sc.c[0], sc.c[1], 0.010, 0.010, 720, 720);
    state.resultFilter = channelFilter();
    scrollToId('upload');
    runAnalysis('scene_' + (state.scene + 1) + '.png', routed.backbone, state.channels.length + '-CH');
  }
  var actions = {
    showStudy: function () { state.view = 'study'; applyView(); },
    showDemo: function () { state.view = 'demo'; applyView(); },
    goStudy: function () { state.view = 'study'; applyView(); scrollToId('study'); },
    goMap: function () { state.view = 'demo'; applyView(); scrollToId('map'); },
    goChannels: function () { state.view = 'demo'; applyView(); scrollToId('channels'); },
    goUpload: function () { state.view = 'demo'; applyView(); scrollToId('upload'); },
    captureMap: captureMap,
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
        var id = ch.getAttribute('data-ch');
        state.channels = state.channels.indexOf(id) >= 0 ? state.channels.filter(function (c) { return c !== id; }) : state.channels.concat([id]);
        renderChannels(); return;
      }
      var sn = e.target.closest('[data-scene]');
      if (sn) { state.scene = parseInt(sn.getAttribute('data-scene'), 10); renderChannels(); return; }
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

    // Create the 720m x 720m capture box overlay
    // We use a dashed lime-green line to match your app's theme
    captureBoxOverlay = window.L.rectangle([[0,0], [0,0]], {
      color: '#ebfc72',
      weight: 2,
      fill: false,
      dashArray: '5, 5',
      interactive: false
    }).addTo(m);

    function upd() {
      var c = m.getCenter();
      var out = $('mapCoord');
      if (out) out.textContent = c.lat.toFixed(4) + '°N · ' + Math.abs(c.lng).toFixed(4) + '°W · Z' + m.getZoom();

      // Calculate the exact geographic bounds for 720x720 meters
      // Since we want 1m/pixel for a 720px image, we need 360 meters in each direction from the center
      var halfSide = 360;

      // 1 degree of latitude is roughly 111,320 meters
      var deltaLat = halfSide / 111320;
      // Longitude shrinks as you move away from the equator, so we divide by the cosine of the latitude
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
  function wireFile() {
    var input = $('fileInput');
    if (!input) return;
    input.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      state.capturedUrl = null; state.resultFilter = 'none';
      runAnalysis(f ? f.name : 'demo_scene.png', 'EfficientNetV2B0', '3-BAND');
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
    wireFile();
    initMap();
    applyView();
    wireImgRetry();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
