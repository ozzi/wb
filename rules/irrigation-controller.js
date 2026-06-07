function makeIrrigationController(
    name,
    tankStatusTopic,
    pulseCounterTopic,
    pumpRelayTopic
) {
    var deviceName = "irrigation-" + name;
    var lastPulseCount = null;

    defineVirtualDevice(deviceName, {
        title: "Irrigation Controller - " + name,
        cells: {
            watering_allowed: {
                type: "switch",
                readonly: true,
                value: false
            },
            maintenance_mode: {
                type: "switch",
                value: false
            },
            pulses_per_liter: {
                type: "value",
                value: 10
            },
            total_liters: {
                type: "value",
                readonly: true,
                value: 0
            },
            reset_total: {
                type: "pushbutton"
            }
        }
    });

    function updatePumpState() {
        var tankStatus = dev[tankStatusTopic];
        var maintenance = !!dev[deviceName]["maintenance_mode"];
        
        // Разрешаем полив, если нет сервисного режима и бак не пустой/не в ошибке
        var allowed = !maintenance && (tankStatus !== "empty" && tankStatus !== "error");
        
        if (dev[deviceName]["watering_allowed"] !== allowed) {
            dev[deviceName]["watering_allowed"] = allowed;
        }
        
        // Управляем реле насоса
        if (dev[pumpRelayTopic] !== allowed) {
            dev[pumpRelayTopic] = allowed;
        }
    }

    defineRule({
        whenChanged: [
            tankStatusTopic,
            deviceName + "/maintenance_mode"
        ],
        then: function() {
            updatePumpState();
        }
    });

    defineRule({
        whenChanged: [
            pulseCounterTopic
        ],
        then: function() {
            var currentPulses = dev[pulseCounterTopic];
            
            // Инициализация при первом запуске, чтобы не было скачка
            if (lastPulseCount === null) {
                lastPulseCount = currentPulses;
                return;
            }
            
            var delta = currentPulses - lastPulseCount;
            if (delta > 0) {
                var pulsesPerLiter = parseFloat(dev[deviceName]["pulses_per_liter"]) || 1;
                var liters = delta / pulsesPerLiter;
                dev[deviceName]["total_liters"] = dev[deviceName]["total_liters"] + liters;
            }
            lastPulseCount = currentPulses;
        }
    });

    defineRule({
        whenChanged: [
            deviceName + "/reset_total"
        ],
        then: function() {
            dev[deviceName]["total_liters"] = 0;
        }
    });
    
    // Первоначальное вычисление состояния
    updatePumpState();
    lastPulseCount = dev[pulseCounterTopic];
}

makeIrrigationController(
    "main",
    "tank-level-main/status",
    "wb-mr6cv3_52/Counter 1",
    "wb-mr6cv3_52/K3"
);
