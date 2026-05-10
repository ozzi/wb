// Version: 1

function makePumpPWMController(
  name,
  minSpeedValue,
  maxSpeedValue,
  stopValue,
  offValue,
  outputPWMValue
) {
  var deviceName = "pump-pwm-controller-" + name;
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
        value: 1000,
        max: 1000,
        min: 0
      }
    }
  });

  var stateTopicName = deviceName + "/state";
  var powerTopicName = deviceName + "/power"

  defineRule("pump-pwm-automation-" + name, {
    whenChanged: [
      stateTopicName,
      powerTopicName
    ],
    then: function (newValue, devName, cellName) {
      var stateValue = dev[stateTopicName];
      if (stateValue == 1) {
        var power = (maxSpeedValue - minSpeedValue) / 1000 * dev[powerTopicName] + minSpeedValue;
        dev[outputPWMValue] = power * 10;
      } else if (stateValue == 2) {
        dev[outputPWMValue] = stopValue * 10;
      } else if (stateValue == 3) {
        dev[outputPWMValue] = offValue * 10;
      }
    }
  });
}


makePumpPWMController("pool-heat-exchanger", 840, 100, 960, 1000, "wb-mao4_16/Channel 1");
makePumpPWMController("asic", 840, 100, 960, 1000, "wb-mao4_16/Channel 2");
makePumpPWMController("dry-cooling-tower", 840, 100, 960, 1000, "wb-mao4_16/Channel 3");
