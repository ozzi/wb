# pool-heat-controller.js

Контроллер нагрева воды бассейна. Управляет нагревом на основе температуры воды на входе, отслеживает дельту температур (вход/выход), считает потреблённую энергию и расход воды через нагреватель.

## Функция `makePoolHeatController(name, inletTemperatureTopicName, inletTemperatureOkTopicName, outletTemperatureTopicName, outletTemperatureOkTopicName, poolFiltrationModeTopicName, temperatureSettleMinutes, heaterPowerTopicName)`

### Параметры

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `name` | string | да | Уникальное имя экземпляра |
| `inletTemperatureTopicName` | string | да | Топик температуры воды на входе нагревателя |
| `inletTemperatureOkTopicName` | string | да | Топик валидности датчика входной температуры (`true` = датчик исправен) |
| `outletTemperatureTopicName` | string | да | Топик температуры воды на выходе нагревателя |
| `outletTemperatureOkTopicName` | string | да | Топик валидности датчика выходной температуры (`true` = датчик исправен) |
| `poolFiltrationModeTopicName` | string | да | Топик режима контроллера фильтрации |
| `temperatureSettleMinutes` | number | да | Время ожидания стабилизации температуры после запуска фильтрации (мин) |
| `heaterPowerTopicName` | string | да | Топик мощности нагревателя (Вт) |

### Виртуальное устройство `pool-heat-ctrl-{name}`

| Ячейка | Тип | Доступ | Описание |
|---|---|---|---|
| `mode` | value (enum) | чтение/запись | Режим работы контроллера |
| `target` | value (°C) | чтение/запись | Целевая температура воды, по умолчанию 28°C |
| `hysteresis` | value | чтение/запись | Гистерезис регулирования, по умолчанию 0.5°C |
| `inlet_temperature` | value (°C) | только чтение | Текущая температура на входе |
| `outlet_temperature` | value (°C) | только чтение | Текущая температура на выходе |
| `temperature_delta` | value (°C) | только чтение | Дельта температур (выход − вход + offset) |
| `delta_valid` | switch | только чтение | Флаг валидности дельты температур |
| `temperatures_valid` | switch | только чтение | Флаг готовности датчиков (после прогрева) |
| `flow_rate` | value (м³/ч) | только чтение | Расчётный расход воды через нагреватель |
| `energy_consumed` | value (кВт·ч) | только чтение | Накопительный счётчик потреблённой энергии |
| `outlet_offset` | value (°C) | только чтение | Калибровочный офсет датчика выходной температуры |
| `calibrate` | pushbutton | запись | Кнопка калибровки (обнуляет дельту, устанавливает offset) |
| `reset_energy` | pushbutton | запись | Кнопка сброса счётчика энергии |
| `status` | value (enum) | только чтение | Текущий статус контроллера |

### Режимы (`mode`)

| Значение | Название | Описание |
|---|---|---|
| `0` | Off | Контроллер выключен |
| `1` | Heat | Контроллер активен, управляет нагревом |

### Статусы (`status`)

| Значение | Название | Описание |
|---|---|---|
| `0` | Off | Контроллер выключен |
| `1` | Standby | Ожидание запуска фильтрации |
| `2` | Idle | Целевая температура достигнута, нагрев не нужен |
| `3` | Heating | Активный нагрев |
| `4` | Error: sensor | Ошибка датчика входной температуры |
| `5` | Error: no filtration data | Нет данных о режиме фильтрации |
| `6` | Waiting: temperature settle | Ожидание стабилизации температуры после запуска фильтрации |

### Логика работы

**Управление нагревом:**
- Нагрев активен (`status = 3`) только если `mode == 1` И `filtration_mode == 1` И `inlet_temperature < target - hysteresis`
- Нагрев останавливается (`status = 2`) если `inlet_temperature > target + hysteresis`
- В зоне гистерезиса предыдущий статус сохраняется

**Стабилизация температуры:**
- При запуске фильтрации запускается таймер на `temperatureSettleMinutes` минут
- До истечения таймера `status = 6` (Waiting)
- После истечения таймера, если датчик исправен — `temperatures_valid = true`, нагрев разрешается
- При остановке фильтрации `temperatures_valid = false`, таймер отменяется

**Расчёт расхода воды:**
```
Q [м³/ч] = P [Вт] / (ρ [кг/м³] × Cp [Дж/(кг·К)] × ΔT [°C]) × 3600
```
где ρ = 1000, Cp = 4186. Расчёт активен только при `delta_valid == true`.

**Счётчик энергии:**
- Накапливается каждую минуту пока `status == 3` (Heating)
- Сбрасывается кнопкой `reset_energy`
- Сохраняется между перезапусками через retain MQTT

**Калибровка:**
- Кнопка `calibrate` устанавливает `outlet_offset = inlet_temperature - outlet_temperature`
- Это обнуляет дельту при одинаковых температурах (насос только запущен, нагрева ещё нет)

**Инициализация при старте:**
- Если фильтрация уже активна — `temperatures_valid = true` (без ожидания таймера)
- `applyHeatState()` вызывается сразу — контроллер приводится в актуальное состояние

### Пример использования

```js
makePoolHeatController(
    "outdoor",
    "wb-m1w2_118/External Sensor 2",
    "wb-m1w2_118/External Sensor 2 OK",
    "wb-m1w2_118/External Sensor 1",
    "wb-m1w2_118/External Sensor 1 OK",
    "pool-filtration-ctrl-outdoor/mode",
    5,
    "ANTMINER S21e/power"
);
```
