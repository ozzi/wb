function makePoolHeatController(
    name,
    inletTemperatureTopicName,
    outletTemperatureTopicName,
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
            inlet_temperature: {
                title: "inlet temperature",
                type: "value",
                value: 20,
                readonly: true
            },
            outlet_temperature: {
                title: "outlet temperature",
                type: "value",
                value: 20,
                readonly: true
            },
            temperature_delta: {
                title: "temperature delta (outlet - inlet)",
                type: "value",
                value: 0,
                readonly: true
            },
            outlet_offset: {
                title: "outlet offset (calibration)",
                type: "value",
                value: 0,
                readonly: true
            },
            calibrate: {
                title: "calibrate (set delta to zero)",
                type: "pushbutton"
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
    var inletTopicName = deviceName + "/inlet_temperature";
    var outletTopicName = deviceName + "/outlet_temperature";
    var deltaTopicName = deviceName + "/temperature_delta";
    var outletOffsetTopicName = deviceName + "/outlet_offset";
    var calibrateTopicName = deviceName + "/calibrate";
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
        var inletTemperature = dev[inletTemperatureTopicName];
        var outletTemperature = dev[outletTemperatureTopicName];
        var outletOffset = dev[outletOffsetTopicName];
        var oldHeatRequest = dev[heatRequestTopicName];
        var newHeatRequest = oldHeatRequest;
        var newStatus = dev[statusTopicName];

        if (!isValidTemperature(inletTemperature)) {
            log.warning("[pool-heat-ctrl-{}] invalid inlet temperature: {}", name, inletTemperature);
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
            if (inletTemperature < (targetTemperature - hysteresis)) {
                newHeatRequest = true;
                newStatus = STATUS_HEATING;
            } else if (inletTemperature > (targetTemperature + hysteresis)) {
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
        if (isValidTemperature(inletTemperature)) {
            dev[inletTopicName] = inletTemperature;
        }
        if (isValidTemperature(outletTemperature)) {
            dev[outletTopicName] = outletTemperature;
            if (isValidTemperature(inletTemperature)) {
                dev[deltaTopicName] = (outletTemperature + outletOffset) - inletTemperature;
            }
        }
    }

    defineRule("recalculate-" + name, {
        whenChanged: [
            modeTopicName,
            targetTopicName,
            inletTemperatureTopicName,
            outletTemperatureTopicName,
            poolFiltrationModeTopicName,
            hysteresisTopicName
        ],
        then: function () {
            applyHeatState();
        }
    });

    defineRule("calibrate-" + name, {
        whenChanged: [calibrateTopicName],
        then: function () {
            var inletTemperature = dev[inletTemperatureTopicName];
            var outletTemperature = dev[outletTemperatureTopicName];
            if (!isValidTemperature(inletTemperature) || !isValidTemperature(outletTemperature)) {
                log.warning("[pool-heat-ctrl-{}] calibration skipped: invalid sensor data", name);
                return;
            }
            var newOffset = inletTemperature - outletTemperature;
            log.info("[pool-heat-ctrl-{}] calibration: outlet_offset set to {}", name, newOffset);
            dev[outletOffsetTopicName] = newOffset;
            dev[deltaTopicName] = 0;
        }
    });

    applyHeatState();
}

makePoolHeatController(
    "outdoor",
    "wb-m1w2_118/External Sensor 1",
    "wb-m1w2_118/External Sensor 2",
    "pool-filtration-ctrl-outdoor/mode"
);
