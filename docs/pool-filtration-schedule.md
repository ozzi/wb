# pool-filtration-schedule.js

Планировщик расписания фильтрации бассейна. Рассчитывает временны́е окна работы насоса на основе объёма бассейна, производительности насоса и заданного количества суточных циклов.

## Функция `makePoolFiltrationSchedule(name, poolVolumeTopicName, pumpFlowRateTopicName, filterDiameterTopicName, modeTopicName)`

### Параметры

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `name` | string | да | Уникальное имя экземпляра |
| `poolVolumeTopicName` | string | да | Топик объёма бассейна |
| `pumpFlowRateTopicName` | string | да | Топик производительности насоса |
| `filterDiameterTopicName` | string | да | Топик диаметра фильтра |
| `modeTopicName` | string | да | Топик режима контроллера фильтрации |

### Виртуальное устройство `pool-filtration-schedule-{name}`

| Ячейка | Тип | Доступ | Описание |
|---|---|---|---|
| `target_daily_cycles` | range (1–8) | чтение/запись | Целевое количество циклов фильтрации в сутки |
| `work_hours_per_day` | value (ч) | только чтение | Расчётное время работы насоса в сутки |
| `morning_weight` | range (0–5) | чтение/запись | Вес утреннего окна |
| `day_weight` | range (0–5) | чтение/запись | Вес дневного окна |
| `evening_weight` | range (0–5) | чтение/запись | Вес вечернего окна |
| `night_weight` | range (0–5) | чтение/запись | Вес ночного окна |
| `sunrise_time` | text (HH:MM) | чтение/запись | Время рассвета (для режима Sunrise-Sunset) |
| `sunset_time` | text (HH:MM) | чтение/запись | Время заката (для режима Sunrise-Sunset) |
| `schedule_mode` | value (enum) | чтение/запись | Режим расписания |
| `schedule` | text | только чтение | Рассчитанное расписание в формате `HH:MM-HH:MM,...` |
| `calc_turnover_time` | value (ч) | только чтение | Расчётное время одного цикла фильтрации |

### Режимы расписания (`schedule_mode`)

| Значение | Название | Описание |
|---|---|---|
| `0` | Manual | Расписание не применяется, управление вручную |
| `1` | Sunrise-Sunset | Окна привязаны к рассвету и закату |
| `2` | Optimized | Окна привязаны к фиксированным точкам: 09:00, 15:00, 21:00, 03:00 |

### Логика работы

- Суммарное время работы рассчитывается как `pool_volume / 1000 * target_daily_cycles / pump_flow_rate` часов.
- Время распределяется по четырём окнам (утро, день, вечер, ночь) пропорционально весам.
- Каждую минуту проверяется, попадает ли текущее время в одно из окон расписания, и соответственно устанавливается `mode = 1` или `mode = 0`.
- Режимы `2` (Backwash) и `3` (Fault) расписанием не затрагиваются.
- Поддерживаются окна, переходящие через полночь.

### Возвращаемое значение

```js
{
    scheduleTopicName:     "pool-filtration-schedule-{name}/schedule",
    scheduleModeTopicName: "pool-filtration-schedule-{name}/schedule_mode"
}
```

### Пример использования

```js
var sched = makePoolFiltrationSchedule(
    "outdoor",
    "pool-filtration-meter-outdoor/pool_volume",
    "pool-filtration-meter-outdoor/pump_flow_rate",
    "pool-filtration-meter-outdoor/filter_diameter",
    "pool-filtration-ctrl-outdoor/mode"
);
```
