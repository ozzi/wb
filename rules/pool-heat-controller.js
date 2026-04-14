function makePoolHeatController(
    name,
    currentTemperatureTopicName,
    poolFiltrationModeTopicName
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
                value: 20,
                readonly: true
            },
            hysteresis: {
                title: "hysteresis",
                type: "value",
                value: 0.5,
                readonly: false
            },
            heat_request: {
                title: "heat request",
                type: "switch",
                value: false,
                readonly: true
            }
        }
    });

    var modeTopicName = deviceName + "/mode";
    var targetTopicName = deviceName + "/target";
    var heatRequestTopicName = deviceName + "/heat_request";
    var hysteresisTopicName = deviceName + "/hysteresis";
    var currentTopicName = deviceName + "/current";

    function applyHeatState() {
        var mode = dev[modeTopicName];
        var poolFiltrationMode = dev[poolFiltrationModeTopicName];
        var currentTemperature = dev[currentTemperatureTopicName];
        var oldHeatRequest = dev[heatRequestTopicName];
        var newHeatRequest = oldHeatRequest;
        if (mode == 1 && poolFiltrationMode == 1) {
            var targetTemperature = dev[targetTopicName];
            var hysteresis = dev[hysteresisTopicName];
            if (currentTemperature < (targetTemperature - hysteresis)) {
                newHeatRequest = true;
            } else if (currentTemperature > (targetTemperature + hysteresis)) {
                newHeatRequest = false;
            }
        } else {
            newHeatRequest = false;
        }
        if (oldHeatRequest != newHeatRequest) {
            dev[heatRequestTopicName] = newHeatRequest;
        }
        dev[currentTopicName] = currentTemperature;
    }

    defineRule("mode-changed-" + name, {
        whenChanged: [
            modeTopicName,
            targetTopicName,
            currentTemperatureTopicName,
            poolFiltrationModeTopicName,
            hysteresisTopicName
        ],
        then: function () {
            applyHeatState();
        }
    });

    applyHeatState();
}

makePoolHeatController(
    "outdoor",
    "wb-m1w2_69/External Sensor 1",
    "pool-filtration-ctrl-outdoor/mode"
);
