# План реализации — HackTrainingWebapps

Пофазный план для кодинг-агента (Cursor / Grok 4.5). Каждая фаза самодостаточна, имеет **артефакты**
и **критерии приёмки**. Идти строго по порядку — поздние фазы зависят от ранних. Полное ТЗ — в
`[SPEC.md](SPEC.md)`.

**Общие правила для агента:**

- Стек фиксирован: TypeScript + Express + PostgreSQL (`pg`) + EJS + pino. Не заменять без запроса.
- Каждую уязвимость сопровождать: (а) кодом в `vulnerable/`, (б) фиксом в `reference/`, (в) PoC-скриптом
в `tools/attacker-scripts/`, (г) разделом в `reference/SOLUTION.md` по шаблону из §5 SPEC.
- Секреты платформы — не коммитить. Учебные слабые секреты — коммитить с пометкой `# INTENTIONALLY WEAK`.
- Всё, что запускается, должно иметь `/healthz` и `/readyz`.
- Идентификатор флага-регэкспа: `TRN\{[0-9a-f]{32}\}` — вынести в общий пакет-константу.

---



## Фаза 0 — Каркас репозитория

**Артефакты:** структура каталогов из §2 SPEC; корневой `package.json` (workspaces/pnpm) или отдельные
пакеты на приложение; `tsconfig` базовый; `.editorconfig`, `.gitignore`, `.dockerignore`; общий пакет
`packages/shared` (типы событий логов, константа флаг-регэкспа, JSON-логгер-обёртка pino).
**Приёмка:** `npm run build` проходит по всем воркспейсам; общий логгер импортируется из обоих приложений.

---



## Фаза 1 — app1 «Helpdesk» (общий src + два конфига)

**Артефакты:**

- `apps/app1-helpdesk/src/` — рабочее приложение: пользователи, JWT-логин, тикеты (CRUD), вложения,
`/admin` (список тикетов + `admin_secrets`), `/internal/debug` (ветвление по env), статик-middleware
(корень из env), helmet за флагом, CORS из env, healthz/readyz. Код **не содержит развилок «vuln/ref»** —
различие достигается только значениями конфига.
- `apps/app1-helpdesk/vulnerable/` — `.env` (слабые значения V1.1–V1.9), `Dockerfile` (root, `:latest`),
`db/pg_hba`, k8s-фрагменты (NodePort, без securityContext), `package.json` с уязвимой зависимостью (V1.2).
- `apps/app1-helpdesk/reference/` — те же артефакты с исправленными значениями + `SOLUTION.md`.
**Приёмка:**
- `diff -r vulnerable/../src reference/../src` пуст (исходники идентичны).
- Уязвимый стенд воспроизводит V1.1–V1.6 (core); эталон — закрывает их только конфигом.
- PoC в `tools/attacker-scripts/app1/` достаёт флаг через forged-JWT, через debug-эндпоинт и через уязвимую зависимость.

---



## Фаза 2 — app2 «Billing» (разный код в двух вариантах)

**Артефакты:**

- `apps/app2-billing/shared/` — SQL-схема (users, invoices, comments, secret_flags, security_audit),
сид, EJS-лейауты, статик.
- `apps/app2-billing/vulnerable/src/` — реализует V2.1–V2.6 (см. §5 SPEC): IDOR, SQLi-конкатенация,
небезопасный EJS-рендер, mass-assignment, MD5-пароли + предсказуемый reset-токен, SSRF-загрузка аватара.
- `apps/app2-billing/reference/src/` — исправленные паттерны (ownership-check, параметризация, экранирование,
allow-list полей, bcrypt+`randomBytes`, SSRF-guard) + `SOLUTION.md` (эксплуатация/фикс/пример/логи по каждой).
**Приёмка:**
- Для каждой V2.x — PoC в `tools/attacker-scripts/app2/` работает на `vulnerable/` и **не** работает на `reference/`.
- Флаги извлекаемы только через уязвимость (штатное API их не отдаёт).
- Оба варианта проходят SLA-сценарий чекера (функционал не сломан фиксом).

---



## Фаза 3 — Логирование и аудит

**Артефакты:**

- Сквозной middleware `reqId` + логирование запросов и security-событий (формат из §7.1 SPEC) в обоих app.
- Таблица и запись `security_audit` (§7.2).
- ConfigMap `postgresql.conf` со `log_statement=all` и пр. (§7.3) — для стендовых postgres.
**Приёмка:** атака PoC-скриптом порождает ожидаемые события (`authz.deny`, `sql.error`, `role.change`,
`ssrf.blocked`) в stdout и в `security_audit`; в логах PG виден инъектированный запрос.

---



## Фаза 4 — Платформа скоринга

**Артефакты:**

- `platform/flag-planter/` — раскладка `TRN{...}` во все стенды каждый tick; таблица `planted_flags`.
- `platform/scoreboard/` — `POST /api/submit`, валидация+дедуп, начисление attack/SLA, web-табло,
привязка сабмита к `vuln_id`.
- `platform/checker/` — функциональный SLA-сценарий на каждый стенд; статусы up/down/mumble.
- `platform/internal-metadata/` — учебная мишень SSRF (отдаёт флаг только из pod'а app).
- `docs/scoring.md` — правила и формула (§6 SPEC).
**Приёмка:** end-to-end локально (scoreboard Postgres + platform-сервисы; полный `compose.dev.yml` —
в Фазе 5): planter кладёт флаг → PoC крадёт → submit начисляет очки → табло обновляется;
остановка app роняет SLA в чекере. Скрипт: `tools/attacker-scripts/phase4-e2e.mjs`.

---



## Фаза 5 — Docker и локальный запуск

**Артефакты:** `Dockerfile` для app1/app2 (vuln и ref), scoreboard/checker/planter/internal-metadata;
`deploy/docker/compose.dev.yml` (app + postgres + платформа). Non-root/пиннинг — в reference-образах
и platform-сервисах; vulnerable app1 — soft image (`node:latest`, root) под V1.8.
**Приёмка:** `docker compose -f deploy/docker/compose.dev.yml up --build -d` поднимает полный локальный
полигон; проходят PoC (`tools/attacker-scripts`) и SLA-сценарии (`sla-smoke` / checker).
См. `deploy/docker/README.md` (PowerShell-совместимо).

---



## Фаза 6 — k3s / kustomize

**Артефакты:**

- `deploy/k8s/base` (namespaces, PSA-лейблы, StorageClass), `team-template` (app+postgres+code-server+
PVC workspace+Service+NetworkPolicy+ConfigMap/Secret), `overlays/team-a|team-b`, `platform` (скоринг+логи+Grafana).
- NetworkPolicy: default-deny + разрешения из §3 SPEC; RBAC-роль команды на свой namespace; kubeconfig'и команд.
- Probes, `resources.limits`, `securityContext` (в reference-оверлеях).
- Grafana-дашборды (5 шт., §7.4) как provisioning ConfigMap; Loki+Promtail.
**Приёмка:** `bootstrap-cluster.sh` на чистом k3s поднимает платформу и обе команды; атакующая команда
по сети видит только HTTP-порт соперника (проверить, что postgres/code-server/платформа недоступны).

---



## Фаза 7 — Оркестрация раундов и форензика

**Артефакты:**

- `scripts/bootstrap-cluster.sh`, `deploy-team.sh`, `reset-round.sh`, `swap-roles.sh`, `collect-logs.sh`.
- `docs/instructor-guide.md` (роли, тайминг 60–90 мин, подсказки к каждой уязвимости, чек-лист судьи).
- `docs/forensics.md` (готовые LogQL/SQL-запросы для разбора каждой атаки).
**Приёмка:**
- `reset-round.sh` восстанавливает уязвимый baseline < 60 c (проверить: закрытая уязвимость снова открыта).
- `swap-roles.sh` меняет направление NetworkPolicy и роли; scoreboard стартует новый раунд.
- `collect-logs.sh` формирует `artifacts/round-<n>-<team>.tar.gz` с логами Loki + `security_audit` + git-diff патчей.

---



## Фаза 8 — Приёмочное тестирование и полировка

**Артефакты:** сквозной прогон полного раунда на k3s двумя «командами»; smoke-скрипт, гоняющий все PoC
против обоих вариантов; финальная вычитка `SOLUTION.md` и `instructor-guide.md`.
**Приёмка:** выполнены все пункты Definition of Done из §11 SPEC.

---



## Приоритеты, если время ограничено

1. Фазы 0–2 (приложения) + Фаза 3 (логи) — минимально играбельный полигон вручную.
2. Фаза 4 (скоринг) — превращает в измеримый attack/defense.
3. Фаза 5 (Docker) — воспроизводимость.
4. Фазы 6–7 (k3s + оркестрация) — целевой формат с self-healing и изоляцией.
5. Фаза 8 — качество.

Bonus-уязвимости (V1.7–V1.9, V2.6) реализовывать в последнюю очередь.