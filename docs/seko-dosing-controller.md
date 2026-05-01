# seko-dosing-controller.js

Контроллер управления дозирующей станцией Seko. Управляет разрешением дозирования через реле, отслеживает аварийные сигналы, уровни реагентов, работу насосов дозирования и состояние калибровки датчиков pH и Redox.

## Функция `makeSekoDosingController(name, relayTopicName, filtrationModeTopicName, alarmTopicName, phMinusSensorTopicName, chlorineSensorTopicName, phPumpSensorTopicName, chlorinePumpSensorTopicName)`

### Параметры

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `name` | string | да | Уникальное имя экземпляра |
| `relayTopicName` | string | да | Топик реле разрешения дозирования (`true` = дозирование разрешено) |
| `filtrationModeTopicName` | string | да | Топик режима контроллера фильтрации |
| `alarmTopicName` | string | нет | Топик сигнала аварии станции (нормально разомкнутый, `true` = авария) |
| `phMinusSensorTopicName` | string | нет | Топик датчика уровня pH- (`true` = канистра пуста) |
| `chlorineSensorTopicName` | string | нет | Топик датчика уровня хлора (`true` = канистра пуста) |
| `phPumpSensorTopicName` | string | нет | Топик датчика работы насоса pH (дублирование через реле на MCM8) |
| `chlorinePumpSensorTopicName` | string | нет | Топик датчика работы насоса хлора (дублирование через реле на MCM8) |

### Виртуальное устройство `seko-dosing-ctrl-{name}`

#### Основные ячейки (всегда присутствуют)

| Ячейка | Тип | Доступ | Описание |
|---|---|---|---|
| `mode` | value (enum) | чтение/запись | Режим дозирования |
| `bathing_duration` | value (мин) | чтение/запись | Длительность режима купания, по умолчанию 30 мин |
| `bathing_remaining` | value (мин) | только чтение | Оставшееся время режима купания |
| `dosing_active` | switch | только чтение | Флаг активного дозирования |
| `status` | text | только чтение | Текущий статус |
| `ph_calibration_interval` | value (дн) | чтение/запись | Интервал калибровки pH, по умолчанию 30 дней |
| `ph_calibrated_at` | value | только чтение | Unix timestamp последней калибровки pH |
| `ph_needs_calibration` | switch | только чтение | Флаг необходимости калибровки pH |
| `ph_calibrate_btn` | pushbutton | запись | Кнопка фиксации калибровки pH |
| `redox_calibration_interval` | value (дн) | чтение/запись | Интервал калибровки Redox, по умолчанию 30 дней |
| `redox_calibrated_at` | value | только чтение | Unix timestamp последней калибровки Redox |
| `redox_needs_calibration` | switch | только чтение | Флаг необходимости калибровки Redox |
| `redox_calibrate_btn` | pushbutton | запись | Кнопка фиксации калибровки Redox |

#### Опциональные ячейки

| Ячейка | Условие появления | Тип | Описание |
|---|---|---|---|
| `ph_minus_empty` | `phMinusSensorTopicName != null` | switch | Канистра pH- пуста |
| `chlorine_empty` | `chlorineSensorTopicName != null` | switch | Канистра хлора пуста |
| `ph_pump_flow_rate` | `phPumpSensorTopicName != null` | value (л/ч) | Производительность насоса pH, по умолчанию 1.5 л/ч |
| `ph_pump_duty_cycle` | `phPumpSensorTopicName != null` | value (%) | Скважинность насоса pH за последний час |
| `ph_pump_daily_runtime` | `phPumpSensorTopicName != null` | value (мин) | Время работы насоса pH за сутки |
| `ph_pump_total_volume` | `phPumpSensorTopicName != null` | value (л) | Накопительный расход реагента pH |
| `ph_pump_reset_btn` | `phPumpSensorTopicName != null` | pushbutton | Сброс накопительного счётчика насоса pH |
| `chlorine_pump_flow_rate` | `chlorinePumpSensorTopicName != null` | value (л/ч) | Производительность насоса хлора, по умолчанию 1.5 л/ч |
| `chlorine_pump_duty_cycle` | `chlorinePumpSensorTopicName != null` | value (%) | Скважинность насоса хлора за последний час |
| `chlorine_pump_daily_runtime` | `chlorinePumpSensorTopicName != null` | value (мин) | Время работы насоса хлора за сутки |
| `chlorine_pump_total_volume` | `chlorinePumpSensorTopicName != null` | value (л) | Накопительный расход реагента хлора |
| `chlorine_pump_reset_btn` | `chlorinePumpSensorTopicName != null` | pushbutton | Сброс накопительного счётчика насоса хлора |

### Режимы дозирования (`mode`)

| Значение | Название | Описание |
|---|---|---|
| `0` | Allowed | Дозирование разрешено (если фильтрация активна) |
| `1` | Prohibited | Дозирование запрещено вручную |
| `2` | Bathing | Режим купания — дозирование временно отключено |

### Статусы (`status`)

| Значение | Описание |
|---|---|
| `ok` | Дозирование активно, станция работает нормально |
| `idle` | Дозирование не активно (фильтрация выключена или mode = Prohibited) |
| `bathing` | Активен режим купания |
| `alarm` | Дозирование активно, но станция сигнализирует аварию |

### Логика работы

**Разрешение дозирования:**
```
dosing_active = (mode == 0) AND (filtration_mode == 1) AND (bathing_remaining == 0)
```

**Аварийный сигнал:**
- Сигнал аварии (`true` = авария) игнорируется когда `dosing_active == false` — станция уходит в аварию при отключении реле, это ожидаемое поведение.
- При активном дозировании и сигнале аварии `status` переходит в `alarm`.

**Режим купания:**
- При установке `mode = 2` запускается таймер на `bathing_duration` минут.
- `bathing_remaining` обновляется каждую минуту.
- По истечении таймера `mode` автоматически возвращается в `0`.

**Мониторинг насосов:**
- Скважинность рассчитывается как процент времени работы насоса за последний час, обновляется каждую минуту.
- Суточное время работы и накопительный объём рассчитываются по фронтам сигнала датчика.
- Суточные счётчики сбрасываются в полночь.
- Накопительный объём сбрасывается вручную кнопкой `*_pump_reset_btn`.

**Калибровка датчиков:**
- При нажатии кнопки `ph_calibrate_btn` или `redox_calibrate_btn` фиксируется текущий timestamp.
- Каждый час проверяется, не истёк ли интервал калибровки.
- Если `calibrated_at == 0` (никогда не калибровался) — флаг `needs_calibration` сразу `true`.

### Возвращаемое значение

```js
{ modeTopicName: "seko-dosing-ctrl-{name}/mode" }
```

### Пример использования

```js
var dosing = makeSekoDosingController(
    "outdoor",
    "wbio-ssr8/K1",
    "pool-filtration-ctrl-outdoor/mode",
    "wb-mcm8_238/Input 5",
    "wb-mcm8_238/Input 6",
    "wb-mcm8_238/Input 7",
    "wb-mcm8_238/Input 8",
    "wb-mcm8_238/Input 9"
);
```
