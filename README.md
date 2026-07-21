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

## Быстрый старт (локально, без k8s)

Для разработки и проверки эксплойтов поднимается весь полигон в Docker Compose:

```bash
docker compose -f deploy/docker/compose.dev.yml up --build -d
docker compose -f deploy/docker/compose.dev.yml ps
# Табло: http://127.0.0.1:3020/   ·   стенды: app1 3001/3002, app2 3011/3012
node tools/attacker-scripts/phase8-smoke.mjs   # прогнать всю матрицу PoC (vuln PASS / ref FAIL)
docker compose -f deploy/docker/compose.dev.yml down -v
```

---

## Деплой в продакшн (k3s)

> ⚠️ Полигон содержит намеренно уязвимые приложения. Разворачивать **только в изолированной
> лабораторной сети без выхода в интернет**. Никогда не публиковать в открытый доступ.

### 1. Требования

- **VM:** Linux (Ubuntu 22.04+ / Debian 12), 8 vCPU / 16 GB RAM / 60 GB SSD (на платформу + 2 команды + логи).
- **ПО:** `k3s`, `kubectl`, `docker` (для сборки образов), `git`.
- **Сеть:** изолированный сегмент. Наружу трафик стендов запрещён (обеспечивается NetworkPolicy + сетью лаборатории).
- **CNI с поддержкой NetworkPolicy** — в k3s это встроенный Flannel+kube-router (по умолчанию политики применяются). Проверить, что политики реально режут трафик (шаг 7).

### 2. Установка k3s (с ingress-nginx вместо Traefik)

```bash
# k3s без встроенного Traefik (мы ставим ingress-nginx)
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml   # или ~/.kube/config
kubectl get nodes                              # Ready?
```

`bootstrap-cluster.sh` сам поставит **ingress-nginx** и применит все манифесты. StorageClass
`local-path` встроен в k3s (используется для PVC команд и Postgres).

### 3. Сборка образов и импорт в k3s

Отдельного build-скрипта нет — образы собираются с явными тегами `hacktraining/*:local`
(из корня репозитория):

```bash
docker build -t hacktraining/app1-helpdesk-vulnerable:local -f apps/app1-helpdesk/vulnerable/Dockerfile .
docker build -t hacktraining/app2-billing-vulnerable:local  -f apps/app2-billing/vulnerable/Dockerfile .
docker build -t hacktraining/scoreboard:local               -f platform/scoreboard/Dockerfile .
docker build -t hacktraining/flag-planter:local             -f platform/flag-planter/Dockerfile .
docker build -t hacktraining/checker:local                  -f platform/checker/Dockerfile .
docker build -t hacktraining/internal-metadata:local        -f platform/internal-metadata/Dockerfile .
```

k3s использует свой containerd (не docker), поэтому образы нужно **импортировать**:

```bash
for img in app1-helpdesk-vulnerable app2-billing-vulnerable scoreboard \
           flag-planter checker internal-metadata; do
  docker save hacktraining/$img:local | sudo k3s ctr images import -
done
```

**Внешние образы** (в изолированной сети их тоже надо импортировать заранее, пока есть интернет —
на машине с доступом `docker pull`, затем `docker save | k3s ctr images import`):
`codercom/code-server:4.96.4`, `postgres:16-alpine`, `busybox:1.36`,
`grafana/grafana`, `grafana/loki`, `grafana/promtail`, а также образ контроллера
ingress-nginx (`registry.k8s.io/ingress-nginx/controller` + `.../kube-webhook-certgen`).

### 4. Реальные секреты (заменить учебные)

Слабые значения в манифестах помечены `# INTENTIONALLY WEAK — training only`. Для **стендов**
они намеренно слабые (это уязвимая мишень) — не трогать. А для **платформы** перед проведением
замените на реальные:

- `deploy/k8s/platform/scoreboard-config.yaml` (и `-app1.yaml`) — `team_tokens.*`, `judge_token`,
  `metadata_plant_token`: сгенерировать случайные (`openssl rand -hex 24`).
- `deploy/k8s/platform/scoreboard-config.yaml` → Secret `scoreboard-db` — пароль БД скоринга.
- Grafana admin-пароль (`deploy/k8s/platform/grafana.yaml`).

Токены команд раздаются капитанам (для сабмита флагов), `judge_token` — только у судьи.

### 5. Bootstrap полигона

```bash
# Раунд 1 — app1 «Helpdesk» (образы app1 + платформа + логи + стенд-конфиг app1)
./scripts/bootstrap-cluster.sh --app app1
```

Скрипт идемпотентен: ставит ingress-nginx, применяет `base` (namespaces + PSA), `platform`
(scoreboard, checker, planter, Loki, Grafana, internal-metadata), стенды `team-a`/`team-b` и
выпускает **kubeconfig для каждой команды** в `artifacts/kubeconfigs/team-{a,b}.kubeconfig`
(ограничены своим namespace). Раздать командам вместе с доступом к их code-server.

### 6. DNS / hosts

Ingress-хосты нужно сопоставить с IP ingress-nginx (или nodeIP). На машинах участников/судьи
добавить в `/etc/hosts` (или во внутренний DNS лаборатории):

```
<INGRESS_IP>  scoreboard.hack.local grafana.hack.local
<INGRESS_IP>  team-a.app.hack.local team-a.ide.hack.local
<INGRESS_IP>  team-b.app.hack.local team-b.ide.hack.local
```

IP ingress: `kubectl -n ingress-nginx get svc ingress-nginx-controller`.

### 7. Проверка перед стартом (чек-лист судьи)

```bash
kubectl get pods -A                              # все Running/Ready
kubectl -n platform rollout status deploy/scoreboard
bash scripts/verify-networkpolicy.sh             # Red НЕ достаёт postgres/code-server/платформу
```

- Табло `http://scoreboard.hack.local` показывает раунд 1, тик идёт.
- Grafana `http://grafana.hack.local` — дашборды провижнены, логи текут.
- `checker` показывает оба стенда `up`, `planter` кладёт флаги (`planted_flags` растёт).
- Полный чек-лист — в [`docs/instructor-guide.md`](docs/instructor-guide.md) §3.

### 8. Операции во время тренинга

```bash
./scripts/deploy-team.sh a app1                        # (пере)развернуть стенд команде
./scripts/reset-round.sh --team a --app app1           # сброс к уязвимому baseline + свежие флаги (<60с)
./scripts/collect-logs.sh --round 1                    # архив логов+аудита+git-diff в artifacts/
./scripts/swap-roles.sh --scoreboard-url http://scoreboard.hack.local   # смена ролей между раундами
# Раунд 2 на app2:
./scripts/bootstrap-cluster.sh --app app2 && ./scripts/deploy-team.sh a app2 && ./scripts/deploy-team.sh b app2
```

(Для Windows-хоста доступны `.ps1`-аналоги; полный сценарий — [`docs/instructor-guide.md`](docs/instructor-guide.md).)

### 9. Обновление и откат

- Пересобрать изменённый образ → импортировать в k3s (шаг 3) → `kubectl -n <ns> rollout restart deploy/<name>`.
- Полный сброс стенда команды: `reset-round.sh` (восстанавливает уязвимый baseline, стирает патчи Blue).
- Снести всё: `k3s-uninstall.sh` (полностью удаляет k3s и данные).

---

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
