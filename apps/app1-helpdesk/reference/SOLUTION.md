# SOLUTION — app1 Helpdesk (config/deps only)

Прикладной код в `apps/app1-helpdesk/src/` **идентичен** для vulnerable и reference.
Все фиксы — в `reference/` (env, `package.json`, Dockerfile, db init, k8s).

Флаг-формат: `TRN{<32 hex>}` (`@hacktraining/shared`). Значения флагов в логи не пишутся.

---

## V1.1 Слабый JWT-секрет — `CFG-JWT`

- **Где:** `vulnerable/.env` → `JWT_SECRET=secret`
- **Эксплуатация:** подписать JWT с `role=admin`, `GET /api/admin/secrets`
- **Где флаг:** строка `admin_secrets.name=round_flag`
- **Фикс:** `reference/.env` / k8s Secret — длинный случайный `JWT_SECRET`
- **Логи:** `auth.token.verified` с `role=admin` без предшествующего `auth.login.ok`

```bash
node tools/attacker-scripts/app1/forge-jwt.mjs --base http://127.0.0.1:3001 --secret secret
```

---

## V1.2 Уязвимый ejs (CVE-2022-29078) — `CFG-RCE`

- **Где:** `vulnerable/package.json` → `ejs@3.1.6`; `GET /tickets/:id` делает `res.render(..., { ...req.query })`
- **Эксплуатация:** query `settings[view options][outputFunctionName]=…` → RCE → чтение `FLAG_FILE_PATH`
- **Где флаг:** файл флага (`/flags/app1.flag` или `./flags/app1.flag`)
- **Фикс:** `reference/package.json` → `ejs@3.1.10` (+ `npm ci`); исходник не меняется
- **Логи:** аномальный query / 500; значение флага в логи не пишется

```bash
node tools/attacker-scripts/app1/ejs-rce.mjs --base http://127.0.0.1:3001
```

---

## V1.3 Debug / утечка — `CFG-LEAK`

- **Где:** `EXPOSE_DEBUG=true`, `NODE_ENV=development`
- **Эксплуатация:** `GET /internal/debug` → `database.canary_flag`
- **Где флаг:** поле ответа debug (канарейка)
- **Фикс:** `EXPOSE_DEBUG=false`, `NODE_ENV=production`
- **Логи:** запросы к `/internal/debug`

```bash
node tools/attacker-scripts/app1/debug-leak.mjs --base http://127.0.0.1:3001
```

---

## V1.4 CORS `*` + credentials — `CFG-LEAK`

- **Где:** `CORS_ORIGIN=*`, `CORS_CREDENTIALS=true`
- **Эксплуатация:** вредоносная страница с чужим Origin читает API с cookies
- **Фикс:** `CORS_ORIGIN=https://helpdesk.local`
- **Логи:** `meta.origin` на запросах / preflight OPTIONS

---

## V1.5 Дефолтный админ — `CFG-*`

- **Где:** `SEED_ADMIN_PASSWORD=admin123` → пользователь `admin`
- **Эксплуатация:** логин `admin/admin123` → `/api/admin/secrets`
- **Где флаг:** `admin_secrets`
- **Фикс:** сильный `SEED_ADMIN_PASSWORD` + пересев
- **Логи:** `auth.login.ok` для `admin` с внешнего IP

---

## V1.6 Security headers off — `CFG-LEAK`

- **Где:** `SECURITY_HEADERS=off`
- **Эксплуатация:** нет CSP/HSTS/X-Frame-Options (чекер SLA-security)
- **Фикс:** `SECURITY_HEADERS=on` (helmet)
- **Логи:** косвенно через checker `missing_headers`

---

## V1.7 [bonus] Postgres trust / NodePort / superuser

- **Где:** `vulnerable/db/pg_hba.conf` = trust; `init.sql` SUPERUSER; Service NodePort
- **Фикс:** scram-sha-256, роль `helpdesk_app`, ClusterIP

## V1.8 [bonus] Container root / `:latest` / no limits

- **Где:** vulnerable Dockerfile `node:latest`, нет `USER`; k8s без securityContext/resources
- **Фикс:** pinned tag, `USER app`, runAsNonRoot, drop ALL, limits

## V1.9 [bonus] Static root leak

- **Где:** `SERVE_STATIC_ROOT=.` → `GET /.env`
- **Фикс:** `SERVE_STATIC_ROOT=./public`
