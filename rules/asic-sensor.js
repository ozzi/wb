// Version: 1

function makeASICSensor(
    name,
    firstPowerTopicName,
    secondPowerTopicName
) {
    var deviceName = "ASIC-sensor-" + name;
    defineVirtualDevice(deviceName, {
        title: "ASIC Sensor - " + name,
        cells: {
            power: {
                type: "value",
                unit: "W",
                readonly: true,
                value: 0
            }
        }
    });
    var powerTopicName = deviceName + "/power";

    defineRule("asic-power-sensor-" + name, {
        whenChanged: [
            firstPowerTopicName,
            secondPowerTopicName
        ],
        then: function () {
            dev[powerTopicName] = dev[firstPowerTopicName] + dev[secondPowerTopicName];
        }
    });
}

makeASICSensor(
  "TOTAL",
  "ANTMINER T21-1/power",
  "ANTMINER T21-2/power"
);
