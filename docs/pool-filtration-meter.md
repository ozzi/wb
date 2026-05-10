<!-- Version: 1 -->

# pool-filtration-meter.js

Счётчик фильтрации бассейна. Считает объём отфильтрованной воды, количество суточных циклов и скорость фильтрации через фильтр.

## Функция `makePoolFiltrationMeter(name, modeTopicName, timeframe)`

### Параметры

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `name` | string | да | Уникальное имя экземпляра |
| `modeTopicName` | string | да | Топик режима контроллера фильтрации (`pool-filtration-ctrl-{name}/mode`) |
| `timeframe` | number | да | Интервал накопления объёма в миллисекундах (например, `5000`) |

### Виртуальное устройство `pool-filtration-meter-{name}`

| Ячейка | Тип | Доступ | Описание |
|---|---|---|---|
| `daily_cycles` | value | только чтение | Количество циклов фильтрации за сутки |
| `total_filtration_volume` | value (л) | только чтение | Суммарный объём воды, прошедшей через фильтр за сутки |
| `filtration_speed` | value (м³/ч/м²) | только чтение | Текущая скорость фильтрации через площадь фильтра |
| `filter_diameter` | value (мм) | чтение/запись | Диаметр фильтра, по умолчанию 450 мм |
| `pool_volume` | value (л) | чтение/запись | Объём бассейна, по умолчанию 28000 л |
| `pump_flow_rate` | value (м³/ч) | чтение/запись | Производительность насоса, по умолчанию 13 м³/ч |

### Логика работы

- Каждые `timeframe` мс, если режим фильтрации активен (`mode == 1`), накапливается объём воды пропорционально производительности насоса и прошедшему времени.
- `daily_cycles` = `total_filtration_volume` / `pool_volume`.
- `filtration_speed` пересчитывается при изменении режима, производительности насоса или диаметра фильтра.
- В полночь (`0 0 * * *`) суточные счётчики сбрасываются.

### Возвращаемое значение

```js
{
    poolVolumeTopicName:    "pool-filtration-meter-{name}/pool_volume",
    pumpFlowRateTopicName:  "pool-filtration-meter-{name}/pump_flow_rate",
    filterDiameterTopicName:"pool-filtration-meter-{name}/filter_diameter"
}
```

### Пример использования

```js
var meter = makePoolFiltrationMeter(
    "outdoor",
    "pool-filtration-ctrl-outdoor/mode",
    5000
);
```
