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
            enum: {
              1: "Auto",
              2: "Stop",
              3: "Off"
            }
        },    
        power: {
            title: "Power value",
            type: "range",
            value: 100,
            max: 100,
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
      then: function(newValue, devName, cellName) {
        var stateValue = dev[stateTopicName];
        if (stateValue == 1) {
            var power = (maxSpeedValue -  minSpeedValue) / 100 * dev[powerTopicName] + minSpeedValue;
            dev[outputPWMValue] = power;
        } else if (stateValue == 2) {
            dev[outputPWMValue] = stopValue * 100;
        } else if (stateValue == 3) {
            dev[outputPWMValue] = offValue * 100;
        }
      }
    });
  }
  
  
  makePumpPWMController("pool-heat-exchanger", 84, 10, 96, 100, "wb-mao4_16/Channel 1");