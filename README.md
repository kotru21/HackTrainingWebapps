# HackTrainingWebapps

Тренировочный полигон attack/defense для обучения ИБ-специалистов. Две команды по очереди
атакуют и защищают одни и те же приложения; платформа автоматически считает очки (флаги + SLA)
и пишет подробные логи для разбора атак.

## Что внутри

Два веб-приложения, каждое в двух вариантах:

| Приложение | Уровень | Как чинится | Классы уязвимостей |
|------------|---------|-------------|--------------------|
| **app1 «Helpdesk»** | Лёгкий | Только конфиг/зависимости/инфра — **без правки исходников** | Слабые секреты, уязвимые зависимости, debug-режим, CORS, заголовки, дефолтные креды, привилегии в БД/контейнере |
| **app2 «Billing»** | Средний | Правка исходного кода | OWASP Top 10: IDOR, SQLi, Stored XSS, Mass-Assignment privesc, слабая криптография, SSRF |

Для каждого приложения:
- `vulnerable/` — стенд, который защищают/атакуют. Прикладной код в app1 идентичен эталону; отличие только в конфиге.
- `reference/` — эталон + `SOLUTION.md`: как эксплуатируется и как закрывается **каждая** уязвимость, с командами и примерами.

## Стек

- **Backend:** Node.js (TypeScript, Express), **DB:** PostgreSQL, **Frontend:** SSR (EJS) + минимальный JS.
- **Оркестрация:** k3s (одна VM), namespace на команду, NetworkPolicy для изоляции.
- **Логи:** pino (JSON) + PostgreSQL statement logging → Promtail → Loki → Grafana.
- **Скоринг:** свой сервис (Express + PostgreSQL) — приём флагов, SLA-чекер, флаг-плантер, live-scoreboard.

## Быстрый старт

```bash
# Локально (без k8s) — для разработки и проверки эксплойтов
docker compose -f deploy/docker/compose.dev.yml up --build

# На полигоне (k3s) — раунд 1 на app1 «Helpdesk»
./scripts/bootstrap-cluster.sh --app app1      # namespaces, платформа, логи, стенды app1
./scripts/deploy-team.sh a app1                # (пере)развернуть стенд app1 команде A
./scripts/reset-round.sh --team a --app app1   # сброс к уязвимому baseline + свежие флаги

# Раунд 2 на app2 «Billing» (app2 — значение по умолчанию)
./scripts/bootstrap-cluster.sh --app app2
./scripts/deploy-team.sh a app2
```

## Документация

- [`docs/SPEC.md`](docs/SPEC.md) — полная техническая спецификация (архитектура, уязвимости, скоринг, логи, деплой).
- [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md) — пофазный план реализации с критериями приёмки (для кодинг-агента).
- [`docs/scoring.md`](docs/scoring.md) — модель очков, контракт API scoreboard, `config.yaml`.
- [`docs/instructor-guide.md`](docs/instructor-guide.md) — сценарий проведения, роли, тайминг, подсказки, чек-лист судьи.
- [`docs/forensics.md`](docs/forensics.md) — готовые LogQL/SQL-запросы для разбора атак.
- [`docs/cursor-setup.md`](docs/cursor-setup.md) — настройка Cursor, project rules, референс-репозитории.
- [`docs/GROK-PROMPT.md`](docs/GROK-PROMPT.md) — готовый промпт для запуска реализации в Cursor/Grok 4.5.
- `.cursor/rules/*.mdc` — инварианты проекта, которые агент соблюдает автоматически.
- `apps/*/reference/SOLUTION.md` — разбор эксплуатации и защиты по каждой уязвимости (создаётся вместе с кодом).

> ⚠️ Все уязвимости внесены намеренно и только для обучения в изолированной сети. Не разворачивать в интернете.
