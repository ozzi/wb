function makeSekoDosingController(
    name,
    relayTopicName,
    filtrationModeTopicName,
    alarmTopicName,
    phMinusSensorTopicName,
    chlorineSensorTopicName,
    phPumpSensorTopicName,
    chlorinePumpSensorTopicName
) {
    var deviceName = "seko-dosing-ctrl-" + name;

    var cells = {
        mode: {
            title: "mode",
            type: "value",
            value: 0,
            readonly: false,
            enum: {
                0: { en: "Allowed",    ru: "Разрешено" },
                1: { en: "Prohibited", ru: "Запрещено" },
                2: { en: "Bathing",    ru: "Купание" }
            }
        },
        bathing_duration: {
            title: "bathing duration",
            type: "value",
            unit: "мин",
            value: 30,
            readonly: false
        },
        bathing_remaining: {
            title: "bathing remaining",
            type: "value",
            unit: "мин",
            value: 0,
            readonly: true
        },
        dosing_active: {
            title: "dosing active",
            type: "switch",
            value: false,
            readonly: true
        },
        status: {
            title: "status",
            type: "text",
            value: "idle",
            readonly: true
        },
        ph_calibration_interval: {
            title: "ph calibration interval",
            type: "value",
            unit: "дн",
            value: 30,
            readonly: false
        },
        ph_calibrated_at: {
            title: "ph calibrated at",
            type: "value",
            value: 0,
            readonly: true
        },
        ph_needs_calibration: {
            title: "ph needs calibration",
            type: "switch",
            value: false,
            readonly: true
        },
        ph_calibrate_btn: {
            title: "ph calibrated",
            type: "pushbutton",
            readonly: false
        },
        redox_calibration_interval: {
            title: "redox calibration interval",
            type: "value",
            unit: "дн",
            value: 30,
            readonly: false
        },
        redox_calibrated_at: {
            title: "redox calibrated at",
            type: "value",
            value: 0,
            readonly: true
        },
        redox_needs_calibration: {
            title: "redox needs calibration",
            type: "switch",
            value: false,
            readonly: true
        },
        redox_calibrate_btn: {
            title: "redox calibrated",
            type: "pushbutton",
            readonly: false
        }
    };

    if (phMinusSensorTopicName) {
        cells.ph_minus_empty = {
            title: "ph minus empty",
            type: "switch",
            value: false,
            readonly: true
        };
    }

    if (chlorineSensorTopicName) {
        cells.chlorine_empty = {
            title: "chlorine empty",
            type: "switch",
            value: false,
            readonly: true
        };
    }

    if (phPumpSensorTopicName) {
        cells.ph_pump_flow_rate = {
            title: "ph pump flow rate",
            type: "value",
            unit: "л/ч",
            value: 1.5,
            readonly: false
        };
        cells.ph_pump_duty_cycle = {
            title: "ph pump duty cycle",
            type: "value",
            unit: "%",
            value: 0,
            readonly: true
        };
        cells.ph_pump_daily_runtime = {
            title: "ph pump daily runtime",
            type: "value",
            unit: "мин",
            value: 0,
            readonly: true
        };
        cells.ph_pump_total_volume = {
            title: "ph pump total volume",
            type: "value",
            unit: "л",
            value: 0,
            readonly: true
        };
        cells.ph_pump_reset_btn = {
            title: "ph pump reset total",
            type: "pushbutton",
            readonly: false
        };
    }

    if (chlorinePumpSensorTopicName) {
        cells.chlorine_pump_flow_rate = {
            title: "chlorine pump flow rate",
            type: "value",
            unit: "л/ч",
            value: 1.5,
            readonly: false
        };
        cells.chlorine_pump_duty_cycle = {
            title: "chlorine pump duty cycle",
            type: "value",
            unit: "%",
            value: 0,
            readonly: true
        };
        cells.chlorine_pump_daily_runtime = {
            title: "chlorine pump daily runtime",
            type: "value",
            unit: "мин",
            value: 0,
            readonly: true
        };
        cells.chlorine_pump_total_volume = {
            title: "chlorine pump total volume",
            type: "value",
            unit: "л",
            value: 0,
            readonly: true
        };
        cells.chlorine_pump_reset_btn = {
            title: "chlorine pump reset total",
            type: "pushbutton",
            readonly: false
        };
    }

    defineVirtualDevice(deviceName, {
        title: "Seko Dosing Controller - " + name,
        cells: cells
    });

    var modeTopicName             = deviceName + "/mode";
    var bathingDurationTopicName  = deviceName + "/bathing_duration";
    var bathingRemainingTopicName = deviceName + "/bathing_remaining";
    var dosingActiveTopicName     = deviceName + "/dosing_active";
    var statusTopicName           = deviceName + "/status";
    var phMinusEmptyTopicName     = phMinusSensorTopicName     ? deviceName + "/ph_minus_empty"  : null;
    var chlorineEmptyTopicName    = chlorineSensorTopicName    ? deviceName + "/chlorine_empty"  : null;
    var phCalibrationIntervalTopicName = deviceName + "/ph_calibration_interval";
    var phCalibratedAtTopicName        = deviceName + "/ph_calibrated_at";
    var phNeedsCalibrationTopicName    = deviceName + "/ph_needs_calibration";
    var phCalibrateBtnTopicName        = deviceName + "/ph_calibrate_btn";
    var redoxCalibrationIntervalTopicName = deviceName + "/redox_calibration_interval";
    var redoxCalibratedAtTopicName        = deviceName + "/redox_calibrated_at";
    var redoxNeedsCalibrationTopicName    = deviceName + "/redox_needs_calibration";
    var redoxCalibrateBtnTopicName        = deviceName + "/redox_calibrate_btn";

    var phPumpFlowRateTopicName     = phPumpSensorTopicName      ? deviceName + "/ph_pump_flow_rate"      : null;
    var phPumpDutyCycleTopicName    = phPumpSensorTopicName      ? deviceName + "/ph_pump_duty_cycle"     : null;
    var phPumpDailyRuntimeTopicName = phPumpSensorTopicName      ? deviceName + "/ph_pump_daily_runtime"  : null;
    var phPumpTotalVolumeTopicName  = phPumpSensorTopicName      ? deviceName + "/ph_pump_total_volume"   : null;
    var phPumpResetBtnTopicName     = phPumpSensorTopicName      ? deviceName + "/ph_pump_reset_btn"      : null;

    var chlorinePumpFlowRateTopicName     = chlorinePumpSensorTopicName ? deviceName + "/chlorine_pump_flow_rate"     : null;
    var chlorinePumpDutyCycleTopicName    = chlorinePumpSensorTopicName ? deviceName + "/chlorine_pump_duty_cycle"    : null;
    var chlorinePumpDailyRuntimeTopicName = chlorinePumpSensorTopicName ? deviceName + "/chlorine_pump_daily_runtime" : null;
    var chlorinePumpTotalVolumeTopicName  = chlorinePumpSensorTopicName ? deviceName + "/chlorine_pump_total_volume"  : null;
    var chlorinePumpResetBtnTopicName     = chlorinePumpSensorTopicName ? deviceName + "/chlorine_pump_reset_btn"     : null;

    var bathingTimer     = null;
    var bathingTickTimer = null;
    var bathingEndTime   = null;

    function cancelBathingTimers() {
        if (bathingTimer !== null) {
            clearTimeout(bathingTimer);
            bathingTimer = null;
        }
        if (bathingTickTimer !== null) {
            clearInterval(bathingTickTimer);
            bathingTickTimer = null;
        }
        bathingEndTime = null;
        dev[bathingRemainingTopicName] = 0;
    }

    function applyStatus() {
        var bathingRemaining = dev[bathingRemainingTopicName];
        var dosingActive     = dev[dosingActiveTopicName];
        var alarm            = alarmTopicName ? dev[alarmTopicName] : false;

        if (bathingRemaining > 0) {
            dev[statusTopicName] = "bathing";
        } else if (!dosingActive) {
            dev[statusTopicName] = "idle";
        } else if (alarm === true) {
            // Аварию показываем только если дозирование было активно —
            // при отключении реле станция сама уходит в аварию (нет протока)
            dev[statusTopicName] = "alarm";
        } else {
            dev[statusTopicName] = "ok";
        }
    }

    function applyRelay() {
        var mode             = dev[modeTopicName];
        var filtrationMode   = dev[filtrationModeTopicName];
        var bathingRemaining = dev[bathingRemainingTopicName];
        var alarm            = alarmTopicName ? dev[alarmTopicName] : false;

        var allowed = (mode === 0) &&
                      (filtrationMode === 1) &&
                      (bathingRemaining === 0) &&
                      (alarm !== true);

        dev[dosingActiveTopicName] = allowed;
        dev[relayTopicName] = allowed;
        applyStatus();
    }

    function startBathing() {
        cancelBathingTimers();

        var duration = dev[bathingDurationTopicName];
        if (!duration || duration <= 0) { duration = 30; }

        bathingEndTime = Date.now() + duration * 60 * 1000;
        dev[bathingRemainingTopicName] = duration;

        applyRelay();

        // Тик каждую минуту — обновляем оставшееся время
        bathingTickTimer = setInterval(function () {
            if (bathingEndTime === null) { return; }
            var remaining = Math.ceil((bathingEndTime - Date.now()) / 60000);
            if (remaining < 0) { remaining = 0; }
            dev[bathingRemainingTopicName] = remaining;
        }, 60 * 1000);

        // По истечении — возвращаемся в режим allowed
        bathingTimer = setTimeout(function () {
            bathingTimer = null;
            cancelBathingTimers();
            dev[modeTopicName] = 0;
        }, duration * 60 * 1000);
    }

    defineRule("dosing-mode-changed-" + name, {
        whenChanged: [modeTopicName],
        then: function (newValue) {
            if (newValue !== 2) {
                cancelBathingTimers();
            }
            if (newValue === 2) {
                startBathing();
            } else {
                applyRelay();
            }
        }
    });

    defineRule("dosing-filtration-changed-" + name, {
        whenChanged: [filtrationModeTopicName],
        then: function () {
            applyRelay();
        }
    });

    if (alarmTopicName) {
        defineRule("dosing-alarm-changed-" + name, {
            whenChanged: [alarmTopicName],
            then: function (newValue) {
                // Игнорируем аварию если дозирование не активно —
                // станция уходит в аварию когда мы сами отключаем реле (нет протока)
                if (!dev[dosingActiveTopicName]) { return; }
                if (newValue === true) {
                    log.warning("[seko-dosing-ctrl-{}] alarm signal received from station", name);
                }
                applyRelay();
            }
        });
    }

    if (phMinusSensorTopicName && phMinusEmptyTopicName) {
        defineRule("dosing-ph-minus-changed-" + name, {
            whenChanged: [phMinusSensorTopicName],
            then: function (newValue) {
                dev[phMinusEmptyTopicName] = (newValue === true);
                if (newValue === true) {
                    log.warning("[seko-dosing-ctrl-{}] ph minus canister is empty", name);
                }
            }
        });
    }

    if (chlorineSensorTopicName && chlorineEmptyTopicName) {
        defineRule("dosing-chlorine-changed-" + name, {
            whenChanged: [chlorineSensorTopicName],
            then: function (newValue) {
                dev[chlorineEmptyTopicName] = (newValue === true);
                if (newValue === true) {
                    log.warning("[seko-dosing-ctrl-{}] chlorine canister is empty", name);
                }
            }
        });
    }

    // --- Мониторинг насосов дозирования ---

    // Храним историю состояний за последний час: массив объектов {ts, state}
    var phPumpHistory       = phPumpSensorTopicName      ? [] : null;
    var chlorinePumpHistory = chlorinePumpSensorTopicName ? [] : null;

    function cleanupHistory(history) {
        var cutoff = Date.now() - 3600000;
        var i = 0;
        while (i < history.length && history[i].ts < cutoff) { i++; }
        if (i > 0) { history.splice(0, i); }
    }

    function calcDutyCycle(history) {
        cleanupHistory(history);
        if (history.length === 0) { return 0; }
        var now = Date.now();
        var windowStart = now - 3600000;
        var activeMs = 0;
        for (var i = 0; i < history.length; i++) {
            if (!history[i].state) { continue; }
            var segStart = history[i].ts;
            var segEnd   = (i + 1 < history.length) ? history[i + 1].ts : now;
            if (segStart < windowStart) { segStart = windowStart; }
            if (segEnd > segStart) { activeMs += segEnd - segStart; }
        }
        return Math.round(activeMs / 36000) / 100; // %
    }

    function onPumpChanged(newValue, history, dailyRuntimeTopicName, totalVolumeTopicName, flowRateTopicName) {
        var now = Date.now();
        // Если есть предыдущая запись и насос работал — начисляем время и объём
        if (history.length > 0) {
            var last = history[history.length - 1];
            if (last.state === true) {
                var dtMin = (now - last.ts) / 60000;
                dev[dailyRuntimeTopicName] += dtMin;
                var flowRate = dev[flowRateTopicName];
                if (flowRate && flowRate > 0) {
                    dev[totalVolumeTopicName] += flowRate / 60 * dtMin;
                }
            }
        }
        history.push({ ts: now, state: newValue });
        cleanupHistory(history);
    }

    if (phPumpSensorTopicName) {
        defineRule("ph-pump-changed-" + name, {
            whenChanged: [phPumpSensorTopicName],
            then: function (newValue) {
                onPumpChanged(
                    newValue,
                    phPumpHistory,  // не null, т.к. phPumpSensorTopicName задан
                    phPumpDailyRuntimeTopicName,
                    phPumpTotalVolumeTopicName,
                    phPumpFlowRateTopicName
                );
            }
        });

        defineRule("ph-pump-reset-btn-" + name, {
            whenChanged: [phPumpResetBtnTopicName],
            then: function () {
                dev[phPumpTotalVolumeTopicName] = 0;
                log.info("[seko-dosing-ctrl-{}] ph pump total volume reset", name);
            }
        });
    }

    if (chlorinePumpSensorTopicName) {
        defineRule("chlorine-pump-changed-" + name, {
            whenChanged: [chlorinePumpSensorTopicName],
            then: function (newValue) {
                onPumpChanged(
                    newValue,
                    chlorinePumpHistory,
                    chlorinePumpDailyRuntimeTopicName,
                    chlorinePumpTotalVolumeTopicName,
                    chlorinePumpFlowRateTopicName
                );
            }
        });

        defineRule("chlorine-pump-reset-btn-" + name, {
            whenChanged: [chlorinePumpResetBtnTopicName],
            then: function () {
                dev[chlorinePumpTotalVolumeTopicName] = 0;
                log.info("[seko-dosing-ctrl-{}] chlorine pump total volume reset", name);
            }
        });
    }

    if (phPumpSensorTopicName || chlorinePumpSensorTopicName) {
        defineRule("pump-duty-cycle-tick-" + name, {
            when: cron("@every 1m"),
            then: function () {
                if (phPumpSensorTopicName) {
                    dev[phPumpDutyCycleTopicName] = calcDutyCycle(phPumpHistory);
                }
                if (chlorinePumpSensorTopicName) {
                    dev[chlorinePumpDutyCycleTopicName] = calcDutyCycle(chlorinePumpHistory);
                }
            }
        });

        defineRule("pump-daily-reset-" + name, {
            when: cron("0 0 * * *"),
            then: function () {
                if (phPumpSensorTopicName) {
                    dev[phPumpDailyRuntimeTopicName] = 0;
                }
                if (chlorinePumpSensorTopicName) {
                    dev[chlorinePumpDailyRuntimeTopicName] = 0;
                }
                log.info("[seko-dosing-ctrl-{}] daily pump runtime reset", name);
            }
        });
    }

    function checkCalibration() {
        var now = Date.now();

        var phCalibratedAt = dev[phCalibratedAtTopicName];
        var phInterval     = dev[phCalibrationIntervalTopicName];
        if (!phInterval || phInterval <= 0) { phInterval = 30; }
        if (phCalibratedAt === 0) {
            dev[phNeedsCalibrationTopicName] = true;
        } else {
            dev[phNeedsCalibrationTopicName] = (now - phCalibratedAt) >= phInterval * 86400000;
        }

        var redoxCalibratedAt = dev[redoxCalibratedAtTopicName];
        var redoxInterval     = dev[redoxCalibrationIntervalTopicName];
        if (!redoxInterval || redoxInterval <= 0) { redoxInterval = 30; }
        if (redoxCalibratedAt === 0) {
            dev[redoxNeedsCalibrationTopicName] = true;
        } else {
            dev[redoxNeedsCalibrationTopicName] = (now - redoxCalibratedAt) >= redoxInterval * 86400000;
        }
    }

    defineRule("ph-calibrate-btn-" + name, {
        whenChanged: [phCalibrateBtnTopicName],
        then: function () {
            dev[phCalibratedAtTopicName] = Date.now();
            log.info("[seko-dosing-ctrl-{}] ph sensor calibrated", name);
            checkCalibration();
        }
    });

    defineRule("redox-calibrate-btn-" + name, {
        whenChanged: [redoxCalibrateBtnTopicName],
        then: function () {
            dev[redoxCalibratedAtTopicName] = Date.now();
            log.info("[seko-dosing-ctrl-{}] redox sensor calibrated", name);
            checkCalibration();
        }
    });

    defineRule("calibration-check-" + name, {
        when: cron("@every 1h"),
        then: function () {
            checkCalibration();
        }
    });

    // Инициализация при старте — приводим реле и статус в актуальное состояние
    applyRelay();
    checkCalibration();

    return {
        modeTopicName: modeTopicName
    };
}

// --- Точка входа ---

var dosing = makeSekoDosingController(
    "outdoor",
    "wb-mio-gpio_17:1/K3",
    "pool-filtration-ctrl-outdoor/mode",
    "wb-mcm8_238/Input 5"
);
