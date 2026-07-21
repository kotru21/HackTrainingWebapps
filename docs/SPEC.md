# Техническая спецификация — HackTrainingWebapps

Версия 1.0. Документ описывает **что** и **как** нужно построить. Предназначен для передачи
кодинг-агенту (Cursor / Grok 4.5) как исходное ТЗ. Пофазный план работ — в [`BUILD-PLAN.md`](BUILD-PLAN.md).

---

## 1. Цели и формат тренинга

Полигон для отработки навыков атаки и защиты веб-приложений в формате **attack/defense**.

- Две команды. В раунде одна **защищает** назначенный ей стенд (патчит уязвимости), другая **атакует**
  стенд соперника. По окончании раунда команды **меняются ролями и стендами**.
- Длительность раунда: **60–90 минут**. Отсюда требование: уязвимости **явные и находимые**, к каждой
  есть подсказка (hint) у инструктора; глубина эксплуатации — умеренная.
- Победа определяется **автоматическим скорингом**: очки за украденные флаги (атака) + очки за
  доступность/работоспособность своего стенда (SLA, защита). Скоринг не даёт «чинить, ломая функционал».
- После тренинга — **разбор атак по логам** (централизованные структурированные логи + БД + Grafana).

### Приложения по сложности

- **app1 «Helpdesk»** — фиксится **без залаза в код**: env-переменные, ConfigMap, `package.json`
  (версии зависимостей), `Dockerfile`, k8s-манифесты, init-скрипты БД. Прикладной исходный код в
  `vulnerable/` и `reference/` **байт-в-байт одинаков** — отличаются только конфиг-артефакты. Это
  ключевой дидактический инвариант app1.
- **app2 «Billing»** — фиксится **правкой исходного кода**, набор из OWASP Top 10.

---

## 2. Структура репозитория

```
HackTrainingWebapps/
├── README.md
├── docs/
│   ├── SPEC.md                     # этот файл
│   ├── BUILD-PLAN.md               # план работ + критерии приёмки
│   ├── instructor-guide.md         # сценарий, роли, тайминг, чек-лист судьи
│   ├── scoring.md                  # правила начисления очков
│   └── forensics.md                # как разбирать атаки по логам (запросы Grafana/SQL)
├── packages/
│   └── shared/                     # флаг-регэксп, типы log-событий, обёртка pino
├── apps/
│   ├── app1-helpdesk/
│   │   ├── src/                    # ОБЩИЙ исходный код (симлинк/пакет, используется обоими вариантами)
│   │   ├── vulnerable/             # конфиг уязвимого стенда (env, Dockerfile, k8s, db-init)
│   │   └── reference/              # конфиг эталона + SOLUTION.md
│   └── app2-billing/
│       ├── vulnerable/             # уязвимый исходный код + конфиг
│       ├── reference/              # исправленный исходный код + SOLUTION.md
│       └── shared/                 # общие ассеты/схема БД
├── platform/
│   ├── scoreboard/                 # приём флагов + web-scoreboard (Express + PG)
│   ├── checker/                    # SLA-чекер функциональности стендов
│   └── flag-planter/               # раскладка свежих флагов каждый tick
├── deploy/
│   ├── docker/                     # Dockerfile'ы, compose.dev.yml (локальная разработка)
│   └── k8s/
│       ├── base/                   # namespaces, PSA-лейблы, StorageClass, общие ресурсы
│       ├── platform/               # scoreboard/checker/planter + Loki/Promtail/Grafana
│       ├── team-template/          # kustomize-шаблон namespace команды (app+pg+code-server+netpol)
│       └── overlays/               # team-a, team-b — конкретные значения
├── scripts/
│   ├── bootstrap-cluster.sh
│   ├── deploy-team.sh
│   ├── reset-round.sh
│   ├── swap-roles.sh
│   └── collect-logs.sh             # выгрузка логов раунда в архив для разбора
└── tools/
    ├── attacker-scripts/           # эталонные PoC-эксплойты (для проверки и обучения)
    └── seed/                       # генераторы тестовых данных
```

---

## 3. Общая архитектура полигона

```
                         ┌───────────────────────── k3s (одна VM) ─────────────────────────┐
                         │                                                                  │
  Участники ── ingress ──┤  ns: platform                                                    │
  (браузер/CLI)          │    ├─ scoreboard  (Express+PG)  ← сабмит флагов, live-табло       │
                         │    ├─ checker     (CronJob)     → SLA-проверки стендов            │
                         │    ├─ flag-planter(CronJob)     → раскладка флагов в БД стендов    │
                         │    ├─ Loki + Promtail           ← сбор логов со всех подов         │
                         │    └─ Grafana                   ← дашборды разбора атак            │
                         │                                                                  │
                         │  ns: team-a (blue в раунде 1)      ns: team-b (red в раунде 1)     │
                         │    ├─ app (target, hot-reload)       ├─ app (target)               │
                         │    ├─ postgres (StatefulSet)         ├─ postgres                   │
                         │    ├─ code-server (IDE для правок)   ├─ code-server                │
                         │    └─ NetworkPolicy                  └─ NetworkPolicy              │
                         └──────────────────────────────────────────────────────────────────┘
```

- **Namespace на команду.** У каждой команды свой полный стенд (app + postgres + IDE) — свой экземпляр,
  который она защищает и в который атакующие соперники ходят по сети.
- **NetworkPolicy** (по раундам, применяется скриптом `swap-roles.sh`):
  - default-deny на весь ingress/egress в namespace команды;
  - разрешён вход от `platform` (checker, planter, scoreboard-ingress);
  - разрешён вход от namespace **атакующей** команды **только на HTTP-порт app** (не на postgres, не на code-server);
  - egress к DNS и к своему postgres; запрет egress наружу (кроме нужд SSRF-мишени — см. §5, вынесена в контролируемый internal-сервис).
- **Изоляция БД и IDE:** postgres и code-server никогда не доступны атакующей команде по сети —
  только через app и только через уязвимость.
- **Self-healing:**
  - liveness/readiness probes → k8s перезапускает упавший под;
  - `resources.limits` + `restartPolicy: Always`;
  - `reset-round.sh` восстанавливает базовый уязвимый стенд из baseline-образа и пересевает БД+флаги;
  - защищающая команда работает в **hot-reload** режиме (`tsx watch`/`nodemon`), правки применяются
    без пересборки образа; их рабочая копия лежит на per-team PVC и правится через code-server.

### 3.1 Как команда защищается (workflow патча)

- Исходники/конфиг стенда лежат на **per-team PVC** `workspace`, смонтированном и в `app`, и в `code-server`.
- Команда открывает code-server (web-IDE) в своём namespace, правит файлы.
  - app1: правки в `.env`/ConfigMap/`package.json`/манифестах → применяются `kubectl apply` из
    встроенного терминала code-server (RBAC ограничен своим namespace) либо watcher перекатывает под.
  - app2: правки в `src/**` → `tsx watch` перезапускает процесс за ~1–2 c.
- Все изменения фиксируются git-коммитом (pre-round baseline → post-round diff) для судейского разбора:
  «что именно закрыли». `collect-logs.sh` складывает и git-diff, и логи в архив раунда.

---

## 4. app1 «Helpdesk» — уязвимости уровня «config/deps»

**Легенда:** внутренний хелпдеск: тикеты, вложения, простая админка. Пользователи и админ, JWT-сессии.
Достаточно функционала, чтобы SLA-чекер выполнял осмысленную транзакцию (создать тикет → прочитать → закрыть).

**Инвариант:** `vulnerable/` и `reference/` используют **один и тот же** `apps/app1-helpdesk/src/`.
Всё, что «чинит» команда, лежит вне `src/`.

Флаги в app1 кладутся плантером в места, достижимые **только** через уязвимость (файл `/flags/app1.flag`
в контейнере для RCE; строка в таблице `admin_secrets` для forged-admin JWT; поле в ответе debug-эндпоинта).

Каждая уязвимость ниже описана по шаблону: **где · эксплуатация · фикс (config-only) · след в логах**.
`[core]` — обязательные к раунду; `[bonus]` — если останется время.

### V1.1 `[core]` Слабый/хардкоженный JWT-секрет
- **Где:** `JWT_SECRET=secret` в `vulnerable/.env` (в эталоне — из k8s Secret, 32+ байт случайных).
- **Эксплуатация:** атакующий подбирает/знает секрет, форжит JWT с `role=admin`, читает `admin_secrets` (флаг).
- **Фикс:** заменить на сильный секрет из `Secret`; ротировать. Правка только в env/Secret.
- **Логи:** всплеск успешных `auth.token.verified` для `role=admin` с нового IP; несовпадение `iat` с выдачей.

### V1.2 `[core]` Уязвимая зависимость с известной CVE (реально эксплуатируемая)
- **Где:** в `package.json` закреплена старая версия шаблонизатора/утилиты с RCE/prototype-pollution
  (кандидаты: `ejs@3.1.6` SSTI, либо `lodash`/`minimist` prototype-pollution → обход авторизации). Один
  пакет должен быть **эксплуатируем end-to-end**, остальные — уровня `npm audit`.
- **Эксплуатация:** через штатный путь рендера/парсинга добиться выполнения кода → прочитать `/flags/app1.flag`.
- **Фикс:** поднять версию до патченой + `npm ci` (образ пересобирается пайплайном/`reset` берёт новый lock).
  Исходный код не меняется.
- **Логи:** аномальные payload'ы в теле запроса, дочерние процессы (audit контейнера), 500 с трейсом рендера.

### V1.3 `[core]` Debug-режим и утечка стектрейсов
- **Где:** `NODE_ENV=development`, `EXPOSE_DEBUG=true` → детальные ошибки, `/internal/debug` без auth
  (отдаёт env, версии, конфиг подключения к БД, а в нём — «канареечный» флаг).
- **Эксплуатация:** GET `/internal/debug` или спровоцировать 500 → получить креды/пути/флаг.
- **Фикс:** `NODE_ENV=production`, `EXPOSE_DEBUG=false` (обработчик уже ветвится по env — код не трогаем).
- **Логи:** запросы к `/internal/*`, серии 500 с полным стеком.

### V1.4 `[core]` CORS `*` + credentials
- **Где:** `CORS_ORIGIN=*`, `CORS_CREDENTIALS=true`.
- **Эксплуатация:** зловредная страница читает ответы API с куками жертвы (кража тикета/токена).
- **Фикс:** `CORS_ORIGIN=https://helpdesk.local`, `credentials` только для доверенного origin.
- **Логи:** запросы с чужим `Origin`, preflight `OPTIONS` с внешних доменов.

### V1.5 `[core]` Дефолтные учётки админа
- **Где:** сид создаёт `admin/admin123` (управляется `SEED_ADMIN_PASSWORD`), `/admin` доступна.
- **Эксплуатация:** вход дефолтными кредами → админка → флаг.
- **Фикс:** задать сильный `SEED_ADMIN_PASSWORD` из Secret, пересеять.
- **Логи:** успешный логин `admin` с внешнего IP; много неудачных попыток до успеха (подбор).

### V1.6 `[core]` Отключённые security-заголовки
- **Где:** `SECURITY_HEADERS=off` (helmet сконфигурен, но выключен флагом): нет CSP, HSTS, X-Frame-Options.
- **Эксплуатация:** clickjacking/усиление XSS-поверхности; демонстрация отсутствия заголовков.
- **Фикс:** `SECURITY_HEADERS=on`.
- **Логи:** (косвенно) отсутствие заголовков фиксируется чекером как деградация SLA-по-безопасности.

### V1.7 `[bonus]` Избыточные привилегии PostgreSQL / открытый порт
- **Где:** app подключается к БД суперпользователем; `pg_hba.conf` = `trust`; Service postgres как `NodePort`.
- **Эксплуатация:** через любую инъекцию/утечку кредов — полный доступ к БД, чтение всех схем.
- **Фикс:** least-privilege роль приложения (init-скрипт), `scram-sha-256` в `pg_hba`, `ClusterIP`.
- **Логи:** postgres `log_connections`; подключения от неожиданных ролей/хостов.

### V1.8 `[bonus]` Контейнер от root, `:latest`, без лимитов
- **Где:** `Dockerfile` без `USER`, образ `node:latest`, в k8s нет `securityContext`/`resources`.
- **Эксплуатация:** после RCE — проще закрепиться/эскалировать; нестабильность (OOM ломает стенд).
- **Фикс:** non-root `USER app`, пиннинг тега/digest, `runAsNonRoot`, `readOnlyRootFilesystem`,
  `drop: [ALL]`, `resources.limits`. Правки в `Dockerfile`/манифесте.
- **Логи:** события рестартов/OOM в k8s (Grafana → k8s events).

### V1.9 `[bonus]` Утечка статики (.git/.env/source-maps)
- **Где:** `SERVE_STATIC_ROOT=.` — статик-middleware отдаёт корень проекта.
- **Эксплуатация:** GET `/.env`, `/.git/config`, `/app.js.map` → секреты/исходники.
- **Фикс:** `SERVE_STATIC_ROOT=./public`.
- **Логи:** запросы к `/.git/*`, `/.env`, `*.map`.

> Рекомендуемый набор на раунд: **V1.1–V1.6** (core) + 1–2 bonus. Итого 6–8 находок за 60–90 мин.

---

## 5. app2 «Billing» — уязвимости OWASP Top 10 (правка кода)

**Легенда:** биллинг/выставление счетов: пользователи, счета (`invoices`), комментарии, профиль,
загрузка аватара по URL, роли `user`/`admin`. Функционал достаточен для осмысленного SLA-чекера
(создать счёт → оплатить → получить квитанцию).

**Отличие вариантов:** здесь `vulnerable/` и `reference/` — **разный исходный код**. В `reference/`
уязвимые места закрыты правильными паттернами, и всё описано в `reference/SOLUTION.md`.

Шаблон: **где · эксплуатация · где флаг · фикс (паттерн) · след в логах**.

### V2.1 `[core]` A01 Broken Access Control / IDOR
- **Где:** `GET /api/invoices/:id` возвращает счёт по id без проверки владельца.
- **Эксплуатация:** перебор `:id` → чтение чужих счетов.
- **Флаг:** в поле `memo` счёта, принадлежащего пользователю-жертве (плантер).
- **Фикс:** проверка `invoice.ownerId === req.user.id || req.user.role==='admin'`; 404 вместо 403 для не-владельца.
- **Логи:** один пользователь запрашивает много разных `:id` подряд, часть — 200 на чужие ресурсы
  (событие `authz.deny`/`authz.allow` с `owner!=requester`).

### V2.2 `[core]` A03 SQL-инъекция
- **Где:** поиск `GET /api/invoices?q=` строит SQL конкатенацией строк.
- **Эксплуатация:** `q=' UNION SELECT ... FROM secret_flags --` → выгрузка скрытой таблицы `secret_flags`.
- **Флаг:** строка в `secret_flags` (таблица недостижима штатным API).
- **Фикс:** параметризованные запросы (`pg` placeholders `$1`), белый список полей сортировки.
- **Логи:** postgres `log_statement=all` показывает инъектированный SQL; всплеск SQL-ошибок; кавычки/`UNION` в `q`.

### V2.3 `[core]` A03 Stored XSS
- **Где:** комментарий/поле профиля рендерится в EJS без экранирования (`<%- %>`).
- **Эксплуатация:** сохранить `<script>` → выполняется у админа при просмотре → кража admin-сессии/флага.
- **Флаг:** в приватной заметке админ-панели, видимой только админу (крадётся через угон сессии).
- **Фикс:** экранирование (`<%= %>`)/санитизация (DOMPurify для разрешённого HTML), CSP.
- **Логи:** в сохранённом контенте теги `<script>`/`onerror=`; исходящие обращения к внешнему коллектору из сессии админа.

### V2.4 `[core]` A08/A04 Mass-Assignment → privilege escalation
- **Где:** `PATCH /api/profile` делает `Object.assign(user, req.body)` — включая `role`.
- **Эксплуатация:** `{"role":"admin"}` в теле → самоповышение до админа → доступ к admin-only флагу.
- **Флаг:** admin-only эндпоинт `/api/admin/flag`.
- **Фикс:** явный allow-list полей (`{displayName, avatarUrl}`); `role` меняется только отдельным admin-путём.
- **Логи:** `PATCH /api/profile` с полем `role`; событие `role.change` вне админского пути.

### V2.5 `[core]` A02 Криптографические сбои (хранение паролей + токен сброса)
- **Где:** пароли в БД как MD5/plaintext; токен сброса пароля = `Date.now()`-производный (предсказуем).
- **Эксплуатация:** дамп таблицы (через V2.2) → мгновенный реверс хешей; либо предсказать reset-токен → захват аккаунта.
- **Флаг:** в аккаунте, который берётся через сброс.
- **Фикс:** `bcrypt`/`argon2` с солью; reset-токен = `crypto.randomBytes(32)` + TTL + одноразовость.
- **Логи:** несколько запросов `/reset` подряд, успешная смена без владения почтой.

### V2.6 `[bonus]` A10 SSRF
- **Где:** «загрузить аватар по URL» — сервер сам делает `fetch(userUrl)` без валидации.
- **Эксплуатация:** `userUrl=http://internal-metadata/flag` (контролируемый internal-сервис-мишень в platform) → чтение флага.
- **Флаг:** отдаётся внутренним `internal-metadata` сервисом, доступным только из pod'а app.
- **Фикс:** allow-list схем/хостов, запрет приватных диапазонов (SSRF-guard), резолв+проверка IP, таймауты.
- **Логи:** egress-обращения app к внутренним адресам; `avatarUrl` с `http://` на приватные IP.

> Рекомендуемый набор на раунд: **V2.1–V2.5** (core) + V2.6 если группа сильная. 5–6 находок за 60–90 мин.

---

## 6. Скоринг (attack/defense)

Подробные правила — в [`docs/scoring.md`](scoring.md). Сводно:

### 6.1 Компоненты
- **flag-planter** (CronJob, каждый *tick* = 60 c): кладёт свежие флаги во все стенды в места из §4–§5.
  Флаг: `TRN{<32 hex>}`, привязан к `(team, service, vuln_id, tick)` в таблице `planted_flags`.
- **scoreboard** (Express+PG): `POST /api/submit {team, flag}`:
  - валидирует по `planted_flags`, дедуп (`UNIQUE(team_submitter, flag)`),
  - начисляет **attack-очки** атакующей команде и (опц.) списывает у пострадавшей,
  - тегирует, какая уязвимость сдана (`vuln_id`) — для аналитики покрытия.
  - Живое web-табло: очки, тайм-лайн сабмитов, разбивка по уязвимостям, статус SLA.
- **checker** (CronJob, каждый tick): для каждого стенда выполняет функциональный сценарий
  (регистрация/логин → штатная транзакция → чтение своего «канареечного» значения). Результат `up/down/mumble`
  → **SLA-очки**. Наказывает защиту за «починил, сломав функционал».

### 6.2 Формула (по умолчанию, настраивается)
```
score(team) = Σ attack_points  +  SLA% * defense_weight
attack_points  = flag_value(vuln_id)  за каждый валидный уникальный флаг соперника
SLA%           = uptime_ticks / total_ticks   (checker == up)
```
- Разные `flag_value` по сложности уязвимости (напр. IDOR=100, SQLi=200, RCE=300).
- Защита выигрывает, закрыв уязвимость (флаги перестают воровать) **и** сохранив `up` у чекера.

### 6.3 Смена ролей
`swap-roles.sh` в конце раунда: (1) фиксит git-diff и логи (`collect-logs.sh`), (2) применяет
NetworkPolicy обратной направленности (бывшая red-команда становится blue и наоборот),
(3) `reset-round.sh` восстанавливает уязвимый baseline на стендах, (4) обнуляет tick-счётчик раунда.

---

## 7. Логирование и форензика

Первоклассная задача: после тренинга должно быть возможно **пошагово разобрать каждую атаку**.
Рецепты запросов — в [`docs/forensics.md`](forensics.md).

### 7.1 Логи приложений (pino, JSON, в stdout)
Единый формат события для обоих приложений:
```json
{
  "ts":"2026-07-21T10:00:00.123Z","level":"info","service":"app2-billing","team":"a",
  "reqId":"<uuid>","event":"authz.deny","route":"GET /api/invoices/:id",
  "userId":42,"srcIp":"10.42.3.7","status":403,"latMs":8,
  "meta":{"resourceOwner":17,"requester":42}
}
```
- Логировать **всегда:** входящий запрос (метод, путь, статус, latency, userId, srcIp, reqId),
  события безопасности: `auth.login.ok/fail`, `auth.token.verified/forged`, `authz.allow/deny`,
  `role.change`, `sql.error`, `ssrf.blocked`, `upload.url.fetch`.
- Не логировать секреты/пароли/полные токены (только `sub`, `iat`, префикс).
- `reqId` прокидывается сквозным middleware для сшивки цепочки атаки.

### 7.2 Аудит в БД
Таблица `security_audit(id, ts, team, actor, event, route, src_ip, detail jsonb)` — дублирует
security-события приложения. Переживает рестарт пода (в отличие от stdout), удобна для SQL-разбора.

### 7.3 Логи PostgreSQL
На стендах включить (в `postgresql.conf`, через ConfigMap):
`log_statement=all`, `log_connections=on`, `log_disconnections=on`, `log_line_prefix='%m [%p] %u@%d %h '`.
Это даёт «сырьё» для разбора SQLi: видно точный инъектированный запрос и время.

### 7.4 Централизация и дашборды
- **Promtail** (DaemonSet) → **Loki** → **Grafana** (всё в ns `platform`).
- Лейблы Loki: `namespace/team`, `service`, `event`. Ретенция ≥ длительности тренинга + запас.
- Готовые дашборды Grafana (провижнить как ConfigMap):
  1. **Attack timeline** — события безопасности по времени, фильтр по команде.
  2. **Auth & Access** — login.fail/ok, authz.deny, forged-токены.
  3. **Injection** — sql.error, подозрительные `q`, statement-логи PG.
  4. **SLA / Health** — статус чекера, 5xx, рестарты подов.
  5. **Flag submissions** — сабмиты из scoreboard, привязка к уязвимости.
- `collect-logs.sh` в конце раунда выгружает Loki-срез + дампы `security_audit` + git-diff патчей в
  `artifacts/round-<n>-<team>.tar.gz` для оффлайн-разбора.

---

## 8. Деплой и инфраструктура (k3s, одна VM)

### 8.1 Кластер
- **k3s**, запускать с `--disable traefik` (встроенный Traefik отключаем) и ставить **ingress-nginx**
  (`ingressClassName: nginx`) — единый ingress-контроллер для всех стендов и платформы. Одна VM
  (реком. 8 vCPU / 16 GB / 60 GB SSD для 2 команд + платформа + логи).
- **StorageClass:** local-path (встроен в k3s) для PVC per-team `workspace` и postgres.
- **Pod Security Admission:** на стендовых namespace — `restricted` для эталона; на уязвимых — по факту
  часть нарушений (V1.8) заведомо будет; используем `baseline`/audit-режим, чтобы уязвимость была видимой,
  а не заблокированной админ-контроллером. Namespace `platform` — `restricted`.

### 8.2 Манифесты (kustomize)
- `deploy/k8s/base` — namespaces, PSA-лейблы, общие ресурсы.
- `deploy/k8s/team-template` — параметризованный шаблон стенда: `Deployment(app)` + `StatefulSet(postgres)`
  + `Deployment(code-server)` + `Service` + `PVC(workspace)` + `NetworkPolicy` + `ConfigMap/Secret`.
- `deploy/k8s/overlays/team-a|team-b` — конкретика (имена, порты ingress, какой app развёрнут).
- `deploy/k8s/platform` — scoreboard/checker/planter + Loki/Promtail/Grafana + internal-metadata (мишень SSRF).

### 8.3 Self-healing и сброс
- Каждый под app: `livenessProbe` (`/healthz`), `readinessProbe` (`/readyz`), `resources.limits`.
- `reset-round.sh --team <t> --app <a>`: восстановить `workspace` PVC из baseline (init-контейнер копирует
  чистый уязвимый снапшот), пересоздать под, прогнать миграции+сид, дёрнуть planter — стенд как новый.
- `bootstrap-cluster.sh`: idempotent — создаёт namespace'ы, ставит платформу и логирование, провижнит Grafana.

### 8.4 RBAC команд
- У каждой команды — kubeconfig с ролью, ограниченной **своим** namespace (edit ConfigMap/Secret/Deployment,
  exec в под, apply). Нет доступа в чужой namespace и в `platform`.
- code-server запускается под этим же ограниченным ServiceAccount — терминал команды не может трогать чужое.

### 8.5 Локальная разработка
- `deploy/docker/compose.dev.yml` поднимает app+postgres (+scoreboard/checker опц.) без k8s — для
  разработки приложений и **проверки эталонных эксплойтов** (`tools/attacker-scripts`).

---

## 9. Безопасность самого полигона

- Только изолированная сеть/лаборатория; ingress не выставлять в интернет.
- Секреты платформы (не «учебные») — в k8s `Secret`, не в git. Учебные слабые секреты (V1.1) — намеренно в
  `vulnerable/.env`, помечены комментарием `# INTENTIONALLY WEAK — training only`.
- Атакующей команде сетевой доступ только к HTTP-порту стенда соперника (NetworkPolicy), не к БД/IDE/платформе.
- Egress стендов запрещён наружу (кроме контролируемой SSRF-мишени внутри кластера) — чтобы полигон нельзя
  было использовать как плацдарм.
- `internal-metadata` (мишень SSRF) отдаёт только учебный флаг, без реальных облачных метаданных.

---

## 10. Технологические решения (зафиксировать в реализации)

| Область | Выбор | Причина |
|---------|-------|---------|
| Язык backend | TypeScript + Express | Явные типы, знакомо, легко читать junior-командам |
| Рендер | EJS (SSR) | XSS-сценарий (V2.3) нагляден; минимум фронтового билда |
| БД-драйвер | `pg` (node-postgres) | Явные параметризованные запросы vs конкатенация (V2.2) |
| Логи | `pino` | Быстрый JSON-логгер, дружит с Loki |
| Хеш паролей (эталон) | `bcrypt` (или `argon2`) | Для контраста с MD5/plaintext в vulnerable |
| Миграции/сид | `node-pg-migrate` или SQL-файлы + сид-скрипт | Детерминированный сброс раунда |
| IDE команд | `code-server` | Правка в браузере, единый доступ, RBAC на namespace |
| Оркестрация | k3s + kustomize | Легковесно на одной VM, per-namespace overlays |
| Ingress | **ingress-nginx** (`--disable traefik`) | Единый контроллер; знакомые annotation'ы, гибкие rewrite/rate-limit |
| Логи-стек | Loki + Promtail + Grafana | Легковесная централизация + готовые дашборды |

---

## 11. Критерии готовности (Definition of Done)

- [ ] Оба приложения запускаются локально (`compose.dev.yml`) и в k3s.
- [ ] app1: `vulnerable/` и `reference/` используют идентичный `src/`; отличия только в конфиге (проверяется diff'ом).
- [ ] app2: `reference/` закрывает все заявленные уязвимости; `vulnerable/` — воспроизводимо уязвим.
- [ ] Для каждой уязвимости есть рабочий PoC в `tools/attacker-scripts` и запись в `SOLUTION.md`
      (эксплуатация + фикс + пример + след в логах).
- [ ] flag-planter раскладывает флаги; scoreboard принимает и начисляет; checker меряет SLA — end-to-end.
- [ ] Логи всех подов собираются в Loki; 5 дашбордов Grafana провижнятся автоматически.
- [ ] `reset-round.sh` полностью восстанавливает уязвимый baseline < 60 c.
- [ ] NetworkPolicy подтверждённо блокирует доступ атакующих к postgres/code-server/платформе.
- [ ] `docs/instructor-guide.md` описывает роли, тайминг, подсказки и чек-лист судьи.
