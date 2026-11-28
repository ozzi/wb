# wb

wirenboard templates and rules

## Тесты

Правила, у которых есть чистая расчётная часть, экспортируют её через `module.exports`
и проверяются в Node без контроллера. Зависимостей нет, нужен только `node`:

```bash
node tests/heat-loss.test.js
node tests/scenario-keepalive.test.js
node tests/office-tariff-window.test.js
node tests/delta-temp.test.js
```

Глобалы wb-rules (`dev`, `defineVirtualDevice`, `defineRule`, `cron`) в тесте подменяются
заглушками до `require()` — иначе правило падает на инициализации VD раньше экспорта.
Эталоны в тестах фиксируют текущую модель, а не «истину»: изменилось число — значит
правка меняет расчёт, и эталон обновляют осознанно.

Сторож сценариев проверяется с подменой `Date.now()`: прогрев, ожидание 5 минут и
тормоз за 6 часов иначе не воспроизвести. Правило экспортирует `tickAll`/`tick`/`CFG`/
`STATE` только под Node; на контроллере `module` нет, и оно работает как обычно.

## Шаблоны Modbus TCP

Шаблоны в `templates/` проверяются отдельным скриптом: дубли `id`, форматы,
`error_value`, `word_order`, перекрытия адресов и размер групп чтения.

```bash
node tests/modbus-template-check.js templates/config-victron-solarcharger.json
node tests/modbus-template-check.test.js
```

Как проверять шаблон без устройства (эмулятор Modbus) — `docs/modbus-template-testing.md`.
