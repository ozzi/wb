function makeSekoDosingController(
    name,
    relayTopicName,
    filtrationModeTopicName,
    alarmTopicName,
    phMinusSensorTopicName,
    chlorineSensorTopicName
) {
    var deviceName = "seko-dosing-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "Seko Dosing Controller - " + name,
        cells: {
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
            ph_minus_empty: {
                title: "ph minus empty",
                type: "switch",
                value: false,
                readonly: true
            },
            chlorine_empty: {
                title: "chlorine empty",
                type: "switch",
                value: false,
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
        }
    });

    var modeTopicName            = deviceName + "/mode";
    var bathingDurationTopicName = deviceName + "/bathing_duration";
    var bathingRemainingTopicName = deviceName + "/bathing_remaining";
    var dosingActiveTopicName    = deviceName + "/dosing_active";
    var statusTopicName           = deviceName + "/status";
    var phMinusEmptyTopicName          = deviceName + "/ph_minus_empty";
    var chlorineEmptyTopicName         = deviceName + "/chlorine_empty";
    var phCalibrationIntervalTopicName = deviceName + "/ph_calibration_interval";
    var phCalibratedAtTopicName        = deviceName + "/ph_calibrated_at";
    var phNeedsCalibrationTopicName    = deviceName + "/ph_needs_calibration";
    var phCalibrateBtnTopicName        = deviceName + "/ph_calibrate_btn";
    var redoxCalibrationIntervalTopicName = deviceName + "/redox_calibration_interval";
    var redoxCalibratedAtTopicName        = deviceName + "/redox_calibrated_at";
    var redoxNeedsCalibrationTopicName    = deviceName + "/redox_needs_calibration";
    var redoxCalibrateBtnTopicName        = deviceName + "/redox_calibrate_btn";

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
        var mode             = dev[modeTopicName];
        var filtrationMode   = dev[filtrationModeTopicName];
        var bathingRemaining = dev[bathingRemainingTopicName];
        var dosingActive     = dev[dosingActiveTopicName];

        if (bathingRemaining > 0) {
            dev[statusTopicName] = "bathing";
        } else if (!dosingActive) {
            dev[statusTopicName] = "idle";
        } else if (alarmTopicName && dev[alarmTopicName] === true) {
            dev[statusTopicName] = "alarm";
        } else {
            dev[statusTopicName] = "ok";
        }
    }

    function applyRelay() {
        var mode             = dev[modeTopicName];
        var filtrationMode   = dev[filtrationModeTopicName];
        var bathingRemaining = dev[bathingRemainingTopicName];

        var allowed = (mode === 0) &&
                      (filtrationMode === 1) &&
                      (bathingRemaining === 0);

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
                // Игнорируем сигнал аварии если дозирование не активно —
                // станция уходит в аварию когда мы сами отключаем реле
                if (!dev[dosingActiveTopicName]) { return; }
                if (newValue === true) {
                    log.warning("[seko-dosing-ctrl-{}] alarm signal received from station", name);
                }
                applyStatus();
            }
        });
    }

    if (phMinusSensorTopicName) {
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

    if (chlorineSensorTopicName) {
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

    return {
        modeTopicName: modeTopicName
    };
}

// --- Точка входа ---

var dosing = makeSekoDosingController(
    "outdoor",
    "wbio-ssr8/K1",
    "pool-filtration-ctrl-outdoor/mode",
    "wb-mcm8_238/Input 5",
    "wb-mcm8_238/Input 6",
    "wb-mcm8_238/Input 7"
);
