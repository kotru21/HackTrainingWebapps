import { createLogger } from '@hacktraining/shared';
import type { CheckerConfig, StandConfig } from './config';

const log = createLogger({ service: 'checker', team: 'platform' });

export type SlaStatus = 'up' | 'down' | 'mumble';

export interface CheckResult {
  status: SlaStatus;
  latency_ms: number;
  detail: Record<string, unknown>;
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body, text };
  } finally {
    clearTimeout(t);
  }
}

/** Billing SLA: register → login → create invoice → pay → receipt paid. */
export async function checkBilling(
  stand: StandConfig,
  timeoutMs: number,
): Promise<CheckResult> {
  const base = stand.base_url.replace(/\/$/, '');
  const started = Date.now();
  const user = `sla_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const password = 'sla-pass-1';

  try {
    const health = await fetchJson(`${base}/healthz`, {
      timeoutMs,
    });
    if (!health.ok) {
      return {
        status: 'down',
        latency_ms: Date.now() - started,
        detail: { step: 'healthz', http: health.status },
      };
    }

    const reg = await fetchJson(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
      timeoutMs,
    });
    if (!reg.ok) {
      return {
        status: 'mumble',
        latency_ms: Date.now() - started,
        detail: { step: 'register', http: reg.status },
      };
    }

    const login = await fetchJson(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
      timeoutMs,
    });
    const token = (login.body as { token?: string } | null)?.token;
    if (!login.ok || !token) {
      return {
        status: 'mumble',
        latency_ms: Date.now() - started,
        detail: { step: 'login', http: login.status },
      };
    }

    const created = await fetchJson(`${base}/api/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'SLA invoice', amount_cents: 1500, memo: 'canary' }),
      timeoutMs,
    });
    const invoiceId = (created.body as { invoice?: { id?: number } } | null)?.invoice?.id;
    if (!created.ok || !invoiceId) {
      return {
        status: 'mumble',
        latency_ms: Date.now() - started,
        detail: { step: 'create_invoice', http: created.status },
      };
    }

    const paid = await fetchJson(`${base}/api/invoices/${invoiceId}/pay`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs,
    });
    const receiptStatus = (paid.body as { receipt?: { status?: string } } | null)?.receipt
      ?.status;
    if (!paid.ok || receiptStatus !== 'paid') {
      return {
        status: 'mumble',
        latency_ms: Date.now() - started,
        detail: { step: 'pay', http: paid.status, receiptStatus },
      };
    }

    return {
      status: 'up',
      latency_ms: Date.now() - started,
      detail: { step: 'ok', user },
    };
  } catch (err) {
    return {
      status: 'down',
      latency_ms: Date.now() - started,
      detail: {
        step: 'exception',
        error: err instanceof Error ? err.name : 'error',
      },
    };
  }
}

/** Helpdesk SLA: health → login → list tickets. */
export async function checkHelpdesk(
  stand: StandConfig,
  timeoutMs: number,
): Promise<CheckResult> {
  const base = stand.base_url.replace(/\/$/, '');
  const started = Date.now();
  try {
    const health = await fetchJson(`${base}/healthz`, { timeoutMs });
    if (!health.ok) {
      return {
        status: 'down',
        latency_ms: Date.now() - started,
        detail: { step: 'healthz', http: health.status },
      };
    }
    const loginPage = await fetchJson(`${base}/login`, { timeoutMs });
    if (loginPage.status >= 500) {
      return {
        status: 'down',
        latency_ms: Date.now() - started,
        detail: { step: 'login_page', http: loginPage.status },
      };
    }

    // Functional flow: a normal seed user must still be able to log in and list tickets.
    // This is what turns a broken defender fix into an SLA penalty — if a patch damages
    // auth or the tickets API, these steps fail and the tick is scored 'mumble' (not up).
    // 'alice'/'user123' is an ordinary seed account (not a vuln to close), so it stays
    // stable across legitimate fixes.
    const login = await fetchJson(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'user123' }),
      timeoutMs,
    });
    const token = (login.body as { token?: string } | null)?.token;
    if (!login.ok || !token) {
      return {
        status: 'mumble',
        latency_ms: Date.now() - started,
        detail: { step: 'login', http: login.status },
      };
    }

    const tickets = await fetchJson(`${base}/api/tickets`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs,
    });
    if (!tickets.ok) {
      return {
        status: 'mumble',
        latency_ms: Date.now() - started,
        detail: { step: 'tickets', http: tickets.status },
      };
    }

    return {
      status: 'up',
      latency_ms: Date.now() - started,
      detail: { step: 'ok' },
    };
  } catch (err) {
    return {
      status: 'down',
      latency_ms: Date.now() - started,
      detail: {
        step: 'exception',
        error: err instanceof Error ? err.name : 'error',
      },
    };
  }
}

export async function checkStand(
  stand: StandConfig,
  timeoutMs: number,
): Promise<CheckResult> {
  if (stand.kind === 'billing') return checkBilling(stand, timeoutMs);
  return checkHelpdesk(stand, timeoutMs);
}

export async function reportSla(
  cfg: CheckerConfig,
  stand: StandConfig,
  tick: number,
  result: CheckResult,
): Promise<void> {
  const res = await fetch(`${cfg.scoreboard_url}/api/internal/sla`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Judge-Token': cfg.judge_token,
    },
    body: JSON.stringify({
      team: stand.team,
      service: stand.service,
      tick,
      status: result.status,
      latency_ms: result.latency_ms,
      detail: result.detail,
    }),
  });
  if (!res.ok) {
    throw new Error(`sla report failed: ${res.status}`);
  }
  log.info(
    {
      event: 'sla.sample',
      team: stand.team,
      service: stand.service,
      tick,
      status: result.status,
      latency_ms: result.latency_ms,
    },
    'sla recorded',
  );
}

export async function runCheckerTick(cfg: CheckerConfig): Promise<void> {
  const roundRes = await fetch(`${cfg.scoreboard_url}/api/round`);
  const round = roundRes.ok
    ? ((await roundRes.json()) as { current_tick?: number })
    : { current_tick: 0 };
  const tick = round.current_tick ?? 0;

  for (const stand of cfg.stands) {
    const result = await checkStand(stand, cfg.timeout_ms);
    await reportSla(cfg, stand, tick, result);
  }
}
