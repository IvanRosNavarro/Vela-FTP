// Genera build/icon.png (1024×1024) a partir de la vela de la familia Vela con
// una insignia de transferencia. electron-builder deriva de él los .ico e .icns.
//   npx electron scripts/generate-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sail = fs.readFileSync(path.join(root, 'build', 'vela-sail.png')).toString('base64');

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c" width="1024" height="1024"></canvas>
<script>
const img = new Image();
img.onload = () => {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  // Vela centrada y un poco a la izquierda para dejar sitio a la insignia.
  ctx.drawImage(img, 40, 60, 860, 860);
  // Insignia: círculo con borde blanco y flechas de subida/bajada.
  const cx = 770, cy = 770, r = 210;
  ctx.beginPath(); ctx.arc(cx, cy, r + 28, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#1f6f62'; ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 34; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Flecha arriba (izquierda)
  ctx.beginPath(); ctx.moveTo(cx - 62, cy + 110); ctx.lineTo(cx - 62, cy - 105); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 132, cy - 35); ctx.lineTo(cx - 62, cy - 110); ctx.lineTo(cx + 8, cy - 35); ctx.stroke();
  // Flecha abajo (derecha)
  ctx.beginPath(); ctx.moveTo(cx + 62, cy - 110); ctx.lineTo(cx + 62, cy + 105); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 8, cy + 35); ctx.lineTo(cx + 62, cy + 110); ctx.lineTo(cx + 132, cy + 35); ctx.stroke();
  window.__icon = c.toDataURL('image/png');
};
img.src = 'data:image/png;base64,${sail}';
</script></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  let dataUrl = null;
  for (let i = 0; i < 100 && !dataUrl; i++) {
    dataUrl = await win.webContents.executeJavaScript('window.__icon ?? null');
    if (!dataUrl) await new Promise((r) => setTimeout(r, 50));
  }
  if (!dataUrl) throw new Error('No se pudo dibujar el icono');
  const out = path.join(root, 'build', 'icon.png');
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`Icono escrito en ${out}`);
  app.quit();
});
