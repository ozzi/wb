var POOL_STATUS_IDLE             = 2;
var POOL_STATUS_HEATING          = 3;
var POOL_STATUS_WAITING_SETTLE   = 6;

function makeASICPoolHeatController(
    name,
    poolHeatRequestTopicName,
    asicDeviceNames,
    boilerRelayTopicName
) {
    var deviceName = "asic-pool-heat-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "ASIC Pool Heat Controller - " + name,
        cells: {
            heat_source: {
                title: "heat source",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                    0: {en: "ASIC", ru: "ASIC"},
                    1: {en: "Boiler", ru: "Электрокотёл"}
                }
            },
            min_run_minutes: {
                title: "min run minutes",
                type: "value",
                value: 30,
                readonly: false
            },
            mining_started_at: {
                title: "mining started at (ms)",
                type: "value",
                value: 0,
                readonly: true
            }
        }
    });

    var heatSourceTopicName = deviceName + "/heat_source";
    var minRunMinutesTopicName = deviceName + "/min_run_minutes";
    var miningStartedAtTopicName = deviceName + "/mining_started_at";

    var stopTimer = null;

    function cancelStopTimer() {
        if (stopTimer !== null) {
            clearTimeout(stopTimer);
            stopTimer = null;
        }
    }

    function stopAllASICs() {
        log("[asic-pool-heat-{}] stopping all ASICs", name);
        for (var i = 0; i < asicDeviceNames.length; i++) {
            dev[asicDeviceNames[i] + "/stop_mining"] = true;
        }
        dev[miningStartedAtTopicName] = 0;
    }

    function startAllASICs() {
        log("[asic-pool-heat-{}] starting all ASICs", name);
        var anyStarted = false;
        for (var i = 0; i < asicDeviceNames.length; i++) {
            var asicDevice = asicDeviceNames[i];
            var state = dev[asicDevice + "/state"];
            if (state === "failure") {
                log("[asic-pool-heat-{}] skipping {} — device is in failure state", name, asicDevice);
                continue;
            }
            dev[asicDevice + "/start_mining"] = true;
            anyStarted = true;
        }
        if (anyStarted && (!dev[miningStartedAtTopicName] || dev[miningStartedAtTopicName] === 0)) {
            dev[miningStartedAtTopicName] = Date.now();
        }
    }

    function stopBoiler() {
        if (boilerRelayTopicName) {
            log("[asic-pool-heat-{}] stopping boiler", name);
            dev[boilerRelayTopicName] = false;
        }
    }

    function startBoiler() {
        if (boilerRelayTopicName) {
            log("[asic-pool-heat-{}] starting boiler", name);
            dev[boilerRelayTopicName] = true;
        }
    }

    function applyHeatRequest() {
        var heatRequest = dev[poolHeatRequestTopicName];
        var heatSource  = dev[heatSourceTopicName];
        log("[asic-pool-heat-{}] heat_request = {}, heat_source = {}", name, heatRequest, heatSource);

        if (heatSource === 1) {
            // Режим электрокотла: асики не трогаем, управляем только реле котла
            cancelStopTimer();
            stopAllASICs();
            if (heatRequest === POOL_STATUS_HEATING) {
                startBoiler();
            } else if (heatRequest === POOL_STATUS_WAITING_SETTLE) {
                log("[asic-pool-heat-{}] boiler mode: waiting for temperature settle, doing nothing", name);
            } else {
                stopBoiler();
            }
            return;
        }

        // Режим ASIC (heatSource === 0)
        stopBoiler();

        if (heatRequest === POOL_STATUS_HEATING) {
            cancelStopTimer();
            // Если miningStartedAt не установлен — фиксируем текущее время
            // (асик мог быть запущен до старта wb-rules)
            if (!dev[miningStartedAtTopicName] || dev[miningStartedAtTopicName] === 0) {
                dev[miningStartedAtTopicName] = Date.now();
            }
            startAllASICs();
        } else if (heatRequest === POOL_STATUS_WAITING_SETTLE) {
            // Ждём стабилизации температуры после запуска фильтрации — асики не трогаем
            log("[asic-pool-heat-{}] waiting for temperature settle, doing nothing", name);
        } else if (heatRequest === POOL_STATUS_IDLE) {
            var miningStartedAt = dev[miningStartedAtTopicName];
            if (!miningStartedAt || miningStartedAt === 0) {
                // Асик никогда не запускался этим контроллером — останавливаем на всякий случай
                stopAllASICs();
                return;
            }
            var minRunMinutes = dev[minRunMinutesTopicName];
            var elapsed = (Date.now() - miningStartedAt) / 60000;
            var remaining = minRunMinutes - elapsed;
            if (remaining <= 0) {
                stopAllASICs();
            } else {
                log("[asic-pool-heat-{}] idle: waiting {} min before stop", name, Math.ceil(remaining));
                cancelStopTimer();
                stopTimer = setTimeout(function () {
                    stopTimer = null;
                    stopAllASICs();
                }, remaining * 60 * 1000);
            }
        } else {
            // STATUS_OFF, STATUS_STANDBY, STATUS_ERROR_* — немедленная остановка
            cancelStopTimer();
            stopAllASICs();
        }
    }

    defineRule("asic-pool-heat-" + name, {
        whenChanged: [poolHeatRequestTopicName, heatSourceTopicName],
        then: function () {
            applyHeatRequest();
        }
    });

    applyHeatRequest();
}

makeASICPoolHeatController(
    "outdoor",
    "pool-heat-ctrl-outdoor/status",
    ["ANTMINER S21e"],
    "wb-mr6cu_XX/K1"  // TODO: заменить на реальный топик реле электрокотла
);
