# Victron Venus GX по Modbus TCP

Резервное питание дома: инвертор MultiPlus-II 48/5000 и батарея LiFePO4 (16S, JK BMS)
под управлением Venus GX.

## Зачем в wb-mqtt-serial

Правила wb-rules работают только с топиками `/devices/...`. MQTT-брокер Venus GX
публикует данные в собственный namespace `N/<VRM ID>/...`, который wb-rules не видит.
Поэтому телеметрия резерва заводится штатным устройством Modbus TCP: значения
попадают в `/devices/victron_venus/controls/...` и доступны и правилам, и Home Assistant.

Safety-логика (снятие нагрузки при работе от батареи) должна исполняться на WB,
а не в Home Assistant: при потере сети HA может быть недоступен.

## Что включить на Venus GX

1. Remote Console → **Settings → Integrations → Modbus TCP server → Enable**.
2. Там же, **Available services**, проверить unit id сервиса `com.victronenergy.system`.
   Для system он всегда `100`. Остальные сервисы (`battery`, `vebus`) в прошивках
   с 2.60 получают unit id динамически и для шаблона не используются.

## Конфигурация порта

`/etc/wb-mqtt-serial.conf`:

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
                    "name": "Victron Venus",
                    "id": "victron-venus",
                    "slave_id": 100,
                    "device_type": "victron-venus-system",
                    "enabled": true
                }
            ]
        }
    ]
}
```

Порт не занимает физическую шину RS-485, поэтому не конфликтует с существующими
устройствами. Опрос по сети: 7 регистров одним запросом, нагрузка на Venus
минимальна.

## Каналы

| Канал | Адрес | Формат | Масштаб | Единицы |
|---|---|---|---|---|
| `battery-voltage` | 840 | u16 | 0.1 | V |
| `battery-current` | 841 | s16 | 0.1 | A |
| `battery-power` | 842 | s16 | 1 | W |
| `battery-soc` | 843 | u16 | 1 | % |
| `battery-state` | 844 | u16 | 1 | 0 = idle, 1 = charging, 2 = discharging |
| `battery-consumed-ah` | 845 | s16 | -0.1 | Ah |
| `battery-time-to-go` | 846 | u16 | 0.01 | s |

Источник адресов — официальный `CCGX-Modbus-TCP-register-list.xlsx`
(`com.victronenergy.system`).

## Ограничения

- Шаблон рассчитан только на `com.victronenergy.system` (unit id 100). Это
  единственный сервис с фиксированным unit id; привязка к `battery`/`vebus`
  сломается после обновления прошивки Venus или изменения состава устройств.
- Детальная телеметрия (ячейки BMS, режимы VE.Bus, аварии инвертора) в Home Assistant
  приходит отдельно по MQTT-интеграции и в этом шаблоне не дублируется.
- Регистры только для чтения: шаблон ничего не пишет в Venus.
