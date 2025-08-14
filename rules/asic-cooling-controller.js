function makeASICCoolingController(
    name,
    outdoorTemperatureTopicName,
    dryCoolingSetTemperatureCallback,
    wellCoolingSetTemperatureCallback,
    poolCoolingSetTemperatureCallback,
    dryCoolingRunCallback,
    wellCoolingRunCallback,
    poolCoolingRunCallback
) {
    var deviceName = "ASIC-cooling-controller-" + name;
    defineVirtualDevice(deviceName, {
        title: "ASIC Cooling Controller - " + name,
        cells: {
            mode: {
                title: "mode",
                type: "value",
                value: 2,
                readonly: false,
                enum: {
                    0: { en: "Off", ru: "Выключено" },
                    1: { en: "Auto", ru: "Автоматический выбор" },
                    2: { en: "Dry cooling", ru: "Сухая градирня" },
                    3: { en: "Well cooling", ru: "Скважинное охлаждение" },
                    4: { en: "Pool cooling", ru: "Охлаждение бассейном" }
                }
            },
            target_temperature: {
                title: "Target temperature",
                type: "value",
                value: 35,
                readonly: false
            },
            switch_temperature: {
                title: "Switch temperature",
                type: "value",
                value: 20,
                readonly: false
            }
        }
    });

    var modeTopicName = deviceName + "/mode";
    var targetTemperatureTopicName = deviceName + "/target_temperature";
    var switchTemperatureTopicName = deviceName + "/switch_temperature";

    defineRule("asic-cooling-controller-mode-" + name, {
        whenChanged: [
            modeTopicName
        ],
        then: function (newValue) {
            log("asyc cooling change mode to " + newValue);
            if (newValue == 0) {
                dryCoolingRunCallback(false);
                wellCoolingRunCallback(false);
                poolCoolingRunCallback(false);
            } else if (newValue == 1) {
                poolCoolingRunCallback(false);
                var outdoorTemperature = dev[outdoorTemperatureTopicName];
                var switchTemperature = dev[switchTemperatureTopicName];
                var targetTemperature = dev[targetTemperatureTopicName];
                var delta = targetTemperature - outdoorTemperature;
                if (delta < switchTemperature) {
                    dryCoolingRunCallback(false);
                    wellCoolingRunCallback(true);
                } else {
                    wellCoolingRunCallback(false);
                    dryCoolingRunCallback(true);
                }
            } else if (newValue == 2) {
                wellCoolingRunCallback(false);
                poolCoolingRunCallback(false);
                dryCoolingRunCallback(true);
            } else if (newValue == 3) {
                dryCoolingRunCallback(false);
                poolCoolingRunCallback(false);
                wellCoolingRunCallback(true);
            } else if (newValue == 4) {
                dryCoolingRunCallback(false);
                wellCoolingRunCallback(false);
                poolCoolingRunCallback(true);
            }
        }
    });

    defineRule("asic-cooling-controller-switch-" + name, {
        whenChanged: [
            switchTemperatureTopicName,
            outdoorTemperatureTopicName,
            targetTemperatureTopicName
        ],
        then: function () {
            if (dev[modeTopicName] != 1) {
                return;
            }
            var hysteresis = 0.25;
            var outdoorTemperature = dev[outdoorTemperatureTopicName];
            var switchTemperature = dev[switchTemperatureTopicName];
            var targetTemperature = dev[targetTemperatureTopicName];
            var delta = targetTemperature - outdoorTemperature;
            if (delta < (switchTemperature - hysteresis)) {
                dryCoolingRunCallback(false);
                wellCoolingRunCallback(true);
            } else if (delta > (switchTemperature + hysteresis)) {
                wellCoolingRunCallback(false);
                dryCoolingRunCallback(true);
            }
        }
    });

    defineRule("asic-cooling-controller-target-" + name, {
        whenChanged: [
            targetTemperatureTopicName
        ],
        then: function (newValue) {
            dryCoolingSetTemperatureCallback(newValue);
            wellCoolingSetTemperatureCallback(newValue);
            poolCoolingSetTemperatureCallback(newValue);
        }
    });
}

makeASICCoolingController(
    "T21",
    "wb-m1w2_107/External Sensor 1",
    function (newValue) {
        dev["pid-controller-dry-cooling/set_point"] = newValue;
    },
    function (newValue) {
        dev["pid-controller-esbe-actuator-asic/set_point"] = newValue;
    },
    function (newValue) {
        dev["pid-controller-esbe-actuator-asic/set_point"] = newValue;
    },
    function (enabled) {
        log("dry cooling set " + enabled);
        dev["pid-controller-dry-cooling/enabled"] = enabled;
        dev["pid-controller-dry-cooling-pump/enabled"] = enabled;
        if (enabled) {
            dev["pump-pwm-controller-dry-cooling-tower/state"] = 1;
        } else {
            dev["pump-pwm-controller-dry-cooling-tower/state"] = 2;
            dev["pid-controller-dry-cooling/power"] = 0;
        }
    },
    function (enabled) {
        log("well cooling set " + enabled);
        dev["start-stop-controller-well-cooling/enabled"] = enabled;
        dev["pid-controller-esbe-actuator-asic/enabled"] = enabled;
        if (enabled) {
            dev["pump-pwm-controller-well/state"] = 1;
        } else {
            dev["pump-pwm-controller-well/state"] = 2;
            dev["pid-controller-esbe-actuator-asic/power"] = 100;
        }
    },
    function (enabled) {
        log("pool cooling set " + enabled);
        dev["pid-controller-pool-heat-exchanger-pump/enabled"] = enabled;
        dev["pid-controller-esbe-actuator-asic/enabled"] = enabled;
        if (enabled) {
            dev["pump-pwm-controller-pool-heat-exchanger/state"] = 1;
        } else {
            dev["pump-pwm-controller-pool-heat-exchanger/state"] = 2;
            dev["pid-controller-esbe-actuator-asic/power"] = 100;
        }
    }
);