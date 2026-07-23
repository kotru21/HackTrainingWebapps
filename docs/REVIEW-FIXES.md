# Чеклист исправлений после код-ревью (для Cursor)

Контекст: attack/defense полигон. Ревью выявило 8 находок. **#1, #6, #7 уже исправлены**
(в этом же PR/ветке) — их трогать не нужно, они здесь только для сверки. Остальные —
задачи для Cursor. После применения вернуть на валидацию.

Инварианты, которые НЕЛЬЗЯ нарушать:
- Значения флагов никогда не логируются (`.cursor/rules/00-project.mdc`).
- app1 «Helpdesk» чинится только конфигом/инфрой — прикладной код `apps/app1-helpdesk/src`
  идентичен эталону; правки бизнес-логики app1 запрещены (кроме платформенных сервисов).
- Намеренные уязвимости (`V2.x`, `CFG-*`) не «чинить» — это мишени.
- Формат флага — только через `@hacktraining/shared` (`isValidFlag`/`generateFlag`).

Проверка после КАЖДОГО пункта:
```bash
npm run build          # tsc по всем воркспейсам должен пройти
```

---

## ✅ #1 (сделано) — rce_flag больше не утекает через admin-секреты
Файл: `apps/app1-helpdesk/src/services/tickets.ts` → `listAdminSecrets()`
Изменено `WHERE name <> 'leak_flag'` → `WHERE name NOT IN ('leak_flag', 'rce_flag')`.
Проверка: логин `admin/admin123` → `GET /api/admin/secrets` не содержит `rce_flag`;
CFG-RCE берётся только через EJS-RCE (чтение `FLAG_FILE_PATH`).

## ✅ #6/#7 (сделано) — транзакция + advisory-lock в submitFlag
Файл: `platform/scoreboard/src/submit.ts`. Accept-путь в одной транзакции, `pg_advisory_xact_lock`
по vuln, upsert `ON CONFLICT (submitter_team, flag) DO UPDATE ... WHERE status <> 'accepted'`.

---

## ✅ #2 (ожидает валидации) — Ясность табло (per-round by design)
Шапка: `N · счёт раунда · тик …`; колонки «Атака/Защита/Итог (раунд)»; `match_total` + колонка «Матч».

---

## ✅ #3 (ожидает валидации) — Единый SoT ролей
PVC у `scoreboard-pg` уже был (`volumeClaimTemplates`). `swap-roles.sh`/`.ps1` читают
`GET /api/round` → `POST /api/round/next` → синхронизируют k8s. `ensureRound` идемпотентен (#4).

---

## ✅ #4 (ожидает валидации) — ensureRound + GET read-only
`COALESCE(MAX(n),0)+1`; хардкод ролей только на пустой таблице; `GET /api/round` без INSERT.

---

## ✅ #5 (ожидает валидации) — Часы тика в scoreboard
Таймер в `index.ts` → `bumpTick`; planter читает `GET /api/round`; `POST /api/internal/tick` — ручной хук.

---

## ✅ #8 (ожидает валидации) — Stable SLA canary + prune
`sla_canary` + 409=ok; prune `SLA invoice` старше 10 мин в `plantBillingStand`.

---

## (архив задания) #2 — Ясность табло (решение принято: per-round by design)
**Цель:** убрать двусмысленность «почему счёт обнулился после swap». Логику скоринга НЕ менять.

**Файл:** `platform/scoreboard/src/app.ts` (константа `BOARD_HTML`, фронтенд-скрипт).

**Сделать:**
1. В шапке рядом с номером раунда подписать, что показывается счёт ТЕКУЩЕГО раунда.
   В блоке `#roundInfo` (строка ~375) добавить текст вида `раунд N · счёт раунда`.
2. Заголовки колонок «Атака»/«Защита»/«Итог» дополнить подписью `(раунд)` — в `.row.head`
   (строки ~339–343).
3. (Опционально, если захотите кумулятив рядом) добавить в `/api/scoreboard` (app.ts ~79)
   второй расчёт БЕЗ фильтра по `started_at` — назвать `match_total`, отдать в `teams[]`,
   и вывести отдельной приглушённой колонкой. Для этого в `scoring.ts` сделать параметр
   `computeScores(pool, cfg, { sinceRoundStart: boolean })` и вызвать дважды. НЕ трогать
   defended/first-blood (они корректно per-round).

**Критерий приёмки:** на табло явно видно, что итог — за текущий раунд; после `/api/round/next`
пользователь понимает, почему цифры начинаются заново. Если добавлен `match_total` — он растёт
через раунды и не обнуляется на swap.

---

## (архив) #3 — Единый источник правды для ролей раунда (архитектура)
**Проблема:** роли атакующий/защитник задаются в ДВУХ местах без сверки:
`scoring.ts::nextRound()` (БД scoreboard) и `scripts/swap-roles.sh` (по label'ам namespace +
переписывание NetworkPolicy). При рестарте pod/БД scoreboard `ensureRound` пересоздаёт раунд 1
с ролями `attacker=b, defender=a`, а кластер уже на раунде N → скоринг доверяет неверной команде.

**Цель:** сделать scoreboard авторитетом ролей; k8s следует за ним; состояние переживает рестарт.

**Сделать:**
1. **Персистентность.** Проверить `deploy/k8s/platform/scoreboard-pg.yaml`: Postgres scoreboard
   должен монтировать PVC (не emptyDir), иначе `rounds` теряются при рестарте. Если emptyDir —
   заменить на PVC (по образцу `deploy/k8s/team-template/pvc.yaml` + `postgres.yaml`).
2. **swap-roles.sh читает роли из scoreboard, а не из label'ов.** В `scripts/swap-roles.sh`
   (и `.ps1`-аналоге) заменить вывод текущих ролей из `kubectl get ns ... role` на
   `GET ${SCOREBOARD_URL}/api/round` → взять `attacker_team`/`defender_team`, вычислить новые
   (flip), затем: (a) `POST /api/round/next`, (b) применить label'ы и патчи NetworkPolicy из
   НОВЫХ ролей, полученных из ответа `/api/round/next` (там уже есть `attacker_team`/`defender_team`).
   Порядок: сначала спросить/крутануть scoreboard, потом привести k8s в соответствие.
3. **Идемпотентный старт.** В `platform/scoreboard/src/index.ts` при старте не полагаться на
   хардкод раунда 1 (см. #4).

**Критерий приёмки:** после `kubectl -n platform delete pod -l app=scoreboard` (или рестарта БД,
если PVC уже есть) роли и номер раунда сохраняются и совпадают с NetworkPolicy; `swap-roles.sh`
корректно продолжает нумерацию, даже если k8s-label'ы кто-то поменял руками.

---

## #4 — ensureRound не должен падать на UNIQUE(n) и писать в GET
**Проблема:** `scoring.ts::ensureRound()` всегда `INSERT ... VALUES (1, ...)`. `rounds.n` UNIQUE —
если раунд 1 когда-либо был завершён (`ended_at`) без преемника, INSERT кинет `23505`. Плюс это
достижимо из публичного `GET /api/round` (app.ts ~113), т.е. GET делает запись.

**Сделать:**
1. `platform/scoreboard/src/scoring.ts::ensureRound()` — вычислять номер как
   `COALESCE(MAX(n),0)+1` вместо литерала `1`, и оставлять хардкод ролей (a-защищает первым)
   только когда таблица `rounds` пуста. Пример:
   ```sql
   INSERT INTO rounds (n, attacker_team, defender_team, current_tick)
   VALUES ((SELECT COALESCE(MAX(n),0)+1 FROM rounds), $1, $2, 0)
   RETURNING ...
   ```
   (роли `$1=attacker,$2=defender` берутся из дефолта только для самого первого раунда).
2. `platform/scoreboard/src/app.ts` — убрать вызов `ensureRound` из `GET /api/round`
   (строки ~113–114). GET делает только чтение; если активного раунда нет — вернуть `404`
   `{ error: 'no round' }` (фронтенд уже умеет `round: null`). Создание раунда оставить в
   `POST /api/internal/tick` и в старте (`index.ts`).

**Критерий приёмки:** `GET /api/round` не выполняет INSERT; повторные вызовы после завершённого
раунда не дают 500; на свежей БД первый tick/старт создаёт раунд 1 с ролями a-defender.

---

## #5 — Единые «часы» тика (checker/planter рассинхрон)
**Проблема:** `flag-planter` единолично двигает `rounds.current_tick` (POST `/api/internal/tick`),
`checker` крутит НЕЗАВИСИМЫЙ `setInterval` и лишь читает тик для тегирования `sla_samples`.
Петли стартуют в разное время → тики дублируются/пропускаются; колонка `sla_samples.tick`
(и индекс по ней) ненадёжна. Скоринг спасается тем, что считает по `sampled_at`.

**Цель:** один авторитет времени.

**Сделать (рекомендуемый вариант — перенести тик в scoreboard):**
1. `platform/scoreboard/src/index.ts` — завести собственный таймер, который раз в `tick_seconds`
   вызывает `bumpTick(pool)` (если есть активный раунд). Scoreboard становится «часовщиком».
2. `platform/flag-planter/src/plant.ts::runTick()` — вместо `POST /api/internal/tick` (bump)
   читать текущий тик через `GET /api/round` (как это делает checker) и сажать флаги под него.
   Убрать увеличение тика из planter.
3. `platform/scoreboard/src/app.ts` — `POST /api/internal/tick` оставить как ручной хук
   (judge) либо удалить, если больше не используется. Проверить, что `flag-planter` и `checker`
   больше не вызывают bump.

**Альтернатива (минимальная):** оставить как есть, но в схеме/доках явно пометить
`sla_samples.tick` как advisory (скоринг по времени), и в `check.ts` перечитывать
`GET /api/round` перед КАЖДЫМ стендом, а не раз на петлю, чтобы тег был максимально свежим.

**Критерий приёмки:** тик монотонно растёт из одного места; `sla_samples.tick` и `planted_flags.tick`
для одного момента времени совпадают; форензика по тику корректно джойнится.

---

## #8 — checker/billing не должен плодить пользователей каждый тик
**Проблема:** `platform/checker/src/check.ts::checkBilling()` регистрирует НОВОГО пользователя
`sla_<ts>_<rand>` + инвойс на каждом тике и не чистит их. За матч — сотни мусорных строк в той же
таблице, на которой стоят SQLi/IDOR-челленджи; засоряет форензику.

**Сделать:**
1. `check.ts` — использовать СТАБИЛЬНОГО канареечного пользователя (например `sla_canary`)
   вместо timestamped. Register теперь на 2-м тике вернёт 409 → это НЕ ошибка: трактовать
   `reg.status === 409` (или тело «username taken») как успех и идти на login. Т.е. изменить
   условие: `if (!reg.ok && reg.status !== 409) return mumble`.
2. Инвойс всё ещё создаётся каждый тик (нужен для проверки pay-flow). Чтобы не рос бесконечно —
   добавить прунинг в `flag-planter` (у него ЕСТЬ `database_url` стенда): в
   `platform/flag-planter/src/plant.ts::plantBillingStand()` раз в тик выполнять
   `DELETE FROM invoices WHERE title = 'SLA invoice' AND created_at < NOW() - INTERVAL '10 minutes'`
   и (опц.) `DELETE FROM comments WHERE ...` если появятся. НЕ удалять пользователя канарейку.
   Внимание: убедиться, что `title='SLA invoice'` не пересекается с challenge-данными планте́ра
   (там `title='Confidential retainer'` — не пересекается).

**Критерий приёмки:** число пользователей в billing-БД не растёт с тиками; число `SLA invoice`
ограничено скользящим окном; SLA-проба billing по-прежнему `up` на каждом тике.

---

## Порядок для Cursor
1. #4 (быстро, изолировано) → 2. #5 (перенос тика) → 3. #3 (роли/персистентность) →
4. #8 (checker+planter) → 5. #2 (UI).
После всего: `npm run build`, затем прогнать `node tools/attacker-scripts/phase8-smoke.mjs`
на локальном compose (`deploy/docker/compose.dev.yml`) — матрица PoC должна остаться зелёной
(vuln PASS / ref FAIL), и вернуть diff на валидацию.
