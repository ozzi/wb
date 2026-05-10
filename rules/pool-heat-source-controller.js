// Version: 3
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
    heatExchangerPumpPowerTopicName
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
                    1: {en: "Boiler", ru: "Электрокотёл"}
                }
            },
            coast_down_minutes: {
                title: "coast down minutes",
                type: "value",
                value: 3,
                readonly: false
            }
        }
    });

    var heatSourceTopicName      = deviceName + "/heat_source";
    var coastDownMinutesTopicName = deviceName + "/coast_down_minutes";

    var coastDownTimer = null;

    function cancelCoastDownTimer() {
        if (coastDownTimer !== null) {
            clearTimeout(coastDownTimer);
            coastDownTimer = null;
        }
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

    function applyHeatRequest() {
        var heatRequest = dev[poolHeatRequestTopicName];
        var heatSource  = dev[heatSourceTopicName];
        log("[pool-heat-source-{}] heat_request = {}, heat_source = {}", name, heatRequest, heatSource);

        if (heatSource === 1) {
            // Режим электрокотла: асики останавливаем принудительно
            dev[asicCmdTopics.forceStop] = true;
            if (heatRequest === POOL_STATUS_HEATING) {
                cancelCoastDownTimer();
                startHeatExchangerPump();
                startBoiler();
            } else {
                // WAITING_SETTLE, IDLE, OFF, STANDBY, ERROR — котёл останавливаем
                stopBoiler();
                scheduleHeatExchangerPumpStop();
            }
            return;
        }

        // Режим ASIC (heatSource === 0)
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
            // STATUS_OFF, STATUS_STANDBY, STATUS_ERROR_* — немедленная остановка
            scheduleHeatExchangerPumpStop();
            dev[asicCmdTopics.forceStop] = true;
        }
    }

    defineRule("pool-heat-source-" + name, {
        whenChanged: [poolHeatRequestTopicName, heatSourceTopicName],
        then: function () {
            applyHeatRequest();
        }
    });

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
    "pump-pwm-controller-pool-heat-exchanger/power"
);
