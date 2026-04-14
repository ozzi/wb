function makePoolHeatController(
    name,
    currentTemperatureTopicName,
    poolFiltrationModeTopicName
) {
    var deviceName = "pool-heat-ctrl-" + name;
    var defaultHysteresis = 0.5;

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
                value: 28,
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
                value: defaultHysteresis,
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

    function isValidTemperature(value) {
        return value !== null && value !== undefined && typeof value === "number" && !isNaN(value);
    }

    function isValidFiltrationMode(value) {
        return value !== null && value !== undefined;
    }

    function isValidHysteresis(value) {
        return value !== null && value !== undefined && typeof value === "number" && !isNaN(value) && value >= 0;
    }

    function isControllerActive(mode, filtrationMode) {
        return mode === 1 && filtrationMode === 1;
    }

    function applyHeatState() {
        var mode = dev[modeTopicName];
        var poolFiltrationMode = dev[poolFiltrationModeTopicName];
        var currentTemperature = dev[currentTemperatureTopicName];
        var oldHeatRequest = dev[heatRequestTopicName];
        var newHeatRequest = oldHeatRequest;

        if (!isValidTemperature(currentTemperature)) {
            log.warning("[pool-heat-ctrl-{}] invalid temperature: {}", name, currentTemperature);
            newHeatRequest = false;
        } else if (!isValidFiltrationMode(poolFiltrationMode)) {
            log.warning("[pool-heat-ctrl-{}] filtration mode unavailable", name);
            newHeatRequest = false;
        } else if (isControllerActive(mode, poolFiltrationMode)) {
            var targetTemperature = dev[targetTopicName];
            var hysteresis = dev[hysteresisTopicName];
            if (!isValidHysteresis(hysteresis)) {
                log.warning("[pool-heat-ctrl-{}] invalid hysteresis: {}, using default: {}", name, hysteresis, defaultHysteresis);
                hysteresis = defaultHysteresis;
            }
            if (currentTemperature < (targetTemperature - hysteresis)) {
                newHeatRequest = true;
            } else if (currentTemperature > (targetTemperature + hysteresis)) {
                newHeatRequest = false;
            }
        } else {
            newHeatRequest = false;
        }

        if (oldHeatRequest != newHeatRequest) {
            log.info("[pool-heat-ctrl-{}] heat_request: {} -> {}", name, oldHeatRequest, newHeatRequest);
            dev[heatRequestTopicName] = newHeatRequest;
        }
        if (isValidTemperature(currentTemperature)) {
            dev[currentTopicName] = currentTemperature;
        }
    }

    defineRule("recalculate-" + name, {
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
