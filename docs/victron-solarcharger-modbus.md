# Victron Solar Charger по Modbus TCP

Солнечный MPPT-контроллер Victron (SmartSolar/BlueSolar с VE.Direct, VE.Can MPPT или
MPPT RS) на GX-устройстве: телеметрия зарядки попадает в MQTT контроллера Wiren Board
штатным устройством `wb-mqtt-serial`, без правил и без Home Assistant.

Дополняет шаблон `victron-venus-system` из PR #31: система знает про батарею, а о том,
сколько даёт солнце, не знает ничего.

## Зачем в wb-mqtt-serial

Правила wb-rules видят только `/devices/...`. MQTT GX-устройства публикуется в свой
namespace `N/<VRM ID>/...`, HA забирает его интеграцией `victron_mqtt`, но wb-rules —
нет. Пока солнце не в MQTT контроллера, экраны и правила знают о зарядке только через
HA, то есть логика снова зависит от HA.

## Что включить на GX

1. Remote Console → **Settings → Integrations → Modbus TCP server → Enable**.
2. Там же, **Available services**, найти `com.victronenergy.solarcharger` и записать
   его **unit id**. С прошивки 2.60 unit id динамический (равен device instance, если
   тот не больше 247), в шаблоне он нигде не зашит: нужен `slave_id` в конфиге порта.

## Конфигурация порта

```json
{
    "ports": [
        {
            "port_type": "modbus tcp",
            "address": "192.168.0.29",
            "port": 502,
            "response_timeout_ms": 500,
            "devices": [
                {
                    "name": "Victron Solar Charger",
                    "id": "victron-solar",
                    "slave_id": 243,
                    "device_type": "victron-solarcharger",
                    "enabled": true
                }
            ]
        }
    ]
}
```

`slave_id` подставляется из «Available services», а не из примера. У GX на один порт
502 могут висеть несколько сервисов, тогда они заводятся отдельными устройствами с
разными `slave_id`: `victron-venus` (system, unit id 100) и `victron-solar`.

## Каналы

| Канал | Адрес | Формат | Масштаб | Единицы |
|---|---|---|---|---|
| `battery-voltage` | 771 | u16 | 0.01 | V |
| `battery-current` | 772 | s16 | 0.1 | A |
| `charge-state` | 775 | u16 | 1 | 0 off, 2 fault, 3 bulk, 4 absorption, 5 float, 6 storage, 7 equalize, 11 other, 245 wake-up, 252 external control |
| `pv-voltage` | 776 | u16 | 0.01 | V |
| `yield-today` | 784 | u16 | 0.1 | kWh |
| `max-charge-power-today` | 785 | u16 | 1 | W |
| `yield-yesterday` | 786 | u16 | 0.1 | kWh |
| `error-code` | 788 | u16 | 1 | код ошибки зарядника, 0 = нет |
| `pv-power` | 789 | u16 | 0.1 | W |
| `mpp-mode` | 791 | u16 | 1 | 0 off, 1 voltage/current limited, 2 MPPT active, 255 нет данных |

Адреса и масштабы сверены с официальным `CCGX-Modbus-TCP-register-list` (3.81),
лист `Field list`, сервис `com.victronenergy.solarcharger`.

**Масштаб `pv-power` важен.** В листе поле помечено «Older 16-bit variant of 789»
при масштабе `10`, то есть значение отдаётся в 0.1 Вт: 1250 на шине — 125 Вт, а не
1250 Вт. Полная мощность есть и в 32-битном регистре 792 (`uint32` в реестре), но у
него нет масштаба, зато есть зависимость от порядка слов: в wb-mqtt-serial это
`word_order: "little_endian"`, и утверждать его без живого устройства нельзя. Поэтому
взят 16-битный вариант с его штатным масштабом 10. Если покажется вдесятеро меньше — первый
подозреваемый именно этот масштаб, проверить сравнением с VRM.

Намеренно не заведено:

- `pv-current` (777) — его нет в списке регистров, он вычисляется по `pv-power` и
  `pv-voltage`; считать в правиле, если понадобится;
- `charger on/off` (774, запись) и `battery temperature` (773) — только для VE.Can
  MPPT, на локальном MPPT их не будет;
- трекеры MPPT RS (3700+) — у простого MPPT их нет, а регистры 3704–3707 заняты
  `RESERVED`; заводить под конкретную модель.

## Как проверить

1. `node tests/modbus-template-check.js templates/config-victron-solarcharger.json` —
   адреса, дубли, форматы, размер групп чтения.
2. Завести порт и смотреть `mosquitto_sub -t '/devices/victron-solar/controls/#' -v`.
   Драйвер читает тремя запросами: 771–776 (напряжение и ток батареи, состояние заряда,
   напряжение PV), 784–789 (выработка и мощность, код ошибки) и 791 (режим MPPT).
3. Сверить `battery-voltage`, `pv-power` и `charge-state` с VRM или Remote Console.
   Не сходится мощность в 10 раз — см. выше про масштаб.
4. Проверить ошибки регистров: `meta/error` у каналов должен быть пустым. Если весь
   блок в ошибке — чаще всего неверный `slave_id` или на GX не включён Modbus TCP.

## Ограничения

- Только чтение: шаблон ничего не пишет в GX. Управление (`charger on/off`, уставки
  ESS) — отдельная задача с явным подтверждением, а не побочный эффект телеметрии.
- Отдельный MPPT на VE.Direct через свой интерфейс не сюда: это USB-порт GX и драйвер
  `vedirect`, а не Modbus.
- Если под GX несколько зарядников, GX объединяет их в один сервис: `pv-voltage`
  для нескольких VE.Can-зарядников не отдаётся (в листе это оговорено).
