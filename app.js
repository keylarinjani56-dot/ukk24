/* ============================================================
   app.js — IoT Monitoring Dashboard
   Broker  : HiveMQ Cloud (TLS WebSocket)
   Device  : ESP32 + DHT11 + LDR
   Project : UKK SMK IoT Monitoring
   ============================================================ */

// ─── MQTT CONFIG (hardcoded) ──────────────────────────────────
const MQTT_CONFIG = {
  host     : 'b182a000b8cb44d786348d0a164df087.s1.eu.hivemq.cloud',
  port     : 8884,
  username : 'keyla',
  password : 'Ukkstemsend24',
  protocol : 'wss',       // WebSocket Secure (TLS)
  path     : '/mqtt',
};

// Topics yang di-subscribe (ESP32 → Web)
const TOPICS_SUB = [
  'smk/iot/suhu',
  'smk/iot/kelembaban',
  'smk/iot/ldr',
  'smk/iot/relay1',
  'smk/iot/relay2',
  'smk/iot/relay3',
  'smk/iot/relay4',
  'smk/iot/mode',
];

// Topics yang di-publish (Web → ESP32)
const TOPIC_MODE_SET    = 'smk/iot/mode/set';
const TOPIC_RELAY_SET   = n => `smk/iot/relay${n}/set`;

// ─── STATE ────────────────────────────────────────────────────
let mqttClient  = null;
let rows        = [];
let rowCount    = 0;
const MAX_ROWS  = 80;
const MAX_CHART = 30;   // diperbesar karena data datang lebih cepat (500ms)
const relayState = { 1: false, 2: false, 3: false, 4: false };

// ─── CHART DATA ───────────────────────────────────────────────
const chartLabels  = [];
const chartSuhu    = [];
const chartHumi    = [];

// ─── CHART INIT ───────────────────────────────────────────────
function makeChart(canvasId, label, dataArr, color) {
  return new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label,
        data: dataArr,
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: color,
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },   // dipercepat dari 400ms → 200ms agar tidak lag
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', maxTicksLimit: 6, font: { size: 10 } }, grid: { color: '#1f2937' } },
        y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: '#1f2937' } },
      },
    },
  });
}

const chSuhu = makeChart('ch-s', 'Suhu °C',     chartSuhu, '#6366f1');
const chHumi = makeChart('ch-h', 'Kelembaban %', chartHumi, '#0ea5e9');

// ─── MQTT CONNECT (auto on load) ─────────────────────────────
function connectMQTT() {
  const url = `${MQTT_CONFIG.protocol}://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}${MQTT_CONFIG.path}`;

  mqttClient = mqtt.connect(url, {
    clientId        : 'web_' + Math.random().toString(16).slice(2, 8),
    username        : MQTT_CONFIG.username,
    password        : MQTT_CONFIG.password,
    reconnectPeriod : 5000,
    connectTimeout  : 15000,
    clean           : true,
  });

  mqttClient.on('connect', onConnect);
  mqttClient.on('message', onMessage);
  mqttClient.on('error',   onError);
  mqttClient.on('close',   onClose);
  mqttClient.on('reconnect', () => setStatus('connecting'));
}

// ─── MQTT EVENTS ─────────────────────────────────────────────
function onConnect() {
  setStatus('connected');
  TOPICS_SUB.forEach(t => mqttClient.subscribe(t));
  enableModeButtons(true);
}

function onClose() {
  setStatus('disconnected');
  enableModeButtons(false);
  enableRelayButtons(false);
}

function onError(err) {
  console.error('[MQTT] Error:', err.message);
  setStatus('disconnected');
}

function onMessage(topic, payload) {
  const msg = payload.toString().trim();
  const now  = new Date();
  const ts   = now.toLocaleTimeString('id-ID');
  const tsFull = now.toLocaleString('id-ID');

  switch (topic) {
    case 'smk/iot/suhu':       handleSuhu(msg, ts, tsFull);     break;
    case 'smk/iot/kelembaban': handleKelembaban(msg, ts);        break;
    case 'smk/iot/ldr':        handleLDR(msg, ts);               break;
    case 'smk/iot/mode':       handleMode(msg);                  break;
    default:
      if (topic.startsWith('smk/iot/relay')) {
        const n = +topic.replace('smk/iot/relay', '');
        if (n >= 1 && n <= 4) updateRelayUI(n, msg === 'ON');
      }
  }
}

// ─── SENSOR HANDLERS ─────────────────────────────────────────
function handleSuhu(msg, ts, tsFull) {
  const v = parseFloat(msg);
  if (isNaN(v)) return;

  const col  = v <= 25 ? 'g' : v <= 30 ? 'y' : 'r';
  const lbl  = v <= 25 ? 'Normal ✓' : v <= 30 ? 'Hangat ⚠️' : 'Panas! 🔥';

  document.getElementById('csuhu').className = 'card-val ' + col;
  document.getElementById('csuhu').innerHTML = v.toFixed(1) + '<span class="card-unit">°C</span>';
  document.getElementById('tsuhu').className = 'tag ' + col;
  document.getElementById('tsuhu').textContent = lbl;
  document.getElementById('usuhu').textContent = 'Update: ' + ts;

  if (v > 30) showNotification(`Suhu ${v.toFixed(1)}°C — Melebihi batas aman!`);

  // Update chart
  chartLabels.push(ts);
  chartSuhu.push(v);
  if (chartLabels.length > MAX_CHART) { chartLabels.shift(); chartSuhu.shift(); }
  chSuhu.update();

  addRow(tsFull, v, null, null);
}

function handleKelembaban(msg, ts) {
  const v = parseFloat(msg);
  if (isNaN(v)) return;

  document.getElementById('chumi').innerHTML = v.toFixed(1) + '<span class="card-unit">%</span>';
  document.getElementById('thumi').textContent = 'Kelembaban: ' + v.toFixed(1) + '%';
  document.getElementById('uhumi').textContent = 'Update: ' + ts;

  chartHumi.push(v);
  if (chartHumi.length > MAX_CHART) chartHumi.shift();
  chHumi.update();

  updateLastRow(null, v, null);
}

function handleLDR(msg, ts) {
  // Bersihkan semua karakter aneh
  const clean = msg.replace(/[^\x20-\x7E]/g, '').toLowerCase().trim();

  const terang = clean.includes('terang');

  document.getElementById('cldr').textContent  = terang ? 'TERANG' : 'GELAP';
  document.getElementById('tldr').className    = 'tag ' + (terang ? 'y' : 'p');
  document.getElementById('tldr').textContent  = terang ? '💡 Terang' : '🌙 Gelap';
  document.getElementById('uldr').textContent  = 'Update: ' + ts;

  updateLastRow(null, null, terang ? 'terang' : 'gelap');
}

function handleMode(msg) {
  const isAuto = msg === 'AUTO';

  // Update card mode
  document.getElementById('cmode').textContent = msg;
  document.getElementById('cmode').className   = 'card-val ' + (isAuto ? 'g' : 'y');

  // Update tombol aktif
  const btnAuto = document.getElementById('mbtn-auto');
  const btnMan  = document.getElementById('mbtn-man');
  btnAuto.className = 'mbtn auto'   + (isAuto  ? ' active' : '');
  btnMan.className  = 'mbtn manual' + (!isAuto ? ' active' : '');

  // Relay hanya bisa dikontrol saat MANUAL
  enableRelayButtons(!isAuto);

  if (isAuto) {
    // Saat AUTO: tampilkan "AUTO" di semua relay, ESP32 yang kendalikan
    [1, 2, 3, 4].forEach(n => {
      document.getElementById('rc' + n).className   = 'relay-card off';
      document.getElementById('rs' + n).className   = 'relay-status off';
      document.getElementById('rs' + n).textContent = 'AUTO';
      document.getElementById('rb' + n).className   = 'btn-toggle btn-on';
      document.getElementById('rb' + n).textContent = 'Auto';
    });
  } else {
    // Saat MANUAL: tampilkan ON/OFF sesuai state relay aktual
    [1, 2, 3, 4].forEach(n => updateRelayUI(n, relayState[n]));
  }
}

// ─── PUBLISH COMMANDS ─────────────────────────────────────────
function setMode(mode) {
  if (!mqttClient || !mqttClient.connected) {
    showNotification('⚠️ Belum terhubung ke broker MQTT!');
    return;
  }
  // Optimistic UI update — langsung ubah tampilan tanpa tunggu ESP32
  handleMode(mode);
  // Kirim perintah ke ESP32 via MQTT
  mqttClient.publish(TOPIC_MODE_SET, mode);
  console.log('[MQTT] Publish:', TOPIC_MODE_SET, '→', mode);
}

function setRelay(n) {
  if (!mqttClient || !mqttClient.connected) {
    showNotification('⚠️ Belum terhubung ke broker MQTT!');
    return;
  }
  const newState = !relayState[n];
  // Optimistic UI update — langsung ubah tampilan
  updateRelayUI(n, newState);
  // Kirim perintah ke ESP32 via MQTT
  mqttClient.publish(TOPIC_RELAY_SET(n), newState ? 'ON' : 'OFF');
  console.log('[MQTT] Publish:', TOPIC_RELAY_SET(n), '→', newState ? 'ON' : 'OFF');
}

// ─── UI: RELAY ────────────────────────────────────────────────
function updateRelayUI(n, on) {
  relayState[n] = on;
  document.getElementById('rc' + n).className = 'relay-card ' + (on ? 'on' : 'off');
  const stat = document.getElementById('rs' + n);
  stat.className   = 'relay-status ' + (on ? 'on' : 'off');
  stat.textContent = on ? 'ON' : 'OFF';
  const btn = document.getElementById('rb' + n);
  btn.className   = 'btn-toggle ' + (on ? 'btn-off-relay' : 'btn-on');
  btn.textContent = on ? 'Matikan' : 'Nyalakan';
}

function enableModeButtons(en) {
  document.getElementById('mbtn-auto').disabled = !en;
  document.getElementById('mbtn-man').disabled  = !en;
  if (!en) enableRelayButtons(false);
}

function enableRelayButtons(en) {
  [1, 2, 3, 4].forEach(n => {
    document.getElementById('rb' + n).disabled = !en;
  });
}

// ─── UI: STATUS ───────────────────────────────────────────────
function setStatus(state) {
  const badge = document.getElementById('sbadge');
  const text  = document.getElementById('stxt');
  const map = {
    connected    : { cls: 'conn', label: '✅ Connected'    },
    disconnected : { cls: 'disc', label: '❌ Disconnected'  },
    connecting   : { cls: 'disc', label: '🔄 Reconnecting...' },
  };
  const s = map[state] || map.disconnected;
  badge.className = 'sbadge ' + s.cls;
  text.textContent = s.label;
}

// ─── TABLE ────────────────────────────────────────────────────
function addRow(ts, suhu, humi, ldr) {
  rowCount++;
  rows.unshift({ id: rowCount, ts, suhu, humi, ldr });
  if (rows.length > MAX_ROWS) rows.pop();
  renderTable();
}

function updateLastRow(suhu, humi, ldr) {
  if (!rows.length) return;
  if (suhu !== null) rows[0].suhu = suhu;
  if (humi !== null) rows[0].humi = humi;
  if (ldr  !== null) rows[0].ldr  = ldr;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">Belum ada data.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r, i) => {
    const s   = r.suhu;
    const col = s === null ? 'b' : s <= 25 ? 'g' : s <= 30 ? 'y' : 'r';
    const lbl = s === null ? '-' : s <= 25 ? 'Normal' : s <= 30 ? 'Hangat' : 'Panas!';
    return `<tr>
      <td>${i + 1}</td>
      <td>${r.ts}</td>
      <td>${s !== null ? `<span class="badge ${col}">${s.toFixed(1)}°C</span>` : '-'}</td>
      <td>${r.humi !== null ? r.humi.toFixed(1) + '%' : '-'}</td>
      <td>${r.ldr || '-'}</td>
      <td>${s !== null ? `<span class="badge ${col}">${lbl}</span>` : '-'}</td>
    </tr>`;
  }).join('');
}

function clearAll() {
  rows = []; rowCount = 0;
  chartLabels.length = 0;
  chartSuhu.length   = 0;
  chartHumi.length   = 0;
  chSuhu.update();
  chHumi.update();
  renderTable();
}

// ─── NOTIFICATION ─────────────────────────────────────────────
let notifTimer = null;
function showNotification(msg) {
  const el = document.getElementById('notif');
  document.getElementById('notif-txt').textContent = msg;
  el.classList.add('show');
  if (notifTimer) clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// ─── INIT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Auto connect ke MQTT saat halaman dibuka
  connectMQTT();
});
