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
            energy_consumed: {
                title: "energy consumed (kWh)",
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
            reset_energy: {
                title: "reset energy counter",
                type: "pushbutton"
            },
            hysteresis: {
                title: "hysteresis",
                type: "value",
                value: defaultHysteresis,
                readonly: false
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
    var hysteresisTopicName = deviceName + "/hysteresis";
    var inletTopicName = deviceName + "/inlet_temperature";
    var outletTopicName = deviceName + "/outlet_temperature";
    var deltaTopicName = deviceName + "/temperature_delta";
    var deltaValidTopicName = deviceName + "/delta_valid";
    var temperaturesValidTopicName = deviceName + "/temperatures_valid";
    var flowRateTopicName = deviceName + "/flow_rate";
    var energyConsumedTopicName = deviceName + "/energy_consumed";
    var outletOffsetTopicName = deviceName + "/outlet_offset";
    var calibrateTopicName = deviceName + "/calibrate";
    var resetEnergyTopicName = deviceName + "/reset_energy";
    var statusTopicName = deviceName + "/status";

    var settleTimer = null;
    var energyLastUpdate = null;

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
        var delta = dev[deltaTopicName];
        dev[deltaValidTopicName] = (temperaturesValid === true && outletOk === true && typeof delta === "number" && !isNaN(delta) && delta > 0);
        applyFlowRate();
    }

    function applyTemperaturesValid(value) {
        dev[temperaturesValidTopicName] = value;
        applyDeltaValid();
        applyHeatState();
    }

    function initTemperaturesValid() {
        var filtrationMode = dev[poolFiltrationModeTopicName];
        if (isFiltrationActive(filtrationMode)) {
            log.info("[pool-heat-ctrl-{}] filtration already active on start, temperatures_valid = true", name);
            dev[temperaturesValidTopicName] = true;
        } else {
            dev[temperaturesValidTopicName] = false;
        }
    }

    function tickEnergy() {
        var now = Date.now();

        // Сбрасываем lastUpdate при первом тике чтобы избежать огромного dt после перезапуска
        if (energyLastUpdate === null) {
            energyLastUpdate = now;
            return;
        }

        var power = dev[heaterPowerTopicName];
        var deltaValid = dev[deltaValidTopicName];
        var delta = dev[deltaTopicName];

        var isHeating = (dev[statusTopicName] === STATUS_HEATING) &&
                        (typeof power === "number" && !isNaN(power) && power > 0) &&
                        (deltaValid === true) &&
                        (delta > 0);

        if (isHeating) {
            var dtHours = (now - energyLastUpdate) / 3600000;
            var addedKwh = (power / 1000) * dtHours;
            dev[energyConsumedTopicName] = dev[energyConsumedTopicName] + addedKwh;
        }

        energyLastUpdate = now;
    }

    function applyHeatState() {
        var mode = dev[modeTopicName];
        var poolFiltrationMode = dev[poolFiltrationModeTopicName];
        var inletTemperature = dev[inletTemperatureTopicName];
        var outletTemperature = dev[outletTemperatureTopicName];
        var outletOffset = dev[outletOffsetTopicName];
        var temperaturesValid = dev[temperaturesValidTopicName];
        var newStatus = dev[statusTopicName];

        if (!isValidFiltrationMode(poolFiltrationMode)) {
            log.warning("[pool-heat-ctrl-{}] filtration mode unavailable", name);
            newStatus = STATUS_ERROR_NO_FILTRATION_DATA;
        } else if (!isValidTemperature(inletTemperature) || dev[inletTemperatureOkTopicName] !== true) {
            log.warning("[pool-heat-ctrl-{}] invalid inlet temperature or sensor error", name);
            newStatus = STATUS_ERROR_SENSOR;
        } else if (mode !== 1) {
            newStatus = STATUS_OFF;
        } else if (!isFiltrationActive(poolFiltrationMode)) {
            newStatus = STATUS_STANDBY;
        } else if (!temperaturesValid) {
            newStatus = STATUS_TEMPERATURES_INVALID;
        } else {
            var targetTemperature = dev[targetTopicName];
            var hysteresis = dev[hysteresisTopicName];
            if (!isValidHysteresis(hysteresis)) {
                log.warning("[pool-heat-ctrl-{}] invalid hysteresis: {}, using default: {}", name, hysteresis, defaultHysteresis);
                hysteresis = defaultHysteresis;
            }
            if (inletTemperature < (targetTemperature - hysteresis)) {
                newStatus = STATUS_HEATING;
            } else if (inletTemperature > (targetTemperature + hysteresis)) {
                newStatus = STATUS_IDLE;
            } else {
                // в зоне гистерезиса — сохраняем предыдущий статус если он был HEATING или IDLE
                var oldStatus = dev[statusTopicName];
                if (oldStatus !== STATUS_HEATING && oldStatus !== STATUS_IDLE) {
                    newStatus = STATUS_IDLE;
                }
                // иначе newStatus остаётся равным oldStatus
            }
        }

        if (newStatus !== dev[statusTopicName]) {
            log.info("[pool-heat-ctrl-{}] status: {} -> {}", name, dev[statusTopicName], newStatus);
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
                applyDeltaValid();
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
        }
    });

    // TODO: если heat_source = 1 (электрокотёл), heaterPowerTopicName указывает на мощность ASIC,
    // что не отражает реальную мощность нагрева. Учёт энергии в этом режиме будет некорректным.
    setInterval(function () {
        tickEnergy();
    }, 60 * 1000);

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

    defineRule("reset-energy-" + name, {
        whenChanged: [resetEnergyTopicName],
        then: function () {
            log.info("[pool-heat-ctrl-{}] energy counter reset", name);
            dev[energyConsumedTopicName] = 0;
            energyLastUpdate = Date.now();
        }
    });

    // Инициализация при старте
    initTemperaturesValid();
    applyDeltaValid();
    applyHeatState();
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
