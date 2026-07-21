# SOLUTION — app2 Billing (OWASP code fixes)

`vulnerable/src` и `reference/src` — **разный** код. Общая схема/статика — `apps/app2-billing/shared/`.
Флаги: `TRN{<32 hex>}` (`@hacktraining/shared`). Значения флагов в логи не пишутся.

---

## V2.1 A01 IDOR — `A01-IDOR`

- **Где (vuln):** `GET /api/invoices/:id` без проверки владельца (`vulnerable/src/routes/invoices.ts`)
- **Эксплуатация:** от имени `alice` перебрать id → прочитать счёт `bob` с флагом в `memo`
- **Где флаг:** `invoices.memo` жертвы (bob / «Confidential retainer»)
- **Фикс:** `owner_id === req.user.id || admin`; иначе **404**
- **Логи:** `authz.allow` с `resourceOwner != requester` (vuln) / `authz.deny` (ref)

```bash
node tools/attacker-scripts/app2/idor.mjs --base http://127.0.0.1:3011
```

---

## V2.2 A03 SQLi — `A03-SQLI`

- **Где:** `GET /api/invoices?q=` — конкатенация в SQL
- **Эксплуатация:** `q=%27 UNION SELECT id, name, 0, 'open', value FROM secret_flags--`
- **Где флаг:** таблица `secret_flags` (не отдаётся штатным API)
- **Фикс:** `$1` placeholders + allow-list `sort` + фильтр по `owner_id`
- **Логи:** `sql.error`; в PG `log_statement=all` — сырой SQL

```bash
node tools/attacker-scripts/app2/sqli.mjs --base http://127.0.0.1:3011
```

---

## V2.3 A03 Stored XSS — `A03-XSS`

- **Где:** bio/comments в EJS как `<%- %>` + cookie без HttpOnly
- **Эксплуатация:** сохранить `<script>` в bio → админ открывает `/admin` → кража сессии → `/api/admin/note`
- **Где флаг:** `admin_notes.body`
- **Фикс:** `<%= %>` + HttpOnly cookie + CSP (helmet)
- **Логи:** `content.store` с `<script`/`onerror=`

```bash
node tools/attacker-scripts/app2/xss.mjs --base http://127.0.0.1:3011
```

---

## V2.4 Mass-assignment — `A04-MASSASSIGN`

- **Где:** `PATCH /api/profile` → `Object.assign(user, req.body)` включая `role`
- **Эксплуатация:** `{"role":"admin"}` → `GET /api/admin/flag`
- **Где флаг:** `/api/admin/flag`
- **Фикс:** allow-list `{display_name, avatar_url, bio}`
- **Логи:** `role.change` вне admin-пути (vuln)

```bash
node tools/attacker-scripts/app2/mass-assign.mjs --base http://127.0.0.1:3011
```

---

## V2.5 Crypto / reset — `A02-CRYPTO`

- **Где:** MD5 пароли; `reset_token = String(Date.now())` (+ возврат токена в ответе)
- **Эксплуатация:** `POST /api/reset/request` для `carol` → confirm с предсказанным/полученным токеном → login → `private_note`
- **Где флаг:** `users.private_note` аккаунта carol
- **Фикс:** bcrypt + `randomBytes(32)` + TTL + токен не возвращается в API
- **Логи:** `reset.request` / `reset.consume`

```bash
node tools/attacker-scripts/app2/crypto-reset.mjs --base http://127.0.0.1:3011
```

---

## V2.6 SSRF — `A10-SSRF`

- **Где:** `POST /api/profile/avatar` → `fetch(userUrl)` без проверки
- **Эксплуатация:** `avatarUrl=http://127.0.0.1:3099/flag` (local `internal-metadata`)
- **Где флаг:** ответ internal-metadata
- **Фикс:** allow-list схем, блок localhost/private/metadata hostnames, timeout, no redirects
- **Логи:** `upload.url.fetch` (vuln) / `ssrf.blocked` (ref)

```bash
node tools/attacker-scripts/app2/ssrf.mjs --base http://127.0.0.1:3011 --metadata http://127.0.0.1:3099/flag
```
