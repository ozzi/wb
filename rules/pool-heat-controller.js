function makePoolHeatController(
    name,
    inletTemperatureTopicName,
    inletTemperatureOkTopicName,
    outletTemperatureTopicName,
    outletTemperatureOkTopicName,
    poolFiltrationModeTopicName,
    temperatureSettleMinutes,
    heaterPowerTopicName
) {
    var deviceName = "pool-heat-ctrl-" + name;
    var defaultHysteresis = 0.5;

    var STATUS_OFF                      = 0;
    var STATUS_STANDBY                  = 1;
    var STATUS_IDLE                     = 2;
    var STATUS_HEATING                  = 3;
    var STATUS_ERROR_SENSOR             = 4;
    var STATUS_ERROR_NO_FILTRATION_DATA = 5;
    var STATUS_TEMPERATURES_INVALID     = 6;

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
            delta_valid: {
                title: "delta valid",
                type: "switch",
                value: false,
                readonly: true
            },
            temperatures_valid: {
                title: "temperatures valid",
                type: "switch",
                value: false,
                readonly: true
            },
            flow_rate: {
                title: "flow rate (m3/h)",
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
                    5: {en: "Error: no filtration data",  ru: "Ошибка: нет данных фильтрации"},
                    6: {en: "Waiting: temperature settle", ru: "Ожидание: прогрев датчиков"}
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
    var deltaValidTopicName = deviceName + "/delta_valid";
    var temperaturesValidTopicName = deviceName + "/temperatures_valid";
    var flowRateTopicName = deviceName + "/flow_rate";
    var outletOffsetTopicName = deviceName + "/outlet_offset";
    var calibrateTopicName = deviceName + "/calibrate";
    var statusTopicName = deviceName + "/status";

    var settleTimer = null;

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

    function isFiltrationActive(filtrationMode) {
        return filtrationMode === 1;
    }

    function cancelSettleTimer() {
        if (settleTimer !== null) {
            clearTimeout(settleTimer);
            settleTimer = null;
        }
    }

    function applyFlowRate() {
        var deltaValid = dev[deltaValidTopicName];
        if (deltaValid !== true) {
            dev[flowRateTopicName] = 0;
            return;
        }
        var power = dev[heaterPowerTopicName];
        var delta = dev[deltaTopicName];
        if (typeof power !== "number" || isNaN(power) || power <= 0 || delta <= 0) {
            dev[flowRateTopicName] = 0;
            return;
        }
        // Q [м³/ч] = P [Вт] / (ρ [кг/м³] * Cp [Дж/(кг·К)] * ΔT [°C]) * 3600
        var flowRate = (power / (1000 * 4186 * delta)) * 3600;
        dev[flowRateTopicName] = flowRate;
    }

    function applyDeltaValid() {
        var temperaturesValid = dev[temperaturesValidTopicName];
        var outletOk = dev[outletTemperatureOkTopicName];
        dev[deltaValidTopicName] = (temperaturesValid === true && outletOk === true);
        applyFlowRate();
    }

    function applyTemperaturesValid(value) {
        dev[temperaturesValidTopicName] = value;
        applyDeltaValid();
        applyHeatState();
    }

    function applyHeatState() {
        var mode = dev[modeTopicName];
        var poolFiltrationMode = dev[poolFiltrationModeTopicName];
        var inletTemperature = dev[inletTemperatureTopicName];
        var outletTemperature = dev[outletTemperatureTopicName];
        var outletOffset = dev[outletOffsetTopicName];
        var temperaturesValid = dev[temperaturesValidTopicName];
        var oldHeatRequest = dev[heatRequestTopicName];
        var newHeatRequest = oldHeatRequest;
        var newStatus = dev[statusTopicName];

        if (!isValidFiltrationMode(poolFiltrationMode)) {
            log.warning("[pool-heat-ctrl-{}] filtration mode unavailable", name);
            newHeatRequest = false;
            newStatus = STATUS_ERROR_NO_FILTRATION_DATA;
        } else if (!isValidTemperature(inletTemperature) || dev[inletTemperatureOkTopicName] !== true) {
            log.warning("[pool-heat-ctrl-{}] invalid inlet temperature or sensor error", name);
            newHeatRequest = false;
            newStatus = STATUS_ERROR_SENSOR;
        } else if (mode !== 1) {
            newHeatRequest = false;
            newStatus = STATUS_OFF;
        } else if (!isFiltrationActive(poolFiltrationMode)) {
            newHeatRequest = false;
            newStatus = STATUS_STANDBY;
        } else if (!temperaturesValid) {
            newHeatRequest = false;
            newStatus = STATUS_TEMPERATURES_INVALID;
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
                var delta = (outletTemperature + outletOffset) - inletTemperature;
                dev[deltaTopicName] = delta;
                applyFlowRate();
            }
        }
    }

    defineRule("recalculate-" + name, {
        whenChanged: [
            modeTopicName,
            targetTopicName,
            inletTemperatureTopicName,
            inletTemperatureOkTopicName,
            outletTemperatureTopicName,
            outletTemperatureOkTopicName,
            poolFiltrationModeTopicName,
            hysteresisTopicName,
            heaterPowerTopicName
        ],
        then: function () {
            applyHeatState();
            applyDeltaValid();
        }
    });

    defineRule("filtration-watch-" + name, {
        whenChanged: [poolFiltrationModeTopicName],
        then: function () {
            var filtrationMode = dev[poolFiltrationModeTopicName];
            if (isFiltrationActive(filtrationMode)) {
                log.info("[pool-heat-ctrl-{}] filtration started, waiting {} min for temperatures to settle", name, temperatureSettleMinutes);
                cancelSettleTimer();
                settleTimer = setTimeout(function () {
                    settleTimer = null;
                    var inletOk = dev[inletTemperatureOkTopicName];
                    if (inletOk === true) {
                        log.info("[pool-heat-ctrl-{}] temperatures settled and inlet sensor ok, temperatures_valid = true", name);
                        applyTemperaturesValid(true);
                    } else {
                        log.warning("[pool-heat-ctrl-{}] temperatures settle timeout but inlet sensor not ok", name);
                        applyTemperaturesValid(false);
                    }
                }, temperatureSettleMinutes * 60 * 1000);
            } else {
                log.info("[pool-heat-ctrl-{}] filtration stopped, temperatures_valid = false", name);
                cancelSettleTimer();
                applyTemperaturesValid(false);
            }
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

    // При старте: если фильтрация уже активна — сразу считаем датчики валидными
    var initialFiltrationMode = dev[poolFiltrationModeTopicName];
    if (isFiltrationActive(initialFiltrationMode)) {
        log.info("[pool-heat-ctrl-{}] filtration already active on start, temperatures_valid = true", name);
        applyTemperaturesValid(true);
    } else {
        applyDeltaValid();
        applyHeatState();
    }
}

makePoolHeatController(
    "outdoor",
    "wb-m1w2_118/External Sensor 2",
    "wb-m1w2_118/External Sensor 2 OK",
    "wb-m1w2_118/External Sensor 1",
    "wb-m1w2_118/External Sensor 1 OK",
    "pool-filtration-ctrl-outdoor/mode",
    5,
    "ANTMINER S21e/power"
);
