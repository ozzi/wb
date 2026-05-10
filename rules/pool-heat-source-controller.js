// Version: 4
// Оркестратор источника тепла для бассейна.
// Читает статус от pool-heat-controller, выбирает источник тепла (ASIC или электрокотёл)
// и делегирует управление соответствующему драйверу.

var POOL_STATUS_IDLE           = 2;
var POOL_STATUS_HEATING        = 3;
var POOL_STATUS_WAITING_SETTLE = 6;

function makePoolHeatSourceController(
    name,
    poolHeatRequestTopicName,
    asicCmdTopics,
    boilerRelayTopicName,
    heatExchangerPumpPowerTopicName,
    asicStateTopicName
) {
    var deviceName = "pool-heat-source-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "Pool Heat Source Controller - " + name,
        cells: {
            heat_source: {
                title: "heat source",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                    0: {en: "ASIC",   ru: "ASIC"},
                    1: {en: "Boiler", ru: "Электрокотёл"},
                    2: {en: "Auto",   ru: "Авто"}
                }
            },
            coast_down_minutes: {
                title: "coast down minutes",
                type: "value",
                value: 3,
                readonly: false
            },
            asic_fallback_minutes: {
                title: "asic fallback minutes",
                type: "value",
                value: 10,
                readonly: false
            },
            asic_state: {
                title: "asic state (auto mode)",
                type: "text",
                value: "",
                readonly: true
            }
        }
    });

    var heatSourceTopicName       = deviceName + "/heat_source";
    var coastDownMinutesTopicName = deviceName + "/coast_down_minutes";
    var asicFallbackMinutesTopicName = deviceName + "/asic_fallback_minutes";
    var asicStateTopicNameLocal   = deviceName + "/asic_state";

    var coastDownTimer = null;
    var asicFallbackTimer = null;
    var asicFallbackActive = false;

    function cancelCoastDownTimer() {
        if (coastDownTimer !== null) {
            clearTimeout(coastDownTimer);
            coastDownTimer = null;
        }
    }

    function cancelAsicFallbackTimer() {
        if (asicFallbackTimer !== null) {
            clearTimeout(asicFallbackTimer);
            asicFallbackTimer = null;
        }
    }

    function isAsicBad(asicState) {
        return asicState === "failure" || asicState === "unavailable";
    }

    function startHeatExchangerPump() {
        if (heatExchangerPumpPowerTopicName) {
            log("[pool-heat-source-{}] starting heat exchanger pump", name);
            dev[heatExchangerPumpPowerTopicName] = 1000;
        }
    }

    function stopHeatExchangerPump() {
        if (heatExchangerPumpPowerTopicName) {
            log("[pool-heat-source-{}] stopping heat exchanger pump", name);
            dev[heatExchangerPumpPowerTopicName] = 0;
        }
    }

    function scheduleHeatExchangerPumpStop() {
        if (!heatExchangerPumpPowerTopicName) { return; }
        cancelCoastDownTimer();
        var minutes = dev[coastDownMinutesTopicName];
        if (!minutes || minutes <= 0) {
            stopHeatExchangerPump();
            return;
        }
        log("[pool-heat-source-{}] coast down: stopping pump in {} min", name, minutes);
        coastDownTimer = setTimeout(function () {
            coastDownTimer = null;
            stopHeatExchangerPump();
        }, minutes * 60 * 1000);
    }

    function stopBoiler() {
        if (boilerRelayTopicName) {
            log("[pool-heat-source-{}] stopping boiler", name);
            dev[boilerRelayTopicName] = false;
        }
    }

    function startBoiler() {
        if (boilerRelayTopicName) {
            log("[pool-heat-source-{}] starting boiler", name);
            dev[boilerRelayTopicName] = true;
        }
    }

    function applyHeatRequestAsic(heatRequest) {
        stopBoiler();
        if (heatRequest === POOL_STATUS_HEATING) {
            cancelCoastDownTimer();
            startHeatExchangerPump();
            dev[asicCmdTopics.heat] = true;
        } else if (heatRequest === POOL_STATUS_WAITING_SETTLE) {
            log("[pool-heat-source-{}] ASIC mode: waiting for temperature settle, doing nothing", name);
        } else if (heatRequest === POOL_STATUS_IDLE) {
            scheduleHeatExchangerPumpStop();
            dev[asicCmdTopics.idle] = true;
        } else {
            scheduleHeatExchangerPumpStop();
            dev[asicCmdTopics.forceStop] = true;
        }
    }

    function applyHeatRequestBoiler(heatRequest) {
        dev[asicCmdTopics.forceStop] = true;
        if (heatRequest === POOL_STATUS_HEATING) {
            cancelCoastDownTimer();
            startHeatExchangerPump();
            startBoiler();
        } else {
            stopBoiler();
            scheduleHeatExchangerPumpStop();
        }
    }

    function applyHeatRequest() {
        var heatRequest = dev[poolHeatRequestTopicName];
        var heatSource  = dev[heatSourceTopicName];
        log("[pool-heat-source-{}] heat_request = {}, heat_source = {}", name, heatRequest, heatSource);

        if (heatSource === 1) {
            // Режим электрокотла
            cancelAsicFallbackTimer();
            asicFallbackActive = false;
            applyHeatRequestBoiler(heatRequest);
            return;
        }

        if (heatSource === 0) {
            // Режим ASIC
            cancelAsicFallbackTimer();
            asicFallbackActive = false;
            applyHeatRequestAsic(heatRequest);
            return;
        }

        // Режим Auto (heatSource === 2)
        if (!asicStateTopicName) {
            log("[pool-heat-source-{}] auto mode: asicStateTopicName not set, fallback to ASIC", name);
            applyHeatRequestAsic(heatRequest);
            return;
        }

        var asicState = dev[asicStateTopicName];
        dev[asicStateTopicNameLocal] = asicState || "";

        if (!isAsicBad(asicState)) {
            // Асик в норме — отменяем таймер фолбэка, работаем на асике
            if (asicFallbackActive) {
                log("[pool-heat-source-{}] auto mode: ASIC recovered, switching back to ASIC", name);
                asicFallbackActive = false;
                stopBoiler();
            }
            cancelAsicFallbackTimer();
            applyHeatRequestAsic(heatRequest);
            return;
        }

        // Асик плохой
        if (asicFallbackActive) {
            // Уже переключились на котёл
            applyHeatRequestBoiler(heatRequest);
            return;
        }

        // Запускаем таймер фолбэка если ещё не запущен
        if (asicFallbackTimer === null) {
            var minutes = dev[asicFallbackMinutesTopicName];
            if (!minutes || minutes <= 0) { minutes = 10; }
            log("[pool-heat-source-{}] auto mode: ASIC is {}, fallback to boiler in {} min", name, asicState, minutes);
            asicFallbackTimer = setTimeout(function () {
                asicFallbackTimer = null;
                asicFallbackActive = true;
                log("[pool-heat-source-{}] auto mode: fallback timer fired, switching to boiler", name);
                applyHeatRequest();
            }, minutes * 60 * 1000);
        }

        // Пока таймер не истёк — продолжаем на асике (он может восстановиться)
        applyHeatRequestAsic(heatRequest);
    }

    defineRule("pool-heat-source-" + name, {
        whenChanged: [poolHeatRequestTopicName, heatSourceTopicName],
        then: function () {
            applyHeatRequest();
        }
    });

    if (asicStateTopicName) {
        defineRule("pool-heat-source-asic-state-" + name, {
            whenChanged: [asicStateTopicName],
            then: function () {
                var heatSource = dev[heatSourceTopicName];
                if (heatSource !== 2) { return; }
                applyHeatRequest();
            }
        });
    }

    // Не вызываем applyHeatRequest() при старте — состояние восстановится
    // через defineRule когда придут retained-значения из MQTT
}

makePoolHeatSourceController(
    "outdoor",
    "pool-heat-ctrl-outdoor/status",
    {
        heat:      "asic-cooling-ctrl-outdoor/heat",
        idle:      "asic-cooling-ctrl-outdoor/idle",
        forceStop: "asic-cooling-ctrl-outdoor/force_stop"
    },
    "wb-mio-gpio_17:1/K1",
    "pump-pwm-controller-pool-heat-exchanger/power",
    "ANTMINER S21e/state"
);
