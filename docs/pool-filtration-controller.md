<!-- Version: 2 -->

# pool-filtration-controller.js

Контроллер управления насосом фильтрации бассейна.

## Функция `makePoolFiltrationController(name, pumpSwitchTopicName, buttonSinglePressTopicName, buttonLongPressTopicName, buttonDoublePressTopicName, flowSensorTopicName)`

### Параметры

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `name` | string | да | Уникальное имя экземпляра (используется в именах устройств и правил) |
| `pumpSwitchTopicName` | string | да | Топик реле насоса (запись `true`/`false`) |
| `buttonSinglePressTopicName` | string | нет | Топик одиночного нажатия кнопки MCM8 |
| `buttonLongPressTopicName` | string | нет | Топик долгого нажатия кнопки MCM8 |
| `buttonDoublePressTopicName` | string | нет | Топик двойного нажатия кнопки MCM8 |
| `flowSensorTopicName` | string | нет | Топик датчика протока (геркон, нормально разомкнутый, `true` = проток есть) |

### Виртуальное устройство `pool-filtration-ctrl-{name}`

| Ячейка | Тип | Доступ | Описание |
|---|---|---|---|
| `mode` | value (enum) | только чтение | Текущий режим работы |
| `flow_check_delay` | value (с) | чтение/запись | Задержка перед проверкой протока, по умолчанию 30 с |
| `backwash_duration` | value (с) | чтение/запись | Длительность промывки, по умолчанию 180 с |
| `rinse_duration` | value (с) | чтение/запись | Длительность уплотнения, по умолчанию 45 с |
| `intent_start` | pushbutton | запись | Запустить фильтрацию |
| `intent_stop` | pushbutton | запись | Остановить фильтрацию |
| `intent_service` | pushbutton | запись | Перейти в режим обслуживания |
| `intent_backwash_start` | pushbutton | запись | Запустить промывку |
| `intent_rinse_start` | pushbutton | запись | Запустить уплотнение |
| `intent_emergency_stop` | pushbutton | запись | Аварийная остановка (переход в fault) |
| `intent_reset` | pushbutton | запись | Сброс ошибки |

### Режимы (`mode`)

| Значение | Название | Описание |
|---|---|---|
| `0` | Idle | Ожидание, насос выключен |
| `1` | Run | Фильтрация, насос включён |
| `2` | Service Wait | Ожидание обслуживания, насос выключен |
| `3` | Fault | Ошибка, насос выключен |
| `4` | Backwash | Промывка, насос включён, автостоп по таймеру |
| `5` | Rinse | Уплотнение, насос включён, автостоп по таймеру |

### Логика работы

- При переходе в режим `1` (Run) насос включается. Если задан `flowSensorTopicName` — запускается таймер на `flow_check_delay` секунд. По истечении таймера, если проток отсутствует, контроллер переходит в режим `3` (Fault).
- При пропадании протока во время фильтрации таймер перезапускается. При появлении протока — отменяется.
- Режим `4` (Backwash) завершается автоматически через `backwash_duration` секунд — переход в `2` (Service Wait).
- Режим `5` (Rinse) завершается автоматически через `rinse_duration` секунд — переход в `2` (Service Wait).
- При переходе в режим `0`, `2` или `3` насос выключается, все таймеры отменяются.
- Из режима `3` (Fault) выйти можно через `intent_reset` или двойным нажатием кнопки.
- Если насос включился или выключился неожиданно (не по команде контроллера) — контроллер переходит в режим `3` (Fault).

### Управление через intent-кнопки

| Кнопка | Допустимые режимы | Результат |
|---|---|---|
| `intent_start` | `0`, `2` | → `1` (Run) |
| `intent_stop` | `1`, `4`, `5` | → `0` (Idle) |
| `intent_service` | `1`, `4`, `5` | → `2` (Service Wait) |
| `intent_backwash_start` | `2` | → `4` (Backwash) |
| `intent_rinse_start` | `2` | → `5` (Rinse) |
| `intent_emergency_stop` | любой | → `3` (Fault) |
| `intent_reset` | `3` | → `0` (Idle) |

### Управление физической кнопкой

**Single press:**

| Текущий режим | Результат |
|---|---|
| `0` Idle | → `1` Run |
| `1` Run | → `0` Idle |
| `2` Service Wait | → `4` Backwash |
| `4` Backwash | → `2` Service Wait |
| `5` Rinse | → `2` Service Wait |

**Long press:**

| Текущий режим | Результат |
|---|---|
| `0` Idle | → `2` Service Wait |
| `1` Run | → `2` Service Wait |
| `2` Service Wait | → `5` Rinse |
| `4` Backwash | → `2` Service Wait |
| `5` Rinse | → `2` Service Wait |

**Double press:**

| Текущий режим | Результат |
|---|---|
| `2` Service Wait | → `1` Run |
| `3` Fault | → `0` Idle |

### Пример использования

```js
makePoolFiltrationController(
    "outdoor",
    "wb-mr6cu_91/K1",
    "wb-mcm8_238/Input 3 Single Press Counter",
    "wb-mcm8_238/Input 3 Long Press Counter",
    "wb-mcm8_238/Input 3 Double Press Counter",
    "wb-mcm8_238/Input 2"
);
```
