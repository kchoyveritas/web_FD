// FD_rate_7.11.js — simplified JS port of FD_rate_7.11.py
// Provides UI bindings and a canvas plot. Designed to run in the browser.

const CROSS_SECTIONS = {
  "0.009 Round": 0.13,
  "0.010 Round": 0.20,
  "0.012 Round": 0.42,
  "0.014 Round": 0.78,
  "0.016 Round": 1.34,
  "0.017 Round": 1.71,
  "0.018 Round": 2.14,
  "0.019 Round": 2.66,
  "0.020 Round": 3.27,
  "0.021 Round": 3.97,
  "0.022 Round": 4.79,
  "0.010x0.020 Rect": 0.69,
  "0.016x0.022 Rect": 3.13,
  "0.017x0.025 Rect": 4.26,
  "0.018x0.025 Rect": 5.06,
  "0.019x0.025 Rect": 5.95,
  "0.021x0.025 Rect": 8.03,
  "0.022x0.028 Rect": 10.34
};

const MATERIAL_E_RANGES = {
  "Stainless Steel": [190.0, 207.0],
  "Beta Titanium": [82.8, 93.2],
  "Nickel Titanium": [14.5, 58.0]
};

const MATERIAL_DEFAULT_E = {
  "Stainless Steel": 207.0,
  "Beta Titanium": 87.0,
  "Nickel Titanium": 14.5
};

function clamp(v, a, b){ const n = Number(v); if (isNaN(n)) return a; return Math.max(a, Math.min(b, n)); }

function calculateCantileverDeflection(L_mm, F_g, E_GPa, I_10_15, numPoints=200){
  const L_m = L_mm/1000.0;
  const F_N = F_g * 0.00981;
  const E_Pa = E_GPa * 1e9;
  const I_m4 = I_10_15 * 1e-15;
  const xs = [];
  const ys = [];
  for(let i=0;i<numPoints;i++){
    const x_m = L_m * (i/(numPoints-1));
    const x_mm = x_m*1000;
    const def_m = (F_N * x_m*x_m / (6 * E_Pa * I_m4)) * (3*L_m - x_m);
    const def_mm = def_m * 1000;
    xs.push(x_mm);
    ys.push(def_mm);
  }
  return {x: xs, y: ys};
}

// Simple linear interpolation for color between blue -> purple -> gray
function mapEtoColor(E){
  const minE = 14.5, maxE = 207;
  let t = (E - minE)/(maxE - minE);
  t = Math.max(0, Math.min(1, t));
  // 0..0.5 -> blue to purple, 0.5..1 -> purple to gray
  if(t <= 0.5){
    const u = t/0.5;
    // blue #0000ff to purple #800080
    const r = Math.round(0 + (128-0)*u);
    const g = 0;
    const b = Math.round(255 - (255-128)*u);
    return `rgb(${r},${g},${b})`;
  } else {
    const u = (t-0.5)/0.5;
    // purple #800080 to gray #808080
    const r = Math.round(128 + (128-128)*u);
    const g = Math.round(0 + (128-0)*u);
    const b = Math.round(128 + (128-128)*u);
    return `rgb(${r},${g},${b})`;
  }
}

// Fit a polynomial (degree 3) using normal equations (small n so simple solver)
function polyfit(x, y, degree){
  const N = x.length;
  const M = degree + 1;
  const A = Array.from({length:M}, ()=>Array(M).fill(0));
  const B = Array(M).fill(0);
  for(let i=0;i<N;i++){
    const xi = x[i];
    let xp = 1;
    for(let r=0;r<M;r++){
      let yp = 1;
      for(let c=0;c<M;c++){
        A[r][c] += xp * (xi**c);
      }
      B[r] += y[i]*xp;
      xp *= xi;
    }
  }
  // Solve A * coeffs = B using Gaussian elimination
  // Augment
  for(let i=0;i<M;i++) A[i].push(B[i]);
  // elimination
  for(let i=0;i<M;i++){
    // pivot
    let maxr=i;
    for(let r=i+1;r<M;r++) if(Math.abs(A[r][i])>Math.abs(A[maxr][i])) maxr=r;
    if(maxr!==i){ const tmp=A[i]; A[i]=A[maxr]; A[maxr]=tmp; }
    const pivot = A[i][i];
    if(Math.abs(pivot) < 1e-12) continue;
    for(let c=i;c<=M;c++) A[i][c] /= pivot;
    for(let r=0;r<M;r++){ if(r===i) continue; const f=A[r][i]; for(let c=i;c<=M;c++) A[r][c] -= f*A[i][c]; }
  }
  const coeffs = Array(M).fill(0);
  for(let i=0;i<M;i++) coeffs[i]=A[i][M]||0;
  return coeffs; // [a0, a1, a2, a3] where y = a0 + a1 x + a2 x^2 ...
}

function formatEquation(coeffs){
  // coeffs are [a0, a1, a2, a3] -> convert to readable y = ... using up to 3 sig figs
  function fmt(v){ if(!isFinite(v)) return '0'; const s = Number(v).toPrecision(3); return s; }
  const deg = coeffs.length-1;
  let parts=[];
  for(let i=deg;i>=0;i--){ const c = coeffs[i]; if(Math.abs(c) < 1e-12) continue; const sign = c<0?'-':(parts.length?'+':''); parts.push(`${sign} ${fmt(Math.abs(c))}${i?` x${i>1?'^'+i:''}`:''}`.trim()); }
  return parts.length?('y = '+parts.join(' ')):'y = 0';
}

// UI wiring + drawing
window.addEventListener('DOMContentLoaded', ()=>{
  const el = id=>document.getElementById(id);
  const L = el('L'), Lr = el('L_range');
  const F = el('F'), Fr = el('F_range');
  const D = el('D'), Dr = el('D_range');
  const E = el('E'), Er = el('E_range');
  const I = el('I'), Ir = el('I_range');
  const mat = el('material');
  const cross = el('cross');
  const canvas = el('plotCanvas');
  const ctx = canvas.getContext('2d');
  // Resize canvas for high-DPI displays and keep it responsive
  function resizeCanvas(){
    const dpr = window.devicePixelRatio || 1;
    // use client size (CSS pixels) as logical size
    const w = Math.max(100, canvas.clientWidth || 800);
    const h = Math.max(80, canvas.clientHeight || 420);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    // map CSS pixels -> device pixels so drawing uses CSS coords
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // Observe size changes and window resizes
  const ro = new ResizeObserver(()=>{ resizeCanvas(); schedulePlot(); });
  ro.observe(canvas);
  window.addEventListener('resize', ()=>{ resizeCanvas(); schedulePlot(); });
  // initial sizing
  resizeCanvas();
  const showEq = el('showEq');
  const F_D_rate_el = el('F_D_rate');
  const moment_el = el('moment');
  const eqDisplay = el('eq_display');

  // immediate redraw when toggling the show-equation checkbox
  showEq.addEventListener('change', ()=>{ schedulePlot(); // show/hide eq display will be handled in renderPlot
  });

  // populate selects
  Object.keys(MATERIAL_E_RANGES).forEach(k => { const o=document.createElement('option'); o.value=k; o.textContent=k; mat.appendChild(o); });
  // add a 'Custom' entry (hidden) so we can mark the material as custom when the user edits E
  // It is hidden so it does not appear in the pulldown menu but can still be selected programmatically.
  const customOption = document.createElement('option');
  customOption.value = 'Custom';
  customOption.textContent = 'Custom';
  customOption.hidden = true; // hide from the dropdown list
  mat.appendChild(customOption);
  Object.keys(CROSS_SECTIONS).forEach(k => { const o=document.createElement('option'); o.value=k; o.textContent=k; cross.appendChild(o); });
  // add a 'Custom' entry (hidden) so we can mark the cross-section as custom when the user edits I
  // It is hidden so it does not appear in the pulldown menu but can still be selected programmatically.
  const customCross = document.createElement('option');
  customCross.value = 'Custom';
  customCross.textContent = 'Custom';
  customCross.hidden = true;
  cross.appendChild(customCross);

  // defaults
  L.value = Lr.value = 7.0; Lr.addEventListener('input', ()=>{ L.value=Lr.value; updateFromL(); });
  F.value = Fr.value = 0.0; Fr.addEventListener('input', ()=>{ F.value=Fr.value; updateFromF(); });
  D.value = Dr.value = 0.0; Dr.addEventListener('input', ()=>{ D.value=Dr.value; updateFromD(); });
  E.value = Er.value = MATERIAL_DEFAULT_E['Stainless Steel']; Er.addEventListener('input', ()=>{ E.value=Er.value; updateFromE(); });
  I.value = Ir.value = CROSS_SECTIONS['0.016 Round']; Ir.addEventListener('input', ()=>{ I.value=Ir.value; updateFromI(); });
  mat.value = 'Stainless Steel'; cross.value = '0.016 Round';

  // Helper updates to keep UI in sync and replot
  function updateFromL(){ Lr.value = L.value; schedulePlot(); }
  function updateFromF(){ Fr.value = F.value; // when force changed, recompute deflection
    const L_mm=Number(L.value), E_GPa=Number(E.value), I_v=Number(I.value), F_g=Number(F.value);
    if(L_mm>0 && E_GPa>0 && I_v>0){ const L_m=L_mm/1000; const F_N=F_g*0.00981; const delta_m = F_N * L_m**3 / (3*E_GPa*1e9*I_v*1e-15); D.value = (delta_m*1000).toFixed(1); Dr.value = D.value; }
    schedulePlot(); }
  function updateFromD(){ Dr.value = D.value; // when deflection changed compute force
    const L_mm=Number(L.value), E_GPa=Number(E.value), I_v=Number(I.value), delta_mm=Number(D.value);
    if(L_mm>0 && E_GPa>0 && I_v>0){ const L_m=L_mm/1000; const delta_m = delta_mm/1000; const F_N = delta_m * 3*E_GPa*1e9*I_v*1e-15 / (L_m**3); const F_g=F_N/0.00981; F.value=F_g.toFixed(1); Fr.value=F.value; }
    schedulePlot(); }
  // When E is changed directly (slider/input), treat the material as "Custom"
  // so the user sees that the E value no longer matches the preset materials.
  // Also update the displayed deflection (D) based on current Force, L and I so
  // the numeric D field reflects the changed stiffness.
  function updateFromE(){
    Er.value = E.value;
    try{ mat.value = 'Custom'; }catch(e){}
    // Recompute deflection D from current F, L, E, I (if possible):
    const L_mm = Number(L.value), E_GPa = Number(E.value), I_v = Number(I.value), F_g = Number(F.value);
    if(L_mm>0 && E_GPa>0 && I_v>0 && F_g>0){
      const L_m = L_mm/1000;
      const F_N = F_g * 0.00981;
      const delta_m = F_N * Math.pow(L_m,3) / (3 * E_GPa * 1e9 * I_v * 1e-15);
      const delta_mm = delta_m * 1000;
      D.value = delta_mm.toFixed(1);
      Dr.value = D.value;
    }
    schedulePlot();
  }
  // When I is changed directly (slider/input), treat the cross-section as "Custom"
  // so the user sees that the I value no longer matches the preset cross sections.
  // Also update the displayed deflection (D) based on current Force, L and E so
  // the numeric D field reflects the changed inertia.
  function updateFromI(){
    Ir.value = I.value;
    try{ cross.value = 'Custom'; }catch(e){}
    // Recompute deflection D from current F, L, E, I (if possible):
    const L_mm = Number(L.value), E_GPa = Number(E.value), I_v = Number(I.value), F_g = Number(F.value);
    if(L_mm>0 && E_GPa>0 && I_v>0 && F_g>0){
      const L_m = L_mm/1000;
      const F_N = F_g * 0.00981;
      const delta_m = F_N * Math.pow(L_m,3) / (3 * E_GPa * 1e9 * I_v * 1e-15);
      const delta_mm = delta_m * 1000;
      D.value = delta_mm.toFixed(1);
      Dr.value = D.value;
    }
    schedulePlot();
  }

  // text inputs commit on change/blur
  [L,F,D,E,I].forEach(inp=>{ inp.addEventListener('change', ()=>{ // clamp values to ranges
    const id=inp.id; if(id==='L') L.value=clamp(L.value,0,50); if(id==='F') F.value=clamp(F.value,0,500); if(id==='D') D.value=clamp(D.value,0,50); if(id==='E') E.value=clamp(E.value,14.5,207); if(id==='I') I.value=clamp(I.value,0.13,10.34); // sync ranges
    Lr.value=L.value; Fr.value=F.value; Dr.value=D.value; Er.value=E.value; Ir.value=I.value; // recalc coupling: prefer deflection->force
    updateFromD(); }); });

  mat.addEventListener('change', ()=>{
    const d = MATERIAL_DEFAULT_E[mat.value] || MATERIAL_E_RANGES[mat.value][1]; E.value = d; Er.value = d; schedulePlot();
  });
  cross.addEventListener('change', ()=>{ const v=CROSS_SECTIONS[cross.value]; I.value = v; Ir.value = v; schedulePlot(); });

  function computeFDRate(L_mm, E_GPa, I_10_15){
    const L_m = L_mm/1000; if(L_m<=0 || E_GPa<=0 || I_10_15<=0) return NaN; const E_Pa = E_GPa*1e9; const I_m4 = I_10_15*1e-15; const delta_m = 1e-3; const F_N = delta_m * 3*E_Pa*I_m4 / (L_m**3); const F_g = F_N/0.00981; return F_g; }

  // Drawing
  function clearCanvas(){ const w = canvas.clientWidth, h = canvas.clientHeight; ctx.clearRect(0,0,w,h); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,w,h); }
  // drawAxes now accepts maxY so it can draw appropriate y tick labels
  function drawAxes(maxY){ const w = canvas.clientWidth, h = canvas.clientHeight;
    const M_LEFT = 60, M_RIGHT = 20, M_TOP = 20, M_BOTTOM = 50;
    ctx.save(); ctx.strokeStyle='#e6e6e6'; ctx.lineWidth=1; ctx.beginPath(); // x axis
    ctx.moveTo(M_LEFT,h-M_BOTTOM); ctx.lineTo(w-M_RIGHT, h-M_BOTTOM); // y axis
    ctx.moveTo(M_LEFT,h-M_BOTTOM); ctx.lineTo(M_LEFT,M_TOP); ctx.stroke(); ctx.restore();
    // ticks and labels
    ctx.fillStyle='#333'; ctx.font='12px Arial'; ctx.textAlign='center';
    const xTicks = 5;
    for(let i=0;i<=xTicks;i++){ const x = M_LEFT + i*(w-M_LEFT-M_RIGHT)/xTicks; const val = Math.round((i*(50/xTicks))*10)/10; ctx.fillText(val.toString(), x, h-M_BOTTOM+18); ctx.beginPath(); ctx.moveTo(x,h-M_BOTTOM); ctx.lineTo(x,h-M_BOTTOM-4); ctx.strokeStyle='#ddd'; ctx.stroke(); }
  // x-axis label centered under the ticks
  ctx.font='12px Arial'; ctx.textAlign='center';
  ctx.fillText('L (mm)', M_LEFT + (w-M_LEFT-M_RIGHT)/2, h-M_BOTTOM+36);
    // y ticks and numeric labels (show mm values)
    ctx.textAlign='right'; ctx.textBaseline='middle';
    const yTicks = 5;
    for(let j=0;j<=yTicks;j++){ const gy = (h-M_BOTTOM) - (j/yTicks)*(h-M_TOP-M_BOTTOM); const val = (j/yTicks) * Math.max(maxY, 30); const lbl = (Math.round(val*10)/10).toString(); ctx.fillText(lbl, M_LEFT-8, gy); ctx.beginPath(); ctx.moveTo(M_LEFT, gy); ctx.lineTo(M_LEFT+4, gy); ctx.strokeStyle='#f0f0f0'; ctx.stroke(); }
    // y axis label with units
    ctx.save(); ctx.translate(M_LEFT-40, h/2); ctx.rotate(-Math.PI/2); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('Deflection (mm)', 0,0); ctx.restore();
  }

  function schedulePlot(){ window.requestAnimationFrame(renderPlot); }

  function renderPlot(){
  clearCanvas();
  const L_mm = Number(L.value), F_g=Number(F.value), E_GPa=Number(E.value), I_v=Number(I.value);
  const data = calculateCantileverDeflection(L_mm, F_g, E_GPa, I_v, 200);
  const maxY = Math.max(1e-6, ...data.y);
  drawAxes(maxY);
    // Plot curve scaled to area
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const M_LEFT = 60, M_RIGHT = 20, M_TOP = 20, M_BOTTOM = 50;
  const plotW = w - M_LEFT - M_RIGHT; const plotH = h - M_TOP - M_BOTTOM; const originX = M_LEFT; const originY = h - M_BOTTOM;
  // find max deflection to scale
  // draw curve
  // grid lines (horizontal)
  ctx.strokeStyle='#f0f0f0'; ctx.lineWidth=1;
  const yGrid = 5;
  for(let j=0;j<=yGrid;j++){ const gy = originY - (j/yGrid)*plotH; ctx.beginPath(); ctx.moveTo(originX, gy); ctx.lineTo(originX+plotW, gy); ctx.stroke(); }
    // plot curve
    // Map I (m^4 x10^-15) to a visible line width for the wire
    const min_I_val = 0.13, max_I_val = 10.34;
    const min_lw = 2, max_lw = 6;
    let lw = min_lw;
    try{
      const frac = (I_v - min_I_val) / (max_I_val - min_I_val);
      const t = Math.max(0, Math.min(1, frac));
      lw = min_lw + (max_lw - min_lw) * t;
    }catch(e){ lw = 3; }
    ctx.beginPath(); ctx.lineWidth = lw; ctx.strokeStyle = mapEtoColor(E_GPa);
  for(let i=0;i<data.x.length;i++){ const px = originX + (data.x[i]/50)*plotW; const py = originY - (data.y[i]/Math.max(maxY,30))*plotH; if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py); }
  ctx.stroke();
    // annotate max (keep label inside canvas)
    const idx = data.y.indexOf(Math.max(...data.y));
    const mx = originX + (data.x[idx]/50)*plotW;
    const my = originY - (data.y[idx]/Math.max(maxY,30))*plotH;
    if (F_g > 0) {
      const forceText = `${Number(F_g).toFixed(1)} g`;
      let defText = 'N/A';
      try { const defVal = parseFloat(D.value); defText = isFinite(defVal) ? `(${defVal.toFixed(1)} mm)` : 'N/A'; } catch(e){}
      // measure widths
      ctx.font = '14px Arial';
      const fw = ctx.measureText(forceText).width;
      ctx.font = '12px Arial';
      const dw = ctx.measureText(defText).width;
      const spacing = 6;
      const textW = fw + spacing + dw;
      const half = textW / 2;
      // clamp horizontal center within plot area
      const minCenterX = originX + 4 + half;
      const maxCenterX = originX + plotW - 4 - half;
      const centerX = Math.max(minCenterX, Math.min(mx, maxCenterX));
      // vertical placement: prefer above the point, else below, clamp to plot vertical bounds
      const aboveY = my - 28;
      const textH = 18; // approx
      let textY = aboveY;
      const topLimit = M_TOP + 4;
      const bottomLimit = originY - 4 - textH;
      if (textY < topLimit) {
        textY = my + 8; // place below
        if (textY > bottomLimit) textY = bottomLimit;
      }
      // draw arrow marker near the plotted max point but clamp vertically so it's visible
      const arrowY = Math.max(M_TOP + 4, Math.min(my - 12, originY - 4));
      ctx.fillStyle = '#0000ff'; ctx.font = '14px Arial'; ctx.textAlign = 'center'; ctx.fillText('↑', mx, arrowY);
      // draw force (centered) and deflection (to the right) at clamped position
      ctx.fillStyle = '#0000ff'; ctx.font = '14px Arial'; ctx.textAlign = 'center'; ctx.fillText(forceText, centerX, textY);
      ctx.font = '12px Arial'; ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.fillText(defText, centerX + fw/2 + spacing, textY + 1);
    }
    // Draw F/Δ display
    const fd = computeFDRate(L_mm, E_GPa, I_v);
  F_D_rate_el.textContent = isFinite(fd)?`F/Δ= ${fd.toFixed(1)} g/mm`:'F/Δ= N/A';
    // Moment estimate
    const M_gmm = F_g * L_mm; moment_el.textContent = `M = ${M_gmm.toFixed(1)} g·mm`;
    // Show equation if requested
  // Populate the equation below the checkbox (DOM) when requested
  try{
    const coeffs = polyfit(data.x, data.y, 3);
    const eq = formatEquation(coeffs);
    if (showEq.checked) {
      if (eqDisplay) { eqDisplay.textContent = eq; eqDisplay.style.display = 'block'; }
    } else {
      if (eqDisplay) { eqDisplay.textContent = ''; eqDisplay.style.display = 'none'; }
    }
  }catch(e){ if (eqDisplay) { eqDisplay.textContent = ''; eqDisplay.style.display = 'none'; } }
  }

  // Export CSV
  document.getElementById('export').addEventListener('click', ()=>{
    const rows = [
      ['IBD L (mm)', L.value], ['Force (g)', F.value], ['Deflection (mm)', D.value], ['Material', mat.value], ['E (GPa)', E.value], ['Cross Section', cross.value], ['I (m4 x10^-15)', I.value]
    ];
    const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `FD_rate_export.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  // Reset
  document.getElementById('reset').addEventListener('click', ()=>{
    L.value = Lr.value = 0.0; F.value = Fr.value = 0.0; D.value = Dr.value = 0.0; mat.value='Stainless Steel'; E.value = Er.value = MATERIAL_DEFAULT_E['Stainless Steel']; cross.value='0.016 Round'; I.value = Ir.value = CROSS_SECTIONS['0.016 Round']; schedulePlot();
  });

  // initial draw
  schedulePlot();
});
