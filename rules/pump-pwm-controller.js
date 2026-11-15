// Version: 3
// Управление скоростью циркуляционных насосов через ШИМ-выходы WB-MAO4.
//
// У ZOTA EcoRING III скважность инвертирована: 84 % (8400) — минимальная скорость,
// 10 % (1000) — максимальная, 96 % (9600) — стоп, 100 % (10000) — авто.
// Уровень пишется в топик команды канала (/on): запись в топик состояния
// (/devices/<dev>/controls/Channel N) на MAO4 не применяется, остаётся только retained.
// Выход включается отдельно через Channel N Switch.
//
// Каналы:
//   primary-ring         -> wb-mao4_213/Channel 1
//   underfloor-heating-1 -> wb-mao4_213/Channel 2
//   underfloor-heating-2 -> wb-mao4_100/Channel 1

function makePumpPWMController(name, minSpeedValue, maxSpeedValue, stopValue, outputChannel) {
  var deviceName = "pump-pwm-controller-" + name;
  var stateTopicName = deviceName + "/state";
  var powerTopicName = deviceName + "/power";
  var levelCmdTopic = "/devices/" + outputChannel + "/on";
  var switchCmdTopic = "/devices/" + outputChannel + " Switch/on";

  defineVirtualDevice(deviceName, {
    title: "Pump PWM Controller - " + name,
    cells: {
      state: {
        title: "State",
        type: "value",
        value: 1,
        readonly: false,
        enum: {
          1: { en: 'Auto', ru: 'Авто' },
          2: { en: 'Stop', ru: 'Остановлено' },
          3: { en: 'Off', ru: 'Отключено' }
        }
      },
      power: {
        title: "Power value",
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
      publish(switchCmdTopic, "0", 0, false);
      return;
    }

    publish(switchCmdTopic, "1", 0, false);

    var level;
    if (stateValue == 2) {
      level = stopValue * 10;
    } else {
      level = (minSpeedValue + (maxSpeedValue - minSpeedValue) / 1000 * dev[powerTopicName]) * 10;
    }
    publish(levelCmdTopic, String(level), 0, false);
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
