import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const RAFFLE_ID = process.env.RAFFLE_ID || 'rifa-dark-green';
const RAFFLE_TITLE = process.env.RAFFLE_TITLE || 'Rifa Dark Green';
const RAFFLE_PRICE = Number(process.env.RAFFLE_PRICE || 2000);
const RAFFLE_SIZE = Number(process.env.RAFFLE_SIZE || 100);
const RESERVATION_MINUTES = Number(process.env.RESERVATION_MINUTES || 10);
const PUBLIC_FRONTEND_URL = process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://127.0.0.1:5500';
const KHIPU_BASE_URL = process.env.KHIPU_BASE_URL || 'https://payment-api.khipu.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-token';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://example.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
);

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function addMinutes(date, minutes) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeNumberList(numbers) {
  return Array.from(new Set((numbers || [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= RAFFLE_SIZE)))
    .sort((a, b) => a - b);
}

function jsonToCsv(rows) {
  const headers = ['number','status','payer_name','payer_phone','payer_email','payer_rut','payment_channel','transaction_id','payment_id','paid_at','notes'];
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
}

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Token administrador inválido.' });
  }
  next();
}

async function releaseExpiredReservations() {
  await supabase
    .from('raffle_tickets')
    .update({
      status: 'available',
      reserved_until: null,
      payer_name: null,
      payer_email: null,
      payer_phone: null,
      payer_rut: null,
      payment_id: null,
      transaction_id: null,
      payment_channel: null,
      notes: null,
    })
    .eq('raffle_id', RAFFLE_ID)
    .eq('status', 'reserved')
    .lt('reserved_until', nowIso());
}

async function ensureRaffleNumbers(size) {
  const { count } = await supabase
    .from('raffle_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('raffle_id', RAFFLE_ID);

  if ((count || 0) >= size) return;

  const rows = [];
  for (let number = 1; number <= size; number += 1) rows.push({ raffle_id: RAFFLE_ID, number, status: 'available' });

  await supabase.from('raffle_tickets').upsert(rows, { onConflict: 'raffle_id,number', ignoreDuplicates: true });
}

async function getTicketsByNumbers(numbers) {
  const { data, error } = await supabase
    .from('raffle_tickets')
    .select('*')
    .eq('raffle_id', RAFFLE_ID)
    .in('number', numbers)
    .order('number', { ascending: true });
  if (error) throw error;
  return data || [];
}

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, raffleId: RAFFLE_ID });
});

app.get('/api/numbers', async (req, res) => {
  try {
    const size = Number(req.query.size || RAFFLE_SIZE);
    await ensureRaffleNumbers(size);
    await releaseExpiredReservations();

    const { data, error } = await supabase
      .from('raffle_tickets')
      .select('number,status,reserved_until')
      .eq('raffle_id', RAFFLE_ID)
      .order('number', { ascending: true });

    if (error) throw error;
    res.json({ numbers: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error al consultar números.' });
  }
});

app.post('/api/payments/create', async (req, res) => {
  try {
    const { numbers, payerName, payerEmail, payerPhone, payerRut } = req.body;
    const normalizedNumbers = normalizeNumberList(numbers);

    if (!normalizedNumbers.length) return res.status(400).json({ error: 'Debes indicar uno o más números.' });
    if (!payerName || !payerEmail || !payerPhone) return res.status(400).json({ error: 'Debes completar nombre, celular y email.' });

    await ensureRaffleNumbers(RAFFLE_SIZE);
    await releaseExpiredReservations();

    const tickets = await getTicketsByNumbers(normalizedNumbers);
    if (tickets.length !== normalizedNumbers.length) return res.status(404).json({ error: 'Uno o más números no existen.' });
    const blocked = tickets.filter((ticket) => ticket.status !== 'available');
    if (blocked.length) return res.status(409).json({ error: `Estos números ya no están disponibles: ${blocked.map((t) => t.number).join(', ')}.` });

    const transactionId = `${RAFFLE_ID}-${Date.now()}`;
    const reservedUntil = addMinutes(new Date(), RESERVATION_MINUTES).toISOString();

    const { error: reserveError } = await supabase
      .from('raffle_tickets')
      .update({
        status: 'reserved',
        reserved_until: reservedUntil,
        payer_name: payerName,
        payer_email: payerEmail,
        payer_phone: payerPhone,
        payer_rut: payerRut || null,
        transaction_id: transactionId,
        payment_channel: 'khipu',
        notes: null,
      })
      .eq('raffle_id', RAFFLE_ID)
      .in('number', normalizedNumbers)
      .eq('status', 'available');

    if (reserveError) throw reserveError;

    const expiresDate = addMinutes(new Date(), RESERVATION_MINUTES).toISOString();
    const notifyUrl = `${req.protocol}://${req.get('host')}/api/payments/webhook`;
    const total = normalizedNumbers.length * RAFFLE_PRICE;

    const paymentPayload = {
      amount: total,
      currency: 'CLP',
      subject: `${RAFFLE_TITLE} - Números ${normalizedNumbers.join(', ')}`,
      transaction_id: transactionId,
      return_url: `${PUBLIC_FRONTEND_URL}/?status=success&numbers=${normalizedNumbers.join(',')}`,
      cancel_url: `${PUBLIC_FRONTEND_URL}/?status=cancel&numbers=${normalizedNumbers.join(',')}`,
      notify_url: notifyUrl,
      payer_name: payerName,
      payer_email: payerEmail,
      expires_date: expiresDate,
      custom: JSON.stringify({ raffleId: RAFFLE_ID, numbers: normalizedNumbers, payerPhone, payerRut }),
    };

    const khipuResponse = await fetch(`${KHIPU_BASE_URL}/v3/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.KHIPU_API_KEY,
      },
      body: JSON.stringify(paymentPayload),
    });

    const khipuData = await khipuResponse.json();
    if (!khipuResponse.ok) {
      await supabase
        .from('raffle_tickets')
        .update({
          status: 'available',
          reserved_until: null,
          payer_name: null,
          payer_email: null,
          payer_phone: null,
          payer_rut: null,
          transaction_id: null,
          payment_channel: null,
        })
        .eq('raffle_id', RAFFLE_ID)
        .in('number', normalizedNumbers);

      return res.status(400).json({ error: khipuData.message || 'Khipu no pudo crear el cobro.', details: khipuData });
    }

    await supabase
      .from('raffle_tickets')
      .update({ payment_id: khipuData.payment_id })
      .eq('raffle_id', RAFFLE_ID)
      .eq('transaction_id', transactionId);

    res.json({
      ok: true,
      payment_id: khipuData.payment_id,
      payment_url: khipuData.payment_url,
      transaction_id: transactionId,
      reserved_until: reservedUntil,
      numbers: normalizedNumbers,
      total,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'No fue posible generar el pago.' });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const paymentId = req.body.payment_id || req.query.payment_id;
    const transactionId = req.body.transaction_id || req.query.transaction_id;
    if (!paymentId && !transactionId) return res.status(400).json({ error: 'Webhook sin payment_id ni transaction_id.' });

    let query = supabase.from('raffle_tickets').select('*').eq('raffle_id', RAFFLE_ID);
    if (paymentId) query = query.eq('payment_id', paymentId); else query = query.eq('transaction_id', transactionId);

    const { data: tickets, error: ticketError } = await query.order('number', { ascending: true });
    if (ticketError) throw ticketError;
    if (!tickets?.length) return res.status(404).json({ error: 'Tickets no encontrados.' });

    await supabase
      .from('raffle_tickets')
      .update({ status: 'paid', paid_at: nowIso(), reserved_until: null, payment_channel: 'khipu' })
      .eq('raffle_id', RAFFLE_ID)
      .eq('transaction_id', tickets[0].transaction_id);

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error procesando webhook.' });
  }
});

app.get('/api/admin/tickets', requireAdmin, async (_req, res) => {
  try {
    await ensureRaffleNumbers(RAFFLE_SIZE);
    await releaseExpiredReservations();
    const { data, error } = await supabase
      .from('raffle_tickets')
      .select('number,status,payer_name,payer_phone,payer_email,payer_rut,payment_channel,transaction_id,payment_id,paid_at,notes')
      .eq('raffle_id', RAFFLE_ID)
      .order('number', { ascending: true });
    if (error) throw error;
    res.json({ tickets: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message || 'No fue posible cargar tickets.' });
  }
});

app.get('/api/admin/export.csv', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('raffle_tickets')
      .select('number,status,payer_name,payer_phone,payer_email,payer_rut,payment_channel,transaction_id,payment_id,paid_at,notes')
      .eq('raffle_id', RAFFLE_ID)
      .order('number', { ascending: true });
    if (error) throw error;

    const csv = jsonToCsv(data || []);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rifa-export.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message || 'No fue posible exportar el CSV.' });
  }
});

app.post('/api/admin/assign-manual', requireAdmin, async (req, res) => {
  try {
    const normalizedNumbers = normalizeNumberList(req.body.numbers);
    const { payerName, payerPhone, payerEmail, payerRut, notes } = req.body;
    if (!normalizedNumbers.length) return res.status(400).json({ error: 'Debes indicar uno o más números.' });
    if (!payerName || !payerPhone || !payerEmail) return res.status(400).json({ error: 'Debes completar nombre, celular y email.' });

    await ensureRaffleNumbers(RAFFLE_SIZE);
    await releaseExpiredReservations();

    const tickets = await getTicketsByNumbers(normalizedNumbers);
    const blocked = tickets.filter((ticket) => ticket.status !== 'available');
    if (blocked.length) return res.status(409).json({ error: `Estos números no están disponibles: ${blocked.map((t) => t.number).join(', ')}.` });

    const transactionId = `manual-${Date.now()}`;
    const { error } = await supabase
      .from('raffle_tickets')
      .update({
        status: 'paid',
        payer_name: payerName,
        payer_phone: payerPhone,
        payer_email: payerEmail,
        payer_rut: payerRut || null,
        payment_channel: 'manual',
        transaction_id: transactionId,
        payment_id: null,
        paid_at: nowIso(),
        reserved_until: null,
        notes: notes || null,
      })
      .eq('raffle_id', RAFFLE_ID)
      .in('number', normalizedNumbers)
      .eq('status', 'available');
    if (error) throw error;

    res.json({ ok: true, updated_numbers: normalizedNumbers });
  } catch (error) {
    res.status(500).json({ error: error.message || 'No fue posible registrar manualmente.' });
  }
});

app.post('/api/admin/release', requireAdmin, async (req, res) => {
  try {
    const normalizedNumbers = normalizeNumberList(req.body.numbers);
    if (!normalizedNumbers.length) return res.status(400).json({ error: 'Debes indicar uno o más números.' });

    const { error } = await supabase
      .from('raffle_tickets')
      .update({
        status: 'available',
        payer_name: null,
        payer_phone: null,
        payer_email: null,
        payer_rut: null,
        payment_channel: null,
        transaction_id: null,
        payment_id: null,
        paid_at: null,
        reserved_until: null,
        notes: null,
      })
      .eq('raffle_id', RAFFLE_ID)
      .in('number', normalizedNumbers);
    if (error) throw error;

    res.json({ ok: true, released_numbers: normalizedNumbers });
  } catch (error) {
    res.status(500).json({ error: error.message || 'No fue posible liberar los números.' });
  }
});

app.listen(PORT, () => {
  console.log(`Rifa backend corriendo en http://localhost:${PORT}`);
});
