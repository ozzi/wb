// Интервал дозирования — раз в час (захардкожено)
var COAGULANT_DOSE_INTERVAL_MS = 60 * 60 * 1000;

function makeCoagulantDosingController(
    name,
    relayTopicName,
    filtrationModeTopicName,
    levelSensorTopicName
) {
    var deviceName = "coagulant-dosing-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "Coagulant Dosing Controller - " + name,
        cells: {
            enabled: {
                title: "enabled",
                type: "switch",
                value: true,
                readonly: false
            },
            pool_volume: {
                title: "pool volume",
                type: "value",
                unit: "м³",
                value: 50,
                readonly: false
            },
            dose_rate: {
                title: "dose rate",
                type: "value",
                unit: "мл/м³/сут",
                value: 40,
                readonly: false
            },
            concentration: {
                title: "solution concentration",
                type: "value",
                unit: "мл коаг./л р-ра",
                value: 100,
                readonly: false
            },
            flow_rate: {
                title: "pump flow rate",
                type: "value",
                unit: "л/ч",
                value: 1.5,
                readonly: false
            },
            dose_duration: {
                title: "dose duration",
                type: "value",
                unit: "сек",
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
            total_volume: {
                title: "total volume dosed",
                type: "value",
                unit: "л",
                value: 0,
                readonly: true
            },
            reset_btn: {
                title: "reset total volume",
                type: "pushbutton",
                readonly: false
            },
            canister_empty: {
                title: "canister empty",
                type: "switch",
                value: false,
                readonly: true
            }
        }
    });

    var enabledTopicName        = deviceName + "/enabled";
    var poolVolumeTopicName     = deviceName + "/pool_volume";
    var doseRateTopicName       = deviceName + "/dose_rate";
    var concentrationTopicName  = deviceName + "/concentration";
    var flowRateTopicName       = deviceName + "/flow_rate";
    var doseDurationTopicName   = deviceName + "/dose_duration";
    var dosingActiveTopicName   = deviceName + "/dosing_active";
    var statusTopicName         = deviceName + "/status";
    var totalVolumeTopicName    = deviceName + "/total_volume";
    var resetBtnTopicName       = deviceName + "/reset_btn";
    var canisterEmptyTopicName  = deviceName + "/canister_empty";

    var doseTimer     = null;
    var intervalTimer = null;

    // Рассчитываем длительность одной дозы в секундах и обновляем топик
    function calcAndApplyDoseDuration() {
        var poolVolume    = dev[poolVolumeTopicName];
        var doseRate      = dev[doseRateTopicName];
        var concentration = dev[concentrationTopicName];
        var flowRate      = dev[flowRateTopicName];

        if (!poolVolume    || poolVolume    <= 0 ||
            !doseRate      || doseRate      <= 0 ||
            !concentration || concentration <= 0 ||
            !flowRate      || flowRate      <= 0) {
            dev[doseDurationTopicName] = 0;
            return 0;
        }

        // Суточный объём раствора (л) = норма(мл) * объём(м³) / концентрация(мл/л) / 1000
        var dailyVolumeLiters = (doseRate * poolVolume) / (concentration * 1000);
        // Объём одной дозы (л) = суточный объём / 24 доз
        var doseVolumeLiters  = dailyVolumeLiters / 24;
        // Длительность (сек) = объём(л) / производительность(л/ч) * 3600
        var durationSec = doseVolumeLiters / flowRate * 3600;
        durationSec = Math.round(durationSec);
        if (durationSec < 1) { durationSec = 1; }

        dev[doseDurationTopicName] = durationSec;
        return durationSec;
    }

    function stopDose() {
        if (doseTimer !== null) {
            clearTimeout(doseTimer);
            doseTimer = null;
        }
        dev[relayTopicName]      = false;
        dev[dosingActiveTopicName] = false;
        dev[statusTopicName]     = "idle";
    }

    function startDose() {
        var filtrationMode = dev[filtrationModeTopicName];
        var enabled        = dev[enabledTopicName];

        if (filtrationMode !== 1 || enabled !== true) {
            return;
        }

        var duration = calcAndApplyDoseDuration();
        if (!duration || duration <= 0) {
            log.warning("[coagulant-dosing-ctrl-{}] dose duration is 0, skipping dose", name);
            return;
        }

        log.info("[coagulant-dosing-ctrl-{}] starting dose for {} sec", name, duration);

        dev[relayTopicName]        = true;
        dev[dosingActiveTopicName] = true;
        dev[statusTopicName]       = "dosing";

        doseTimer = setTimeout(function () {
            doseTimer = null;

            // Начисляем объём
            var flowRate = dev[flowRateTopicName];
            if (flowRate && flowRate > 0) {
                var durationHours = duration / 3600;
                dev[totalVolumeTopicName] += flowRate * durationHours;
            }

            stopDose();
            log.info("[coagulant-dosing-ctrl-{}] dose complete", name);
        }, duration * 1000);
    }

    function scheduleInterval() {
        if (intervalTimer !== null) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }

        intervalTimer = setInterval(function () {
            startDose();
        }, COAGULANT_DOSE_INTERVAL_MS);
    }

    function applyState() {
        var filtrationMode = dev[filtrationModeTopicName];
        var enabled        = dev[enabledTopicName];

        if (filtrationMode !== 1 || enabled !== true) {
            stopDose();
            if (intervalTimer !== null) {
                clearInterval(intervalTimer);
                intervalTimer = null;
            }
            dev[statusTopicName] = "idle";
            return;
        }

        // Фильтрация активна — запускаем первую дозу сразу и планируем интервал
        scheduleInterval();
        startDose();
    }

    defineRule("coagulant-filtration-changed-" + name, {
        whenChanged: [filtrationModeTopicName],
        then: function () {
            applyState();
        }
    });

    defineRule("coagulant-enabled-changed-" + name, {
        whenChanged: [enabledTopicName],
        then: function () {
            applyState();
        }
    });

    defineRule("coagulant-params-changed-" + name, {
        whenChanged: [
            poolVolumeTopicName,
            doseRateTopicName,
            concentrationTopicName,
            flowRateTopicName
        ],
        then: function () {
            calcAndApplyDoseDuration();
        }
    });

    if (levelSensorTopicName) {
        defineRule("coagulant-level-sensor-changed-" + name, {
            whenChanged: [levelSensorTopicName],
            then: function (newValue) {
                dev[canisterEmptyTopicName] = (newValue === true);
                if (newValue === true) {
                    log.warning("[coagulant-dosing-ctrl-{}] coagulant canister is empty", name);
                }
            }
        });
    }

    defineRule("coagulant-reset-btn-" + name, {
        whenChanged: [resetBtnTopicName],
        then: function () {
            dev[totalVolumeTopicName] = 0;
            log.info("[coagulant-dosing-ctrl-{}] total volume reset", name);
        }
    });

    // Инициализация
    calcAndApplyDoseDuration();
    applyState();

    return {
        dosingActiveTopicName: dosingActiveTopicName
    };
}

// --- Точка входа ---

var coagulantDosing = makeCoagulantDosingController(
    "outdoor",
    "wb-mr6cu_91/K4",
    "pool-filtration-ctrl-outdoor/mode",
    undefined
);
