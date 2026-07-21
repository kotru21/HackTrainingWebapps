# Настройка Cursor и полезные референсы

Как настроить Cursor/Grok под этот проект и на какие открытые репозитории опираться при реализации.
Промпт для запуска — в [`GROK-PROMPT.md`](GROK-PROMPT.md).

---

## 1. Project Rules (уже в репозитории)

В `.cursor/rules/` лежат правила проекта в формате `.mdc` (frontmatter + markdown). Cursor подхватывает их
автоматически:

| Файл | Тип | Когда применяется |
|------|-----|-------------------|
| `00-project.mdc` | `alwaysApply: true` | Всегда — базовые инварианты (стек, флаги, порядок работы) |
| `10-app1-config-only.mdc` | `globs: apps/app1-helpdesk/**` | При работе с app1 — инвариант «идентичный src» |
| `20-app2-owasp.mdc` | `globs: apps/app2-billing/**` | При работе с app2 — паттерны OWASP-фиксов |
| `30-logging-and-platform.mdc` | `globs: apps/**, platform/**, packages/shared/**` | Формат логов и контракты скоринга |
| `40-deploy-k8s.mdc` | `globs: deploy/**, scripts/**` | k3s/nginx/NetworkPolicy/self-healing |

> Формат: `.cursor/rules/*.mdc` с YAML-frontmatter `description` / `globs` / `alwaysApply`. Обычные `.md`
> в этой папке правилами Cursor **не** считаются. При `alwaysApply: true` поля `globs`/`description` игнорируются.

Правила — «страховка» инвариантов: даже если контекст переполнится, Grok не начнёт менять стек, плодить
развилки `if vulnerable` в app1 или логировать флаги в открытую.

---

## 2. Рекомендованный режим работы Grok

- **Agent mode**, модель Grok 4.5 (или сопоставимая по контексту). Дать доступ к терминалу для
  `npm`, `docker`, `kubectl`, `git`.
- Работать **по фазам** `docs/BUILD-PLAN.md`; после каждой фазы — прогон её критериев приёмки, затем коммит.
- Держать `docs/` открытыми/приложенными как контекст (или `@docs` в запросах). `docs` — источник истины.
- Проверять эксплойты локально через `deploy/docker/compose.dev.yml` до переноса в k3s.

### Опционально: под-агенты / разделение ролей
Если используется multi-agent/оркестрация в Cursor, разумное разделение:
- **builder** — пишет приложения и платформу по BUILD-PLAN.
- **attacker/QA** — пишет и гоняет PoC из `tools/attacker-scripts`, подтверждает, что уязвимость есть в
  `vulnerable/` и закрыта в `reference/` (критерий приёмки Фазы 2).
- **devops** — Docker/k3s/kustomize/NetworkPolicy (Фазы 5–6).
Простой вариант без оркестрации — один агент последовательно по фазам; QA-проверка = отдельный проход
«прогони все PoC против обоих вариантов и покажи результат».

---

## 3. Референс-репозитории (для вдохновения и сверки)

> Учебные материалы. Проверить актуальность ссылок; лицензии — перед копированием кода. Ничего не тянуть в
> прод-путь без ревью.

### Cursor rules / агенты
- **PatrickJS/awesome-cursorrules** — большая коллекция примеров правил Cursor под разные стеки; шаблоны для
  `.cursor/rules`.
- **Cursor Docs → Rules** (cursor.com/docs/rules) — официальная спецификация формата `.mdc`.
- **cursor/cookbook** — примеры кастомных проверок, agent-событий, self-hosted cloud-агентов.

### Намеренно уязвимые приложения (образцы уязвимостей и их фиксов — особенно для app2)
- **OWASP/NodeGoat** — эталон уязвимого Node.js/Express-приложения по OWASP Top 10; ближе всего к нашему стеку,
  смотреть подачу уязвимостей и «tutorial»-фиксы.
- **juice-shop/juice-shop** (OWASP Juice Shop) — самый известный современный уязвимый веб-апп (Node/TS);
  богатый набор challenge'ей, scoreboard, идеи по подаче и подсказкам.
- **digininja/DVWA**, **OWASP/WebGoat** — классика (PHP/Java); брать идеи уровней сложности и подсказок, не код.
- **OWASP Cheat Sheet Series** (cheatsheetseries.owasp.org) — канон правильных фиксов: SQLi, XSS, Access Control,
  Password Storage, SSRF, Secure Headers. Использовать как источник паттернов для `reference/` и `SOLUTION.md`.

### Attack/Defense CTF инфраструктура (образцы checker/gameserver/scoreboard)
- **pomo-mondreganto/ForcAD** — легковесная A/D CTF-платформа (checker'ы, флаги, табло); хороший ориентир по
  архитектуре нашей `platform/`.
- **enowars/EnoEngine** + **enowars/enochecker** — движок A/D и библиотека чекеров; смотреть модель put/get флага
  и статусы up/mumble/down (мы используем ту же семантику в `checker`).
- **HackTheArch / Mellivora / CTFd** — scoreboard-движки (в основном jeopardy); брать идеи UI табло, не архитектуру A/D.

### Kubernetes / изоляция / логи
- **ahmetb/kubernetes-network-policy-recipes** — готовые рецепты NetworkPolicy (default-deny, allow-from-namespace);
  прямо ложится на нашу изоляцию команд.
- **grafana/loki**, **grafana/grafana** docs — Promtail-конфиги, LogQL, provisioning дашбордов (см. `docs/forensics.md`).
- **coder/code-server** — деплой web-IDE в k8s под ограниченным ServiceAccount (рабочее место защиты).

---

## 4. Чего НЕ делать (частые ошибки при генерации)

- Не копировать уязвимости из Juice Shop «как есть» — у нас фиксированный список (SPEC §4–§5) и требование
  находимости за 60–90 мин с подсказками.
- Не тянуть тяжёлый A/D-движок целиком — наш `platform/` намеренно минимален (Express+PG), см. `docs/scoring.md`.
- Не логировать флаги/секреты ради «удобства отладки» — нарушает модель скоринга.
- Не заменять стек «на более модный» — TS+Express+pg+EJS+pino выбраны осознанно ради наглядности уязвимостей.
