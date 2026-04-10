const API_BASE = window.__API_BASE__ || 'http://localhost:8787';
const RAFFLE_PRICE = Number(window.__RAFFLE_PRICE__ || 2000);
const RAFFLE_SIZE = Number(window.__RAFFLE_SIZE__ || 100);

const state = {
  numbers: [],
  selectedNumbers: new Set(),
  adminToken: localStorage.getItem('rifa_admin_token') || '',
};

const els = {
  grid: document.getElementById('numbersGrid'),
  selectedNumbers: document.getElementById('selectedNumbers'),
  ticketCount: document.getElementById('ticketCount'),
  ticketPrice: document.getElementById('ticketPrice'),
  ticketTotal: document.getElementById('ticketTotal'),
  status: document.getElementById('statusMessage'),
  form: document.getElementById('checkoutForm'),
  refreshBtn: document.getElementById('refreshBtn'),
  statAvailable: document.getElementById('statAvailable'),
  statReserved: document.getElementById('statReserved'),
  statPaid: document.getElementById('statPaid'),
  payBtn: document.getElementById('payBtn'),
  adminToken: document.getElementById('adminToken'),
  adminLoginForm: document.getElementById('adminLoginForm'),
  adminStatus: document.getElementById('adminStatus'),
  adminRefreshBtn: document.getElementById('adminRefreshBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  adminTableBody: document.getElementById('adminTableBody'),
  manualAssignForm: document.getElementById('manualAssignForm'),
  releaseForm: document.getElementById('releaseForm'),
};

els.ticketPrice.textContent = formatClp(RAFFLE_PRICE);
els.adminToken.value = state.adminToken;
updateCheckoutSummary();

function formatClp(value) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
}

function parseNumberInput(value) {
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0)
  ));
}

function setStatus(message, type = '') {
  els.status.textContent = message;
  els.status.className = `status-message ${type}`.trim();
}

function setAdminStatus(message, type = '') {
  els.adminStatus.textContent = message;
  els.adminStatus.className = `status-message ${type}`.trim();
}

async function fetchNumbers() {
  try {
    const response = await fetch(`${API_BASE}/api/numbers?size=${RAFFLE_SIZE}`);
    if (!response.ok) throw new Error('No fue posible cargar los números.');
    const data = await response.json();
    state.numbers = data.numbers;

    for (const number of Array.from(state.selectedNumbers)) {
      const current = state.numbers.find((item) => item.number === number);
      if (!current || current.status !== 'available') {
        state.selectedNumbers.delete(number);
      }
    }

    renderStats();
    renderNumbers();
    updateCheckoutSummary();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderStats() {
  const available = state.numbers.filter((n) => n.status === 'available').length;
  const reserved = state.numbers.filter((n) => n.status === 'reserved').length;
  const paid = state.numbers.filter((n) => n.status === 'paid').length;
  els.statAvailable.textContent = available;
  els.statReserved.textContent = reserved;
  els.statPaid.textContent = paid;
}

function renderNumbers() {
  els.grid.innerHTML = '';

  state.numbers.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.number;
    button.className = `number-btn ${item.status}`;

    if (state.selectedNumbers.has(item.number)) button.classList.add('selected');

    if (item.status === 'available') {
      button.addEventListener('click', () => toggleNumber(item.number));
    } else {
      button.disabled = true;
    }

    els.grid.appendChild(button);
  });
}

function toggleNumber(number) {
  if (state.selectedNumbers.has(number)) state.selectedNumbers.delete(number);
  else state.selectedNumbers.add(number);

  updateCheckoutSummary();
  renderNumbers();

  const selected = Array.from(state.selectedNumbers).sort((a, b) => a - b);
  if (selected.length) setStatus(`Seleccionaste ${selected.length} número(s): ${selected.join(', ')}.`, 'success');
  else setStatus('Selecciona uno o más números para continuar.', '');
}

function updateCheckoutSummary() {
  const selected = Array.from(state.selectedNumbers).sort((a, b) => a - b);
  els.selectedNumbers.value = selected.join(', ');
  els.ticketCount.textContent = String(selected.length);
  els.ticketTotal.textContent = formatClp(selected.length * RAFFLE_PRICE);
}

async function createPayment(event) {
  event.preventDefault();
  const numbers = Array.from(state.selectedNumbers).sort((a, b) => a - b);
  if (!numbers.length) {
    setStatus('Primero debes seleccionar uno o más números.', 'warning');
    return;
  }

  const payload = {
    raffleId: 'rifa-dark-green',
    numbers,
    payerName: document.getElementById('name').value.trim(),
    payerEmail: document.getElementById('email').value.trim(),
    payerPhone: document.getElementById('phone').value.trim(),
    payerRut: document.getElementById('payerRut').value.trim(),
  };

  if (!payload.payerName || !payload.payerEmail || !payload.payerPhone) {
    setStatus('Completa nombre, celular y email.', 'warning');
    return;
  }

  els.payBtn.disabled = true;
  els.payBtn.textContent = 'Creando cobro...';

  try {
    const response = await fetch(`${API_BASE}/api/payments/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo crear el pago.');

    setStatus('Reserva creada. Serás redirigido a Khipu...', 'success');
    window.location.href = data.payment_url;
  } catch (error) {
    setStatus(error.message, 'error');
    await fetchNumbers();
  } finally {
    els.payBtn.disabled = false;
    els.payBtn.textContent = 'Reservar y pagar con Khipu';
  }
}

function getAdminHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-token': state.adminToken,
  };
}

async function fetchAdminTickets() {
  if (!state.adminToken) {
    setAdminStatus('Ingresa el token para usar el panel.', 'warning');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/admin/tickets`, { headers: getAdminHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible cargar el panel.');

    renderAdminTable(data.tickets || []);
    setAdminStatus(`Panel actualizado. ${data.tickets.length} registro(s) cargados.`, 'success');
  } catch (error) {
    setAdminStatus(error.message, 'error');
  }
}

function renderAdminTable(tickets) {
  if (!tickets.length) {
    els.adminTableBody.innerHTML = '<tr><td colspan="7" class="empty-row">No hay registros.</td></tr>';
    return;
  }

  els.adminTableBody.innerHTML = tickets.map((ticket) => `
    <tr>
      <td>${ticket.number}</td>
      <td><span class="pill ${ticket.status}">${ticket.status}</span></td>
      <td>${ticket.payer_name || '-'}</td>
      <td>${ticket.payer_phone || '-'}</td>
      <td>${ticket.payer_email || '-'}</td>
      <td>${ticket.payment_channel || '-'}</td>
      <td>${ticket.paid_at ? new Date(ticket.paid_at).toLocaleString('es-CL') : '-'}</td>
    </tr>
  `).join('');
}

async function handleAdminLogin(event) {
  event.preventDefault();
  state.adminToken = els.adminToken.value.trim();
  localStorage.setItem('rifa_admin_token', state.adminToken);
  await fetchAdminTickets();
}

async function handleManualAssign(event) {
  event.preventDefault();
  const numbers = parseNumberInput(document.getElementById('manualNumbers').value);
  if (!numbers.length) {
    setAdminStatus('Debes indicar uno o más números válidos.', 'warning');
    return;
  }

  const payload = {
    numbers,
    payerName: document.getElementById('manualName').value.trim(),
    payerPhone: document.getElementById('manualPhone').value.trim(),
    payerEmail: document.getElementById('manualEmail').value.trim(),
    payerRut: document.getElementById('manualRut').value.trim(),
    notes: document.getElementById('manualNotes').value.trim(),
  };

  try {
    const response = await fetch(`${API_BASE}/api/admin/assign-manual`, {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible registrar los números.');

    setAdminStatus(`Asignación manual lista: ${data.updated_numbers.join(', ')}.`, 'success');
    event.target.reset();
    await fetchNumbers();
    await fetchAdminTickets();
  } catch (error) {
    setAdminStatus(error.message, 'error');
  }
}

async function handleRelease(event) {
  event.preventDefault();
  const numbers = parseNumberInput(document.getElementById('releaseNumbers').value);
  if (!numbers.length) {
    setAdminStatus('Debes indicar uno o más números válidos para liberar.', 'warning');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/admin/release`, {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify({ numbers }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible liberar los números.');

    setAdminStatus(`Números liberados: ${data.released_numbers.join(', ')}.`, 'success');
    event.target.reset();
    await fetchNumbers();
    await fetchAdminTickets();
  } catch (error) {
    setAdminStatus(error.message, 'error');
  }
}

async function exportCsv() {
  if (!state.adminToken) {
    setAdminStatus('Primero debes conectar el panel con tu token.', 'warning');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/admin/export.csv`, {
      headers: { 'x-admin-token': state.adminToken },
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'No fue posible exportar.');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rifa-export.csv';
    a.click();
    window.URL.revokeObjectURL(url);
    setAdminStatus('CSV exportado correctamente.', 'success');
  } catch (error) {
    setAdminStatus(error.message, 'error');
  }
}

els.form.addEventListener('submit', createPayment);
els.refreshBtn.addEventListener('click', fetchNumbers);
els.adminLoginForm.addEventListener('submit', handleAdminLogin);
els.adminRefreshBtn.addEventListener('click', fetchAdminTickets);
els.manualAssignForm.addEventListener('submit', handleManualAssign);
els.releaseForm.addEventListener('submit', handleRelease);
els.exportCsvBtn.addEventListener('click', exportCsv);

fetchNumbers();
if (state.adminToken) fetchAdminTickets();
setInterval(fetchNumbers, 15000);
