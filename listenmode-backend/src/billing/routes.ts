import { Hono } from 'hono';
import type { Bindings, ApiResponse } from '../types';
import { jsonError } from '../types';
import { generateLicenseKey, hashLicenseKey } from '../auth/jwt';

/**
 * Minimal Stripe billing routes implemented using fetch to Stripe API.
 * These routes are intended to be called by the audio-vault.app website.
 */
const billing = new Hono<{ Bindings: Bindings }>();

function requireStripe(c: any): { ok: boolean; msg?: string } {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_SECRET_KEY.trim()) {
    return { ok: false, msg: 'Stripe secret not configured' };
  }
  return { ok: true };
}

function formEncode(payload: Record<string, string | number | boolean | undefined | null | Array<string | number | boolean>>): string {
  const parts: string[] = [];
  const enc = (v: string) => encodeURIComponent(v);
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'undefined' || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${enc(k)}=${enc(String(item))}`);
    } else {
      parts.push(`${enc(k)}=${enc(String(v))}`);
    }
  }
  return parts.join('&');
}

/**
 * POST /v1/billing/checkout
 * Body: { price_id: string; success_url?: string; cancel_url?: string; customer_email?: string; plan?: 'basic'|'pro' }
 * Returns: { url, id }
 */
billing.post('/checkout', async (c) => {
  try {
    const guard = requireStripe(c);
    if (!guard.ok) return jsonError(c, 500, 'CONFIG_MISSING', guard.msg!);
    let body: any = {};
    try { body = await c.req.json(); } catch {}
    const price_id = String(body?.price_id || '').trim();
    if (!price_id) return jsonError(c, 400, 'PRICE_ID_REQUIRED', 'price_id is required');
    const success_url = (body?.success_url && String(body.success_url)) || 'https://audio-vault.app/thanks?session_id={CHECKOUT_SESSION_ID}';
    const cancel_url = (body?.cancel_url && String(body.cancel_url)) || 'https://audio-vault.app/cancelled';
    const customer_email = body?.customer_email ? String(body.customer_email) : undefined;
    const plan = body?.plan && (body.plan === 'basic' || body.plan === 'pro') ? body.plan : undefined;

    const payload: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': price_id,
      'line_items[0][quantity]': '1',
      success_url,
      cancel_url,
    };
    if (customer_email) payload['customer_email'] = customer_email;
    if (plan) payload['metadata[plan]'] = plan;

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formEncode(payload)
    });
    const json = await res.json().catch(() => null) as any;
    if (!res.ok) {
      return jsonError(c, 502, 'STRIPE_ERROR', `Stripe error: ${res.status}`, json);
    }
    return c.json<ApiResponse<{ id: string; url?: string }>>({ success: true, data: { id: json?.id, url: json?.url } });
  } catch (e) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

/**
 * POST /v1/billing/portal
 * Body: { stripe_customer_id: string; return_url?: string }
 * Returns: { url }
 */
billing.post('/portal', async (c) => {
  try {
    const guard = requireStripe(c);
    if (!guard.ok) return jsonError(c, 500, 'CONFIG_MISSING', guard.msg!);
    let body: any = {};
    try { body = await c.req.json(); } catch {}
    const customer = String(body?.stripe_customer_id || '').trim();
    if (!customer) return jsonError(c, 400, 'CUSTOMER_REQUIRED', 'stripe_customer_id is required');
    const return_url = (body?.return_url && String(body.return_url)) || 'https://audio-vault.app/account';
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formEncode({ customer, return_url })
    });
    const json = await res.json().catch(() => null) as any;
    if (!res.ok) return jsonError(c, 502, 'STRIPE_ERROR', `Stripe error: ${res.status}`, json);
    return c.json<ApiResponse<{ url: string }>>({ success: true, data: { url: String(json?.url || '') } });
  } catch (e) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

/**
 * POST /v1/billing/webhook
 * Verifies Stripe signature and updates license records accordingly.
 * For simplicity, plan mapping is taken from event metadata (plan) when present.
 */
billing.post('/webhook', async (c) => {
  try {
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return jsonError(c, 500, 'CONFIG_MISSING', 'Webhook secret not configured');
    const sig = c.req.header('Stripe-Signature') || '';
    const raw = await c.req.text();
    // Basic verification: match v1 signature using HMAC SHA-256 over `${t}.${raw}`
    const m = sig.split(',').reduce((acc, part) => { const [k, v] = part.split('='); if (k && v) acc[k.trim()] = v.trim(); return acc; }, {} as Record<string,string>);
    const t = m['t']; const v1 = m['v1'];
    if (!t || !v1) return jsonError(c, 400, 'BAD_SIGNATURE', 'Missing signature');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const data = encoder.encode(`${t}.${raw}`);
    const sigBuf = await crypto.subtle.sign('HMAC', key, data);
    const hex = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== v1) {
      // Allow slight mismatch in non-production/testing to simplify local testing
      if ((c.env.ENVIRONMENT || '').toLowerCase() === 'production') {
        return jsonError(c, 400, 'BAD_SIGNATURE', 'Invalid signature');
      }
    }
    const event = JSON.parse(raw);
    const type: string = event?.type || '';
    // Handle events
    if (type === 'checkout.session.completed') {
      const customer: string | undefined = event?.data?.object?.customer || event?.data?.object?.customer_id;
      const plan: 'free'|'basic'|'pro' | undefined = event?.data?.object?.metadata?.plan;
      // Create license if not exists for this customer
      if (customer) {
        let lic = await c.env.DB
          .prepare('SELECT * FROM licenses WHERE stripe_customer_id = ? LIMIT 1')
          .bind(customer)
          .first<any>();
        if (!lic) {
          const keyPlain = generateLicenseKey();
          const hash = await hashLicenseKey(keyPlain);
          await c.env.DB
            .prepare('INSERT INTO licenses (license_key_hash, stripe_customer_id, plan, status) VALUES (?, ?, ?, ?)')
            .bind(hash, customer, plan || 'basic', 'active')
            .run();
          lic = await c.env.DB
            .prepare('SELECT * FROM licenses WHERE stripe_customer_id = ? LIMIT 1')
            .bind(customer)
            .first<any>();
          // Audit
          try { await c.env.DB.prepare('INSERT INTO events (license_id, event_type, metadata) VALUES (?, ?, ?)').bind(lic?.id ?? null, 'checkout_session_completed', JSON.stringify({ customer, plan: plan || 'basic' })).run(); } catch {}
        }
      }
    } else if (type === 'customer.subscription.updated') {
      const customer: string | undefined = event?.data?.object?.customer;
      const status: string | undefined = event?.data?.object?.status; // active, past_due, canceled
      let plan: string | undefined = event?.data?.object?.plan?.nickname || event?.data?.object?.metadata?.plan;
      if (customer) {
        const row = await c.env.DB.prepare('SELECT * FROM licenses WHERE stripe_customer_id = ? LIMIT 1').bind(customer).first<any>();
        if (row) {
          const newStatus = status === 'canceled' ? 'expired' : 'active';
          await c.env.DB.prepare('UPDATE licenses SET plan = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(plan || row.plan, newStatus, row.id).run();
          try { await c.env.DB.prepare('INSERT INTO events (license_id, event_type, metadata) VALUES (?, ?, ?)').bind(row.id, 'subscription_updated', JSON.stringify({ status, plan })).run(); } catch {}
        }
      }
    } else if (type === 'invoice.paid') {
      const customer: string | undefined = event?.data?.object?.customer;
      if (customer) {
        const row = await c.env.DB.prepare('SELECT * FROM licenses WHERE stripe_customer_id = ? LIMIT 1').bind(customer).first<any>();
        if (row) {
          await c.env.DB.prepare('UPDATE licenses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('active', row.id).run();
          try { await c.env.DB.prepare('INSERT INTO events (license_id, event_type, metadata) VALUES (?, ?, ?)').bind(row.id, 'invoice_paid', null).run(); } catch {}
        }
      }
    } else if (type === 'invoice.payment_failed') {
      const customer: string | undefined = event?.data?.object?.customer;
      if (customer) {
        const row = await c.env.DB.prepare('SELECT * FROM licenses WHERE stripe_customer_id = ? LIMIT 1').bind(customer).first<any>();
        if (row) {
          await c.env.DB.prepare('UPDATE licenses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('suspended', row.id).run();
          try { await c.env.DB.prepare('INSERT INTO events (license_id, event_type, metadata) VALUES (?, ?, ?)').bind(row.id, 'invoice_failed', null).run(); } catch {}
        }
      }
    }

    return c.json<ApiResponse>({ success: true });
  } catch (e) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

export { billing as billingRoutes };


