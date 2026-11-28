// Version: 4
// Управление скоростью циркуляционных насосов через ШИМ-выходы WB-MAO4.
//
// У ZOTA EcoRING III скважность инвертирована: 84 % (8400) — минимальная скорость,
// 10 % (1000) — максимальная, 96 % (9600) — стоп, 100 % (10000) — авто.
// Уровень пишется в топик команды канала (/on): запись в топик состояния
// (/devices/<dev>/controls/Channel N) на MAO4 не применяется, остаётся только retained.
// Выход включается отдельно через Channel N Switch.
//
// v4: подписи состояний — «Модуляция» / «Стоп» / «Авто насоса»; реле разрешения
// питания нет (решение 18.11.2026), поэтому state 3 = выход выключен = d 0 = АВТО
// насоса, а НЕ остановка. Остановка — только state 2 (d = 96 %).
// Уставка power переименована в скорость: 0 = минимум, 1000 = максимум.
//
// Каналы:
//   primary-ring         -> wb-mao4_213/Channel 1
//   underfloor-heating-1 -> wb-mao4_213/Channel 2
//   underfloor-heating-2 -> wb-mao4_100/Channel 1

function makePumpPWMController(name, minSpeedValue, maxSpeedValue, stopValue, outputChannel) {
  var deviceName = "pump-pwm-controller-" + name;
  var stateTopicName = deviceName + "/state";
  var powerTopicName = deviceName + "/power";
  // outputChannel приходит в виде "<device>/Channel N"; топик команды строится от /controls
  var levelTopic = "/devices/" + outputChannel.replace("/", "/controls/") + "/on";
  var switchTopic = "/devices/" + outputChannel.replace("/", "/controls/") + " Switch/on";

  defineVirtualDevice(deviceName, {
    title: "Pump PWM Controller - " + name,
    cells: {
      state: {
        title: "State",
        type: "value",
        value: 1,
        readonly: false,
        enum: {
          1: { en: 'Modulation', ru: 'Модуляция' },
          2: { en: 'Stop', ru: 'Стоп' },
          3: { en: 'Pump auto', ru: 'Авто насоса' }
        }
      },
      power: {
        title: "Скорость насоса, 0...1000 (0 - мин, 1000 - макс)",
        type: "range",
        value: 0,
        max: 1000,
        min: 0
      }
    }
  });

  function apply() {
    var stateValue = dev[stateTopicName];
    if (stateValue == 3) {
      publish(switchTopic, "0", 0, false);
      return;
    }

    publish(switchTopic, "1", 0, false);

    var level;
    if (stateValue == 2) {
      level = stopValue * 10;
    } else {
      level = (minSpeedValue + (maxSpeedValue - minSpeedValue) / 1000 * dev[powerTopicName]) * 10;
    }
    publish(levelTopic, String(level), 0, false);
  }

  defineRule("pump-pwm-automation-" + name, {
    whenChanged: [
      stateTopicName,
      powerTopicName
    ],
    then: apply
  });

  // применение уставки при загрузке правила, не дожидаясь изменения power
  apply();
}

makePumpPWMController("primary-ring", 840, 100, 960, "wb-mao4_213/Channel 1");
makePumpPWMController("underfloor-heating-1", 840, 100, 960, "wb-mao4_213/Channel 2");
makePumpPWMController("underfloor-heating-2", 840, 100, 960, "wb-mao4_100/Channel 1");
