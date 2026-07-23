# Правила скоринга — HackTrainingWebapps

Конкретизация §6 [`SPEC.md`](SPEC.md). Модель — классический attack/defense: очки за **украденные флаги**
(атака) и за **доступность своего стенда** (SLA, защита). Значения ниже — дефолты, все вынести в
`platform/scoreboard/config.yaml`, чтобы судья менял без пересборки.

---

## 1. Тик и раунд

- **Tick** = 60 c. Базовый интервал: planter кладёт флаги, checker меряет SLA, scoreboard пересчитывает табло.
- **Round** = 60–90 мин ≈ 60–90 тиков. В раунде команда A защищает свой стенд, команда B атакует его (и наоборот
  во втором раунде). Флаг «живёт» `FLAG_TTL = 3` тика — украсть можно только свежий, устаревший не засчитывается.
- Каждый флаг уникален по кортежу `(team, service, vuln_id, tick)` и имеет вид `TRN{<32 hex>}`.

---

## 2. Атакующие очки

За каждый **валидный, свежий, ранее не сданный** флаг соперника команда получает `flag_value(vuln_id)`.

| Класс уязвимости | vuln_id (пример) | Очки за флаг |
|------------------|------------------|-------------:|
| IDOR / Broken Access Control | `A01-IDOR` | 100 |
| Mass-assignment privesc | `A04-MASSASSIGN` | 120 |
| Слабые креды / конфиг (app1) | `CFG-*` | 120 |
| Криптосбои (пароли/reset) | `A02-CRYPTO` | 150 |
| Stored XSS | `A03-XSS` | 150 |
| CORS / заголовки / debug-утечка | `CFG-LEAK` | 150 |
| SQL-инъекция | `A03-SQLI` | 200 |
| SSRF | `A10-SSRF` | 200 |
| RCE через зависимость / forged-admin | `CFG-RCE`, `CFG-JWT` | 300 |

Правила начисления:
- **Дедуп:** одна и та же строка-флаг засчитывается атакующей команде один раз (`UNIQUE(submitter_team, flag)`).
- **Свежесть:** флаг старше `FLAG_TTL` тиков → `expired`, 0 очков (не даём фармить один баг вечно — заставляем
  переэксплуатировать, что видно в логах и честнее к защите).
- **Свой флаг:** сабмит собственного флага запрещён (0 очков + запись в аудит как попытка читерства).
- **First-blood бонус (опц.):** первая в раунде успешная сдача данного `vuln_id` = +50% к `flag_value`.

---

## 3. Защитные очки (SLA)

Checker каждый tick прогоняет функциональный сценарий против стенда и ставит статус:

- **up** — сценарий полностью прошёл (регистрация/логин → штатная транзакция → чтение «канарейки»).
- **mumble** — сервис отвечает, но функционал частично сломан (напр. вернул не то) → считается как down для SLA, но
  логируется отдельно (обычно признак «перестарались с патчем»).
- **down** — не отвечает / таймаут / 5xx.

```
SLA% = up_ticks / total_ticks_in_round
defense_score = round(SLA% * DEFENSE_WEIGHT)      # DEFENSE_WEIGHT = 500 по умолчанию
```

- Закрытие уязвимости **не** даёт прямых очков — оно лишает соперника потока атакующих очков. Стимул защиты =
  «перекрыть кран краж + удержать SLA=up».
- Штраф за поломку функционала заложен автоматически: сломал фичу при патче → checker ставит down/mumble → падает `SLA%`.

---

## 4. Итог раунда и матча

```
team_round_score = Σ attack_points  +  defense_score
match_score      = Σ team_round_score по всем раундам, где команда участвовала
```

Победитель матча — по сумме за оба раунда (каждая команда один раунд атакует, один защищает). При равенстве —
меньше суммарного down-времени, затем — раньше взятый first-blood.

---

## 5. API scoreboard (контракт для реализации)

```
POST /api/submit
  body: { "team": "b", "flag": "TRN{ab12...}" }
  auth: заголовок X-Team-Token (per-team, выдаётся при bootstrap)
  200: { "status": "accepted", "points": 200, "vuln_id": "A03-SQLI", "first_blood": false }
  200: { "status": "duplicate"|"expired"|"own_flag"|"invalid", "points": 0 }
  429: троттлинг (см. анти-чит)

GET  /api/scoreboard            → live-табло (JSON): attack/defense/SLA/total **за текущий раунд**,
                                  плюс `match_total` (кумулятив матча без фильтра `started_at`), тайм-лайн
GET  /api/round                 → текущий раунд/тик/оставшееся время (**только чтение**; 404 если нет раунда)
POST /api/round/next  (судья)   → перейти к следующему раунду (дёргается swap-roles.sh)
POST /api/internal/tick (судья) → ручной bump тика; основной часовщик — сам scoreboard (`setInterval`)
GET  /healthz /readyz
Web UI: '/' — авто-обновляемое табло (poll GET /api/scoreboard раз в 3 c); колонки помечены «(раунд)»
```

Таблицы БД scoreboard:
- `planted_flags(id, flag, team, service, vuln_id, tick, planted_at, expires_at)`
- `submissions(id, submitter_team, flag, vuln_id, points, status, first_blood, src_ip, submitted_at)`
- `sla_samples(id, team, service, tick, status, latency_ms, sampled_at)`
- `rounds(id, n, attacker_team, defender_team, started_at, ended_at, current_tick)`
- `sla_samples(..., excluded, detail jsonb)` — расширения для разбора/исключений

**Часы тика:** `rounds.current_tick` двигает только scoreboard (таймер + опциональный `POST /api/internal/tick`).
`flag-planter` и `checker` читают тик через `GET /api/round` и сажают/тегируют под него — так
`planted_flags.tick` и `sla_samples.tick` согласованы для форензики.

**Роли раунда:** scoreboard (таблица `rounds`, PVC) — источник правды; `swap-roles.sh` читает
`GET /api/round`, делает `POST /api/round/next`, затем приводит labels/NetworkPolicy к ответу.
---

## 6. Анти-чит

- **Троттлинг сабмитов:** ≤ 20 сабмитов/мин на команду (429 при превышении) — против брутфорса флаг-пространства
  (32 hex необрутфорсим, но защищаемся от флуда и мусора в аудите).
- **Только сеть своей роли:** сабмит принимается с токеном команды; чужой стенд достижим только по HTTP (NetworkPolicy).
- **Аудит:** каждый сабмит (в т.ч. own_flag/invalid) пишется в `submissions` с `src_ip` и временем — для разбора
  споров и выявления обмена флагами между командами.
- **Флаги не логируются в открытом виде** приложениями стендов (только факт доступа к защищённому ресурсу) —
  чтобы флаг нельзя было «подсмотреть» в общих логах Grafana, минуя эксплуатацию.

---

## 7. Значения по умолчанию (config.yaml)

```yaml
tick_seconds: 60
flag_ttl_ticks: 3
defense_weight: 500
first_blood_multiplier: 1.5
submit_rate_limit_per_min: 20
flag_regex: 'TRN\{[0-9a-f]{32}\}'
flag_values:
  A01-IDOR: 100
  A04-MASSASSIGN: 120
  CFG-JWT: 300
  CFG-RCE: 300
  CFG-LEAK: 150
  CFG-CREDS: 120
  A02-CRYPTO: 150
  A03-XSS: 150
  A03-SQLI: 200
  A10-SSRF: 200
```

Колонка `rounds.current_tick` — авторитетные «часы» матча (двигает scoreboard). Поля
`sla_samples.excluded` / `detail` — рабочие расширения схемы для разбора; контракт API §5 не меняют.
