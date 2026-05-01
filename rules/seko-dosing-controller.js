function makeSekoDosingController(
    name,
    relayTopicName,
    filtrationModeTopicName
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
            }
        }
    });

    var modeTopicName            = deviceName + "/mode";
    var bathingDurationTopicName = deviceName + "/bathing_duration";
    var bathingRemainingTopicName = deviceName + "/bathing_remaining";
    var dosingActiveTopicName    = deviceName + "/dosing_active";

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

    function applyRelay() {
        var mode            = dev[modeTopicName];
        var filtrationMode  = dev[filtrationModeTopicName];
        var bathingRemaining = dev[bathingRemainingTopicName];

        var allowed = (mode === 0) &&
                      (filtrationMode === 1) &&
                      (bathingRemaining === 0);

        dev[dosingActiveTopicName] = allowed;
        dev[relayTopicName] = allowed;
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

    return {
        modeTopicName: modeTopicName
    };
}

// --- Точка входа ---

var dosing = makeSekoDosingController(
    "outdoor",
    "wbio-ssr8/K1",
    "pool-filtration-ctrl-outdoor/mode"
);
