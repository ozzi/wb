function makePoolHeatController(
    name,
    currentTemperatureTopicName,
    poolFiltrationModeTopicName
) {
    var deviceName = "pool-heat-ctrl-" + name;
    var defaultHysteresis = 0.5;

    var STATUS_OFF                      = 0;
    var STATUS_STANDBY                  = 1;
    var STATUS_IDLE                     = 2;
    var STATUS_HEATING                  = 3;
    var STATUS_ERROR_SENSOR             = 4;
    var STATUS_ERROR_NO_FILTRATION_DATA = 5;

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
            },
            status: {
                title: "status",
                type: "value",
                value: STATUS_OFF,
                readonly: true,
                enum: {
                    0: {en: "Off",                        ru: "Выключено"},
                    1: {en: "Standby",                    ru: "Ожидание фильтрации"},
                    2: {en: "Idle",                       ru: "Температура достигнута"},
                    3: {en: "Heating",                    ru: "Нагрев"},
                    4: {en: "Error: sensor",              ru: "Ошибка датчика"},
                    5: {en: "Error: no filtration data",  ru: "Ошибка: нет данных фильтрации"}
                }
            }
        }
    });

    var modeTopicName = deviceName + "/mode";
    var targetTopicName = deviceName + "/target";
    var heatRequestTopicName = deviceName + "/heat_request";
    var hysteresisTopicName = deviceName + "/hysteresis";
    var currentTopicName = deviceName + "/current";
    var statusTopicName = deviceName + "/status";

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
        var newStatus = dev[statusTopicName];

        if (!isValidTemperature(currentTemperature)) {
            log.warning("[pool-heat-ctrl-{}] invalid temperature: {}", name, currentTemperature);
            newHeatRequest = false;
            newStatus = STATUS_ERROR_SENSOR;
        } else if (!isValidFiltrationMode(poolFiltrationMode)) {
            log.warning("[pool-heat-ctrl-{}] filtration mode unavailable", name);
            newHeatRequest = false;
            newStatus = STATUS_ERROR_NO_FILTRATION_DATA;
        } else if (mode !== 1) {
            newHeatRequest = false;
            newStatus = STATUS_OFF;
        } else if (!isControllerActive(mode, poolFiltrationMode)) {
            newHeatRequest = false;
            newStatus = STATUS_STANDBY;
        } else {
            var targetTemperature = dev[targetTopicName];
            var hysteresis = dev[hysteresisTopicName];
            if (!isValidHysteresis(hysteresis)) {
                log.warning("[pool-heat-ctrl-{}] invalid hysteresis: {}, using default: {}", name, hysteresis, defaultHysteresis);
                hysteresis = defaultHysteresis;
            }
            if (currentTemperature < (targetTemperature - hysteresis)) {
                newHeatRequest = true;
                newStatus = STATUS_HEATING;
            } else if (currentTemperature > (targetTemperature + hysteresis)) {
                newHeatRequest = false;
                newStatus = STATUS_IDLE;
            } else {
                newStatus = newHeatRequest ? STATUS_HEATING : STATUS_IDLE;
            }
        }

        if (oldHeatRequest != newHeatRequest) {
            log.info("[pool-heat-ctrl-{}] heat_request: {} -> {}", name, oldHeatRequest, newHeatRequest);
            dev[heatRequestTopicName] = newHeatRequest;
        }
        dev[statusTopicName] = newStatus;
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
    "wb-m1w2_118/External Sensor 1",
    "pool-filtration-ctrl-outdoor/mode"
);
