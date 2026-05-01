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
            }
        }
    });

    var modeTopicName            = deviceName + "/mode";
    var bathingDurationTopicName = deviceName + "/bathing_duration";
    var bathingRemainingTopicName = deviceName + "/bathing_remaining";
    var dosingActiveTopicName    = deviceName + "/dosing_active";
    var statusTopicName           = deviceName + "/status";
    var phMinusEmptyTopicName     = deviceName + "/ph_minus_empty";
    var chlorineEmptyTopicName    = deviceName + "/chlorine_empty";

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
