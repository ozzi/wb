function makePoolHeatController(
    name,
    currentTemperatureTopicName,
    poolFiltrationModeTopicName,
    heatOnClosure,
    heatOffClosure
) {
    var deviceName = "pool-heat-ctrl-" + name;
    defineVirtualDevice(deviceName, {
        title: "Pool Heat Controller - " + name,
        cells: {
            mode: {
                title: "mode",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                  0: {en: "Off", ru: "Выключено"},
                  1: {en: "Heat", ru: "Нагрев"}
                }
            },
            target: {
                title: "target temperature",
                type: "value",
                value: 20,
                readonly: false
            },
            current: {
                title: "current temperature",
                type: "value",
                type: "value",
                value: 20,
                readonly: true
            },
            tolerance: {
                title: "tolerance",
                type: "value",
                value: 0,
                readonly: false
            },
            active: {
                title: "active",
                type: "switch",
                value: false,
                readonly: true
            }
        }
    });

    var modeTopicName = deviceName + "/mode";
    var targetTopicName = deviceName + "/target";
    var activeTopicName = deviceName + "/active";
    var hysteresisTopicName = deviceName + "/tolerance";
    var currentTopicName = deviceName + "/current";

    defineRule("mode-changed-" + name, {
        whenChanged: [
            modeTopicName,
            targetTopicName,
            currentTemperatureTopicName,
            poolFiltrationModeTopicName,
            hysteresisTopicName
        ],
        then: function () {
            var mode = dev[modeTopicName];
            var poolFiltrationMode = dev[poolFiltrationModeTopicName];
            var currentTemperature = dev[currentTemperatureTopicName];
            var oldActiveValue = dev[activeTopicName];
            var newActiveValue = false;
            if (mode == 1 && poolFiltrationMode == 1) {
                var targetTemperature = dev[targetTopicName];
                var hysteresis = dev[hysteresisTopicName];
                if (currentTemperature < (targetTemperature - hysteresis)) {
                    newActiveValue = true;
                } else if (currentTemperature > (targetTemperature + hysteresis)) {
                    newActiveValue = false;
                }
            } else {
                newActiveValue = false;
            }
            if (oldActiveValue != newActiveValue) {
                dev[activeTopicName] = newActiveValue;
            }
            dev[currentTopicName] = currentTemperature;
        }
    });

    defineRule("active-changed-" + name, {
        whenChanged: [
            activeTopicName
        ],
        then: function (newValue) {
            if (newValue == false) {
                heatOffClosure();
            } else {
                heatOnClosure();
            }
        }
    });
}

makePoolHeatController(
    "outdoor",
    "wb-m1w2_69/External Sensor 1",
    "pool-filtration-ctrl-outdoor/mode",
    function () {
        dev["ASIC-cooling-controller-T21/mode"] = 4;
        dev["calculated-flow-sensor-POOL FILTR/activated"] = true;
        dev["ANTMINER T21-1/schedule_mode"] = "pool-heat";
        dev["ANTMINER T21-2/schedule_mode"] = "pool-heat";
    },
    function () {
        dev["ASIC-cooling-controller-T21/mode"] = 1;
        dev["calculated-flow-sensor-POOL FILTR/activated"] = false;
        dev["ANTMINER T21-1/schedule_mode"] = "peak-offpeak-night";
        dev["ANTMINER T21-2/schedule_mode"] = "peak-offpeak-night";
    }
);