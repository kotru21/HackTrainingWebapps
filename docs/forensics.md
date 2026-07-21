# Разбор атак по логам — HackTrainingWebapps

Готовые запросы для пост-разбора: **LogQL** (Grafana/Loki, логи приложений), **SQL** (аудит-таблица
`security_audit` и scoreboard), **PostgreSQL statement log** (сырьё по SQLi). Формат событий — §7 [`SPEC.md`](SPEC.md),
привязка к очкам — [`scoring.md`](scoring.md). Материалы раунда лежат в `artifacts/round-<n>-<team>.tar.gz`
(собирает `collect-logs.sh`).

**Общий метод разбора одной атаки (5 шагов):**
1. На дашборде **Attack timeline** найти всплеск security-событий и время T.
2. Достать `reqId` ключевого события → собрать всю цепочку запросов атаки по `reqId`.
3. Для инъекций — показать реальный запрос из PostgreSQL-лога в окне ±30 c от T.
4. Сопоставить с сабмитом флага в `submissions` (какой `vuln_id`, во сколько) — доказать, что баг «выстрелил».
5. Показать git-diff патча Blue → закрыли/не закрыли и почему кражи прекратились/продолжились.

Лейблы Loki: `namespace` (=`team-a`/`team-b`/`platform`), `service`, `event`. Ниже `team-a` — подставлять нужный.

---

## 0. Базовые запросы (для любого разбора)

**Все security-события команды за раунд, по времени:**
```logql
{namespace="team-a"} | json | event=~"auth.*|authz.*|role.change|sql.error|ssrf.blocked|upload.url.fetch"
```

**Собрать цепочку атаки по одному reqId:**
```logql
{namespace="team-a"} | json | reqId="0b3f...-uuid"
```

**Топ источников по числу запросов (найти атакующий IP):**
```logql
sum by (srcIp) (count_over_time({namespace="team-a"} | json [5m]))
```

**Аудит из БД (переживает рестарты подов) — сырой поток событий:**
```sql
SELECT ts, actor, event, route, src_ip, detail
FROM security_audit
WHERE ts BETWEEN :round_start AND :round_end
ORDER BY ts;
```

**Сшить событие безопасности со сдачей флага:**
```sql
SELECT s.submitted_at, s.submitter_team, s.vuln_id, s.points, s.src_ip
FROM submissions s
WHERE s.status='accepted'
ORDER BY s.submitted_at;
```

---

## app1 «Helpdesk»

### V1.1 Forged-admin JWT (слабый секрет) → `vuln_id: CFG-JWT`
**Признак:** успешная верификация admin-токена с нового IP, `iat` не совпадает с реальной выдачей логина.
```logql
{namespace="team-a"} | json | event="auth.token.verified" | role="admin"
```
```sql
-- admin-действия без предшествующего auth.login.ok для этого actor
SELECT ts, actor, event, src_ip, detail->>'iat' AS token_iat
FROM security_audit
WHERE event IN ('auth.token.verified','admin.access') AND detail->>'role'='admin'
ORDER BY ts;
```
**Доказательство:** admin-токен принят с IP, с которого не было `auth.login.ok`.

### V1.2 RCE через уязвимую зависимость → `vuln_id: CFG-RCE`
**Признак:** аномальные payload'ы в теле запроса к пути рендера/парсинга, 500 с трейсом шаблонизатора,
доступ к `/flags/app1.flag`.
```logql
{namespace="team-a", service="app1-helpdesk"} | json | status=500 | line_format "{{.route}} {{.meta}}"
```
```logql
{namespace="team-a"} |= "flag" |= "app1.flag"
```
**Доказательство:** чтение файла флага коррелирует с подозрительным payload'ом по `reqId`.

### V1.3 Debug/утечка стектрейса → `vuln_id: CFG-LEAK`
```logql
{namespace="team-a"} | json | route=~"/internal/.*"
```
```logql
{namespace="team-a", service="app1-helpdesk"} | json | status=500 | __error__=""
```
**Доказательство:** запрос к `/internal/debug` (200) от внешнего IP → в ответе конфиг/канареечный флаг.

### V1.4 CORS `*` + credentials → `vuln_id: CFG-LEAK`
**Признак:** запросы с чужим `Origin`, preflight `OPTIONS` с внешних доменов.
```logql
{namespace="team-a"} | json | method="OPTIONS" or origin!=""
| label_format ext_origin="{{ .origin }}"
```
```sql
SELECT ts, src_ip, detail->>'origin' AS origin, route
FROM security_audit
WHERE detail ? 'origin' AND detail->>'origin' !~ 'helpdesk\.local'
ORDER BY ts;
```

### V1.5 Дефолтные креды админа → `vuln_id: CFG-*`
**Признак:** серия `auth.login.fail` для `admin`, затем `auth.login.ok` с внешнего IP (подбор), либо сразу успех дефолтом.
```logql
{namespace="team-a"} | json | event=~"auth.login.(ok|fail)" | userId="admin"
```
```sql
SELECT date_trunc('minute', ts) m, event, count(*)
FROM security_audit
WHERE event LIKE 'auth.login.%' AND detail->>'user'='admin'
GROUP BY 1,2 ORDER BY 1;
```

### V1.6 Отключённые security-заголовки → `vuln_id: CFG-LEAK`
Фиксируется чекером как деградация безопасности (нет CSP/HSTS/X-Frame-Options):
```sql
SELECT team, tick, status, detail->>'missing_headers' AS missing
FROM sla_samples
WHERE detail ? 'missing_headers'
ORDER BY tick;
```

### V1.9 Утечка статики (.git/.env/map) → `vuln_id: CFG-LEAK`
```logql
{namespace="team-a"} | json | route=~"/(\\.git|\\.env).*|.*\\.map"
```

---

## app2 «Billing»

### V2.1 IDOR → `vuln_id: A01-IDOR`
**Признак:** один пользователь перебирает много разных `:id`, часть — 200 на чужие ресурсы.
```logql
{namespace="team-a"} | json | route="GET /api/invoices/:id" | event=~"authz.(allow|deny)"
```
```sql
-- запросы, где владелец ресурса != запросивший (успешная кража)
SELECT ts, actor, src_ip, detail->>'resourceOwner' AS owner, detail->>'requester' AS req
FROM security_audit
WHERE event='authz.allow' AND detail->>'resourceOwner' <> detail->>'requester'
ORDER BY ts;
```
```logql
-- скорость перебора id одним источником
sum by (srcIp) (count_over_time({namespace="team-a"} | json | route="GET /api/invoices/:id" [1m]))
```

### V2.2 SQL-инъекция → `vuln_id: A03-SQLI`
**Признак:** кавычки/`UNION` в параметре `q`, всплеск `sql.error`, а в PG-логе — сам инъектированный запрос.
```logql
{namespace="team-a"} | json | event="sql.error"
```
```logql
{namespace="team-a"} | json | route=~"GET /api/invoices.*" |~ "(?i)(union|select|--|')"
```
**PostgreSQL statement log (главное доказательство)** — сырой инъектированный SQL в окне ±30 c:
```logql
{namespace="team-a", service="postgres"} |~ "secret_flags" or |~ "UNION"
```
```sql
-- если PG-логи зеркалируются в таблицу; иначе grep по файлу лога из артефакта
SELECT log_time, user_name, message
FROM postgres_log
WHERE message ILIKE '%secret_flags%' OR message ILIKE '%UNION SELECT%'
ORDER BY log_time;
```

### V2.3 Stored XSS → `vuln_id: A03-XSS`
**Признак:** в сохранённом контенте `<script>`/`onerror=`; затем исходящий запрос из сессии админа к внешнему коллектору.
```logql
{namespace="team-a"} |~ "(?i)(<script|onerror=|onload=|document\\.cookie)"
```
```sql
-- полезная нагрузка, попавшая в хранилище комментариев/профиля
SELECT ts, actor, route, detail->>'payload' AS payload
FROM security_audit
WHERE event='content.store' AND detail->>'payload' ~* '<script|onerror|onload'
ORDER BY ts;
```
**Доказательство:** сохранённый payload + последующее срабатывание у админа (обращение к внешнему URL из его сессии).

### V2.4 Mass-assignment privesc → `vuln_id: A04-MASSASSIGN`
**Признак:** `PATCH /api/profile` с полем `role`; событие `role.change` вне админского пути.
```logql
{namespace="team-a"} | json | event="role.change"
```
```sql
SELECT ts, actor, src_ip, detail->>'from' AS from_role, detail->>'to' AS to_role, route
FROM security_audit
WHERE event='role.change' AND route NOT LIKE '/api/admin/%'
ORDER BY ts;
```
**Доказательство:** `to_role='admin'` через `/api/profile`, затем доступ к `/api/admin/flag`.

### V2.5 Криптосбои / захват через reset → `vuln_id: A02-CRYPTO`
**Признак:** несколько запросов `/reset` подряд, успешная смена пароля без владения почтой; либо использование
хешей, выгруженных через V2.2.
```logql
{namespace="team-a"} | json | route=~".*/(reset|password).*"
```
```sql
SELECT ts, actor, src_ip, event
FROM security_audit
WHERE route ILIKE '%reset%'
ORDER BY ts;
```
**Доказательство:** `reset.request` → `reset.consume` для чужого аккаунта с одного IP за секунды (предсказуемый токен).

### V2.6 SSRF → `vuln_id: A10-SSRF`
**Признак:** egress app к внутренним/приватным адресам при «загрузке аватара по URL».
```logql
{namespace="team-a"} | json | event="upload.url.fetch"
```
```logql
{namespace="team-a"} | json | event="upload.url.fetch" | target=~"(10\\.|127\\.|169\\.254\\.|internal-metadata).*"
```
```sql
SELECT ts, actor, src_ip, detail->>'avatarUrl' AS url
FROM security_audit
WHERE event='upload.url.fetch' AND detail->>'avatarUrl' ~ '(10\.|127\.|169\.254\.|internal-metadata)'
ORDER BY ts;
```
**Доказательство:** `avatarUrl` указывает на `internal-metadata` → в ответе учебный флаг. В эталоне это событие
`ssrf.blocked`, а не `upload.url.fetch`.

---

## Сводные запросы для финального табло разбора

**Тайм-лайн «атака → сдача флага» по всему раунду:**
```sql
SELECT s.submitted_at, s.submitter_team AS red, s.vuln_id, s.points, s.src_ip
FROM submissions s WHERE s.status='accepted'
ORDER BY s.submitted_at;
```

**Реакция защиты: когда прекратились кражи по каждому багу (время «закрытия»):**
```sql
SELECT vuln_id, min(submitted_at) first_steal, max(submitted_at) last_steal,
       count(*) FILTER (WHERE status='accepted') steals
FROM submissions GROUP BY vuln_id ORDER BY steals DESC;
```

**SLA-провалы (где защита сломала функционал патчем):**
```sql
SELECT team, tick, status, latency_ms
FROM sla_samples WHERE status IN ('down','mumble') ORDER BY tick;
```

**Что именно закрыла Blue (из архива):** `git -C artifacts/round-<n>-<team>/workspace diff baseline..HEAD`
— показать на разборе рядом с моментом, когда прекратились сабмиты соответствующего `vuln_id`.

---

## Замечания по реализации логов (для агента)

- Каждое security-событие обязано нести `reqId`, `srcIp`, `route`, `event` и релевантный `meta`/`detail` (jsonb) —
  без этого запросы выше не сработают. Дублировать security-события в `security_audit` (переживает рестарт пода).
- PostgreSQL на стендах: `log_statement=all`, `log_line_prefix='%m [%p] %u@%d %h '`; Promtail должен собирать логи
  postgres-подов с лейблом `service="postgres"`, иначе SQLi разбирают только из файла в артефакте.
- Флаги в открытом виде в логах приложений **не** писать — только факт доступа к защищённому ресурсу
  (иначе флаг «подсматривается» в Grafana мимо эксплуатации, см. §6 `scoring.md`).
- Часы всех подов синхронны (UTC) — корреляция по времени между Loki, `security_audit` и PG-логом обязана сходиться.
